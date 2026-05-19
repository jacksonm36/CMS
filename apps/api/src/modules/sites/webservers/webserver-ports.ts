import type { WebServerType } from "./index.js";

/** Public HTTP entry (edge reverse proxy). */
export const EDGE_PUBLIC_PORT = parseInt(process.env.HOSTPANEL_EDGE_PUBLIC_PORT ?? "80", 10);

/** Which stack terminates public :80 (always nginx in default layout). */
export const EDGE_WEB_SERVER = (process.env.HOSTPANEL_EDGE_WEB_SERVER ?? "nginx") as WebServerType;

/**
 * Loopback ports for each web server process so multiple stacks can run together.
 * Override per stack with HOSTPANEL_WS_PORT_<ID> (e.g. HOSTPANEL_WS_PORT_APACHE2=8081).
 */
const DEFAULT_BACKEND_PORTS: Record<WebServerType, number> = {
  nginx: 80,
  apache2: 8081,
  lighttpd: 8082,
  litespeed: 8083,
  caddy: 8084,
  openresty: 8085,
  traefik: 8086,
};

const ENV_KEY: Record<WebServerType, string> = {
  nginx: "HOSTPANEL_WS_PORT_NGINX",
  apache2: "HOSTPANEL_WS_PORT_APACHE2",
  lighttpd: "HOSTPANEL_WS_PORT_LIGHTTPD",
  litespeed: "HOSTPANEL_WS_PORT_LITESPEED",
  caddy: "HOSTPANEL_WS_PORT_CADDY",
  openresty: "HOSTPANEL_WS_PORT_OPENRESTY",
  traefik: "HOSTPANEL_WS_PORT_TRAEFIK",
};

/** Valid TCP port for shell/config generation (rejects injection via env overrides). */
export function parseSafePort(value: string | number, fallback: number): number {
  const p = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return fallback;
  return p;
}

export function backendListenPort(ws: WebServerType): number {
  const env = process.env[ENV_KEY[ws]];
  if (env) {
    return parseSafePort(env, DEFAULT_BACKEND_PORTS[ws]);
  }
  return DEFAULT_BACKEND_PORTS[ws];
}

/** Nginx serves the site vhost directly on :80 (no edge hop). */
export function isEdgeNativeWebServer(ws: WebServerType): boolean {
  return ws === EDGE_WEB_SERVER;
}

/** Site uses a non-edge stack; nginx edge proxy file is required on :80. */
export function needsEdgeProxy(ws: WebServerType): boolean {
  return !isEdgeNativeWebServer(ws);
}

export function getReservedWebServerBackendPorts(): number[] {
  return (Object.keys(DEFAULT_BACKEND_PORTS) as WebServerType[])
    .map((id) => backendListenPort(id))
    .filter((p) => p !== EDGE_PUBLIC_PORT);
}

export function backendUpstreamUrl(ws: WebServerType): string {
  return `http://127.0.0.1:${backendListenPort(ws)}`;
}
