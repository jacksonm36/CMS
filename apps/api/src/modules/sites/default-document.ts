import { readdir } from "fs/promises";
import { basename, join } from "path";
import type { Site } from "@hostpanel/db";

export type SiteIndexContext = Pick<Site, "type" | "defaultDocument">;

const SAFE_DOC_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;

/**
 * Safe default entry relative to the site tree (no leading `/`, no `..`).
 * Allows a single filename (`index.php`) or one subdirectory (`web/index.php`, `public/index.php`).
 */
export function sanitizeDefaultDocument(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  trimmed = trimmed.replace(/^\/+/g, "").replace(/\/+$/g, "");
  if (!trimmed || trimmed.includes("..")) return null;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return null;
  for (const p of parts) {
    if (!SAFE_DOC_SEGMENT.test(p)) return null;
  }
  return parts.join("/");
}

/** Subdirectory of `site.rootPath` that should be the web server document root, or null for root itself. */
export function documentRootSuffix(defaultDocument: string | null | undefined): string | null {
  const s = sanitizeDefaultDocument(defaultDocument);
  if (!s) return null;
  const i = s.lastIndexOf("/");
  if (i <= 0) return null;
  return s.slice(0, i);
}

/** Absolute filesystem path used as nginx/apache document root (handles `web/`, `public/`, etc.). */
export function siteFilesystemWebRoot(site: Pick<Site, "rootPath" | "defaultDocument">): string {
  const sub = documentRootSuffix(site.defaultDocument);
  if (!sub) return site.rootPath;
  return join(site.rootPath, sub);
}

/** Filenames for web server index directives / root try_files order */
export function indexFilenamesForSite(site: SiteIndexContext): string[] {
  const custom = sanitizeDefaultDocument(site.defaultDocument);
  const customIndexName =
    custom && custom.includes("/") ? basename(custom) : custom;
  const ordered: string[] = [];
  if (customIndexName) ordered.push(customIndexName);
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
