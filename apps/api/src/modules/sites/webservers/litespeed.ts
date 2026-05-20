import type { Site } from "@hostpanel/db";
import { indexFilenamesForSite, siteFilesystemWebRoot } from "../default-document.js";
import { appUpstreamPort } from "./proxy-port.js";
import { normalizePhpVersionForFpm } from "./php-fpm-socket.js";

// LiteSpeed Community Edition uses Apache-compatible vhost syntax
// but is typically managed via /usr/local/lsws/conf/vhosts/
export const LSWS_VHOSTS_DIR = process.env.LSWS_VHOSTS_DIR ?? "/usr/local/lsws/conf/vhosts";
export const LSWS_LOG_DIR = process.env.LSWS_LOG_DIR ?? "/usr/local/lsws/logs";

export function generateConfig(site: Site, _extras?: import("./index.js").SiteWebConfigExtras): string {
  const upstream = appUpstreamPort(site);
  const phpDigits = normalizePhpVersionForFpm(site.phpVersion).replace(".", "");
  const phpHandler = `lsapi:/tmp/lshttpd/php${phpDigits}`;
  const idxCsv = indexFilenamesForSite(site).join(", ");
  const docRoot = siteFilesystemWebRoot(site);

  const phpBlock = site.type === "php" ? `
  # PHP via LiteSpeed API (LSAPI)
  addType application/x-httpd-php .php
  Action application/x-httpd-php /${phpHandler}
  <FilesMatch "\\.php$">
      SetHandler application/x-httpd-php
  </FilesMatch>` : "";

  const proxyBlock =
    site.type === "nodejs" || site.type === "python"
      ? `
  # Node.js / Python reverse proxy
  ProxyPass        / http://127.0.0.1:${upstream}/
  ProxyPassReverse / http://127.0.0.1:${upstream}/`
      : "";

  // LiteSpeed native config format (XML-like)
  return `# HostPanel — managed by hostpanel (litespeed)
# Place this file in: ${LSWS_VHOSTS_DIR}/${site.domain}/vhconf.conf

docRoot                   ${docRoot}
vhDomain                  ${site.domain}
vhAliases                 www.${site.domain}
enableGzip                1
enableBr                  1

errorlog ${LSWS_LOG_DIR}/${site.domain}.error.log {
  useServer               0
  logLevel                WARN
  rollingSize             10M
}

accesslog ${LSWS_LOG_DIR}/${site.domain}.access.log {
  useServer               0
  logFormat               "%h %l %u %t \\"%r\\" %>s %b"
  logHeaders              5
  rollingSize             10M
}

index {
  useServer               0
  indexFiles              ${idxCsv}
  autoIndex               0
}

# Security headers via .htaccess or rewrite rules
context / {
  type                    null
  location                ${docRoot}
  allowBrowse             0
  accessControl {
    allow                 *
  }
  addDefaultCharset       off
}

rewrite {
  enable                  1
  autoLoadHtaccess        1
}
${phpBlock}
${proxyBlock}
`;
}

export function configPath(domain: string): string {
  return `${LSWS_VHOSTS_DIR}/${domain}/vhconf.conf`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    // LiteSpeed graceful restart via its control socket
    await execAsync("/usr/local/lsws/bin/lswsctrl restart");
  } catch (err) {
    try {
      // Fallback: send SIGUSR1 for graceful reload
      const { exec: execRaw } = await import("child_process");
      const p = promisify(execRaw);
      await p("kill -USR1 $(cat /tmp/lshttpd/lshttpd.pid)");
    } catch {
      console.warn("[litespeed] Could not reload:", (err as Error).message);
    }
  }
}
