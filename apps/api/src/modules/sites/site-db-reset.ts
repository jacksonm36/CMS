import { access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import { prisma } from "@hostpanel/db";
import type { Site } from "@prisma/client";
import { ensureStackDbForSite } from "./site-stack-db.js";
import { writeSiteDbEnvFile } from "./write-site-db-env.js";
import { provisionCmsInstall } from "./cms-install-provision.js";
import { resolveCmsDbProfile, shouldProvisionCmsAfterInstall } from "./cms-db-profiles.js";
import type { SiteTemplate } from "@prisma/client";
import {
  engineFromEnvFile,
  prismaDbEngine,
  siteStackDbEngine,
  siteSupportsStackDb,
  type SiteDbEngine,
} from "./site-db-engine.js";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const WIPE_SCRIPT = "/opt/hostpanel/scripts/wipe-site-db.php";

export type SiteDbResetMode = "wipe" | "recreate";

export async function siteHasProvisionedDbEnv(rootPath: string): Promise<boolean> {
  try {
    await access(join(rootPath, ".hostpanel-db.env"));
    return true;
  } catch {
    return false;
  }
}

export async function readSiteDbEngineFromRoot(rootPath: string): Promise<SiteDbEngine | null> {
  try {
    const raw = await readFile(join(rootPath, ".hostpanel-db.env"), "utf8");
    const parsed: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t === "" || t.startsWith("#") || !t.includes("=")) continue;
      const [k, ...rest] = t.split("=");
      parsed[k.trim()] = rest.join("=").trim();
    }
    return engineFromEnvFile(parsed) ?? null;
  } catch {
    return null;
  }
}

/** @deprecated Use siteSupportsStackDb */
export function siteSupportsDockerMysql(site: Site): boolean {
  const e = siteStackDbEngine(site);
  return e === "mysql" || e === "mariadb";
}

export function siteSupportsRecreateStack(site: Site): boolean {
  return siteStackDbEngine(site) != null;
}

/** Wipe database content; credentials unchanged (all supported engines). */
export async function wipeSiteDatabase(rootPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await execFileAsync("sudo", ["-n", "/usr/bin/php", WIPE_SCRIPT, rootPath], {
      timeout: 300_000,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: (err.stderr || err.message || "wipe failed").trim() };
  }
}

/** Replace Docker stack DB or SQLite file with fresh storage and new .hostpanel-db.env. */
export async function recreateSiteStackDatabase(
  site: Site,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const engine = siteStackDbEngine(site);
  if (!engine) {
    return { ok: false, error: "Site has no stack database engine configured." };
  }

  let networkGroup = site.networkGroup;
  if (engine !== "sqlite" && !networkGroup) {
    networkGroup = `site-${site.id}`;
    await prisma.site.update({ where: { id: site.id }, data: { networkGroup } });
  }

  const db = await ensureStackDbForSite({
    siteId: site.id,
    siteRootPath: site.rootPath,
    networkGroupShort: networkGroup ?? `site-${site.id}`,
    dbStackVersion: site.dbStackVersion,
  });
  if (!db.ok) return { ok: false, error: db.error };

  await prisma.siteDatabase.deleteMany({ where: { siteId: site.id } });
  if (db.engine !== "sqlite") {
    await prisma.siteDatabase.create({
      data: {
        siteId: site.id,
        name: db.dbName,
        engine: prismaDbEngine(db.engine),
        host: "127.0.0.1",
        port: db.hostPort,
        username: db.dbUser,
        passwordHash: await bcrypt.hash(db.dbPassword, 10),
      },
    });
    await prisma.site.update({
      where: { id: site.id },
      data: { stackDbContainerId: db.containerId, stackDbHostPort: db.hostPort },
    });
  }

  await writeSiteDbEnvFile(
    site.rootPath,
    {
      engine: db.engine,
      host: "127.0.0.1",
      port: db.hostPort,
      database: db.dbName,
      username: db.dbUser,
      password: db.dbPassword,
      dbPath: db.dbPath,
    },
    { siteId: site.id },
  );

  const label =
    db.engine === "sqlite"
      ? `New SQLite file at ${db.dbPath ?? db.dbName}`
      : `New ${db.engine} database on 127.0.0.1:${db.hostPort}`;
  return { ok: true, message: label };
}

export async function resetSiteDatabase(
  site: Site,
  mode: SiteDbResetMode,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!(await siteHasProvisionedDbEnv(site.rootPath))) {
    return { ok: false, error: "No .hostpanel-db.env on this site." };
  }

  const engine =
    (await readSiteDbEngineFromRoot(site.rootPath)) ?? siteStackDbEngine(site);
  if (!engine) {
    return { ok: false, error: "Could not determine database engine for this site." };
  }

  if (mode === "recreate") {
    if (!site.dbStackVersion && engine) {
      return { ok: false, error: "Recreate requires dbStackVersion on the site record." };
    }
    if (siteSupportsStackDb(site) || engine === "sqlite") {
      return recreateSiteStackDatabase(site);
    }
    return { ok: false, error: "Recreate requires a provisioned stack dbStackVersion on the site." };
  }

  const wipe = await wipeSiteDatabase(site.rootPath);
  if (!wipe.ok) return wipe;

  const engineLabel = engine === "mariadb" ? "MariaDB/MySQL" : engine;
  return { ok: true, message: `${engineLabel}: data cleared; credentials unchanged.` };
}

/** Re-apply CMS config from .hostpanel-db.env after a DB reset. */
export async function reprovisionCmsAfterDbReset(site: Site, templateSlug: string | null): Promise<void> {
  if (!templateSlug) return;
  const tpl = await prisma.siteTemplate.findFirst({ where: { slug: templateSlug } });
  if (!tpl || !shouldProvisionCmsAfterInstall(tpl as SiteTemplate)) return;
  const profile = resolveCmsDbProfile(tpl.slug);
  if (profile) await provisionCmsInstall(site.rootPath, profile);
}

/** Whether reset-db menu applies to this site. */
export function siteCanResetDatabase(site: Site & { _count?: { databases: number } }): boolean {
  if (siteSupportsStackDb(site)) return true;
  return (site._count?.databases ?? 0) > 0;
}
