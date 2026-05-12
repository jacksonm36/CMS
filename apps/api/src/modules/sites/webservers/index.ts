import { writeFile, unlink, mkdir } from "fs/promises";
import { dirname } from "path";
import type { Site } from "@hostpanel/db";

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

export interface WebServerDriver {
  generateConfig(site: Site): string;
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
  const driver = await getDriver(site.webServer as WebServerType);
  const config = driver.generateConfig(site);
  const path = driver.configPath(site.domain);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, config, "utf-8");
  } catch (err) {
    console.warn(`[${site.webServer}] Could not write config (non-Linux?):`, (err as Error).message);
  }

  return path;
}

export async function removeSiteConfig(site: Pick<Site, "domain" | "webServer">): Promise<void> {
  const driver = await getDriver(site.webServer as WebServerType);
  try {
    await unlink(driver.configPath(site.domain));
  } catch {}
}

export async function reloadWebServer(webServer: WebServerType): Promise<void> {
  const driver = await getDriver(webServer);
  await driver.reload();
}

// ─── Install / service helpers ────────────────────────────────────────────────

export interface WebServerInfo {
  id: WebServerType;
  name: string;
  description: string;
  defaultPort: number;
  configDir: string;
  serviceName: string;
  supportsPhp: boolean;
  supportsProxy: boolean;
}

export const WEB_SERVER_CATALOG: WebServerInfo[] = [
  {
    id: "nginx",
    name: "Nginx",
    description: "High-performance event-driven web server. Ideal for static files, reverse proxy, and high concurrency.",
    defaultPort: 80,
    configDir: "/etc/nginx/sites-enabled",
    serviceName: "nginx",
    supportsPhp: true,
    supportsProxy: true,
  },
  {
    id: "apache2",
    name: "Apache 2",
    description: "The most widely deployed web server. Full .htaccess support, mod_rewrite, mod_php, and vast ecosystem.",
    defaultPort: 80,
    configDir: "/etc/apache2/sites-enabled",
    serviceName: "apache2",
    supportsPhp: true,
    supportsProxy: true,
  },
  {
    id: "lighttpd",
    name: "Lighttpd",
    description: "Lightweight, fast server with low memory footprint. Great for embedded systems and high-traffic static content.",
    defaultPort: 80,
    configDir: "/etc/lighttpd/conf-enabled",
    serviceName: "lighttpd",
    supportsPhp: true,
    supportsProxy: true,
  },
  {
    id: "litespeed",
    name: "LiteSpeed Community",
    description: "Apache-compatible high-performance server with built-in caching, LSAPI, and HTTP/3 support.",
    defaultPort: 80,
    configDir: "/usr/local/lsws/conf/vhosts",
    serviceName: "lsws",
    supportsPhp: true,
    supportsProxy: true,
  },
  {
    id: "caddy",
    name: "Caddy",
    description: "Automatic HTTPS, HTTP/3, and a concise Caddyfile. Strong choice for modern apps and simple PHP via php_fastcgi.",
    defaultPort: 80,
    configDir: "/etc/caddy/conf.d",
    serviceName: "caddy",
    supportsPhp: true,
    supportsProxy: true,
  },
  {
    id: "openresty",
    name: "OpenResty",
    description: "Nginx + LuaJIT bundle—nginx-compatible virtual hosts with scripting and high-performance proxying.",
    defaultPort: 80,
    configDir: "/etc/openresty/nginx/sites-enabled",
    serviceName: "openresty",
    supportsPhp: true,
    supportsProxy: true,
  },
  {
    id: "traefik",
    name: "Traefik",
    description: "Cloud-native reverse proxy with YAML/TOML discovery. Best for Node.js/Python upstreams (file provider snippets).",
    defaultPort: 80,
    configDir: "/etc/traefik/dynamic",
    serviceName: "traefik",
    supportsPhp: false,
    supportsProxy: true,
  },
];
