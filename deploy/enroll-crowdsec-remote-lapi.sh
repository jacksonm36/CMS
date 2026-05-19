#!/usr/bin/env bash
# Enroll this host as a CrowdSec log processor + enable firewall bouncer against a remote LAPI.
#
# Usage (as root):
# Central stack: :8080 = Manager UI, :8888 = LAPI (agents + bouncers).
#   sudo CROWDSEC_LAPI_URL=http://192.168.1.187:8888 bash deploy/enroll-crowdsec-remote-lapi.sh
# Optional auto-registration token (from remote config.yaml api.server.auto_registration):
#   sudo CROWDSEC_LAPI_URL=http://192.168.1.187:8888 CROWDSEC_LAPI_TOKEN='...' bash deploy/enroll-crowdsec-remote-lapi.sh
#
# On the LAPI server, validate the machine if not using auto_registration:
#   sudo cscli machines validate "$(hostname -s)"
set -euo pipefail

LAPI_URL="${CROWDSEC_LAPI_URL:-http://192.168.1.187:8888}"
LAPI_URL="${LAPI_URL%/}"
MACHINE_NAME="${CROWDSEC_MACHINE_NAME:-$(hostname -s)}"
LAPI_TOKEN="${CROWDSEC_LAPI_TOKEN:-}"
HOSTPANEL_ENV="${HOSTPANEL_ENV:-/opt/hostpanel/.env}"
FW_YAML="/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
FW_NAME="crowdsec-firewall-bouncer"
HP_BOUNCER="hostpanel-api"
CONFIG="/etc/crowdsec/config.yaml"
CREDS="/etc/crowdsec/local_api_credentials.yaml"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo)."

command -v cscli &>/dev/null || die "cscli not found — install crowdsec first."

validate_lapi() {
  local url="$1"
  local body code ctype
  body="$(mktemp)"
  code="$(curl -sS -m 8 -o "$body" -w '%{http_code}' "${url}/v1/decisions" -H 'X-Api-Key: invalid-probe-key' 2>/dev/null || echo 000)"
  ctype="$(grep -i '^content-type:' "$body" 2>/dev/null | head -1 || true)"
  if [[ "$code" == "000" ]]; then
    rm -f "$body"
    return 1
  fi
  if head -c 64 "$body" | grep -qi '<!doctype html\|<html'; then
    rm -f "$body"
    echo "html"
    return 1
  fi
  rm -f "$body"
  # 401/403/200 with JSON body = real LAPI; 404 plain text may still be LAPI on some builds
  [[ "$code" == "401" || "$code" == "403" || "$code" == "200" ]]
}

install_packages() {
  if ! dpkg -s crowdsec &>/dev/null; then
    die "crowdsec package not installed"
  fi
  if [[ ! -f "$FW_YAML" ]]; then
    info "Installing crowdsec-firewall-bouncer-iptables..."
    apt-get update -qq
    apt-get install -y crowdsec-firewall-bouncer-iptables
  fi
}

disable_local_lapi_server() {
  if [[ ! -f "$CONFIG" ]]; then
    return 0
  fi
  if grep -q 'listen_uri: 127.0.0.1:8080' "$CONFIG" 2>/dev/null; then
    info "Configuring this host as log-processor only (LAPI client → remote)."
    sed -i '/^api:/,/^[^ ]/{
      /^  server:/,/^  [^ ]/d
    }' "$CONFIG" 2>/dev/null || true
    # Simpler: comment listen if yaml edit fails — use Python for reliability
    python3 - "$CONFIG" <<'PY' || true
import sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text()
marker = "  server:"
if marker not in text:
    sys.exit(0)
lines = text.splitlines()
out, skip = [], 0
for line in lines:
    if line.startswith("  server:"):
        skip = 1
        continue
    if skip:
        if line.startswith("  ") and not line.startswith("    ") and line.strip():
            skip = 0
        elif line.startswith("prometheus:") or line.startswith("db_config:"):
            skip = 0
        else:
            continue
    out.append(line)
p.write_text("\n".join(out) + "\n")
PY
  fi
}

register_machine() {
  local args=(lapi register --url "$LAPI_URL" --machine "$MACHINE_NAME")
  if [[ -n "$LAPI_TOKEN" ]]; then
    args+=(--token "$LAPI_TOKEN")
  fi
  info "Registering machine '$MACHINE_NAME' with $LAPI_URL ..."
  if ! cscli "${args[@]}"; then
    die "cscli lapi register failed"
  fi
}

verify_lapi_status() {
  if ! cscli lapi status &>/dev/null; then
    die "Registered but cscli lapi status failed — is LAPI reachable and machine validated on the server?"
  fi
  info "LAPI authentication OK"
}

configure_firewall_bouncer() {
  [[ -f "$FW_YAML" ]] || die "Missing $FW_YAML"

  local key
  if cscli bouncers list -o json 2>/dev/null | grep -q "\"$FW_NAME\""; then
    info "Firewall bouncer '$FW_NAME' already registered on LAPI"
    if grep -qF '${API_KEY}' "$FW_YAML" 2>/dev/null; then
      key="$(cscli bouncers add "$FW_NAME" -o raw 2>/dev/null || true)"
    fi
  else
    key="$(cscli bouncers add "$FW_NAME" -o raw)"
  fi
  if [[ -z "${key:-}" ]] && grep -qF '${API_KEY}' "$FW_YAML" 2>/dev/null; then
    die "Could not obtain API key for $FW_NAME"
  fi

  if [[ -n "${key:-}" ]]; then
    sed -i "s|^api_key:.*|api_key: ${key}|" "$FW_YAML"
  fi
  if grep -q '^api_url:' "$FW_YAML"; then
    sed -i "s|^api_url:.*|api_url: ${LAPI_URL}/|" "$FW_YAML"
  else
    echo "api_url: ${LAPI_URL}/" >> "$FW_YAML"
  fi

  systemctl enable crowdsec-firewall-bouncer
  systemctl restart crowdsec-firewall-bouncer
  systemctl is-active --quiet crowdsec-firewall-bouncer || die "crowdsec-firewall-bouncer not active — check journalctl"
  info "Firewall bouncer active (iptables/ipset → $LAPI_URL)"
}

configure_hostpanel_bouncer() {
  [[ -f "$HOSTPANEL_ENV" ]] || { info "No $HOSTPANEL_ENV — skip HostPanel API key"; return 0; }

  local key
  if cscli bouncers list -o json 2>/dev/null | grep -q "\"$HP_BOUNCER\""; then
    key="$(grep -E '^CROWDSEC_API_KEY=' "$HOSTPANEL_ENV" | cut -d= -f2- | tr -d '"' || true)"
    if [[ -z "$key" || "$key" == "" ]]; then
      info "hostpanel-api exists on LAPI but .env has no key — add manually: cscli bouncers list"
      return 0
    fi
  else
    key="$(cscli bouncers add "$HP_BOUNCER" -o raw)"
  fi

  if grep -q '^CROWDSEC_API_URL=' "$HOSTPANEL_ENV"; then
    sed -i "s|^CROWDSEC_API_URL=.*|CROWDSEC_API_URL=\"${LAPI_URL}\"|" "$HOSTPANEL_ENV"
  else
    echo "CROWDSEC_API_URL=\"${LAPI_URL}\"" >> "$HOSTPANEL_ENV"
  fi
  if [[ -n "$key" ]]; then
    if grep -q '^CROWDSEC_API_KEY=' "$HOSTPANEL_ENV"; then
      sed -i "s|^CROWDSEC_API_KEY=.*|CROWDSEC_API_KEY=\"${key}\"|" "$HOSTPANEL_ENV"
    else
      echo "CROWDSEC_API_KEY=\"${key}\"" >> "$HOSTPANEL_ENV"
    fi
  fi
  info "Updated $HOSTPANEL_ENV (CROWDSEC_API_URL + key)"
  systemctl restart hostpanel-api 2>/dev/null || true
}

install_acquis() {
  local src="${HP_INSTALL_DIR:-/opt/hostpanel}/deploy/crowdsec-acquis-hostpanel.yaml"
  if [[ -f "$src" ]]; then
    install -m 0644 "$src" /etc/crowdsec/acquis.d/hostpanel-weblogs.yaml
    getent passwd crowdsec &>/dev/null && usermod -a -G adm,www-data crowdsec 2>/dev/null || true
  fi
}

main() {
  info "Remote LAPI target: $LAPI_URL"
  if ! validate_lapi "$LAPI_URL"; then
    cat >&2 <<EOF

$LAPI_URL does not look like a CrowdSec LAPI (got HTML or no response).

Central stack on 192.168.1.187:
  :8080 = CrowdSec Manager UI (HTML; not for agents/bouncers)
  :8888 = LAPI (agents + bouncers)

Re-run with: CROWDSEC_LAPI_URL=http://192.168.1.187:8888

EOF
    exit 1
  fi

  install_packages
  install_acquis
  if [[ -x "${HP_INSTALL_DIR:-/opt/hostpanel}/deploy/ensure-crowdsec-hub.sh" ]]; then
    HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}" bash "${HP_INSTALL_DIR}/deploy/ensure-crowdsec-hub.sh" || true
  fi
  cp -a "$CREDS" "${CREDS}.bak.$(date +%s)" 2>/dev/null || true
  disable_local_lapi_server
  register_machine
  systemctl restart crowdsec
  sleep 2
  systemctl is-active --quiet crowdsec || die "crowdsec failed after enroll — journalctl -u crowdsec -n 40"
  verify_lapi_status
  configure_firewall_bouncer
  configure_hostpanel_bouncer
  info "Done. If machines are not auto-validated, on the LAPI server run:"
  info "  sudo cscli machines validate $MACHINE_NAME"
}

main "$@"
