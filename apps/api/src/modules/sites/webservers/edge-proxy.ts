import type { Site } from "@hostpanel/db";
import { NGINX_LOG_DIR, NGINX_SITES_DIR } from "./nginx.js";
import { nginxRedirectBlocks } from "../site-pages.js";
import { backendUpstreamUrl } from "./webserver-ports.js";
import type { SiteWebConfigExtras, WebServerType } from "./index.js";

/** Hostname safe for nginx `server_name` and log file stems (prevents config injection). */
export function assertSafeHostname(host: string): string {
  const h = host.trim().toLowerCase();
  if (!h || h.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(h)) {
    throw new Error(`Unsafe hostname for nginx config: ${host}`);
  }
  return h;
}

function safeConfigSlug(domain: string): string {
  return assertSafeHostname(domain).replace(/\./g, "-");
}

/** Nginx edge vhost: public :80 → loopback backend for non-native stacks. */
export function generateEdgeProxyConfig(
  site: Site,
  backend: WebServerType,
  extras?: SiteWebConfigExtras
): string {
  const domain = assertSafeHostname(site.domain);
  const redirectBlock = nginxRedirectBlocks(extras?.routes ?? { version: 1, routes: [] });
  const upstream = backendUpstreamUrl(backend);

  return `# HostPanel — edge proxy (${backend} backend)
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location ~ /\\. { deny all; }
    ${redirectBlock}

    location / {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    access_log ${NGINX_LOG_DIR}/${domain}.edge.access.log combined;
    error_log ${NGINX_LOG_DIR}/${domain}.edge.error.log warn;
}
`;
}

export function edgeConfigPath(domain: string): string {
  return `${NGINX_SITES_DIR}/hostpanel-edge-${safeConfigSlug(domain)}.conf`;
}
