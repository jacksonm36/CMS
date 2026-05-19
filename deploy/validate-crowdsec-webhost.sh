#!/usr/bin/env bash
# Validate CrowdSec on webhost: central LAPI agent, firewall bouncer, host logs, Docker containers.
set -euo pipefail

LAPI_URL="${CROWDSEC_LAPI_URL:-http://192.168.1.187:8888}"
LAPI_URL="${LAPI_URL%/}"
FW_YAML="/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
HP_ENV="${HOSTPANEL_ENV:-/opt/hostpanel/.env}"
FAIL=0
WARN=0

ok() { echo "  OK   $*"; }
warn() { echo "  WARN $*"; WARN=$((WARN + 1)); }
fail() { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }

section() { echo ""; echo "=== $* ==="; }

section "Services"
for u in crowdsec crowdsec-firewall-bouncer; do
  if systemctl is-active --quiet "$u" 2>/dev/null; then
    ok "$u is active"
  else
    fail "$u is not active"
  fi
done

section "Central LAPI (machine agent)"
if cscli lapi status &>/dev/null; then
  ok "cscli lapi status → ${LAPI_URL}"
else
  fail "cscli lapi status failed (check /etc/crowdsec/local_api_credentials.yaml)"
fi

section "Firewall bouncer"
if [[ -f "$FW_YAML" ]]; then
  api_url="$(grep -E '^api_url:' "$FW_YAML" | awk '{print $2}')"
  if [[ "${api_url%/}" == "${LAPI_URL}/" || "${api_url%/}" == "${LAPI_URL}" ]]; then
    ok "bouncer api_url → ${api_url}"
  else
    warn "bouncer api_url is ${api_url:-unset} (expected ${LAPI_URL}/)"
  fi
  key="$(grep -E '^api_key:' "$FW_YAML" | awk '{print $2}')"
  if [[ -n "$key" && "$key" != '\${API_KEY}' ]]; then
    n="$(curl -sS -m 8 -H "X-Api-Key: $key" "${LAPI_URL}/v1/decisions" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo 0)"
    if [[ "${n:-0}" -gt 0 ]]; then
      ok "bouncer key valid (${n} decisions from LAPI)"
    else
      fail "bouncer key cannot fetch decisions from LAPI"
    fi
  else
    fail "bouncer api_key missing or placeholder in $FW_YAML"
  fi
else
  fail "missing $FW_YAML"
fi

if iptables -L INPUT -n 2>/dev/null | grep -q CROWDSEC_CHAIN; then
  ok "iptables INPUT → CROWDSEC_CHAIN"
else
  warn "no CROWDSEC_CHAIN on INPUT (nftables-only setup?)"
fi

if iptables -L DOCKER-USER -n 2>/dev/null | grep -q CROWDSEC; then
  ok "iptables DOCKER-USER includes CrowdSec rules"
elif grep -qE '^\s*-\s*DOCKER-USER' "$FW_YAML" 2>/dev/null && ! grep -qE '^\s*#\s*-\s*DOCKER-USER' "$FW_YAML" 2>/dev/null; then
  ok "DOCKER-USER configured in bouncer yaml"
  else
    fail "DOCKER-USER not in iptables_chains — run: sudo bash deploy/ensure-crowdsec-firewall-bouncer.sh"
  fi

section "Hub (parsers & scenarios)"
if cscli scenarios list 2>/dev/null | grep -q 'enabled'; then
  n_scen="$(cscli scenarios list 2>/dev/null | grep -c 'enabled' || true)"
  ok "scenarios enabled (${n_scen})"
else
  warn "no enabled scenarios — run: sudo bash ${HP_INSTALL_DIR:-/opt/hostpanel}/deploy/ensure-crowdsec-hub.sh"
fi
if cscli parsers list 2>/dev/null | grep -q 'nginx-logs'; then
  ok "nginx log parser installed"
else
  warn "nginx parser missing — run ensure-crowdsec-hub.sh"
fi
if [[ -f /etc/crowdsec/parsers/s01-parse/hostpanel-pino-logs.yaml ]]; then
  if crowdsec -t -c /etc/crowdsec/config.yaml >/dev/null 2>&1; then
    ok "hostpanel/pino-logs parser compiles"
  else
    fail "hostpanel/pino-logs parser fails crowdsec -t (fix YAML before restart)"
  fi
  if cscli parsers list 2>/dev/null | grep -q 'hostpanel/pino-logs'; then
    ok "hostpanel/pino-logs enabled"
  else
    warn "hostpanel/pino-logs not enabled — run ensure-crowdsec-hub.sh"
  fi
else
  warn "missing hostpanel-pino-logs.yaml — run ensure-crowdsec-hub.sh"
fi

section "Host log acquisition"
if [[ -f /etc/crowdsec/acquis.d/hostpanel-weblogs.yaml ]]; then
  ok "hostpanel-weblogs.yaml installed"
else
  warn "missing /etc/crowdsec/acquis.d/hostpanel-weblogs.yaml"
fi
metrics="$(cscli metrics 2>/dev/null || true)"
if echo "$metrics" | grep -q '/var/log/nginx/'; then
  ok "nginx access logs appear in cscli metrics"
else
  warn "no nginx paths in acquisition metrics yet"
fi

section "Docker containers"
if ! command -v docker &>/dev/null; then
  warn "docker CLI not installed"
else
  count="$(docker ps -q 2>/dev/null | grep -c . || true)"
  ok "${count} running container(s)"
  docker ps --format '  - {{.Names}} ({{.Image}}) ports={{.Ports}}' 2>/dev/null || true
  if [[ -f /etc/crowdsec/acquis.d/hostpanel-docker-logs.yaml ]]; then
    ok "hostpanel-docker-logs.yaml installed"
  else
    warn "missing /etc/crowdsec/acquis.d/hostpanel-docker-logs.yaml"
  fi
  if cscli parsers list -o raw 2>/dev/null | grep -q 'crowdsecurity/docker-logs'; then
    ok "docker-logs parser enabled"
  else
    warn "install: cscli parsers install crowdsecurity/docker-logs"
  fi
  if echo "$metrics" | grep -q '/var/lib/docker/containers/'; then
    ok "docker json logs in acquisition metrics"
  elif [[ "${count:-0}" -gt 0 ]]; then
    warn "containers running but no docker log lines in metrics (empty logs or acquis not loaded)"
  fi
fi

section "HostPanel API (LAPI bouncer)"
if [[ -f "$HP_ENV" ]]; then
  hp_key="$(grep '^CROWDSEC_API_KEY=' "$HP_ENV" | cut -d= -f2- | tr -d '"')"
  hp_url="$(grep '^CROWDSEC_API_URL=' "$HP_ENV" | cut -d= -f2- | tr -d '"')"
  hp_url="${hp_url%/}"
  if [[ -n "$hp_key" ]]; then
    if curl -sS -m 8 -H "X-Api-Key: $hp_key" "${hp_url:-$LAPI_URL}/v1/decisions?limit=1" | python3 -c "import sys,json; json.load(sys.stdin)" &>/dev/null; then
      ok "HostPanel CROWDSEC_API_KEY works on LAPI"
    else
      fail "HostPanel CROWDSEC_API_KEY rejected by LAPI"
    fi
  else
    warn "CROWDSEC_API_KEY not set in $HP_ENV"
  fi
else
  warn "$HP_ENV not found"
fi

section "Summary"
echo "Failures: $FAIL  Warnings: $WARN"
[[ "$FAIL" -eq 0 ]]
