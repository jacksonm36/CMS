/**
 * Host nginx/OpenResty/Caddy/Apache configs pass PHP to **host** php-fpm (not the Alpine sidecar).
 * Socket path must match an installed pool (e.g. Debian `/run/php/php8.2-fpm.sock`).
 */

import { existsSync } from "node:fs";

const RUN_PHP = "/run/php";

/** Normalize DB/template values like `8.3`, `83`, ` 8.2 ` for the `php{X.Y}-fpm.sock` stem. */
export function normalizePhpVersionForFpm(ver: string | null | undefined): string {
  const raw = (ver ?? "").trim();
  if (!raw) return "8.2";
  if (/^\d+\.\d+$/.test(raw)) return raw;
  /** e.g. `83` → `8.3` (Alpine-style digit run); only handles PHP 8.x two-digit shorthand */
  if (/^8\d$/.test(raw)) return `8.${raw.slice(1)}`;
  return raw;
}

/** Absolute unix socket path for `fastcgi_pass` / Apache `proxy:unix:…` (no filesystem probe). */
export function phpFpmUnixSocket(phpVersion: string | null | undefined): string {
  const override = process.env.HOSTPANEL_PHP_FPM_SOCKET?.trim();
  if (override) return override;
  const n = normalizePhpVersionForFpm(phpVersion);
  return `${RUN_PHP}/php${n}-fpm.sock`;
}

/**
 * Socket path to embed in generated configs. If the requested version’s socket is missing on this
 * host (e.g. DB says 8.3 but only `php8.2-fpm` is installed), pick the first existing pool so nginx
 * does not 502 with “No such file or directory”.
 */
export function pickWorkingPhpFpmSocket(phpVersion: string | null | undefined): string {
  const override = process.env.HOSTPANEL_PHP_FPM_SOCKET?.trim();
  if (override) return override;

  const preferred = normalizePhpVersionForFpm(phpVersion);
  const order = [preferred, "8.2", "8.3", "8.1", "8.4", "7.4"];
  const seen = new Set<string>();
  for (const v of order) {
    if (seen.has(v)) continue;
    seen.add(v);
    const p = `${RUN_PHP}/php${v}-fpm.sock`;
    if (existsSync(p)) return p;
  }
  return `${RUN_PHP}/php${preferred}-fpm.sock`;
}
