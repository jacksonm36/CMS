import type { Site } from "@hostpanel/db";
import { indexFilenamesForSite, siteFilesystemWebRoot } from "../default-document.js";
import { appUpstreamPort } from "./proxy-port.js";
import { backendListenPort } from "./webserver-ports.js";
import { pickWorkingPhpFpmSocket } from "./php-fpm-socket.js";
import { assertSafeHostname } from "./edge-proxy.js";

export const APACHE_SITES_DIR = process.env.APACHE_SITES_DIR ?? "/etc/apache2/sites-enabled";
export const APACHE_LOG_DIR = process.env.APACHE_LOG_DIR ?? "/var/log/apache2";

export function generateConfig(site: Site, _extras?: import("./index.js").SiteWebConfigExtras): string {
  const phpSock = pickWorkingPhpFpmSocket(site.phpVersion ?? "8.2");
  const upstream = appUpstreamPort(site);
  const dirIndex = indexFilenamesForSite(site).join(" ");
  const listenPort = backendListenPort("apache2");
  const docRoot = siteFilesystemWebRoot(site);

  // PHP via mod_php or FPM proxy
  const phpFpmBlock = site.type === "php" ? `
    # PHP-FPM via proxy
    <FilesMatch "\\.php$">
        SetHandler "proxy:unix:${phpSock}|fcgi://localhost"
    </FilesMatch>` : "";

  const proxyBlock =
    site.type === "nodejs" || site.type === "python"
      ? `
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:${upstream}/
    ProxyPassReverse / http://127.0.0.1:${upstream}/`
      : "";

  return `# HostPanel — managed by hostpanel (apache2 backend :${listenPort})
<VirtualHost 127.0.0.1:${listenPort}>
    ServerName   ${site.domain}
    ServerAlias  www.${site.domain}
    DocumentRoot ${docRoot}

    <Directory ${docRoot}>
        DirectoryIndex ${dirIndex}
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # Security headers
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    # Deny hidden files
    <FilesMatch "^\\.">
        Require all denied
    </FilesMatch>
    ${phpFpmBlock}
    ${proxyBlock}

    # Compression
    <IfModule mod_deflate.c>
        AddOutputFilterByType DEFLATE text/plain text/html text/css application/javascript application/json
    </IfModule>

    ErrorLog  ${APACHE_LOG_DIR}/${site.domain}.error.log
    CustomLog ${APACHE_LOG_DIR}/${site.domain}.access.log combined
</VirtualHost>
`;
}

export function configPath(domain: string): string {
  return `${APACHE_SITES_DIR}/${assertSafeHostname(domain)}.conf`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    await execAsync("apachectl configtest && apachectl graceful");
  } catch (err) {
    console.warn("[apache2] Could not reload:", (err as Error).message);
  }
}
