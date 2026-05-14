import { readdir } from "fs/promises";
import { basename } from "path";
import type { Site } from "@hostpanel/db";

export type SiteIndexContext = Pick<Site, "type" | "defaultDocument">;

/** Safe homepage filename only (no paths). Returns null if invalid. */
export function sanitizeDefaultDocument(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const name = basename(trimmed);
  if (name !== trimmed) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,240}$/.test(name)) return null;
  return name;
}

/** Filenames for web server index directives / root try_files order */
export function indexFilenamesForSite(site: SiteIndexContext): string[] {
  const custom = sanitizeDefaultDocument(site.defaultDocument);
  const ordered: string[] = [];
  if (custom) ordered.push(custom);
  ordered.push("index.html", "index.htm");
  if (site.type === "php") ordered.push("index.php");
  return [...new Set(ordered)];
}

/** Space-separated paths for `location = / { try_files ... }` (nginx / OpenResty). */
export function nginxExactRootTryFiles(site: SiteIndexContext): string {
  return indexFilenamesForSite(site)
    .map((f) => `/${f}`)
    .join(" ");
}

/**
 * Pick a single HTML homepage when there is no index.html/index.htm.
 * Returns null when defaults already exist or nothing reliable can be inferred.
 */
export async function detectDefaultDocumentFromRoot(rootPath: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const htmlFiles = entries
    .filter((e) => e.isFile() && /\.(html|htm)$/i.test(e.name))
    .map((e) => e.name);

  const lower = new Set(htmlFiles.map((n) => n.toLowerCase()));
  if (lower.has("index.html") || lower.has("index.htm")) return null;

  if (htmlFiles.length === 0) return null;
  if (htmlFiles.length === 1) return sanitizeDefaultDocument(htmlFiles[0]);

  const main = htmlFiles.find((n) => n.toLowerCase() === "main.html");
  return main ? sanitizeDefaultDocument(main) : null;
}
