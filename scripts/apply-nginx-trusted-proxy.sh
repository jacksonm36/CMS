#!/usr/bin/env bash
# Write /etc/nginx/conf.d/30-hostpanel-trusted-proxy.conf from HOSTPANEL_TRUSTED_PROXY_IPS (.env or env).
# Usage: sudo bash scripts/apply-nginx-trusted-proxy.sh [/path/to/.env]
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }

HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}"
ENV_FILE="${1:-${HP_INSTALL_DIR}/.env}"
OUT="/etc/nginx/conf.d/30-hostpanel-trusted-proxy.conf"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PROXIES="${HOSTPANEL_TRUSTED_PROXY_IPS:-}"
EXTRA="${HOSTPANEL_TRUSTED_PROXY_EXTRA:-10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}"
if [[ -n "${EXTRA//[[:space:],]/}" ]]; then
  PROXIES="${PROXIES:+$PROXIES,}$EXTRA"
fi
if [[ -z "${PROXIES//[[:space:],]/}" ]]; then
  if [[ -f "$OUT" ]]; then
    rm -f "$OUT"
    echo "Removed $OUT (HOSTPANEL_TRUSTED_PROXY_IPS unset)"
    nginx -t && nginx -s reload
  else
    echo "HOSTPANEL_TRUSTED_PROXY_IPS not set in $ENV_FILE — nothing to do."
  fi
  exit 0
fi

{
  echo "# HostPanel — managed by apply-nginx-trusted-proxy.sh (do not edit by hand)"
  echo "# Source: HOSTPANEL_TRUSTED_PROXY_IPS in ${ENV_FILE}"
  IFS=',$; ' read -ra PARTS <<<"$PROXIES"
  for p in "${PARTS[@]}"; do
    p="${p//[[:space:]]/}"
    [[ -n "$p" ]] || continue
    echo "set_real_ip_from ${p};"
  done
  echo "real_ip_header X-Forwarded-For;"
  echo "real_ip_recursive on;"
} >"$OUT"
chmod 644 "$OUT"

nginx -t
nginx -s reload
echo "Wrote $OUT and reloaded nginx."
