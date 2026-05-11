import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type { Site } from "@hostpanel/db";

const execAsync = promisify(exec);

const NGINX_SITES_DIR = process.env.NGINX_SITES_DIR ?? "/etc/nginx/sites-enabled";

export function generateNginxConfig(site: Site): string {
  const phpSocketPath = `/run/php/php${site.phpVersion ?? "8.2"}-fpm.sock`;

  const phpLocation = site.type === "php" ? `
    location ~ \\.php$ {
        fastcgi_pass unix:${phpSocketPath};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }` : "";

  const nodeProxyLocation = site.type === "nodejs" ? `
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }` : "";

  const staticLocation = (site.type === "static" || site.type === "php") ? `
    location / {
        try_files $uri $uri/ =404;
    }` : "";

  return `server {
    listen 80;
    listen [::]:80;
    server_name ${site.domain} www.${site.domain};
    root ${site.rootPath};
    index index.html index.htm index.php;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Deny hidden files
    location ~ /\\. {
        deny all;
    }
    ${phpLocation}
    ${nodeProxyLocation}
    ${staticLocation}

    access_log /var/log/nginx/${site.domain}.access.log;
    error_log /var/log/nginx/${site.domain}.error.log;
}
`;
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
