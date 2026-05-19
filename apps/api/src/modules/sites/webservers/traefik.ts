import type { Site } from "@hostpanel/db";
import { appUpstreamPort } from "./proxy-port.js";

export const TRAEFIK_DYNAMIC_DIR = process.env.TRAEFIK_DYNAMIC_DIR ?? "/etc/traefik/dynamic";

/** Traefik file-provider YAML — reverse proxy only (Node/Python). */
export function generateConfig(site: Site, _extras?: import("./index.js").SiteWebConfigExtras): string {
  const slug = site.domain.replace(/[^a-zA-Z0-9.-]/g, "-");
  const upstream = appUpstreamPort(site);
  const routerName = `hp-${slug}`.replace(/\./g, "-");
  const serviceName = `${routerName}-svc`;

  return `# HostPanel — managed by hostpanel (traefik)
http:
  routers:
    ${routerName}:
      rule: "Host(\`${site.domain}\`) || Host(\`www.${site.domain}\`)"
      entryPoints:
        - web
      service: ${serviceName}
  services:
    ${serviceName}:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${upstream}"
`;
}

export function configPath(domain: string): string {
  const safe = domain.replace(/[^a-zA-Z0-9.-]/g, "-");
  return `${TRAEFIK_DYNAMIC_DIR}/hostpanel-${safe}.yml`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    await execAsync("systemctl reload traefik 2>/dev/null || service traefik reload 2>/dev/null || true");
  } catch (err) {
    console.warn("[traefik] Could not reload:", (err as Error).message);
  }
}
