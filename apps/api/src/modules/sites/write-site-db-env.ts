import { writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { SiteDbEngine } from "./site-db-engine.js";
import { defaultPortForEngine } from "./site-db-engine.js";

export type SiteDbEnv = {
  engine: SiteDbEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** SQLite: path relative to site root */
  dbPath?: string;
};

function sanitizeEnvValue(value: string, field: string): string {
  if (/[\r\n\x00]/.test(value)) {
    throw new Error(`Invalid ${field}: must not contain newlines`);
  }
  return value.trim();
}

/** Force TCP for Docker SQL; "localhost" makes some clients use a missing Unix socket. */
export function normalizeDbHost(host: string): string {
  const h = sanitizeEnvValue(host, "host").toLowerCase();
  if (h === "localhost") {
    return "127.0.0.1";
  }
  return sanitizeEnvValue(host, "host");
}

function envLine(key: string, value: string): string {
  if (!/^[A-Z0-9_]+$/.test(key)) {
    throw new Error(`Invalid env key: ${key}`);
  }
  return `${key}=${value}`;
}

/**
 * Write DB credentials for PHP/apps.
 * Uses a dotfile outside the web docroot; provision-cms-install sets mode 640 hostpanel:www-data.
 */
export async function writeSiteDbEnvFile(
  rootPath: string,
  db: SiteDbEnv,
  opts?: { siteId?: string },
): Promise<void> {
  const engine = db.engine;
  const host = engine === "sqlite" ? "" : normalizeDbHost(db.host);
  const port = engine === "sqlite" ? 0 : Math.max(1, Math.min(65535, Math.floor(db.port || defaultPortForEngine(engine))));
  const database = sanitizeEnvValue(db.database, "database");
  const username = sanitizeEnvValue(db.username, "username");
  const password = sanitizeEnvValue(db.password, "password");

  const lines = [
    "# HostPanel — auto-provisioned database (do not commit to public repos)",
    envLine("HP_DB_ENGINE", engine),
  ];
  const siteId = opts?.siteId?.trim();
  if (siteId && /^[a-z0-9]{8,}$/i.test(siteId)) {
    lines.push(envLine("HP_SITE_ID", siteId));
  }

  if (engine === "sqlite") {
    const dbPath = sanitizeEnvValue(db.dbPath ?? database, "dbPath");
    lines.push(envLine("HP_DB_PATH", dbPath));
    lines.push(envLine("DB_DATABASE", dbPath));
    lines.push(envLine("DB_CONNECTION", "sqlite"));
    lines.push("");
  } else {
    lines.push(envLine("HP_DB_HOST", host));
    lines.push(envLine("HP_DB_PORT", String(port)));
    lines.push(envLine("HP_DB_NAME", database));
    lines.push(envLine("HP_DB_USER", username));
    lines.push(envLine("HP_DB_PASSWORD", password));
    lines.push("");
    lines.push(envLine("DB_HOST", host));
    lines.push(envLine("DB_PORT", String(port)));
    lines.push(envLine("DB_NAME", database));
    lines.push(envLine("DB_USER", username));
    lines.push(envLine("DB_PASSWORD", password));
    lines.push(envLine("DB_CONNECTION", engine === "postgresql" ? "pgsql" : engine));
    if (engine === "mongodb") {
      const auth =
        username !== ""
          ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
          : "";
      lines.push(
        envLine(
          "DATABASE_URL",
          `mongodb://${auth}${host}:${port}/${database}?authSource=admin`,
        ),
      );
    } else if (engine === "postgresql") {
      lines.push(
        envLine(
          "DATABASE_URL",
          `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
        ),
      );
    } else if (engine === "mssql") {
      lines.push(
        envLine(
          "DATABASE_URL",
          `sqlserver://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port};database=${database};encrypt=false`,
        ),
      );
    } else {
      lines.push(
        envLine(
          "DATABASE_URL",
          `mysql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
        ),
      );
    }
    lines.push("");
  }

  const path = join(rootPath, ".hostpanel-db.env");
  await writeFile(path, lines.join("\n"), { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    /* non-Linux dev */
  }
}
