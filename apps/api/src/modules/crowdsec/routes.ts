/**
 * CrowdSec Integration
 *
 * CrowdSec is a collaborative, open-source security engine that detects
 * attacks from server logs and shares intelligence across its network.
 *
 * Architecture:
 *   - CrowdSec Agent  — reads logs, detects attacks, writes decisions to the local DB
 *   - Local API (LAPI) — REST API running at http://127.0.0.1:8080
 *   - Bouncer         — reads decisions from LAPI and enforces bans (nginx, iptables, etc.)
 *
 * This module talks to the CrowdSec LAPI using its API key.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { requireAuth, requireRole } from "../../lib/auth.js";

const execAsync = promisify(exec);

const CROWDSEC_API = process.env.CROWDSEC_API_URL ?? "http://127.0.0.1:8080";
const CROWDSEC_KEY = process.env.CROWDSEC_API_KEY ?? "";

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
  app.get("/status", { preHandler: requireAuth }, async (_request, reply) => {
    const [heartbeat, agentStatus, bouncerStatus] = await Promise.all([
      csApi("/heartbeat"),
      runCmd("systemctl is-active crowdsec 2>/dev/null || cscli version 2>/dev/null | head -1"),
      runCmd("cscli bouncers list -o json 2>/dev/null"),
    ]);

    const isInstalled = agentStatus.ok || agentStatus.stdout.includes("version");
    const isRunning = agentStatus.stdout === "active" || heartbeat.ok;

    let bouncers: unknown[] = [];
    try { bouncers = JSON.parse(bouncerStatus.stdout) ?? []; } catch {}

    return reply.send({
      success: true,
      data: {
        installed: isInstalled,
        running: isRunning,
        lapiReachable: heartbeat.ok,
        lapiVersion: (heartbeat.data as { version?: string } | undefined)?.version ?? "unknown",
        bouncers,
      },
    });
  });

  // GET /api/crowdsec/metrics — hub metrics / scenario counts
  app.get("/metrics", { preHandler: requireAuth }, async (_request, reply) => {
    const result = await runCmd("cscli metrics -o json 2>/dev/null || echo '{}'");
    try {
      return reply.send({ success: true, data: JSON.parse(result.stdout) });
    } catch {
      return reply.send({ success: true, data: {} });
    }
  });

  // GET /api/crowdsec/alerts — recent alerts
  app.get("/alerts", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { limit?: string; since?: string; ip?: string; scenario?: string };
    const params = new URLSearchParams();
    if (query.limit)    params.set("limit", query.limit);
    if (query.since)    params.set("since", query.since);
    if (query.ip)       params.set("ip", query.ip);
    if (query.scenario) params.set("scenario", query.scenario);

    const result = await csApi<unknown[]>(`/alerts?${params}`);

    if (!result.ok) {
      // Fallback: try cscli CLI
      const cli = await runCmd(`cscli alerts list -o json --limit ${query.limit ?? 50} 2>/dev/null || echo '[]'`);
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
    const params = new URLSearchParams({ limit: query.limit ?? "200" });
    if (query.type)  params.set("type", query.type);
    if (query.ip)    params.set("ip", query.ip);
    if (query.scope) params.set("scope", query.scope);

    const result = await csApi<unknown[]>(`/decisions?${params}`);

    if (!result.ok) {
      const cli = await runCmd(`cscli decisions list -o json 2>/dev/null || echo '[]'`);
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
      duration: z.string().default("4h"),
      reason: z.string().default("Manual ban from HostPanel"),
      type: z.enum(["ban", "captcha"]).default("ban"),
    }).safeParse(request.body);

    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });
    const { ip, duration, reason, type } = body.data;

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
      const cli = await runCmd(
        `cscli decisions add --ip "${ip}" --duration "${duration}" --reason "${reason}" --type "${type}" 2>&1`
      );
      if (!cli.ok) return reply.status(500).send({ success: false, error: cli.stderr });
      return reply.status(201).send({ success: true, message: `${ip} ${type === "ban" ? "banned" : "captcha'd"} for ${duration}` });
    }

    return reply.status(201).send({ success: true, message: `${ip} ${type === "ban" ? "banned" : "captcha'd"} for ${duration}` });
  });

  // DELETE /api/crowdsec/decisions/:id — unban/remove a decision
  app.delete("/decisions/:id", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await csApi(`/decisions/${id}`, { method: "DELETE" });

    if (!result.ok) {
      const cli = await runCmd(`cscli decisions delete --id "${id}" 2>&1`);
      if (!cli.ok) return reply.status(500).send({ success: false, error: cli.stderr });
    }

    return reply.send({ success: true, message: `Decision ${id} removed` });
  });

  // DELETE /api/crowdsec/decisions — unban by IP
  app.delete("/decisions", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { ip?: string };
    if (!query.ip) return reply.status(400).send({ success: false, error: "ip query param required" });

    const result = await csApi(`/decisions?ip=${encodeURIComponent(query.ip)}`, { method: "DELETE" });

    if (!result.ok) {
      const cli = await runCmd(`cscli decisions delete --ip "${query.ip}" 2>&1`);
      if (!cli.ok) return reply.status(500).send({ success: false, error: cli.stderr });
    }

    return reply.send({ success: true, message: `All decisions for ${query.ip} removed` });
  });

  // GET /api/crowdsec/hub — installed collections & parsers
  app.get("/hub", { preHandler: requireAuth }, async (_request, reply) => {
    const [collections, parsers, scenarios, postoverflows] = await Promise.all([
      runCmd("cscli collections list -o json 2>/dev/null || echo '[]'"),
      runCmd("cscli parsers list -o json 2>/dev/null || echo '[]'"),
      runCmd("cscli scenarios list -o json 2>/dev/null || echo '[]'"),
      runCmd("cscli postoverflows list -o json 2>/dev/null || echo '[]'"),
    ]);

    function safeParse(s: string) { try { return JSON.parse(s); } catch { return []; } }

    return reply.send({
      success: true,
      data: {
        collections: safeParse(collections.stdout),
        parsers: safeParse(parsers.stdout),
        scenarios: safeParse(scenarios.stdout),
        postoverflows: safeParse(postoverflows.stdout),
      },
    });
  });

  // POST /api/crowdsec/hub/update — cscli hub update
  app.post("/hub/update", { preHandler: requireRole("superadmin") }, async (_request, reply) => {
    const result = await runCmd("cscli hub update 2>&1 && cscli hub upgrade 2>&1");
    return reply.send({ success: result.ok, data: { output: result.stdout || result.stderr } });
  });

  // POST /api/crowdsec/bouncers — register a new bouncer
  app.post("/bouncers", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = z.object({ name: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "name required" });

    const result = await runCmd(`cscli bouncers add "${body.data.name}" -o json 2>&1`);
    try {
      const data = JSON.parse(result.stdout);
      return reply.status(201).send({ success: true, data });
    } catch {
      if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
      return reply.status(201).send({ success: true, data: { output: result.stdout } });
    }
  });

  // DELETE /api/crowdsec/bouncers/:name — remove bouncer
  app.delete("/bouncers/:name", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const result = await runCmd(`cscli bouncers delete "${name}" 2>&1`);
    if (!result.ok) return reply.status(500).send({ success: false, error: result.stderr });
    return reply.send({ success: true, message: `Bouncer '${name}' removed` });
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
    return reply.send({ success: true, message: "CrowdSec installed and started", output: result.stdout });
  });

  // GET /api/crowdsec/logs — tail CrowdSec agent log
  app.get("/logs", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { lines?: string };
    const lines = Math.min(500, Number(query.lines ?? 100));
    const result = await runCmd(
      `journalctl -u crowdsec --no-pager -n ${lines} 2>/dev/null || tail -n ${lines} /var/log/crowdsec/crowdsec.log 2>/dev/null || echo 'Log not available'`
    );
    return reply.send({ success: true, data: { lines: result.stdout.split("\n") } });
  });
}
