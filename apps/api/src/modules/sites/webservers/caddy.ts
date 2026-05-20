import type { Site } from "@hostpanel/db";
import { basename } from "path";
import { sanitizeDefaultDocument, siteFilesystemWebRoot } from "../default-document.js";
import { appUpstreamPort } from "./proxy-port.js";
import { backendListenPort } from "./webserver-ports.js";
import { pickWorkingPhpFpmSocket } from "./php-fpm-socket.js";

export const CADDY_CONF_D = process.env.CADDY_CONF_D ?? "/etc/caddy/conf.d";

function escapeCaddy(s: string): string {
  return s.replace(/`/g, "\\`");
}

export function generateConfig(site: Site, _extras?: import("./index.js").SiteWebConfigExtras): string {
  const webRootFs = siteFilesystemWebRoot(site);
  const root = escapeCaddy(webRootFs);
  const dom = escapeCaddy(site.domain);
  const phpSock = pickWorkingPhpFpmSocket(site.phpVersion ?? "8.2");
  const upstream = appUpstreamPort(site);
  const listenPort = backendListenPort("caddy");
  const bind = `127.0.0.1:${listenPort}`;

  const secHeaders = `
    header X-Frame-Options "SAMEORIGIN"
    header X-Content-Type-Options "nosniff"
    header Referrer-Policy "strict-origin-when-cross-origin"`;

  const customRaw = sanitizeDefaultDocument(site.defaultDocument);
  const customHome =
    customRaw && (site.type === "static" || site.type === "php")
      ? customRaw.includes("/")
        ? basename(customRaw)
        : customRaw
      : null;
  const rootRewrite =
    customHome && (site.type === "static" || site.type === "php")
      ? `
    @hpSiteRoot path /
    handle @hpSiteRoot {
        rewrite * /${escapeCaddy(customHome)}
    }`
      : "";

  if (site.type === "nodejs" || site.type === "python") {
    return `# HostPanel — managed by hostpanel (caddy backend :${listenPort})
${bind} {
    @hosts host ${dom} www.${dom}
    handle @hosts {
        encode gzip zstd
${secHeaders}
        reverse_proxy 127.0.0.1:${upstream}
    }
}
`;
  }

  if (site.type === "php") {
    const sockPath = phpSock.replace(/^\/+/, "");
    return `# HostPanel — managed by hostpanel (caddy backend :${listenPort})
${bind} {
    @hosts host ${dom} www.${dom}
    handle @hosts {
        root * ${root}
        encode gzip zstd
${secHeaders}
${rootRewrite}
        php_fastcgi unix//${sockPath} {
            root ${root}
        }
        file_server
    }
}
`;
  }

  // static
  return `# HostPanel — managed by hostpanel (caddy backend :${listenPort})
${bind} {
    @hosts host ${dom} www.${dom}
    handle @hosts {
        root * ${root}
        encode gzip zstd
${secHeaders}
${rootRewrite}
        file_server
    }
}
`;
}

export function configPath(domain: string): string {
  const safe = domain.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${CADDY_CONF_D}/hostpanel-${safe}.caddy`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    await execAsync(
      "(test -f /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile 2>/dev/null; systemctl reload caddy) || caddy reload --config /etc/caddy/Caddyfile"
    );
  } catch (err) {
    console.warn("[caddy] Could not reload:", (err as Error).message);
  }
}
