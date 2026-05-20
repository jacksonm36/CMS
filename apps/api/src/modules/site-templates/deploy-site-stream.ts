import { stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { prisma } from "@hostpanel/db";
import type { Site, SiteTemplate } from "@prisma/client";
import { runBashStreaming } from "../webservers/install-stream.js";
import { sanitizeDefaultDocument } from "../sites/default-document.js";
import { allocateHostPanelLoopbackPort } from "../sites/port-allocate.js";
import { PORT_ALLOC_END, PORT_ALLOC_START } from "../sites/site-docker-isolation.js";
import {
  alpinePackagesForStack,
  ensureAlpineSidecar,
  getSidecarStatus,
  provisionSidecarPackages,
  sidecarContainerName,
  type SidecarStack,
} from "../sites/site-docker-isolation.js";
import { ensureMysqlStackForSite } from "../sites/site-stack-mysql.js";
import { provisionSiteDir } from "../sites/provisioner.js";
import { writeSiteConfig, reloadWebServer, type WebServerType } from "../sites/webservers/index.js";
import { assertSafeSiteDomain, siteRootPathFromDomain } from "../sites/safe-site-domain.js";
import { getEffectiveDeployFlags } from "./template-deploy-flags.js";
import { writeSiteDbEnvFile } from "../sites/write-site-db-env.js";
import { getAppInstallRecipe } from "./template-app-recipes.js";
import bcrypt from "bcryptjs";

export type DeployStreamInput = {
  templateId: string;
  name: string;
  domain: string;
  ownerId?: string;
  actorUserId: string;
};

type WriteFn = (obj: Record<string, unknown>) => void;

function safeWrite(stream: PassThrough, obj: Record<string, unknown>): void {
  if (stream.destroyed) return;
  try {
    stream.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* client disconnected */
  }
}

function typeNeedsPort(type: string): boolean {
  return type === "nodejs" || type === "python";
}

function sidecarStackFromSite(site: Site): SidecarStack {
  return {
    type: site.type,
    appProxyPort: site.appProxyPort,
    dbStackVersion: site.dbStackVersion,
    phpVersion: site.phpVersion,
    nodeVersion: site.nodeVersion,
    pythonVersion: site.pythonVersion,
    networkGroup: site.networkGroup,
    isCentralService: site.isCentralService,
  };
}

async function runStep(
  write: WriteFn,
  stepIndex: number,
  total: number,
  id: string,
  title: string,
  cmd: string,
  timeoutMs: number,
): Promise<number> {
  write({ type: "phase", phase: id, title, index: stepIndex, total });
  const code = await runBashStreaming(cmd, (line, source) => write({ type: "log", line, source }), timeoutMs);
  write({ type: "step_complete", phase: id, code });
  return code;
}

/** Numeric `uid:gid` for `docker exec -u` — must match bind-mounted site root so Composer can write under `/srv`. */
function formatDockerExecUser(uid: number, gid: number): string | null {
  if (!Number.isFinite(uid) || !Number.isFinite(gid) || uid < 0 || gid < 0) return null;
  return `${Math.floor(uid)}:${Math.floor(gid)}`;
}

async function runSidecarStep(
  write: WriteFn,
  container: string,
  stepIndex: number,
  total: number,
  id: string,
  title: string,
  innerCmd: string,
  timeoutMs: number,
  /** When set (e.g. site dir owner), recipe commands run as that user; omit for root-only steps like `apk add`. */
  execUser?: string | null,
): Promise<number> {
  const escaped = innerCmd.replace(/'/g, `'\\''`);
  const userArg =
    execUser && /^\d+:\d+$/.test(execUser) ? `-u ${execUser} ` : "";
  return runStep(
    write,
    stepIndex,
    total,
    id,
    title,
    `docker exec ${userArg}${container} /bin/sh -c '${escaped}'`,
    timeoutMs,
  );
}

export async function runDeploySiteStream(input: DeployStreamInput, stream: PassThrough): Promise<void> {
  const write: WriteFn = (obj) => safeWrite(stream, obj);

  const phases: { id: string; title: string }[] = [
    { id: "validate", title: "Validate domain and template" },
    { id: "site-row", title: "Create site record" },
    { id: "files", title: "Provision site directory" },
    { id: "stack", title: "Docker network, database, sidecar" },
    { id: "app", title: "Install application files" },
    { id: "nginx", title: "Write nginx vhost and reload" },
  ];
  const total = phases.length;
  let step = 0;

  try {
    write({ type: "start", templateId: input.templateId, domain: input.domain });

    step++;
    write({ type: "phase", phase: "validate", title: phases[0]!.title, index: step, total });
    let domain: string;
    try {
      domain = assertSafeSiteDomain(input.domain);
    } catch (e) {
      write({ type: "done", ok: false, error: e instanceof Error ? e.message : "Invalid domain" });
      return;
    }

    const tpl = await prisma.siteTemplate.findUnique({ where: { id: input.templateId } });
    if (!tpl) {
      write({ type: "done", ok: false, error: "Template not found" });
      return;
    }
    if (tpl.webServer === "traefik" && (tpl.type === "php" || tpl.type === "static")) {
      write({ type: "done", ok: false, error: "Traefik cannot serve PHP/static for this template." });
      return;
    }
    const existing = await prisma.site.findUnique({ where: { domain } });
    if (existing) {
      write({ type: "done", ok: false, error: "Domain already exists" });
      return;
    }
    write({ type: "step_complete", phase: "validate", code: 0 });
    write({ type: "log", line: `Template: ${tpl.name} (${tpl.slug})`, source: "stdout" });

    step++;
    write({ type: "phase", phase: "site-row", title: phases[1]!.title, index: step, total });

    let ownerId = input.actorUserId;
    if (input.ownerId) {
      const assignee = await prisma.user.findUnique({ where: { id: input.ownerId } });
      if (!assignee) {
        write({ type: "done", ok: false, error: "Owner user not found" });
        return;
      }
      ownerId = assignee.id;
    }

    let appProxyPort = tpl.appProxyPort;
    if (!appProxyPort && typeNeedsPort(tpl.type)) {
      const allocated = await allocateHostPanelLoopbackPort();
      if (!allocated) {
        write({ type: "done", ok: false, error: `Port range ${PORT_ALLOC_START}–${PORT_ALLOC_END} exhausted` });
        return;
      }
      appProxyPort = allocated;
    }

    let inheritedDoc: string | null = tpl.defaultDocument ?? null;
    if (inheritedDoc) inheritedDoc = sanitizeDefaultDocument(inheritedDoc);
    if (inheritedDoc != null && tpl.type !== "static" && tpl.type !== "php") inheritedDoc = null;

    const rootPath = siteRootPathFromDomain(domain);
    const site = await prisma.site.create({
      data: {
        name: input.name,
        domain,
        ownerId,
        type: tpl.type,
        webServer: tpl.webServer,
        phpVersion: tpl.phpVersion,
        nodeVersion: tpl.nodeVersion,
        pythonVersion: tpl.pythonVersion,
        dbStackVersion: tpl.dbStackVersion,
        appProxyPort,
        networkGroup: tpl.networkGroup ?? null,
        isCentralService: tpl.isCentralService ?? false,
        templateId: tpl.id,
        defaultDocument: inheritedDoc,
        rootPath,
        status: "pending",
      },
    });
    write({ type: "step_complete", phase: "site-row", code: 0 });
    write({ type: "log", line: `Site id: ${site.id}`, source: "stdout" });

    step++;
    write({ type: "phase", phase: "files", title: phases[2]!.title, index: step, total });
    const appRecipe = getAppInstallRecipe(tpl.slug);
    try {
      await provisionSiteDir(rootPath, { skipPlaceholderIndex: !!appRecipe });
    } catch {
      await runStep(write, step, total, "mkdir", "Ensure site root exists", `sudo -n mkdir -p '${rootPath.replace(/'/g, `'\\''`)}' && sudo -n chown hostpanel:hostpanel '${rootPath.replace(/'/g, `'\\''`)}'`, 60_000);
    }
    write({ type: "step_complete", phase: "files", code: 0 });

    step++;
    write({ type: "phase", phase: "stack", title: phases[3]!.title, index: step, total });
    const stackWarnings = await provisionStackWithLogs(site, tpl, write, {
      /** App phase runs `apk add` with stack + recipe packages — avoid concurrent apk with fire-and-forget queue. */
      skipQueuedSidecarApk: !!appRecipe,
    });
    for (const w of stackWarnings) write({ type: "log", line: `warn: ${w}`, source: "stderr" });
    write({ type: "step_complete", phase: "stack", code: 0 });

    let working = (await prisma.site.findUnique({ where: { id: site.id } })) ?? site;

    step++;
    write({ type: "phase", phase: "app", title: phases[4]!.title, index: step, total });
    if (appRecipe) {
      const sidecar = sidecarContainerName(working.id);
      const st = getSidecarStatus(working.id);
      if (st.state !== "running") {
        write({ type: "log", line: "Sidecar not running — skipping app install", source: "stderr" });
      } else {
        let siteDirDockerUser: string | null = null;
        try {
          const st = await stat(rootPath);
          siteDirDockerUser = formatDockerExecUser(st.uid, st.gid);
        } catch {
          siteDirDockerUser = null;
        }
        if (siteDirDockerUser) {
          write({
            type: "log",
            line: `Running app install in sidecar as ${siteDirDockerUser} (site root owner)`,
            source: "stdout",
          });
        }
        const stack = sidecarStackFromSite(working);
        const pkgs = new Set([...alpinePackagesForStack(stack), ...(appRecipe.extraAlpinePackages ?? [])]);
        if (pkgs.size > 0) {
          write({ type: "log", line: `Installing sidecar packages: ${[...pkgs].join(", ")}`, source: "stdout" });
          const apkCode = await runSidecarStep(
            write,
            sidecar,
            step,
            total,
            "apk",
            "Install Alpine packages",
            `apk add --no-cache ${[...pkgs].join(" ")}`,
            600_000,
            null,
          );
          if (apkCode !== 0) {
            write({ type: "done", ok: false, error: "Sidecar package install failed", siteId: working.id });
            return;
          }
        }
        for (const s of appRecipe.steps) {
          const code = await runSidecarStep(
            write,
            sidecar,
            step,
            total,
            s.id,
            s.title,
            s.cmd,
            900_000,
            siteDirDockerUser,
          );
          if (code !== 0) {
            write({ type: "done", ok: false, error: `App install failed: ${s.title}`, siteId: working.id });
            return;
          }
        }
        if (appRecipe.defaultDocument) {
          const doc = sanitizeDefaultDocument(appRecipe.defaultDocument);
          if (doc) {
            working = await prisma.site.update({
              where: { id: working.id },
              data: { defaultDocument: doc },
            });
          }
        }
        await runStep(
          write,
          step,
          total,
          "chown",
          "Fix site file ownership",
          `sudo -n chown -R hostpanel:hostpanel '${rootPath.replace(/'/g, `'\\''`)}' || true`,
          120_000,
        );
      }
    } else {
      write({ type: "log", line: "No bundled app installer for this template — stack only.", source: "stdout" });
    }
    write({ type: "step_complete", phase: "app", code: 0 });

    step++;
    write({ type: "phase", phase: "nginx", title: phases[5]!.title, index: step, total });
    const fresh = await prisma.site.findUnique({ where: { id: working.id } });
    if (!fresh) {
      write({ type: "done", ok: false, error: "Site row missing" });
      return;
    }
    try {
      const configPath = await writeSiteConfig(fresh);
      await prisma.site.update({ where: { id: site.id }, data: { webConfigPath: configPath, status: "active" } });
      await reloadWebServer(fresh.webServer as WebServerType);
      write({ type: "log", line: `Vhost: ${configPath}`, source: "stdout" });
      write({ type: "step_complete", phase: "nginx", code: 0 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      write({ type: "done", ok: false, error: `Web config failed: ${msg}`, siteId: site.id });
      return;
    }

    const finalSite = await prisma.site.findUnique({ where: { id: site.id } });
    write({
      type: "done",
      ok: true,
      siteId: site.id,
      site: finalSite ?? fresh,
      warnings: stackWarnings,
    });
  } catch (e) {
    write({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (!stream.destroyed) stream.end();
  }
}

async function provisionStackWithLogs(
  site: Site,
  tpl: SiteTemplate,
  write: WriteFn,
  opts?: { skipQueuedSidecarApk?: boolean },
): Promise<string[]> {
  const flags = getEffectiveDeployFlags(tpl);
  const warnings: string[] = [];
  let working = site;

  if (!flags.autoDeployIsolation && !flags.stackNetworkPerSite && !flags.provisionDockerDb) {
    return warnings;
  }

  if (flags.stackNetworkPerSite && !working.networkGroup) {
    const ng = `site-${working.id}`;
    working = await prisma.site.update({ where: { id: working.id }, data: { networkGroup: ng } });
    write({ type: "log", line: `Network group: ${ng}`, source: "stdout" });
  }

  if (flags.provisionDockerDb && !working.networkGroup) {
    const ng = `site-${working.id}`;
    working = await prisma.site.update({ where: { id: working.id }, data: { networkGroup: ng } });
  }

  if (flags.provisionDockerDb && working.networkGroup) {
    write({ type: "log", line: "Starting Docker MySQL/MariaDB…", source: "stdout" });
    const db = await ensureMysqlStackForSite({
      siteId: working.id,
      networkGroupShort: working.networkGroup,
      dbStackVersion: working.dbStackVersion,
    });
    if (!db.ok) {
      warnings.push(`Stack MySQL: ${db.error}`);
      write({ type: "log", line: `DB error: ${db.error}`, source: "stderr" });
    } else {
      working = await prisma.site.update({
        where: { id: working.id },
        data: { stackDbContainerId: db.containerId, stackDbHostPort: db.hostPort },
      });
      write({ type: "log", line: `Database listening on 127.0.0.1:${db.hostPort}`, source: "stdout" });
      try {
        await prisma.siteDatabase.create({
          data: {
            siteId: working.id,
            name: db.dbName,
            engine: "mysql",
            host: "127.0.0.1",
            port: db.hostPort,
            username: db.dbUser,
            passwordHash: await bcrypt.hash(db.dbPassword, 10),
          },
        });
        await writeSiteDbEnvFile(working.rootPath, {
          engine: "mysql",
          host: "127.0.0.1",
          port: db.hostPort,
          database: db.dbName,
          username: db.dbUser,
          password: db.dbPassword,
        });
        write({ type: "log", line: "Wrote .hostpanel-db.env", source: "stdout" });
      } catch (e) {
        warnings.push(`SiteDatabase/env: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (flags.autoDeployIsolation) {
    if (process.platform === "win32") {
      warnings.push("Sidecar skipped on Windows host.");
    } else {
      write({ type: "log", line: "Starting Alpine sidecar…", source: "stdout" });
      const stack = sidecarStackFromSite(working);
      const r = ensureAlpineSidecar(working.id, working.rootPath, stack);
      if (!r.ok) {
        warnings.push(`Alpine sidecar: ${r.error}`);
        write({ type: "log", line: r.error, source: "stderr" });
      } else {
        await prisma.site.update({ where: { id: working.id }, data: { dockerContainerId: r.containerId } });
        write({ type: "log", line: `Sidecar: ${sidecarContainerName(working.id)}`, source: "stdout" });
        if (r.provisioned) {
          const pkgs = alpinePackagesForStack(stack);
          if (opts?.skipQueuedSidecarApk) {
            write({
              type: "log",
              line: `Skipping background apk (bundled installer will install: ${pkgs.join(", ")})`,
              source: "stdout",
            });
          } else {
            provisionSidecarPackages(sidecarContainerName(working.id), pkgs);
            write({ type: "log", line: `Queued apk: ${pkgs.join(", ")}`, source: "stdout" });
          }
        }
      }
    }
  }

  return warnings;
}
