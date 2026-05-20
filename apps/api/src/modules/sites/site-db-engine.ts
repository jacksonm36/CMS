import type { Site } from "@prisma/client";

/** Supported site database engines (stack + reset-db). */
export type SiteDbEngine = "mysql" | "mariadb" | "postgresql" | "sqlite" | "mongodb" | "mssql";

const SQL_LIKE: SiteDbEngine[] = ["mysql", "mariadb", "postgresql", "sqlite", "mssql"];

export function normalizeSiteDbEngine(raw: string | null | undefined): SiteDbEngine | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e === "postgres") return "postgresql";
  if (e === "mongo") return "mongodb";
  if (e === "sqlserver") return "mssql";
  if (
    e === "mysql" ||
    e === "mariadb" ||
    e === "postgresql" ||
    e === "sqlite" ||
    e === "mongodb" ||
    e === "mssql"
  ) {
    return e;
  }
  return null;
}

/** Map site `dbStackVersion` label (e.g. postgresql-16) to engine. */
export function engineFromDbStackVersion(dbStackVersion: string | null | undefined): SiteDbEngine | null {
  if (!dbStackVersion) return null;
  const d = dbStackVersion.toLowerCase();
  if (d.startsWith("mysql")) return "mysql";
  if (d.startsWith("mariadb")) return "mariadb";
  if (d.startsWith("postgresql") || d.startsWith("postgres")) return "postgresql";
  if (d.startsWith("sqlite")) return "sqlite";
  if (d.startsWith("mongodb") || d.startsWith("mongo")) return "mongodb";
  if (d.startsWith("mssql") || d.startsWith("sqlserver")) return "mssql";
  return null;
}

export function engineFromEnvFile(parsed: Record<string, string>): SiteDbEngine | null {
  return (
    normalizeSiteDbEngine(parsed.HP_DB_ENGINE) ??
    normalizeSiteDbEngine(parsed.DB_CONNECTION) ??
    engineFromDbStackVersion(parsed.HP_DB_STACK)
  );
}

export function siteStackDbEngine(site: Site): SiteDbEngine | null {
  return engineFromDbStackVersion(site.dbStackVersion);
}

export function siteSupportsStackDb(site: Site): boolean {
  return siteStackDbEngine(site) != null;
}

export function isSqlLikeEngine(engine: SiteDbEngine): boolean {
  return SQL_LIKE.includes(engine);
}

export function defaultPortForEngine(engine: SiteDbEngine): number {
  switch (engine) {
    case "postgresql":
      return 5432;
    case "mongodb":
      return 27017;
    case "mssql":
      return 1433;
    case "sqlite":
      return 0;
    default:
      return 3306;
  }
}

/** Prisma SiteDatabase.engine field (subset). */
export function prismaDbEngine(engine: SiteDbEngine): "mysql" | "postgresql" {
  return engine === "postgresql" ? "postgresql" : "mysql";
}
