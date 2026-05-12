#!/usr/bin/env bash
# One-time migration: let the hostpanel API user write nginx site configs.
# Run as root on an existing HostPanel host where sites never appear in nginx.
set -euo pipefail
DIR="/var/lib/hostpanel/nginx-sites"
INCLUDE="/etc/nginx/conf.d/00-hostpanel-managed-sites.conf"

mkdir -p "$DIR"
chown hostpanel:hostpanel "$DIR"
chmod 755 "$DIR"

if [[ ! -d /etc/nginx/conf.d ]]; then
  echo "ERROR: /etc/nginx/conf.d not found — install nginx or add include manually." >&2
  exit 1
fi

cat >"$INCLUDE" <<'EOF'
# HostPanel — per-site vhosts written by the `hostpanel` user (NGINX_SITES_DIR in HostPanel .env)
include /var/lib/hostpanel/nginx-sites/*.conf;
EOF
chmod 644 "$INCLUDE"

ENV_FILE="${1:-/opt/hostpanel/.env}"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^NGINX_SITES_DIR=' "$ENV_FILE"; then
    sed -i 's|^NGINX_SITES_DIR=.*|NGINX_SITES_DIR="/var/lib/hostpanel/nginx-sites"|' "$ENV_FILE"
  else
    printf '\nNGINX_SITES_DIR="/var/lib/hostpanel/nginx-sites"\n' >>"$ENV_FILE"
  fi
  chown hostpanel:hostpanel "$ENV_FILE" 2>/dev/null || true
  echo "Updated NGINX_SITES_DIR in $ENV_FILE"
else
  echo "WARN: $ENV_FILE not found — set NGINX_SITES_DIR=/var/lib/hostpanel/nginx-sites in HostPanel .env" >&2
fi

nginx -t
nginx -s reload
echo "OK: nginx loads $DIR/*.conf — restart API: systemctl restart hostpanel-api"
echo "Then re-save each site in HostPanel (or PATCH stack) to regenerate .conf files."
