import { writeFile, unlink, mkdir } from "fs/promises";
import { dirname } from "path";
import type { Site } from "@hostpanel/db";
import type { SiteRoutesFile } from "../site-pages.js";
import {
  backendListenPort,
  EDGE_PUBLIC_PORT,
  needsEdgeProxy,
} from "./webserver-ports.js";

/** Single source for types, Zod, and UI enumerations */
export const WEB_SERVER_IDS = [
  "nginx",
  "apache2",
  "lighttpd",
  "litespeed",
  "caddy",
  "openresty",
  "traefik",
] as const;

export type WebServerType = (typeof WEB_SERVER_IDS)[number];

export type SiteWebConfigExtras = { routes: SiteRoutesFile };

export interface WebServerDriver {
  generateConfig(site: Site, extras?: SiteWebConfigExtras): string;
  configPath(domain: string): string;
  reload(): Promise<void>;
}

async function getDriver(ws: WebServerType): Promise<WebServerDriver> {
  switch (ws) {
    case "nginx":      return await import("./nginx.js");
    case "apache2":    return await import("./apache.js");
    case "lighttpd":   return await import("./lighttpd.js");
    case "litespeed":  return await import("./litespeed.js");
    case "caddy":      return await import("./caddy.js");
    case "openresty":  return await import("./openresty.js");
    case "traefik":    return await import("./traefik.js");
    default:           return await import("./nginx.js");
  }
}

export async function writeSiteConfig(site: Site): Promise<string> {
  const ws = site.webServer as WebServerType;
  const driver = await getDriver(ws);
  const { readSiteRoutes } = await import("../site-pages.js");
  const routes = await readSiteRoutes(site.rootPath);
  const config = driver.generateConfig(site, { routes });
  const path = driver.configPath(site.domain);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, config, "utf-8");
  } catch (err) {
    console.warn(`[${site.webServer}] Could not write config (non-Linux?):`, (err as Error).message);
  }

  const { edgeConfigPath, generateEdgeProxyConfig } = await import("./edge-proxy.js");
  const edgePath = edgeConfigPath(site.domain);

  try {
    if (needsEdgeProxy(ws)) {
      const edge = generateEdgeProxyConfig(site, ws, { routes });
      await mkdir(dirname(edgePath), { recursive: true });
      await writeFile(edgePath, edge, "utf-8");
    } else {
      await unlink(edgePath).catch(() => {});
    }
  } catch (err) {
    console.warn(`[edge] Could not write nginx edge proxy:`, (err as Error).message);
  }

  return path;
}

export async function removeSiteConfig(site: Pick<Site, "domain" | "webServer">): Promise<void> {
  const ws = site.webServer as WebServerType;
  const driver = await getDriver(ws);
  try {
    await unlink(driver.configPath(site.domain));
  } catch {}
  const { edgeConfigPath } = await import("./edge-proxy.js");
  try {
    await unlink(edgeConfigPath(site.domain));
  } catch {}
}

export async function reloadWebServer(webServer: WebServerType): Promise<void> {
  const driver = await getDriver(webServer);
  await driver.reload();
  if (needsEdgeProxy(webServer) || webServer === "nginx") {
    const nginx = await import("./nginx.js");
    await nginx.reload();
  }
}

// ─── Install / service helpers ────────────────────────────────────────────────

export interface WebServerInfo {
  id: WebServerType;
  name: string;
  description: string;
  /** Loopback port this stack listens on (nginx uses public edge port). */
  defaultPort: number;
  /** Public HTTP port (edge nginx). */
  publicPort: number;
  configDir: string;
  serviceName: string;
  supportsPhp: boolean;
  supportsProxy: boolean;
}

function catalogEntry(
  entry: Omit<WebServerInfo, "defaultPort" | "publicPort"> & { id: WebServerType }
): WebServerInfo {
  return {
    ...entry,
    defaultPort: backendListenPort(entry.id),
    publicPort: EDGE_PUBLIC_PORT,
  };
}

export const WEB_SERVER_CATALOG: WebServerInfo[] = [
  catalogEntry({
    id: "nginx",
    name: "Nginx",
    description:
      "High-performance event-driven web server. Default public edge on :80; ideal for static files, reverse proxy, and high concurrency.",
    configDir: "/etc/nginx/sites-enabled",
    serviceName: "nginx",
    supportsPhp: true,
    supportsProxy: true,
  }),
  catalogEntry({
    id: "apache2",
    name: "Apache 2",
    description:
      "Runs on a dedicated loopback port; nginx edge on :80 routes each domain here. Full .htaccess, mod_rewrite, and mod_php.",
    configDir: "/etc/apache2/sites-enabled",
    serviceName: "apache2",
    supportsPhp: true,
    supportsProxy: true,
  }),
  catalogEntry({
    id: "lighttpd",
    name: "Lighttpd",
    description:
      "Lightweight backend on a dedicated loopback port; nginx edge on :80 forwards traffic per site.",
    configDir: "/etc/lighttpd/conf-enabled",
    serviceName: "lighttpd",
    supportsPhp: true,
    supportsProxy: true,
  }),
  catalogEntry({
    id: "litespeed",
    name: "LiteSpeed Community",
    description:
      "Apache-compatible stack on a dedicated loopback port behind the nginx edge proxy.",
    configDir: "/usr/local/lsws/conf/vhosts",
    serviceName: "lsws",
    supportsPhp: true,
    supportsProxy: true,
  }),
  catalogEntry({
    id: "caddy",
    name: "Caddy",
    description:
      "Per-site Caddyfile on a loopback port; nginx edge on :80. Automatic HTTPS can be enabled in Caddy when not using the edge.",
    configDir: "/etc/caddy/conf.d",
    serviceName: "caddy",
    supportsPhp: true,
    supportsProxy: true,
  }),
  catalogEntry({
    id: "openresty",
    name: "OpenResty",
    description:
      "Nginx+Lua backend on a dedicated loopback port; public traffic enters via nginx edge on :80.",
    configDir: "/etc/openresty/nginx/sites-enabled",
    serviceName: "openresty",
    supportsPhp: true,
    supportsProxy: true,
  }),
  catalogEntry({
    id: "traefik",
    name: "Traefik",
    description:
      "YAML dynamic config on loopback :8086; nginx edge routes Node/Python sites. Static/PHP not supported.",
    configDir: "/etc/traefik/dynamic",
    serviceName: "traefik",
    supportsPhp: false,
    supportsProxy: true,
  }),
];

export { backendListenPort, needsEdgeProxy, EDGE_PUBLIC_PORT } from "./webserver-ports.js";
export { configureWebServerCoexistence } from "./configure-coexistence.js";
