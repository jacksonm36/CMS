import type { WebServerType } from "../sites/webservers/index.js";
import { daemonLogDirForServer, defaultDaemonLogFile } from "./webserver-log-dirs.js";
import { safeAbsLogFile } from "./webserver-log-shell.js";

const ENV_PREFIX: Record<WebServerType, string> = {
  nginx: "NGINX",
  apache2: "APACHE2",
  lighttpd: "LIGHTTPD",
  litespeed: "LITESPEED",
  caddy: "CADDY",
  openresty: "OPENRESTY",
  traefik: "TRAEFIK",
};

const PANEL_NGINX_DEFAULTS: Record<"error" | "access", string> = {
  access: "/var/log/nginx/hostpanel.access.log",
  error: "/var/log/nginx/hostpanel.error.log",
};

export function resolveWebserverLogPath(opts: {
  id: WebServerType;
  logType: "access" | "error";
  scope: "panel" | "daemon";
}): string | undefined {
  const { id, logType, scope } = opts;

  if (id === "nginx" && scope === "panel") {
    const k = logType === "access" ? "HOSTPANEL_NGINX_PANEL_ACCESS_LOG" : "HOSTPANEL_NGINX_PANEL_ERROR_LOG";
    const fromEnv = process.env[k]?.trim();
    const fallback = PANEL_NGINX_DEFAULTS[logType];
    return fromEnv ? safeAbsLogFile(fromEnv, fallback) : fallback;
  }

  const prefix = ENV_PREFIX[id];
  const fallback = defaultDaemonLogFile(id, logType);
  if (prefix) {
    const envKey = `HOSTPANEL_${prefix}_${logType.toUpperCase()}_LOG`;
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) return safeAbsLogFile(fromEnv, fallback);
  }

  return fallback;
}

/** Re-export for callers that need the directory (e.g. site log hints). */
export { daemonLogDirForServer };
