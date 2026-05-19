#!/usr/bin/env bash
# Apply pre-issued CrowdSec LAPI machine credentials (log processor) + firewall bouncer.
#
# Central: :8080 = Manager UI, :8888 = LAPI. Example:
#   sudo CROWDSEC_LAPI_URL=http://192.168.1.187:8888 bash deploy/apply-crowdsec-lapi-credentials.sh
#   sudo bash deploy/apply-crowdsec-lapi-credentials.sh deploy/crowdsec-lapi-webhost.credentials.yaml
set -euo pipefail

CREDS_FILE="${1:-${CROWDSEC_CREDENTIALS_FILE:-/opt/hostpanel/deploy/crowdsec-lapi-webhost.credentials.yaml}}"
LAPI_URL_OVERRIDE="${CROWDSEC_LAPI_URL:-}"
FW_YAML="/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
FW_NAME="crowdsec-firewall-bouncer"
HP_BOUNCER="hostpanel-api"
HOSTPANEL_ENV="${HOSTPANEL_ENV:-/opt/hostpanel/.env}"
TARGET_CREDS="/etc/crowdsec/local_api_credentials.yaml"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo)."
[[ -f "$CREDS_FILE" ]] || die "Missing credentials file: $CREDS_FILE"

read_cred() {
  local key="$1"
  grep -E "^${key}:" "$CREDS_FILE" | sed "s/^${key}:[[:space:]]*//" | head -1
}

URL="$(read_cred url)"
LOGIN="$(read_cred login)"
PASS="$(read_cred password)"

[[ -n "$URL" && -n "$LOGIN" && -n "$PASS" ]] || die "credentials file must contain url, login, password"

# 0.0.0.0 is a bind address, not a client target
if [[ "$URL" == *"0.0.0.0"* ]]; then
  if [[ -n "$LAPI_URL_OVERRIDE" ]]; then
    URL="$LAPI_URL_OVERRIDE"
  else
    URL="http://192.168.1.187:8888"
    info "Replaced 0.0.0.0 with client URL $URL (override with CROWDSEC_LAPI_URL)"
  fi
fi
URL="${URL%/}"

install -m 0600 /dev/null "$TARGET_CREDS"
cat >"$TARGET_CREDS" <<EOF
url: ${URL}
login: ${LOGIN}
password: ${PASS}
EOF
info "Wrote $TARGET_CREDS (machine: $LOGIN → $URL)"

if ! cscli lapi status &>/dev/null; then
  die "Cannot authenticate to LAPI at $URL — expose CrowdSec LAPI (not only Manager UI) and validate machine: cscli machines validate $LOGIN"
fi
info "LAPI authentication OK"

if [[ -f "$FW_YAML" ]]; then
  KEY="$(cscli bouncers add "$FW_NAME" -o raw 2>/dev/null || true)"
  if [[ -z "${KEY:-}" ]]; then
    KEY="$(grep '^api_key:' "$FW_YAML" | sed 's/^api_key:[[:space:]]*//')"
  fi
  sed -i "s|^api_url:.*|api_url: ${URL}/|" "$FW_YAML"
  [[ -n "$KEY" ]] && sed -i "s|^api_key:.*|api_key: ${KEY}|" "$FW_YAML"
  if ! grep -qE '^\s*-\s*DOCKER-USER\s*$' "$FW_YAML"; then
    sed -i 's|^[[:space:]]*#[[:space:]]*-[[:space:]]*DOCKER-USER|  - DOCKER-USER|' "$FW_YAML" 2>/dev/null || true
  fi
  systemctl enable crowdsec-firewall-bouncer
  systemctl restart crowdsec-firewall-bouncer
  systemctl is-active --quiet crowdsec-firewall-bouncer || die "firewall bouncer failed"
  info "Firewall bouncer → $URL"
fi

if [[ -f "$HOSTPANEL_ENV" ]]; then
  HP_KEY="$(cscli bouncers add "$HP_BOUNCER" -o raw 2>/dev/null || true)"
  if grep -q '^CROWDSEC_API_URL=' "$HOSTPANEL_ENV"; then
    sed -i "s|^CROWDSEC_API_URL=.*|CROWDSEC_API_URL=\"${URL}\"|" "$HOSTPANEL_ENV"
  else
    echo "CROWDSEC_API_URL=\"${URL}\"" >>"$HOSTPANEL_ENV"
  fi
  if [[ -n "${HP_KEY:-}" ]]; then
    if grep -q '^CROWDSEC_API_KEY=' "$HOSTPANEL_ENV"; then
      sed -i "s|^CROWDSEC_API_KEY=.*|CROWDSEC_API_KEY=\"${HP_KEY}\"|" "$HOSTPANEL_ENV"
    else
      echo "CROWDSEC_API_KEY=\"${HP_KEY}\"" >>"$HOSTPANEL_ENV"
    fi
  fi
  systemctl restart hostpanel-api 2>/dev/null || true
  info "Updated HostPanel .env"
fi

systemctl restart crowdsec
sleep 2
systemctl is-active --quiet crowdsec || die "crowdsec failed — journalctl -u crowdsec -n 30"
info "crowdsec active as log processor for machine '$LOGIN'"
