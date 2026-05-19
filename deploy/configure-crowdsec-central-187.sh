#!/usr/bin/env bash
# Configure this host as CrowdSec log processor + bouncer client of central LAPI at 192.168.1.187 (LAPI :8888, Manager UI :8080).
# Does NOT use local LAPI (api.server disabled).
set -euo pipefail

MANAGER_URL="${CROWDSEC_MANAGER_URL:-http://192.168.1.187:8080}"
LAPI_URL="${CROWDSEC_LAPI_URL:-http://192.168.1.187:8888}"
LAPI_URL="${LAPI_URL%/}"
LOGIN="${CROWDSEC_LOGIN:-webhost}"
PASSWORD="${CROWDSEC_PASSWORD:-PcOPQo9XV1aoCH9Gjwq0204qqptk7NzdYX8HMP8XTEeMnTDEaJesQBJuRjF6XeHn}"
CONFIG="/etc/crowdsec/config.yaml"
CREDS="/etc/crowdsec/local_api_credentials.yaml"
FW_YAML="/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
FW_NAME="crowdsec-firewall-bouncer"
HP_BOUNCER="hostpanel-api"
HOSTPANEL_ENV="${HOSTPANEL_ENV:-/opt/hostpanel/.env}"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo)."
command -v cscli &>/dev/null || die "cscli not found"

disable_local_lapi_server() {
  [[ -f "$CONFIG" ]] || return 0
  cp -a "$CONFIG" "${CONFIG}.bak.$(date +%s)"
  python3 - "$CONFIG" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
lines = p.read_text().splitlines()
out, skip = [], 0
for line in lines:
    if line.strip() == "server:" and out and out[-1].rstrip().endswith("api:"):
        skip = 1
        continue
    if skip:
        if line.startswith("prometheus:") or (line and not line.startswith(" ")):
            skip = 0
        else:
            continue
    out.append(line)
p.write_text("\n".join(out).rstrip() + "\n")
PY
  info "Disabled local LAPI server in $CONFIG"
}

write_credentials() {
  install -m 0600 /dev/null "$CREDS"
  cat >"$CREDS" <<EOF
url: ${LAPI_URL}
login: ${LOGIN}
password: ${PASSWORD}
EOF
  info "Wrote $CREDS → $LAPI_URL (machine: $LOGIN)"
}

lapi_reachable() {
  cscli lapi status &>/dev/null
}

manager_bouncer_key() {
  local name="$1"
  sudo cscli bouncers delete "$name" 2>/dev/null || true
  local resp
  resp="$(curl -sS -m 10 -X POST "${MANAGER_URL}/api/crowdsec/bouncers" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"${name}\"}" 2>/dev/null || true)"
  echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('api_key',''))" 2>/dev/null || true
}

enable_firewall_docker_user() {
  [[ -f "$FW_YAML" ]] || return 0
  if grep -qE '^\s*-\s*DOCKER-USER\s*$' "$FW_YAML"; then
    return 0
  fi
  if grep -qE '^\s*#\s*-\s*DOCKER-USER' "$FW_YAML"; then
    sed -i 's|^[[:space:]]*#[[:space:]]*-[[:space:]]*DOCKER-USER|  - DOCKER-USER|' "$FW_YAML"
  elif grep -qE '^\s*-\s*INPUT' "$FW_YAML"; then
    sed -i '/^\s*-\s*INPUT/a\  - DOCKER-USER' "$FW_YAML"
  fi
  info "Firewall bouncer iptables_chains: INPUT + DOCKER-USER"
}

register_firewall_bouncer_via_manager() {
  local key
  key="$(manager_bouncer_key "$FW_NAME")"
  [[ -n "$key" ]] || die "No firewall bouncer API key from ${MANAGER_URL}/api/crowdsec/bouncers"
  [[ -f "$FW_YAML" ]] || die "Missing $FW_YAML"
  sed -i "s|^api_url:.*|api_url: ${LAPI_URL}/|" "$FW_YAML"
  sed -i "s|^api_key:.*|api_key: ${key}|" "$FW_YAML"
  enable_firewall_docker_user
  info "Firewall bouncer → ${LAPI_URL}"
}

register_hostpanel_bouncer_via_manager() {
  [[ -f "$HOSTPANEL_ENV" ]] || return 0
  local key
  key="$(manager_bouncer_key "$HP_BOUNCER")"
  if grep -q '^CROWDSEC_API_URL=' "$HOSTPANEL_ENV"; then
    sed -i "s|^CROWDSEC_API_URL=.*|CROWDSEC_API_URL=\"${LAPI_URL}\"|" "$HOSTPANEL_ENV"
  else
    echo "CROWDSEC_API_URL=\"${LAPI_URL}\"" >>"$HOSTPANEL_ENV"
  fi
  if grep -q '^CROWDSEC_MANAGER_URL=' "$HOSTPANEL_ENV"; then
    sed -i "s|^CROWDSEC_MANAGER_URL=.*|CROWDSEC_MANAGER_URL=\"${MANAGER_URL}\"|" "$HOSTPANEL_ENV"
  else
    echo "CROWDSEC_MANAGER_URL=\"${MANAGER_URL}\"" >>"$HOSTPANEL_ENV"
  fi
  if [[ -n "$key" ]]; then
    if grep -q '^CROWDSEC_API_KEY=' "$HOSTPANEL_ENV"; then
      sed -i "s|^CROWDSEC_API_KEY=.*|CROWDSEC_API_KEY=\"${key}\"|" "$HOSTPANEL_ENV"
    else
      echo "CROWDSEC_API_KEY=\"${key}\"" >>"$HOSTPANEL_ENV"
    fi
  fi
  info "HostPanel .env → ${LAPI_URL}"
}

install_acquis() {
  local src="${HP_INSTALL_DIR:-/opt/hostpanel}/deploy/crowdsec-acquis-hostpanel.yaml"
  [[ -f "$src" ]] || return 0
  install -m 0644 "$src" /etc/crowdsec/acquis.d/hostpanel-weblogs.yaml
  local docker_src="${HP_INSTALL_DIR:-/opt/hostpanel}/deploy/crowdsec-acquis-docker.yaml"
  if [[ -f "$docker_src" ]]; then
    install -m 0644 "$docker_src" /etc/crowdsec/acquis.d/hostpanel-docker-logs.yaml
    cscli parsers install crowdsecurity/docker-logs 2>/dev/null || true
  fi
  getent passwd crowdsec &>/dev/null && usermod -a -G adm,www-data crowdsec 2>/dev/null || true
}

main() {
  info "Central LAPI: $LAPI_URL (no local LAPI)"
  disable_local_lapi_server
  write_credentials
  install_acquis
  if [[ -x "${HP_INSTALL_DIR:-/opt/hostpanel}/deploy/ensure-crowdsec-hub.sh" ]]; then
    HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}" bash "${HP_INSTALL_DIR}/deploy/ensure-crowdsec-hub.sh" || true
  fi

  if ! lapi_reachable; then
    cat >&2 <<EOF

Cannot authenticate machine '${LOGIN}' to ${LAPI_URL}/v1.

CrowdSec Manager UI on 192.168.1.187 is usually :8080; LAPI for agents is often :8888 (not :8080).

Try: CROWDSEC_LAPI_URL=http://192.168.1.187:8888 sudo bash $(dirname "$0")/configure-crowdsec-central-187.sh

On the LAPI server: sudo cscli machines validate ${LOGIN}

EOF
    exit 1
  fi

  register_firewall_bouncer_via_manager
  register_hostpanel_bouncer_via_manager

  systemctl enable crowdsec crowdsec-firewall-bouncer
  systemctl restart crowdsec
  sleep 2
  systemctl is-active --quiet crowdsec || die "crowdsec failed — journalctl -u crowdsec -n 40"
  systemctl restart crowdsec-firewall-bouncer
  sleep 2
  systemctl is-active --quiet crowdsec-firewall-bouncer || die "firewall bouncer failed — journalctl -u crowdsec-firewall-bouncer -n 40"

  systemctl restart hostpanel-api 2>/dev/null || true
  info "Done — log processor and bouncer use central LAPI at ${LAPI_URL}"
}

main "$@"
