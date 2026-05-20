import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@hostpanel/db";
import {
  defaultPortForEngine,
  engineFromEnvFile,
  normalizeSiteDbEngine,
  type SiteDbEngine,
} from "../sites/site-db-engine.js";
import type { DbConnection } from "./db-client.js";

const SITE_CONN_ID_RE = /^site_[a-z0-9]+$/i;

export interface SiteDbCredentials {
  engine: SiteDbEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  siteId: string;
  siteDomain: string;
}

/** Parse `.hostpanel-db.env` (same rules as PHP loader). */
export function parseHostpanelDbEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const k = trimmed.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(k)) continue;
    let v = trimmed.slice(eq + 1).trim();
    if (v.includes("\0") || /[\r\n]/.test(v)) continue;
    parsed[k] = v;
  }
  const host = parsed.DB_HOST ?? parsed.HP_DB_HOST ?? "";
  if (host.toLowerCase() === "localhost") {
    parsed.DB_HOST = "127.0.0.1";
    parsed.HP_DB_HOST = "127.0.0.1";
  }
  return parsed;
}

export function isSiteConnectionId(connectionId: string): boolean {
  return SITE_CONN_ID_RE.test(connectionId);
}

export async function readSiteDbCredentials(siteId: string): Promise<SiteDbCredentials | null> {
  const row = await prisma.siteDatabase.findFirst({
    where: { siteId },
    include: { site: { select: { domain: true, rootPath: true, dbStackVersion: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;

  const envPath = join(row.site.rootPath, ".hostpanel-db.env");
  let parsed: Record<string, string>;
  try {
    parsed = parseHostpanelDbEnv(await readFile(envPath, "utf8"));
  } catch {
    return null;
  }

  const engine =
    engineFromEnvFile(parsed) ??
    normalizeSiteDbEngine(row.engine) ??
    normalizeSiteDbEngine(row.site.dbStackVersion?.split("-")[0]);
  if (!engine || engine === "sqlite" || engine === "mongodb" || engine === "mssql") {
    return null;
  }

  const host = parsed.DB_HOST ?? parsed.HP_DB_HOST ?? row.host ?? "127.0.0.1";
  const port = Number(parsed.DB_PORT ?? parsed.HP_DB_PORT ?? row.port ?? defaultPortForEngine(engine));
  const database = parsed.DB_NAME ?? parsed.HP_DB_NAME ?? row.name;
  const username = parsed.DB_USER ?? parsed.HP_DB_USER ?? row.username;
  const password = parsed.DB_PASSWORD ?? parsed.HP_DB_PASSWORD ?? "";

  if (!database || !username || !password) return null;

  return {
    engine,
    host: host.toLowerCase() === "localhost" ? "127.0.0.1" : host,
    port: Number.isFinite(port) ? port : defaultPortForEngine(engine),
    database,
    username,
    password,
    siteId: row.siteId,
    siteDomain: row.site.domain,
  };
}

export async function discoverSiteDbConnections(): Promise<DbConnection[]> {
  const rows = await prisma.siteDatabase.findMany({
    include: { site: { select: { domain: true, rootPath: true, dbStackVersion: true } } },
    orderBy: { site: { domain: "asc" } },
  });

  const out: DbConnection[] = [];
  for (const row of rows) {
    const creds = await readSiteDbCredentials(row.siteId);
    if (!creds) continue;
    const engineLabel =
      creds.engine === "postgresql"
        ? "postgresql"
        : creds.engine === "mariadb"
          ? "mariadb"
          : "mysql";
    out.push({
      id: `site_${row.id}`,
      name: `${creds.siteDomain} (sidecar ${engineLabel})`,
      engine: engineLabel,
      host: creds.host,
      port: creds.port,
      database: creds.database,
      username: creds.username,
      isDefault: false,
      siteId: creds.siteId,
      siteDomain: creds.siteDomain,
      managed: true,
    });
  }
  return out;
}

export async function resolveSiteDbCredentials(
  connectionId: string,
): Promise<SiteDbCredentials | null> {
  if (!isSiteConnectionId(connectionId)) return null;
  const siteDbId = connectionId.replace(/^site_/, "");
  const row = await prisma.siteDatabase.findUnique({
    where: { id: siteDbId },
    select: { siteId: true },
  });
  if (!row) return null;
  return readSiteDbCredentials(row.siteId);
}
