import type { Site } from "@hostpanel/db";

export const NGINX_SITES_DIR = process.env.NGINX_SITES_DIR ?? "/etc/nginx/sites-enabled";
export const NGINX_LOG_DIR = process.env.NGINX_LOG_DIR ?? "/var/log/nginx";

export function generateConfig(site: Site): string {
  const phpSocket = `/run/php/php${site.phpVersion ?? "8.2"}-fpm.sock`;

  const phpBlock = site.type === "php" ? `
    location ~ \\.php$ {
        fastcgi_pass unix:${phpSocket};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }` : "";

  const proxyBlock = site.type === "nodejs" ? `
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }` : "";

  const staticBlock = (site.type === "static" || site.type === "php") ? `
    location / {
        try_files $uri $uri/ =404;
    }` : "";

  return `# HostPanel — managed by hostpanel (nginx)
server {
    listen 80;
    listen [::]:80;
    server_name ${site.domain} www.${site.domain};
    root ${site.rootPath};
    index index.html index.htm index.php;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    location ~ /\\. { deny all; }
    ${phpBlock}
    ${proxyBlock}
    ${staticBlock}

    access_log ${NGINX_LOG_DIR}/${site.domain}.access.log;
    error_log  ${NGINX_LOG_DIR}/${site.domain}.error.log;
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
  try {
    await execAsync("nginx -t && nginx -s reload");
  } catch (err) {
    console.warn("[nginx] Could not reload:", (err as Error).message);
  }
}
