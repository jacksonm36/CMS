import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";

export type SqliteStackResult =
  | { ok: true; dbName: string; dbPath: string }
  | { ok: false; error: string };

/** File-based SQLite under site root (no Docker). */
export async function ensureSqliteStackForSite(opts: {
  siteId: string;
  siteRootPath: string;
}): Promise<SqliteStackResult> {
  const safeId = opts.siteId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
  const relPath = `private/hp_${safeId}.sqlite`;
  const dir = join(opts.siteRootPath, "private");
  const fullPath = join(opts.siteRootPath, relPath);

  try {
    await mkdir(dir, { recursive: true, mode: 0o775 });
    await writeFile(fullPath, "", { flag: "a", mode: 0o660 });
    await chmod(fullPath, 0o660).catch(() => {});
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return { ok: true, dbName: relPath, dbPath: relPath };
}
