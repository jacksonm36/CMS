import type { WebServerType } from "../sites/webservers/index.js";
import { NGINX_LOG_DIR } from "../sites/webservers/nginx.js";
import { APACHE_LOG_DIR } from "../sites/webservers/apache.js";
import { LIGHTTPD_LOG_DIR } from "../sites/webservers/lighttpd.js";
import { LSWS_LOG_DIR } from "../sites/webservers/litespeed.js";
import { OPENRESTY_LOG_DIR } from "../sites/webservers/openresty.js";

const CADDY_LOG_DIR_DEFAULT = "/var/log/caddy";
const TRAEFIK_LOG_DIR_DEFAULT = "/var/log/traefik";

/** Absolute log directory only — rejects traversal and odd paths. */
export function safeAbsLogDir(raw: string | undefined, fallback: string): string {
  const d = (raw ?? fallback).trim();
  if (!d.startsWith("/") || d.includes("..") || d.length > 512) return fallback;
  if (!/^\/[a-zA-Z0-9/_.+-]+$/.test(d)) return fallback;
  return d;
}

/** Daemon-scope log directory for a stack (matches site vhost log paths). */
export function daemonLogDirForServer(id: WebServerType): string {
  switch (id) {
    case "nginx":
      return safeAbsLogDir(process.env.NGINX_LOG_DIR, NGINX_LOG_DIR);
    case "openresty":
      return safeAbsLogDir(process.env.OPENRESTY_LOG_DIR, OPENRESTY_LOG_DIR);
    case "apache2":
      return safeAbsLogDir(process.env.APACHE_LOG_DIR, APACHE_LOG_DIR);
    case "lighttpd":
      return safeAbsLogDir(process.env.LIGHTTPD_LOG_DIR, LIGHTTPD_LOG_DIR);
    case "litespeed":
      return safeAbsLogDir(process.env.LSWS_LOG_DIR, LSWS_LOG_DIR);
    case "caddy":
      return safeAbsLogDir(process.env.CADDY_LOG_DIR, CADDY_LOG_DIR_DEFAULT);
    case "traefik":
      return safeAbsLogDir(process.env.TRAEFIK_LOG_DIR, TRAEFIK_LOG_DIR_DEFAULT);
    default:
      return safeAbsLogDir(undefined, "/var/log");
  }
}

/** Default main daemon log file (before per-vhost merge). */
export function defaultDaemonLogFile(id: WebServerType, logType: "access" | "error"): string {
  const dir = daemonLogDirForServer(id);
  if (logType === "access") {
    return `${dir}/access.log`;
  }
  if (id === "caddy") return `${dir}/caddy.log`;
  if (id === "traefik") return `${dir}/traefik.log`;
  return `${dir}/error.log`;
}

/** HostPanel writes per-domain logs for these stacks; nginx also has edge proxy logs. */
export function vhostAccessGlobs(id: WebServerType): string[] {
  if (id === "nginx") return ["*.access.log", "*.edge.access.log"];
  return ["*.access.log"];
}

export function vhostErrorGlobs(id: WebServerType): string[] {
  if (id === "nginx") return ["*.error.log", "*.edge.error.log"];
  return ["*.error.log"];
}

export function supportsMergedDaemonLogs(_id: WebServerType, scope: "panel" | "daemon"): boolean {
  return scope === "daemon";
}

export function mergedSourceHint(id: WebServerType): string {
  const dir = daemonLogDirForServer(id);
  const main = defaultDaemonLogFile(id, "access");
  const globs = vhostAccessGlobs(id).join(", ");
  return `${main} + ${dir}/{${globs}}`;
}
