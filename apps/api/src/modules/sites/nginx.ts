import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { Site } from "@hostpanel/db";
import { generateConfig as generateNginxSiteConfig } from "./webservers/nginx.js";
import {
  legacyMirrorDirsForWebServer,
  removeLegacyMirrorDuplicateIfDifferent,
  unlinkArtifactAndLegacyMirrors,
} from "./webservers/legacy-mirror-dedupe.js";

const execAsync = promisify(exec);

const NGINX_SITES_DIR = process.env.NGINX_SITES_DIR ?? "/etc/nginx/sites-enabled";

/** @deprecated Prefer `webservers/nginx.generateConfig`; kept for callers that import this module. */
export function generateNginxConfig(site: Site): string {
  return generateNginxSiteConfig(site);
}

export async function writeSiteConfig(domain: string, config: string): Promise<void> {
  const path = join(NGINX_SITES_DIR, `${domain}.conf`);
  try {
    await mkdir(NGINX_SITES_DIR, { recursive: true });
    await writeFile(path, config, "utf-8");
    await removeLegacyMirrorDuplicateIfDifferent(path, legacyMirrorDirsForWebServer("nginx")).catch((e) =>
      console.warn(`[hostpanel:dedupe] ${(e as Error).message}`),
    );
  } catch (err) {
    console.warn("[Nginx] Could not write config (non-Linux environment?):", err);
  }
}

export async function removeSiteConfig(domain: string): Promise<void> {
  await unlinkArtifactAndLegacyMirrors(
    join(NGINX_SITES_DIR, `${domain}.conf`),
    legacyMirrorDirsForWebServer("nginx"),
  ).catch(() => {});
}

export async function reloadNginx(): Promise<void> {
  try {
    await execAsync("nginx -s reload");
  } catch (err) {
    console.warn("[Nginx] Could not reload (non-Linux environment?):", err);
  }
}
