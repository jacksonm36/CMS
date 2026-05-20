import type { Site } from "@prisma/client";
import { engineFromDbStackVersion, type SiteDbEngine } from "./site-db-engine.js";
import { ensureMysqlStackForSite, removeStackMysqlContainer as removeDockerStackDbContainer } from "./site-stack-mysql.js";
import { ensurePostgresStackForSite } from "./site-stack-postgres.js";
import { ensureMongodbStackForSite } from "./site-stack-mongodb.js";
import { ensureMssqlStackForSite } from "./site-stack-mssql.js";
import { ensureSqliteStackForSite } from "./site-stack-sqlite.js";

export type StackDbResult =
  | {
      ok: true;
      engine: SiteDbEngine;
      containerId: string | null;
      hostPort: number;
      dbName: string;
      dbUser: string;
      dbPassword: string;
      /** SQLite only — path relative to site root */
      dbPath?: string;
    }
  | { ok: false; error: string };

export function stackDbContainerName(siteId: string): string {
  return `hostpanel-sitedb-${siteId}`;
}

export function removeStackDbContainer(siteId: string): void {
  removeDockerStackDbContainer(siteId);
}

export async function ensureStackDbForSite(opts: {
  siteId: string;
  siteRootPath: string;
  networkGroupShort: string;
  dbStackVersion: string | null | undefined;
}): Promise<StackDbResult> {
  const engine = engineFromDbStackVersion(opts.dbStackVersion);
  if (!engine) {
    return { ok: false, error: "Unsupported or missing dbStackVersion for Docker DB provisioning." };
  }

  switch (engine) {
    case "mysql":
    case "mariadb": {
      const r = await ensureMysqlStackForSite({
        siteId: opts.siteId,
        networkGroupShort: opts.networkGroupShort,
        dbStackVersion: opts.dbStackVersion,
      });
      if (!r.ok) return r;
      return { ok: true, engine, containerId: r.containerId, hostPort: r.hostPort, dbName: r.dbName, dbUser: r.dbUser, dbPassword: r.dbPassword };
    }
    case "postgresql": {
      const r = await ensurePostgresStackForSite({
        siteId: opts.siteId,
        networkGroupShort: opts.networkGroupShort,
        dbStackVersion: opts.dbStackVersion,
      });
      if (!r.ok) return r;
      return { ok: true, engine, containerId: r.containerId, hostPort: r.hostPort, dbName: r.dbName, dbUser: r.dbUser, dbPassword: r.dbPassword };
    }
    case "mongodb": {
      const r = await ensureMongodbStackForSite({
        siteId: opts.siteId,
        networkGroupShort: opts.networkGroupShort,
        dbStackVersion: opts.dbStackVersion,
      });
      if (!r.ok) return r;
      return { ok: true, engine, containerId: r.containerId, hostPort: r.hostPort, dbName: r.dbName, dbUser: r.dbUser, dbPassword: r.dbPassword };
    }
    case "mssql": {
      const r = await ensureMssqlStackForSite({
        siteId: opts.siteId,
        networkGroupShort: opts.networkGroupShort,
        dbStackVersion: opts.dbStackVersion,
      });
      if (!r.ok) return r;
      return { ok: true, engine, containerId: r.containerId, hostPort: r.hostPort, dbName: r.dbName, dbUser: r.dbUser, dbPassword: r.dbPassword };
    }
    case "sqlite": {
      const r = await ensureSqliteStackForSite({ siteId: opts.siteId, siteRootPath: opts.siteRootPath });
      if (!r.ok) return r;
      return {
        ok: true,
        engine,
        containerId: null,
        hostPort: 0,
        dbName: r.dbName,
        dbUser: "",
        dbPassword: "",
        dbPath: r.dbPath,
      };
    }
    default:
      return { ok: false, error: `Unsupported engine: ${engine}` };
  }
}
