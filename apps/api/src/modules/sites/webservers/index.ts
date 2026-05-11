import { writeFile, unlink, mkdir } from "fs/promises";
import { dirname } from "path";
import type { Site } from "@hostpanel/db";

export type WebServerType = "nginx" | "apache2" | "lighttpd" | "litespeed";

export interface WebServerDriver {
  generateConfig(site: Site): string;
  configPath(domain: string): string;
  reload(): Promise<void>;
}

async function getDriver(ws: WebServerType): Promise<WebServerDriver> {
  switch (ws) {
    case "nginx":     return await import("./nginx.js");
    case "apache2":   return await import("./apache.js");
    case "lighttpd":  return await import("./lighttpd.js");
    case "litespeed": return await import("./litespeed.js");
    default:          return await import("./nginx.js");
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
];
