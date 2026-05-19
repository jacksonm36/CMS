import { access, readFile } from "fs/promises";
import { constants as fsConstants } from "fs";
import { guardPathResolved, listDirectory, readFile as readSiteFile, writeFile as writeSiteFile, deleteFile } from "./files.js";

export const SITE_ROUTES_REL = "/.hostpanel/routes.json";

export type SitePageEntry = {
  type: "page";
  /** URL path segment without leading slash, e.g. `main` → /main */
  slug: string;
  /** Site-root path to HTML file, e.g. /main/index.html */
  file: string;
  title?: string;
};

export type SiteRedirectEntry = {
  type: "redirect";
  from: string;
  to: string;
  permanent?: boolean;
};

export type SiteRouteEntry = SitePageEntry | SiteRedirectEntry;

export type SiteRoutesFile = {
  version: 1;
  routes: SiteRouteEntry[];
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

export function normalizeSlug(raw: string): string | null {
  const s = raw.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!s || s === "index") return null;
  if (!SLUG_RE.test(s)) return null;
  return s;
}

export function normalizeRedirectPath(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  const p = t.startsWith("/") ? t : `/${t}`;
  if (p.includes("..") || p.includes("\0")) return null;
  return p.replace(/\/+/g, "/");
}

function defaultRoutes(): SiteRoutesFile {
  return { version: 1, routes: [] };
}

export async function readSiteRoutes(rootPath: string): Promise<SiteRoutesFile> {
  try {
    const raw = await readFile(await guardPathResolved(rootPath, SITE_ROUTES_REL), "utf-8");
    const parsed = JSON.parse(raw) as SiteRoutesFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.routes)) return defaultRoutes();
    return { version: 1, routes: parsed.routes.filter(isValidRoute) };
  } catch {
    return defaultRoutes();
  }
}

function isValidRoute(r: unknown): r is SiteRouteEntry {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (o.type === "page") {
    return typeof o.slug === "string" && typeof o.file === "string";
  }
  if (o.type === "redirect") {
    return typeof o.from === "string" && typeof o.to === "string";
  }
  return false;
}

export async function writeSiteRoutes(rootPath: string, data: SiteRoutesFile): Promise<void> {
  const cleaned: SiteRoutesFile = {
    version: 1,
    routes: data.routes.filter(isValidRoute),
  };
  await writeSiteFile(rootPath, SITE_ROUTES_REL, `${JSON.stringify(cleaned, null, 2)}\n`);
}

export function defaultPageFileForSlug(slug: string): string {
  return `/${slug}/index.html`;
}

export function pageHtmlTemplate(title: string, slug: string): string {
  const safeTitle = title.replace(/[<>&]/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>Page <code>/${slug}</code> — edit in HostPanel Editor.</p>
</body>
</html>
`;
}

export async function ensurePageFile(
  rootPath: string,
  slug: string,
  title?: string,
): Promise<string> {
  const file = defaultPageFileForSlug(slug);
  try {
    await access(await guardPathResolved(rootPath, file), fsConstants.F_OK);
    return file;
  } catch {
    /* create */
  }
  const t = title?.trim() || slug.charAt(0).toUpperCase() + slug.slice(1);
  await writeSiteFile(rootPath, file, pageHtmlTemplate(t, slug));
  return file;
}

/** Move a root-level `slug.html` into `/{slug}/index.html` (canonical page layout). */
export async function migrateRootHtmlToPageFolder(
  rootPath: string,
  slug: string,
  sourceFile: string,
): Promise<string> {
  const src = sourceFile.startsWith("/") ? sourceFile : `/${sourceFile}`;
  if (!/^\/[^/]+\.html?$/i.test(src)) {
    throw new Error("Only a single HTML file at the site root can be moved into a page folder");
  }
  const dest = defaultPageFileForSlug(slug);
  const content = await readSiteFile(rootPath, src);
  if (!content.trim()) {
    throw new Error("Source file is missing or empty");
  }
  await writeSiteFile(rootPath, dest, content);
  try {
    await deleteFile(rootPath, src);
  } catch {
    /* page folder exists but cleanup failed — still registered */
  }
  return dest;
}

/**
 * Preferred page file for a slug: existing folder page, migrate root `slug.html`, or create new.
 */
export async function resolveOrCreatePageFile(
  rootPath: string,
  slug: string,
  title?: string,
): Promise<string> {
  const folderFile = defaultPageFileForSlug(slug);
  try {
    await access(await guardPathResolved(rootPath, folderFile), fsConstants.F_OK);
    return folderFile;
  } catch {
    /* continue */
  }
  const flat = `/${slug}.html`;
  try {
    await access(await guardPathResolved(rootPath, flat), fsConstants.F_OK);
    return migrateRootHtmlToPageFolder(rootPath, slug, flat);
  } catch {
    /* continue */
  }
  return ensurePageFile(rootPath, slug, title);
}

export type DiscoveredPage = {
  slug: string;
  file: string;
  label: string;
};

/** HTML files on the site useful for the editor page list (not including .hostpanel). */
export async function discoverHtmlPages(rootPath: string): Promise<DiscoveredPage[]> {
  const out: DiscoveredPage[] = [];
  const seen = new Set<string>();

  const add = (slug: string, file: string, label: string) => {
    const key = `${slug}:${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ slug, file, label });
  };

  add("", "/index.html", "Home");

  let rootEntries;
  try {
    rootEntries = await listDirectory(rootPath, "/");
  } catch {
    return out;
  }

  for (const e of rootEntries) {
    if (e.type === "file" && /\.html?$/i.test(e.name) && e.name.toLowerCase() !== "index.html") {
      const base = e.name.replace(/\.html?$/i, "");
      add(base, e.path, e.name);
    }
    if (e.type === "directory" && !e.name.startsWith(".")) {
      let sub;
      try {
        sub = await listDirectory(rootPath, e.path);
      } catch {
        continue;
      }
      const index = sub.find((f) => f.type === "file" && /^index\.html?$/i.test(f.name));
      if (index) {
        add(e.name, index.path, `/${e.name}`);
      }
    }
  }

  return out.sort((a, b) => {
    if (!a.slug) return -1;
    if (!b.slug) return 1;
    return a.label.localeCompare(b.label);
  });
}

/** Drop page/redirect routes that lived under a deleted file or folder. */
export async function pruneRoutesAfterDelete(
  rootPath: string,
  deletedPath: string,
): Promise<boolean> {
  const normalized = deletedPath.startsWith("/") ? deletedPath : `/${deletedPath}`;
  const cfg = await readSiteRoutes(rootPath);
  const before = cfg.routes.length;
  const dirSlug = normalized.match(/^\/([^/]+)\/?$/)?.[1]?.toLowerCase();

  cfg.routes = cfg.routes.filter((r) => {
    if (r.type === "page") {
      if (r.file === normalized || r.file.startsWith(`${normalized}/`)) return false;
      if (dirSlug && r.slug.toLowerCase() === dirSlug) return false;
      return true;
    }
    if (r.type === "redirect") {
      if (r.from === normalized || r.from.startsWith(`${normalized}/`)) return false;
      return true;
    }
    return true;
  });

  if (cfg.routes.length === before) return false;
  await writeSiteRoutes(rootPath, cfg);
  return true;
}

/** Nginx location blocks for redirects (exact paths). */
export function nginxRedirectBlocks(routes: SiteRoutesFile): string {
  const lines: string[] = [];
  for (const r of routes.routes) {
    if (r.type !== "redirect") continue;
    const from = normalizeRedirectPath(r.from);
    const to = normalizeRedirectPath(r.to);
    if (!from || !to) continue;
    const code = r.permanent !== false ? 301 : 302;
    const target = to.startsWith("http") ? to : to;
    lines.push(`
    location = ${from} {
        return ${code} ${target};
    }`);
  }
  return lines.join("");
}
