import type { Site } from "@hostpanel/db";
import { indexFilenamesForSite, nginxExactRootTryFiles } from "../default-document.js";
import { nginxRedirectBlocks } from "../site-pages.js";
import { appUpstreamPort } from "./proxy-port.js";
import type { SiteWebConfigExtras } from "./index.js";

export const NGINX_SITES_DIR = process.env.NGINX_SITES_DIR ?? "/etc/nginx/sites-enabled";
export const NGINX_LOG_DIR = process.env.NGINX_LOG_DIR ?? "/var/log/nginx";

export function generateConfig(site: Site, extras?: SiteWebConfigExtras): string {
  const redirectBlock = nginxRedirectBlocks(extras?.routes ?? { version: 1, routes: [] });
  const phpSocket = `/run/php/php${site.phpVersion ?? "8.2"}-fpm.sock`;
  const upstream = appUpstreamPort(site);
  const indexDirective = indexFilenamesForSite(site).join(" ");

  const rootExactBlock =
    site.type === "static" || site.type === "php"
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
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }` : "";

  const staticBlock = (site.type === "static" || site.type === "php") ? `
    location / {
        try_files $uri/index.html $uri $uri/ =404;
    }` : "";

  /** Same-origin uptime checks from static site pages (no cross-domain CORS / Pangolin auth). */
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

  return `# HostPanel — managed by hostpanel (nginx)
server {
    listen 80;
    listen [::]:80;
    server_name ${site.domain} www.${site.domain};
    root ${site.rootPath};
    index ${indexDirective};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    location ~ /\\. { deny all; }
    ${redirectBlock}
    ${uptimeProbeProxyBlock}
    ${rootExactBlock}
    ${phpBlock}
    ${proxyBlock}
    ${site.type === "nodejs" || site.type === "python" ? "" : staticBlock}

    access_log ${NGINX_LOG_DIR}/${site.domain}.access.log;
    error_log ${NGINX_LOG_DIR}/${site.domain}.error.log;
}
`;
}

export function configPath(domain: string): string {
  return `${NGINX_SITES_DIR}/${domain}.conf`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  /** API systemd unit runs as `hostpanel`; use sudoers-whitelisted nginx (see deploy/hostpanel.sudoers). */
  const cmd =
    typeof process.getuid === "function" && process.getuid() === 0
      ? "nginx -t && nginx -s reload"
      : "sudo -n /usr/sbin/nginx -t && sudo -n /usr/sbin/nginx -s reload";
  try {
    await execAsync(cmd);
  } catch (err) {
    console.warn("[nginx] Could not reload:", (err as Error).message);
  }
}
