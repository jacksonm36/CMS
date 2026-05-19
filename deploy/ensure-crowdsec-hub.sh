#!/usr/bin/env bash
# Install CrowdSec hub collections (parsers + scenarios) from log sources on this host.
# Central stack: collections run on the agent; scenarios/parsers are local to the log processor.
set -euo pipefail

HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}"
ACQUIS_DIR="/etc/crowdsec/acquis.d"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo)."
command -v cscli &>/dev/null || die "cscli not found — install crowdsec first."

acquis_has_type() {
  local t="$1"
  grep -rhE "type:[[:space:]]*${t}([[:space:]]|$)" "$ACQUIS_DIR" /etc/crowdsec/acquis.yaml 2>/dev/null | grep -q .
}

# Always useful on HostPanel webhosts
COLLECTIONS=(
  crowdsecurity/linux
  crowdsecurity/nginx
  crowdsecurity/http-cve
)

# sshd is a dependency of linux; install explicitly if acquired without linux syslog
if acquis_has_type sshd && ! printf '%s\n' "${COLLECTIONS[@]}" | grep -qx crowdsecurity/linux; then
  COLLECTIONS+=(crowdsecurity/sshd)
fi

if acquis_has_type pgsql || [[ -d /var/log/postgresql ]]; then
  COLLECTIONS+=(crowdsecurity/pgsql)
fi

PARSERS=()
if acquis_has_type docker || [[ -f "$ACQUIS_DIR/hostpanel-docker-logs.yaml" ]]; then
  PARSERS+=(crowdsecurity/docker-logs)
fi

install_hostpanel_nodejs() {
  local src="${HP_INSTALL_DIR}/deploy/crowdsec"
  local acquis_src="${HP_INSTALL_DIR}/deploy/crowdsec-acquis-nodejs.yaml"
  [[ -f "$acquis_src" ]] || return 0
  install -m 0644 "$acquis_src" "$ACQUIS_DIR/hostpanel-nodejs.yaml"
  [[ -f "$src/parsers/hostpanel-pino-logs.yaml" ]] || return 0
  install -m 0644 "$src/parsers/hostpanel-pino-logs.yaml" /etc/crowdsec/parsers/s01-parse/hostpanel-pino-logs.yaml
  install -m 0644 "$src/scenarios/hostpanel-http-auth-bf.yaml" /etc/crowdsec/scenarios/hostpanel-http-auth-bf.yaml
  cscli parsers install /etc/crowdsec/parsers/s01-parse/hostpanel-pino-logs.yaml 2>/dev/null \
    || cscli parsers install hostpanel/pino-logs 2>/dev/null || true
  cscli scenarios install /etc/crowdsec/scenarios/hostpanel-http-auth-bf.yaml 2>/dev/null \
    || cscli scenarios install hostpanel/http-auth-bf 2>/dev/null || true
  if [[ -f "$src/collections/hostpanel-nodejs.yaml" ]]; then
    cscli collections install "$src/collections/hostpanel-nodejs.yaml" 2>/dev/null \
      || cscli collections install hostpanel/nodejs 2>/dev/null || true
  fi
  if ! crowdsec -t -c /etc/crowdsec/config.yaml >/dev/null 2>&1; then
    warn "crowdsec config test failed after hostpanel/pino-logs install — check /etc/crowdsec/parsers/s01-parse/hostpanel-pino-logs.yaml"
    return 1
  fi
  info "HostPanel Node.js journal acquis + Pino parser + http scenarios"
}

info "Updating CrowdSec hub index"
cscli hub update

installed_collections=0
for c in "${COLLECTIONS[@]}"; do
  if cscli collections install "$c" 2>/dev/null; then
    info "Collection: $c"
    installed_collections=$((installed_collections + 1))
  elif cscli collections list -o raw 2>/dev/null | grep -qF "$c"; then
    info "Collection already present: $c"
  else
    echo "WARN: could not install collection $c" >&2
  fi
done

for p in "${PARSERS[@]}"; do
  if cscli parsers install "$p" 2>/dev/null; then
    info "Parser: $p"
  elif cscli parsers list -o raw 2>/dev/null | grep -qF "$p"; then
    info "Parser already present: $p"
  else
    echo "WARN: could not install parser $p" >&2
  fi
done

install_hostpanel_nodejs

info "Upgrading hub items to latest patch versions"
cscli hub upgrade 2>/dev/null || true

if systemctl is-active --quiet crowdsec 2>/dev/null; then
  systemctl reload crowdsec 2>/dev/null || systemctl restart crowdsec
  info "Reloaded crowdsec"
fi

n_coll=$(cscli collections list -o raw 2>/dev/null | grep -c enabled || echo 0)
n_parse=$(cscli parsers list -o raw 2>/dev/null | grep -c enabled || echo 0)
n_scen=$(cscli scenarios list -o raw 2>/dev/null | grep -c enabled || echo 0)
info "Hub ready — collections: ${n_coll}, parsers: ${n_parse}, scenarios: ${n_scen}"
