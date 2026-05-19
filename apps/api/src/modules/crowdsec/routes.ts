/**
 * CrowdSec Integration
 *
 * CrowdSec is a collaborative, open-source security engine that detects
 * attacks from server logs and shares intelligence across its network.
 *
 * Architecture:
 *   - CrowdSec Agent  — reads logs, detects attacks, writes decisions to the local DB
 *   - Local API (LAPI) — agents + bouncers (central stack often :8888; Manager UI :8080)
 *   - Bouncer         — reads decisions from LAPI and enforces bans (nginx, iptables, etc.)
 *
 * HostPanel uses a bouncer API key (CROWDSEC_API_KEY) for decisions; /v1/heartbeat needs
 * machine auth and is not used. Bouncer lists on central setups come from Manager API.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { execFile } from "node:child_process";
import { exec } from "child_process";
import { isIP } from "node:net";
import { promisify } from "util";
import { requireRole } from "../../lib/auth.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Panel API user cannot read /etc/crowdsec/config.yaml; cscli needs root (see deploy/hostpanel.sudoers). */
const SUDO = "sudo";
const CSCLI_BIN = "/usr/bin/cscli";
const SYSTEMCTL_BIN = "/bin/systemctl";

const DECISION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const BOUNCER_NAME_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
const HUB_NAME_RE = /^[a-zA-Z0-9@._/-]{1,200}$/;
const SCENARIO_FILTER_RE = /^[a-zA-Z0-9@._/-]{1,200}$/;
const HUB_TYPES = ["collections", "parsers", "scenarios", "postoverflows"] as const;
type HubType = (typeof HUB_TYPES)[number];

function isHubType(v: string): v is HubType {
  return (HUB_TYPES as readonly string[]).includes(v);
}

function parseHubList(stdout: string, key: HubType): Record<string, unknown>[] {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>;
    const list = j[key];
    return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

function isHubItemEnabled(item: Record<string, unknown>): boolean {
  return String(item.status ?? "").includes("enabled");
}

function hubSummaryFromLists(lists: Record<HubType, Record<string, unknown>[]>) {
  const sum = (t: HubType) => {
    const items = lists[t];
    const enabled = items.filter(isHubItemEnabled).length;
    return { total: items.length, enabled };
  };
  return {
    collections: sum("collections"),
    parsers: sum("parsers"),
    scenarios: sum("scenarios"),
    postoverflows: sum("postoverflows"),
  };
}

function hubInstalledOnly(lists: Record<HubType, Record<string, unknown>[]>) {
  const pick = (t: HubType) =>
    lists[t]
      .filter(isHubItemEnabled)
      .map((i) => ({
        name: String(i.name ?? ""),
        status: String(i.status ?? ""),
        local_version: i.local_version != null ? String(i.local_version) : undefined,
        description: i.description != null ? String(i.description) : undefined,
      }));
  return {
    collections: pick("collections"),
    parsers: pick("parsers"),
    scenarios: pick("scenarios"),
    postoverflows: pick("postoverflows"),
  };
}

const CROWDSEC_API = (process.env.CROWDSEC_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const CROWDSEC_KEY = process.env.CROWDSEC_API_KEY ?? "";
const CROWDSEC_MANAGER = (process.env.CROWDSEC_MANAGER_URL ?? "").replace(/\/$/, "");
const CROWDSEC_MANAGER_TOKEN = process.env.CROWDSEC_MANAGER_TOKEN ?? "";
const CROWDSEC_LOCAL_LAPI = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(CROWDSEC_API);

function managerRequestInit(extra?: RequestInit): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra?.headers as Record<string, string> | undefined),
  };
  if (CROWDSEC_MANAGER_TOKEN) {
    headers.Authorization = `Bearer ${CROWDSEC_MANAGER_TOKEN}`;
  }
  return { ...extra, headers };
}

type BouncerRow = { name: string; ip_address: string; type: string; last_pull: string };

async function probeLapiReachable(): Promise<boolean> {
  if (!CROWDSEC_KEY) {
    const cli = await runCscli(["lapi", "status"]);
    return cli.ok && /successfully interact/i.test(cli.stdout);
  }
  const decisions = await csApi<unknown[]>("/decisions?limit=1");
  if (decisions.ok) return true;
  const cli = await runCscli(["lapi", "status"]);
  return cli.ok && /successfully interact/i.test(cli.stdout);
}

async function getAgentVersion(): Promise<string> {
  const cli = await runCscli(["version"]);
  const m = cli.stdout.match(/version[:\s]+(\S+)/i);
  return m?.[1] ?? "unknown";
}

async function getHostIps(): Promise<Set<string>> {
  const r = await runCmd("hostname -I 2>/dev/null");
  return new Set(r.stdout.split(/\s+/).filter((ip) => isIP(ip)));
}

async function fetchBouncers(): Promise<BouncerRow[]> {
  if (CROWDSEC_MANAGER) {
    try {
      const res = await fetch(`${CROWDSEC_MANAGER}/api/crowdsec/bouncers`, {
        ...managerRequestInit(),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: { bouncers?: Record<string, string>[] } };
        const raw = json?.data?.bouncers ?? [];
        const hostIps = await getHostIps();
        const rows: BouncerRow[] = raw.map((b) => ({
          name: String(b.name ?? ""),
          ip_address: String(b.ip_address ?? ""),
          type: String(b.type ?? "bouncer"),
          last_pull: String(b.last_pull ?? ""),
        }));
        if (hostIps.size === 0) return rows;
        return rows.filter((b) => b.ip_address && hostIps.has(b.ip_address));
      }
    } catch {
      /* fall through */
    }
  }

  const result = await runCscli(["bouncers", "list", "-o", "json"]);
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, string>[];
    return (parsed ?? []).map((b) => ({
      name: String(b.name ?? ""),
      ip_address: String(b.ip_address ?? ""),
      type: String(b.type ?? ""),
      last_pull: String(b.last_pull ?? ""),
    }));
  } catch {
    return [];
  }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function csApi<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  try {
    const res = await fetch(`${CROWDSEC_API}/v1${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": CROWDSEC_KEY,
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 204) return { ok: true, status: 204 };
    const data = await res.json() as T;
    return { ok: res.ok, data, status: res.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message, status: 0 };
  }
}

async function runCscli(args: string[]): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(SUDO, ["-n", CSCLI_BIN, ...args], {
      timeout: 20_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    return { ok: true, stdout: String(stdout).trim(), stderr: String(stderr).trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: String(e.stdout ?? "").trim(),
      stderr: String(e.stderr ?? e.message ?? "").trim(),
    };
  }
}

async function runCrowdsecSystemctl(args: string[]): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(SUDO, ["-n", SYSTEMCTL_BIN, ...args], {
      timeout: 20_000,
      encoding: "utf8",
    });
    return { ok: true, stdout: String(stdout).trim(), stderr: String(stderr).trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: String(e.stdout ?? "").trim(),
      stderr: String(e.stderr ?? e.message ?? "").trim(),
    };
  }
}

async function runCmd(cmd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 20000 });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? "", stderr: (e.stderr ?? e.message ?? "").trim(), ok: false };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function crowdsecRoutes(app: FastifyInstance) {
  // GET /api/crowdsec/status — agent + LAPI health
  app.get("/status", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const [lapiOk, agentVersion, agentStatus, bouncers, fwBouncer, fwPlaceholder, collList, parseList, scenList, postList] =
      await Promise.all([
      probeLapiReachable(),
      getAgentVersion(),
      runCmd("systemctl is-active crowdsec 2>/dev/null || cscli version 2>/dev/null | head -1"),
      fetchBouncers(),
      runCmd("systemctl is-active crowdsec-firewall-bouncer 2>/dev/null"),
      runCmd(
        'f=/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml; if [ ! -f "$f" ]; then echo missing; elif grep -qF \'${API_KEY}\' "$f" 2>/dev/null; then echo placeholder; else echo keyed; fi',
      ),
      runCscli(["collections", "list", "-o", "json"]),
      runCscli(["parsers", "list", "-o", "json"]),
      runCscli(["scenarios", "list", "-o", "json"]),
      runCscli(["postoverflows", "list", "-o", "json"]),
    ]);

    const hubLists = {
      collections: parseHubList(collList.stdout, "collections"),
      parsers: parseHubList(parseList.stdout, "parsers"),
      scenarios: parseHubList(scenList.stdout, "scenarios"),
      postoverflows: parseHubList(postList.stdout, "postoverflows"),
    };

    const isInstalled = agentStatus.ok || agentStatus.stdout.includes("version");
    const isRunning = agentStatus.stdout === "active" || lapiOk;

    const rawYamlState = fwPlaceholder.stdout.trim();
    const firewallYamlState: "missing" | "placeholder" | "keyed" =
      rawYamlState === "missing" || rawYamlState === "placeholder" || rawYamlState === "keyed"
        ? rawYamlState
        : "keyed";
    const firewallBouncerActive = fwBouncer.stdout === "active";
    const firewallBouncerNeedsApiKey = firewallYamlState === "placeholder";

    return reply.send({
      success: true,
      data: {
        installed: isInstalled,
        running: isRunning,
        lapiReachable: lapiOk,
        lapiVersion: agentVersion,
        lapiUrl: CROWDSEC_API,
        lapiMode: CROWDSEC_LOCAL_LAPI ? "local" : "central",
        centralManagerUrl: CROWDSEC_MANAGER || undefined,
        bouncers,
        firewallBouncerActive,
        firewallBouncerNeedsApiKey,
        firewallBouncerYaml: firewallYamlState,
        firewallBouncerUnit: "crowdsec-firewall-bouncer",
        hub: hubSummaryFromLists(hubLists),
        hubInstalled: hubInstalledOnly(hubLists),
      },
    });
  });

  // GET /api/crowdsec/metrics — hub metrics / scenario counts
  app.get("/metrics", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const result = await runCscli(["metrics", "-o", "json"]);
    try {
      return reply.send({ success: true, data: JSON.parse(result.stdout) });
    } catch {
      return reply.send({ success: true, data: {} });
    }
  });

  // GET /api/crowdsec/alerts — recent alerts
  app.get("/alerts", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { limit?: string; since?: string; ip?: string; scenario?: string };
    const limit = Math.min(500, Math.max(1, Number.parseInt(String(query.limit ?? "50"), 10) || 50));
    const params = new URLSearchParams({ limit: String(limit) });
    if (query.since) {
      const since = String(query.since).trim();
      if (since.length > 64 || !/^[0-9TZ:.\-+]+$/.test(since)) {
        return reply.status(400).send({ success: false, error: "Invalid since parameter" });
      }
      params.set("since", since);
    }
    if (query.ip) {
      if (!isIP(query.ip)) {
        return reply.status(400).send({ success: false, error: "Invalid ip parameter" });
      }
      params.set("ip", query.ip);
    }
    if (query.scenario) {
      if (!SCENARIO_FILTER_RE.test(query.scenario)) {
        return reply.status(400).send({ success: false, error: "Invalid scenario parameter" });
      }
      params.set("scenario", query.scenario);
    }

    const result = await csApi<unknown[]>(`/alerts?${params}`);

    if (!result.ok) {
      // Fallback: try cscli CLI
      const lim = Math.min(500, Math.max(1, Number.parseInt(String(query.limit ?? "50"), 10) || 50));
      const cli = await runCscli(["alerts", "list", "-o", "json", "--limit", String(lim)]);
      try {
        return reply.send({ success: true, data: JSON.parse(cli.stdout) });
      } catch {
        return reply.send({ success: false, error: result.error ?? "CrowdSec LAPI not reachable", data: [] });
      }
    }

    return reply.send({ success: true, data: result.data ?? [] });
  });

  // GET /api/crowdsec/decisions — active bans/captchas
  app.get("/decisions", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { limit?: string; type?: string; ip?: string; scope?: string };
    const limit = Math.min(500, Math.max(1, Number.parseInt(String(query.limit ?? "200"), 10) || 200));
    const params = new URLSearchParams({ limit: String(limit) });
    if (query.type) {
      if (!["ban", "captcha"].includes(query.type)) {
        return reply.status(400).send({ success: false, error: "Invalid type parameter" });
      }
      params.set("type", query.type);
    }
    if (query.ip) {
      if (!isIP(query.ip)) {
        return reply.status(400).send({ success: false, error: "Invalid ip parameter" });
      }
      params.set("ip", query.ip);
    }
    if (query.scope) {
      if (!/^[A-Za-z]{1,32}$/.test(query.scope)) {
        return reply.status(400).send({ success: false, error: "Invalid scope parameter" });
      }
      params.set("scope", query.scope);
    }

    const result = await csApi<unknown[]>(`/decisions?${params}`);

    if (!result.ok) {
      const cli = await runCscli(["decisions", "list", "-o", "json"]);
      try {
        return reply.send({ success: true, data: JSON.parse(cli.stdout) });
      } catch {
        return reply.send({ success: false, error: result.error ?? "LAPI not reachable", data: [] });
      }
    }

    return reply.send({ success: true, data: result.data ?? [] });
  });

  // POST /api/crowdsec/decisions — manually ban an IP
  app.post("/decisions", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = z.object({
      ip: z.string().min(1),
      duration: z.string().min(1).max(32).default("4h"),
      reason: z.string().max(2000).default("Manual ban from HostPanel"),
      type: z.enum(["ban", "captcha"]).default("ban"),
    }).safeParse(request.body);

    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });
    const { ip, duration, reason, type } = body.data;

    if (!isIP(ip)) {
      return reply.status(400).send({ success: false, error: "Invalid IPv4/IPv6 address" });
    }

    // Try LAPI first
    const result = await csApi("/decisions", {
      method: "POST",
      body: JSON.stringify([{
        duration,
        reason,
        scope: "Ip",
        type,
        value: ip,
      }]),
    });

    if (!result.ok) {
      // Fallback: cscli CLI
      const cli = await runCscli(["decisions", "add", "--ip", ip, "--duration", duration, "--reason", reason, "--type", type]);
      if (!cli.ok) return reply.status(500).send({ success: false, error: cli.stderr });
      return reply.status(201).send({ success: true, message: `${ip} ${type === "ban" ? "banned" : "captcha'd"} for ${duration}` });
    }

    return reply.status(201).send({ success: true, message: `${ip} ${type === "ban" ? "banned" : "captcha'd"} for ${duration}` });
  });

  // DELETE /api/crowdsec/decisions/:id — unban/remove a decision
  app.delete("/decisions/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!DECISION_ID_RE.test(id)) {
      return reply.status(400).send({ success: false, error: "Invalid decision id" });
    }

    const result = await csApi(`/decisions/${id}`, { method: "DELETE" });

    if (!result.ok) {
      const cli = await runCscli(["decisions", "delete", "--id", id]);
      if (!cli.ok) return reply.status(500).send({ success: false, error: cli.stderr });
    }

    return reply.send({ success: true, message: `Decision ${id} removed` });
  });

  // DELETE /api/crowdsec/decisions — unban by IP
  app.delete("/decisions", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { ip?: string };
    if (!query.ip || !isIP(query.ip)) {
      return reply.status(400).send({ success: false, error: "Valid ip query param required" });
    }

    const result = await csApi(`/decisions?ip=${encodeURIComponent(query.ip)}`, { method: "DELETE" });

    if (!result.ok) {
      const cli = await runCscli(["decisions", "delete", "--ip", query.ip]);
      if (!cli.ok) return reply.status(500).send({ success: false, error: cli.stderr });
    }

    return reply.send({ success: true, message: `All decisions for ${query.ip} removed` });
  });

  // GET /api/crowdsec/hub — installed hub items (collections, parsers, scenarios, postoverflows)
  app.get("/hub", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const [collections, parsers, scenarios, postoverflows] = await Promise.all([
      runCscli(["collections", "list", "-o", "json"]),
      runCscli(["parsers", "list", "-o", "json"]),
      runCscli(["scenarios", "list", "-o", "json"]),
      runCscli(["postoverflows", "list", "-o", "json"]),
    ]);

    const lists = {
      collections: parseHubList(collections.stdout, "collections"),
      parsers: parseHubList(parsers.stdout, "parsers"),
      scenarios: parseHubList(scenarios.stdout, "scenarios"),
      postoverflows: parseHubList(postoverflows.stdout, "postoverflows"),
    };

    return reply.send({
      success: true,
      data: {
        ...lists,
        summary: hubSummaryFromLists(lists),
        installed: hubInstalledOnly(lists),
      },
    });
  });

  // POST /api/crowdsec/hub/install — install a hub item by name
  app.post("/hub/install", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = z.object({
      type: z.enum(HUB_TYPES),
      name: z.string().min(1).max(200).regex(HUB_NAME_RE),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { type, name } = body.data;
    const result = await runCscli([type, "install", name]);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr || result.stdout });
    const reload = await runCrowdsecSystemctl(["reload", "crowdsec"]);
    if (!reload.ok) await runCrowdsecSystemctl(["restart", "crowdsec"]);
    return reply.send({ success: true, data: { output: result.stdout || result.stderr } });
  });

  // DELETE /api/crowdsec/hub/:type/:name — remove a hub item
  app.delete("/hub/:type/:name", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { type, name } = request.params as { type: string; name: string };
    if (!isHubType(type) || !HUB_NAME_RE.test(name)) {
      return reply.status(400).send({ success: false, error: "Invalid type or name" });
    }
    const result = await runCscli([type, "remove", name]);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr || result.stdout });
    const reload = await runCrowdsecSystemctl(["reload", "crowdsec"]);
    if (!reload.ok) await runCrowdsecSystemctl(["restart", "crowdsec"]);
    return reply.send({ success: true, data: { output: result.stdout || result.stderr } });
  });

  // POST /api/crowdsec/hub/upgrade-item — upgrade one hub item
  app.post("/hub/upgrade-item", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = z.object({
      type: z.enum(HUB_TYPES),
      name: z.string().min(1).max(200).regex(HUB_NAME_RE),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { type, name } = body.data;
    const result = await runCscli([type, "upgrade", name]);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr || result.stdout });
    const reload = await runCrowdsecSystemctl(["reload", "crowdsec"]);
    if (!reload.ok) await runCrowdsecSystemctl(["restart", "crowdsec"]);
    return reply.send({ success: true, data: { output: result.stdout || result.stderr } });
  });

  // POST /api/crowdsec/hub/update — cscli hub update
  app.post("/hub/update", { preHandler: requireRole("superadmin") }, async (_request, reply) => {
    const u = await runCscli(["hub", "update"]);
    const up = await runCscli(["hub", "upgrade"]);
    const result = { ok: u.ok && up.ok, stdout: `${u.stdout}\n${up.stdout}`, stderr: `${u.stderr}\n${up.stderr}` };
    return reply.send({ success: result.ok, data: { output: result.stdout || result.stderr } });
  });

  // POST /api/crowdsec/hub/setup — install collections/parsers/scenarios for this host's log sources
  app.post("/hub/setup", { preHandler: requireRole("superadmin") }, async (_request, reply) => {
    const installDir = process.env.HP_INSTALL_DIR ?? "/opt/hostpanel";
    const script = `${installDir}/deploy/ensure-crowdsec-hub.sh`;
    try {
      const { stdout, stderr } = await execFileAsync(SUDO, ["-n", "/bin/bash", script], {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, HP_INSTALL_DIR: installDir },
      });
      return reply.send({
        success: true,
        data: { output: [String(stdout).trim(), String(stderr).trim()].filter(Boolean).join("\n") },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return reply.status(500).send({
        success: false,
        error: String(e.stderr ?? e.message ?? "hub setup failed"),
        data: { output: [String(e.stdout ?? "").trim(), String(e.stderr ?? "").trim()].filter(Boolean).join("\n") },
      });
    }
  });

  // POST /api/crowdsec/bouncers — register bouncer (central Manager API or local cscli)
  app.post("/bouncers", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(128).regex(BOUNCER_NAME_RE) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "name required" });

    const { name } = body.data;

    if (CROWDSEC_MANAGER) {
      try {
        const res = await fetch(`${CROWDSEC_MANAGER}/api/crowdsec/bouncers`, {
          ...managerRequestInit({
            method: "POST",
            body: JSON.stringify({ name }),
          }),
          signal: AbortSignal.timeout(10000),
        });
        const json = (await res.json()) as { data?: { api_key?: string; name?: string } };
        if (res.ok && json?.data?.api_key) {
          return reply.status(201).send({
            success: true,
            data: { name: json.data.name ?? name, api_key: json.data.api_key, source: "manager" },
            message: "API key shown once — copy it now",
          });
        }
      } catch {
        /* fall through to cscli */
      }
    }

    const result = await runCscli(["bouncers", "add", name, "-o", "json"]);
    try {
      const data = JSON.parse(result.stdout);
      return reply.status(201).send({ success: true, data: { ...data, source: "local" } });
    } catch {
      if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
      return reply.status(201).send({ success: true, data: { output: result.stdout, source: "local" } });
    }
  });

  // DELETE /api/crowdsec/bouncers/:name — remove bouncer
  app.delete("/bouncers/:name", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!BOUNCER_NAME_RE.test(name)) {
      return reply.status(400).send({ success: false, error: "Invalid bouncer name" });
    }

    if (CROWDSEC_MANAGER) {
      try {
        const res = await fetch(`${CROWDSEC_MANAGER}/api/crowdsec/bouncers/${encodeURIComponent(name)}`, {
          ...managerRequestInit({ method: "DELETE" }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) return reply.send({ success: true, message: `Bouncer '${name}' removed from central console` });
      } catch {
        /* fall through */
      }
    }

    const result = await runCscli(["bouncers", "delete", name]);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `Bouncer '${name}' removed` });
  });

  // POST /api/crowdsec/services/:unit/restart — crowdsec | crowdsec-firewall-bouncer
  app.post("/services/:unit/restart", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { unit } = request.params as { unit: string };
    const allowed = ["crowdsec", "crowdsec-firewall-bouncer"] as const;
    if (!allowed.includes(unit as (typeof allowed)[number])) {
      return reply.status(400).send({ success: false, error: "Invalid unit" });
    }
    const result = await runCrowdsecSystemctl(["restart", unit]);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    const active = await runCrowdsecSystemctl(["is-active", unit]);
    return reply.send({
      success: active.stdout === "active",
      data: { unit, active: active.stdout === "active", output: result.stdout },
    });
  });

  // POST /api/crowdsec/install — install CrowdSec on the host
  app.post("/install", { preHandler: requireRole("superadmin") }, async (_request, reply) => {
    const checkResult = await runCmd("which cscli");
    if (checkResult.ok) return reply.send({ success: true, message: "CrowdSec is already installed", alreadyInstalled: true });

    const result = await runCmd(`
      curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash &&
      apt-get install -y crowdsec crowdsec-firewall-bouncer-iptables &&
      systemctl enable crowdsec --now
    `);

    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });

    const installDir = process.env.HP_INSTALL_DIR ?? "/opt/hostpanel";
    const hubScript = `${installDir}/deploy/ensure-crowdsec-hub.sh`;
    let hubOutput = "";
    try {
      const { stdout, stderr } = await execFileAsync(SUDO, ["-n", "/bin/bash", hubScript], {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, HP_INSTALL_DIR: installDir },
      });
      hubOutput = [String(stdout).trim(), String(stderr).trim()].filter(Boolean).join("\n");
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      hubOutput = [String(e.stdout ?? "").trim(), String(e.stderr ?? "hub setup failed")].filter(Boolean).join("\n");
    }

    return reply.send({
      success: true,
      message: "CrowdSec installed with hub parsers and scenarios",
      output: [result.stdout, hubOutput].filter(Boolean).join("\n\n"),
    });
  });

  // GET /api/crowdsec/logs — tail CrowdSec agent log
  app.get("/logs", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { lines?: string };
    const lines = Math.min(500, Math.max(1, Number.parseInt(String(query.lines ?? "100"), 10) || 100));
    const journal = await execFileAsync(SUDO, [
      "-n",
      "/usr/bin/journalctl",
      "-u",
      "crowdsec",
      "--no-pager",
      "-n",
      String(lines),
    ], { timeout: 20_000, encoding: "utf8" }).then(
      ({ stdout, stderr }) => ({ ok: true, stdout: String(stdout).trim(), stderr: String(stderr).trim() }),
      (err: unknown) => {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, stdout: String(e.stdout ?? "").trim(), stderr: String(e.stderr ?? e.message ?? "").trim() };
      },
    );
    const result = journal.ok
      ? journal
      : await runCmd(`tail -n ${lines} /var/log/crowdsec/crowdsec.log 2>/dev/null`);
    if (!result.ok) {
      return reply.send({ success: true, data: { lines: ["Log not available"] } });
    }
    return reply.send({ success: true, data: { lines: result.stdout.split("\n") } });
  });
}
