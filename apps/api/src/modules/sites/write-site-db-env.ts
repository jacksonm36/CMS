import { writeFile } from "fs/promises";
import { join } from "path";

export type SiteDbEnv = {
  engine: "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

function envLine(key: string, value: string): string {
  const safe = value.replace(/[\r\n\x00]/g, "");
  return `${key}=${safe}`;
}

/**
 * Write DB credentials for PHP/apps.
 * Uses a dotfile so nginx `location ~ /\.` blocks HTTP access.
 */
export async function writeSiteDbEnvFile(rootPath: string, db: SiteDbEnv): Promise<void> {
  const lines = [
    "# HostPanel — auto-provisioned database (do not commit to public repos)",
    envLine("HP_DB_ENGINE", db.engine),
    envLine("HP_DB_HOST", db.host),
    envLine("HP_DB_PORT", String(db.port)),
    envLine("HP_DB_NAME", db.database),
    envLine("HP_DB_USER", db.username),
    envLine("HP_DB_PASSWORD", db.password),
    "",
    envLine("DB_HOST", db.host),
    envLine("DB_PORT", String(db.port)),
    envLine("DB_NAME", db.database),
    envLine("DB_USER", db.username),
    envLine("DB_PASSWORD", db.password),
    "",
  ];
  await writeFile(join(rootPath, ".hostpanel-db.env"), lines.join("\n"), { mode: 0o600 });
}
