import type { Site } from "@hostpanel/db";
import {
  documentRootSuffix,
  indexFilenamesForSite,
  nginxExactRootTryFiles,
  siteFilesystemWebRoot,
} from "../default-document.js";
import { nginxPageAliasBlocks, nginxRedirectBlocks } from "../site-pages.js";
import { appUpstreamPort } from "./proxy-port.js";
import { pickWorkingPhpFpmSocket } from "./php-fpm-socket.js";
import { backendListenPort } from "./webserver-ports.js";
import type { SiteWebConfigExtras } from "./index.js";
import { assertSafeHostname } from "./edge-proxy.js";

/** Debian/Ubuntu OpenResty typically mirrors nginx layout. */
export const OPENRESTY_SITES_DIR =
  process.env.OPENRESTY_SITES_DIR ?? "/etc/openresty/nginx/sites-enabled";
export const OPENRESTY_LOG_DIR = process.env.OPENRESTY_LOG_DIR ?? "/var/log/openresty/nginx";

export function generateConfig(site: Site, extras?: SiteWebConfigExtras): string {
  const domain = assertSafeHostname(site.domain);
  const routes = extras?.routes ?? { version: 1 as const, routes: [] };
  const redirectBlock = nginxRedirectBlocks(routes);
  const pageAliasBlock =
    (site.type === "php" || site.type === "static") && documentRootSuffix(site.defaultDocument)
      ? nginxPageAliasBlocks(site.rootPath, routes)
      : "";
  const phpSocket = pickWorkingPhpFpmSocket(site.phpVersion ?? "8.2");
  const upstream = appUpstreamPort(site);
  const indexDirective = indexFilenamesForSite(site).join(" ");
  const listenPort = backendListenPort("openresty");
  const webRoot = siteFilesystemWebRoot(site);
  const phpFrontController =
    site.type === "php"
      ? (indexFilenamesForSite(site).find((f) => f.endsWith(".php")) ?? "index.php")
      : "index.php";

  /** Static only — see `nginx.ts` (PHP must not serve `.php` from `location = /`). */
  const rootExactBlock =
    site.type === "static"
      ? `
    location = / {
        try_files ${nginxExactRootTryFiles(site)} =404;
    }`
      : "";

  const phpBlock = site.type === "php" ? `
    location ~ \\.php$ {
        fastcgi_pass unix:${phpSocket};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }` : "";

  const proxyBlock =
    site.type === "nodejs" || site.type === "python"
      ? `
    location / {
        proxy_pass http://127.0.0.1:${upstream};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }` : "";

  const staticBlock =
    site.type === "static"
      ? `
    location / {
        try_files $uri/index.html $uri $uri/ =404;
    }`
      : site.type === "php"
        ? `
    location / {
        try_files $uri $uri/ /${phpFrontController}?$query_string;
    }`
        : "";

  const uptimeProbeProxyBlock =
    site.type === "static" || site.type === "php"
      ? `
    location /api/monitoring/public-probe {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`
      : "";

  return `# HostPanel — managed by hostpanel (openresty backend :${listenPort})
server {
    listen 127.0.0.1:${listenPort};
    server_name ${domain} www.${domain};
    root ${webRoot};
    index ${indexDirective};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    location ~ /\\. { deny all; }
    ${redirectBlock}
    ${pageAliasBlock}
    ${uptimeProbeProxyBlock}
    ${rootExactBlock}
    ${phpBlock}
    ${proxyBlock}
    ${site.type === "nodejs" || site.type === "python" ? "" : staticBlock}

    access_log ${OPENRESTY_LOG_DIR}/${domain}.access.log combined;
    error_log ${OPENRESTY_LOG_DIR}/${domain}.error.log warn;
}
`;
}

export function configPath(domain: string): string {
  return `${OPENRESTY_SITES_DIR}/${assertSafeHostname(domain)}.conf`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    await execAsync(
      "(command -v openresty >/dev/null && openresty -t && openresty -s reload) || (/usr/local/openresty/nginx/sbin/nginx -t && /usr/local/openresty/nginx/sbin/nginx -s reload)"
    );
  } catch (err) {
    console.warn("[openresty] Could not reload:", (err as Error).message);
  }
}
