import type { WebServerType } from "../sites/webservers/index.js";

const DEFAULT_LOGS: Record<WebServerType, Record<"error" | "access", string>> = {
  nginx: { error: "/var/log/nginx/error.log", access: "/var/log/nginx/access.log" },
  apache2: { error: "/var/log/apache2/error.log", access: "/var/log/apache2/access.log" },
  lighttpd: { error: "/var/log/lighttpd/error.log", access: "/var/log/lighttpd/access.log" },
  litespeed: { error: "/usr/local/lsws/logs/error.log", access: "/usr/local/lsws/logs/access.log" },
  caddy: { error: "/var/log/caddy/caddy.log", access: "/var/log/caddy/access.log" },
  openresty: { error: "/var/log/openresty/error.log", access: "/var/log/openresty/access.log" },
  traefik: { error: "/var/log/traefik/traefik.log", access: "/var/log/traefik/access.log" },
};

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
    if (fromEnv) return fromEnv;
    return PANEL_NGINX_DEFAULTS[logType];
  }

  const prefix = ENV_PREFIX[id];
  if (prefix) {
    const envKey = `HOSTPANEL_${prefix}_${logType.toUpperCase()}_LOG`;
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) return fromEnv;
  }

  return DEFAULT_LOGS[id]?.[logType];
}
