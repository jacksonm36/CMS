/**
 * When HostPanel writes vhosts/snippets under a **managed** directory (env override), the same
 * basename may still exist under the distro’s default include path. The daemon often loads **both**
 * trees → duplicate vhosts / conflicting `ServerName` / router keys.
 *
 * After each write we remove same-basename files under known **legacy mirror** dirs only when they
 * are not the same inode as the canonical file we just wrote. LiteSpeed is excluded: every vhost
 * uses `vhconf.conf` under a domain folder — basename-only mirroring would be unsafe.
 */

import { realpath, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/** Default distro paths; canonical paths often come from `*_SITES_DIR` / `*_CONF_D` env vars. */
export const LEGACY_MIRROR_DIRS_BY_WEB_SERVER = {
  nginx: ["/etc/nginx/sites-enabled"],
  openresty: ["/etc/openresty/nginx/sites-enabled"],
  apache2: ["/etc/apache2/sites-enabled"],
  /** Debian-style includes: `conf-enabled/*.conf` and sometimes `conf.d/*.conf`. */
  lighttpd: ["/etc/lighttpd/conf-enabled", "/etc/lighttpd/conf.d"],
  litespeed: [] as const,
  caddy: ["/etc/caddy/conf.d"],
  traefik: ["/etc/traefik/dynamic"],
} as const;

export type WebServerIdWithLegacyMirrors = keyof typeof LEGACY_MIRROR_DIRS_BY_WEB_SERVER;

export function legacyMirrorDirsForWebServer(webServer: string): readonly string[] {
  const key = webServer as WebServerIdWithLegacyMirrors;
  const dirs = LEGACY_MIRROR_DIRS_BY_WEB_SERVER[key];
  return dirs ?? [];
}

function isDedupeSupportedFilename(path: string): boolean {
  return (
    path.endsWith(".conf") ||
    path.endsWith(".caddy") ||
    path.endsWith(".yml") ||
    path.endsWith(".yaml")
  );
}

/**
 * Remove same-basename artifacts under `legacyDirs` when they are not the same file as
 * `canonicalConfigPath` (path or inode).
 */
export async function removeLegacyMirrorDuplicateIfDifferent(
  canonicalConfigPath: string,
  legacyDirs: readonly string[],
): Promise<void> {
  if (legacyDirs.length === 0 || !isDedupeSupportedFilename(canonicalConfigPath)) return;

  try {
    await stat(canonicalConfigPath);
  } catch {
    return;
  }

  const name = basename(canonicalConfigPath);
  const canonical = resolve(canonicalConfigPath);

  for (const legacyDir of legacyDirs) {
    const legacy = resolve(join(legacyDir, name));
    if (legacy === canonical) continue;

    try {
      const [cReal, lReal] = await Promise.all([
        realpath(canonical).catch(() => canonical),
        realpath(legacy).catch(() => null as string | null),
      ]);
      if (lReal !== null && cReal === lReal) continue;
    } catch {
      /* proceed to unlink legacy */
    }

    try {
      await unlink(legacy);
      console.info(`[hostpanel:dedupe] Removed stale duplicate ${legacy} (canonical ${canonical})`);
    } catch {
      /* absent or EACCES */
    }
  }
}

/** Unlink the canonical file and same-basename paths under legacy dirs (different path only). */
export async function unlinkArtifactAndLegacyMirrors(
  canonicalPath: string,
  legacyDirs: readonly string[],
): Promise<void> {
  const canonResolved = resolve(canonicalPath);
  await unlink(canonicalPath).catch(() => {});
  const name = basename(canonicalPath);
  for (const dir of legacyDirs) {
    const leg = resolve(join(dir, name));
    if (leg !== canonResolved) await unlink(leg).catch(() => {});
  }
}
