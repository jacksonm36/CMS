#!/usr/bin/env bash
# Register CrowdSec LAPI API key for crowdsec-firewall-bouncer and start systemd unit.
# Central stack on 192.168.1.187: :8080 = Manager UI, :8888 = LAPI (agents + bouncers).
# Run as root after crowdsec + crowdsec-firewall-bouncer-iptables packages are installed.
set -euo pipefail

YAML=/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml
BOUNCER_NAME=crowdsec-firewall-bouncer
LAPI_URL="${CROWDSEC_LAPI_URL:-http://192.168.1.187:8888}"

enable_docker_user_chain() {
  [[ -f "$YAML" ]] || return 0
  if grep -qE '^\s*-\s*DOCKER-USER\s*$' "$YAML"; then
    return 0
  fi
  if grep -qE '^\s*#\s*-\s*DOCKER-USER' "$YAML"; then
    sed -i 's|^[[:space:]]*#[[:space:]]*-[[:space:]]*DOCKER-USER|  - DOCKER-USER|' "$YAML"
  elif grep -qE '^\s*-\s*INPUT' "$YAML"; then
    sed -i '/^\s*-\s*INPUT/a\  - DOCKER-USER' "$YAML"
  else
    return 0
  fi
  echo "Enabled DOCKER-USER in iptables_chains ($YAML)"
}

if ! command -v cscli &>/dev/null; then
  echo "cscli not found — install crowdsec first." >&2
  exit 1
fi

if [[ ! -f "$YAML" ]]; then
  echo "Missing $YAML — install: apt install crowdsec-firewall-bouncer-iptables" >&2
  exit 1
fi

if grep -qF '${API_KEY}' "$YAML"; then
  if ! systemctl is-active --quiet crowdsec 2>/dev/null; then
    echo "Starting crowdsec (LAPI required for bouncer keys)..." >&2
    systemctl start crowdsec 2>/dev/null || true
    sleep 2
  fi
  KEY="$(cscli bouncers add "$BOUNCER_NAME" -o raw 2>/dev/null)" || KEY=""
  if [[ -z "$KEY" ]]; then
    echo "Failed to create bouncer API key via cscli (central LAPI is usually :8888, not Manager :8080)." >&2
    exit 1
  fi
  sed -i "s|^api_key:.*|api_key: ${KEY}|" "$YAML"
  if [[ -n "$LAPI_URL" ]]; then
    LAPI_URL="${LAPI_URL%/}"
    sed -i "s|^api_url:.*|api_url: ${LAPI_URL}/|" "$YAML"
    echo "Set api_url to ${LAPI_URL}/"
  fi
  echo "Wrote API key for $BOUNCER_NAME into $YAML"
else
  echo "api_key already set in $YAML (not a placeholder) — leaving as-is."
  if [[ -n "$LAPI_URL" ]] && grep -qE '^api_url:' "$YAML"; then
    LAPI_URL="${LAPI_URL%/}"
    sed -i "s|^api_url:.*|api_url: ${LAPI_URL}/|" "$YAML"
  fi
fi

enable_docker_user_chain

systemctl enable crowdsec-firewall-bouncer 2>/dev/null || true
systemctl restart crowdsec-firewall-bouncer 2>/dev/null || systemctl start crowdsec-firewall-bouncer

if systemctl is-active --quiet crowdsec-firewall-bouncer 2>/dev/null; then
  echo "crowdsec-firewall-bouncer is active."
  exit 0
fi

echo "crowdsec-firewall-bouncer failed — run: journalctl -u crowdsec-firewall-bouncer -n 60 --no-pager" >&2
exit 1
