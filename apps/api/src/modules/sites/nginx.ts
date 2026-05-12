import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type { Site } from "@hostpanel/db";
import { generateConfig as generateNginxSiteConfig } from "./webservers/nginx.js";

const execAsync = promisify(exec);

const NGINX_SITES_DIR = process.env.NGINX_SITES_DIR ?? "/etc/nginx/sites-enabled";

/** @deprecated Prefer `webservers/nginx.generateConfig`; kept for callers that import this module. */
export function generateNginxConfig(site: Site): string {
  return generateNginxSiteConfig(site);
}

export async function writeSiteConfig(domain: string, config: string): Promise<void> {
  try {
    await mkdir(NGINX_SITES_DIR, { recursive: true });
    await writeFile(join(NGINX_SITES_DIR, `${domain}.conf`), config, "utf-8");
  } catch (err) {
    console.warn("[Nginx] Could not write config (non-Linux environment?):", err);
  }
}

export async function removeSiteConfig(domain: string): Promise<void> {
  try {
    await unlink(join(NGINX_SITES_DIR, `${domain}.conf`));
  } catch {}
}

export async function reloadNginx(): Promise<void> {
  try {
    await execAsync("nginx -s reload");
  } catch (err) {
    console.warn("[Nginx] Could not reload (non-Linux environment?):", err);
  }
}
