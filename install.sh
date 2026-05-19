#!/usr/bin/env bash
# =============================================================================
#  HostPanel — Bare Metal Installer
#  Supports: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12 / 13+
#
#  Usage:
#    curl -fsSL https://your-server/install.sh | bash
#  Or:
#    wget -qO- https://your-server/install.sh | bash
#
#  Options (env vars before the script):
#    HP_ADMIN_EMAIL=admin@example.com
#    HP_ADMIN_PASSWORD=changeme
#    HP_DOMAIN=panel.example.com      (optional; prompts on TTY if empty)
#    HP_SKIP_PANEL_HOST_PROMPT=true    (non-interactive: use auto LAN IP)
#    HP_PORT=3000                     (web UI port, default 3000)
#    HP_API_PORT=4000                 (API port, default 4000)
#    HP_WEBSERVER=nginx               (nginx|apache2|lighttpd|litespeed)
#    HP_CROWDSEC=true                 (install CrowdSec, default true)
#    HP_DB_PASSWORD=...               (PostgreSQL password, auto-generated if empty)
#    HP_INSTALL_DIR=/opt/hostpanel    (installation directory)
#    HP_SERVICE_USER=hostpanel        (Linux account that owns app files; default hostpanel)
#    HP_SERVICE_HOME=/var/lib/hostpanel  (home directory for that account)
#    HP_NODE_VERSION=20               (Node.js major version)
#    HP_SKIP_WEBSERVER=false          (skip web server install entirely)
#    HP_SKIP_DOCKER=false             (skip Docker install entirely)
#    HP_FAIL2BAN=true                 (install fail2ban for SSH, default true)
#    HP_STAGING_ACME=false            (Let's Encrypt production; set true for staging certs only)
#    HP_NPM_AUDIT_FAIL=false          (set true to abort if npm audit reports critical)
#    HP_DOCKER_ROOTLESS=true          (run deploy/hostpanel-docker-rootless.sh after user exists)
#    HP_DOCKER_ROOTFUL_ONLY=false     (pass through to script: LXC — skip rootless, install rootful only)
#    HP_DOCKER_TRY_ROOTLESS=true      (pass through: set false with ROOTFUL_ONLY to skip rootless)
#    HP_DOCKER_FALLBACK_ROOTFUL=true  (default: if rootless fails, install rootful docker-ce)
#    HP_RESTART_HOSTPANEL_API=true    (restart hostpanel-api after Docker .env changes; set false to skip)
#
#  Verification (optional — air-gapped / supply-chain hygiene):
#    HP_EXPECTED_GIT_COMMIT=full40hex   After clone/pull, abort if `git rev-parse HEAD` does not match.
#    (Requires a git checkout — use a normal clone; not the local rsync copy-from-tree path without .git.)
#    To verify this script before `curl | bash`, download first and check SHA-256 against a published
#    checksum (e.g. GitHub release notes):  curl -fsSL URL -o install.sh && sha256sum install.sh
# =============================================================================

set -euo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}▸ $*${NC}"; }

# ─── Defaults ─────────────────────────────────────────────────────────────────
HP_ADMIN_EMAIL="${HP_ADMIN_EMAIL:-admin@localhost}"
HP_ADMIN_PASSWORD="${HP_ADMIN_PASSWORD:-$(openssl rand -base64 16 | tr -d '=+/')}"
HP_PORT="${HP_PORT:-3000}"
HP_API_PORT="${HP_API_PORT:-4000}"
HP_WEBSERVER="${HP_WEBSERVER:-nginx}"
HP_CROWDSEC="${HP_CROWDSEC:-true}"
HP_DB_PASSWORD="${HP_DB_PASSWORD:-$(openssl rand -base64 24 | tr -d '=+/')}"
HP_REDIS_PASSWORD="${HP_REDIS_PASSWORD:-}"
HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}"
HP_NODE_VERSION="${HP_NODE_VERSION:-20}"
HP_SKIP_WEBSERVER="${HP_SKIP_WEBSERVER:-false}"
HP_STAGING_ACME="${HP_STAGING_ACME:-false}"
HP_FAIL2BAN="${HP_FAIL2BAN:-true}"
HP_NPM_AUDIT_FAIL="${HP_NPM_AUDIT_FAIL:-false}"
HP_SKIP_DOCKER="${HP_SKIP_DOCKER:-false}"
HP_DOCKER_ROOTLESS="${HP_DOCKER_ROOTLESS:-true}"
HP_DOCKER_ROOTFUL_ONLY="${HP_DOCKER_ROOTFUL_ONLY:-false}"
HP_DOCKER_TRY_ROOTLESS="${HP_DOCKER_TRY_ROOTLESS:-true}"
HP_DOCKER_FALLBACK_ROOTFUL="${HP_DOCKER_FALLBACK_ROOTFUL:-true}"
HP_RESTART_HOSTPANEL_API="${HP_RESTART_HOSTPANEL_API:-true}"
HP_EXPECTED_GIT_COMMIT="${HP_EXPECTED_GIT_COMMIT:-}"
HP_JWT_SECRET="$(openssl rand -base64 48 | tr -d '=+/')"
HP_SESSION_SECRET="$(openssl rand -base64 48 | tr -d '=+/')"
HP_NEXTAUTH_SECRET="$(openssl rand -base64 48 | tr -d '=+/')"
HP_JWT_REFRESH_SECRET="$(openssl rand -base64 48 | tr -d '=+/')"
HP_DOMAIN="${HP_DOMAIN:-}"
HP_SKIP_PANEL_HOST_PROMPT="${HP_SKIP_PANEL_HOST_PROMPT:-false}"
HP_SERVICE_USER="${HP_SERVICE_USER:-hostpanel}"
HP_SERVICE_HOME="${HP_SERVICE_HOME:-/var/lib/hostpanel}"
# Comma-separated IPs/CIDRs of reverse proxies that send X-Forwarded-For (nginx real_ip + API trustProxy)
HP_TRUSTED_PROXY_IPS="${HP_TRUSTED_PROXY_IPS:-}"

REPO_URL="${HP_REPO_URL:-https://github.com/jacksonm36/CMS}"
REPO_BRANCH="${HP_REPO_BRANCH:-main}"

# ─── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
cat <<'BANNER'
  _   _           _   ____                  _
 | | | | ___  ___| |_|  _ \ __ _ _ __   ___| |
 | |_| |/ _ \/ __| __| |_) / _` | '_ \ / _ \ |
 |  _  | (_) \__ \ |_|  __/ (_| | | | |  __/ |
 |_| |_|\___/|___/\__|_|   \__,_|_| |_|\___|_|

BANNER
echo -e "${NC}  Bare Metal Installer — v1.2.0\n"

# ─── Root check ───────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "This script must be run as root. Use: sudo bash install.sh"

# ─── OS detection ─────────────────────────────────────────────────────────────
step "Detecting operating system"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="$ID"
  OS_VERSION="$VERSION_ID"
  OS_CODENAME="${VERSION_CODENAME:-}"
else
  error "Cannot detect OS. /etc/os-release not found."
fi

case "$OS_ID" in
  ubuntu)
    PKG_MGR="apt-get"
    IS_UBUNTU=true
    IS_DEBIAN=false
    ;;
  debian)
    PKG_MGR="apt-get"
    IS_UBUNTU=false
    IS_DEBIAN=true
    ;;
  raspbian)
    PKG_MGR="apt-get"
    IS_UBUNTU=false
    IS_DEBIAN=true
    OS_ID="debian"
    ;;
  *)
    error "Unsupported OS: $OS_ID. HostPanel supports Ubuntu and Debian-based systems."
    ;;
esac

# Resolve codename — some minimal installs omit VERSION_CODENAME
if [[ -z "$OS_CODENAME" ]]; then
  OS_CODENAME="$(lsb_release -cs 2>/dev/null || echo "")"
fi
# Fallback map for known Debian versions without a codename
if [[ -z "$OS_CODENAME" && "$IS_DEBIAN" == "true" ]]; then
  case "$OS_VERSION" in
    11) OS_CODENAME="bullseye" ;;
    12) OS_CODENAME="bookworm" ;;
    13) OS_CODENAME="trixie" ;;
    14) OS_CODENAME="forky" ;;
    *)  OS_CODENAME="$(lsb_release -cs 2>/dev/null || echo "trixie")" ;;
  esac
fi

success "Detected: $PRETTY_NAME"

# ─── Helpers ──────────────────────────────────────────────────────────────────
pkg_install() {
  # Install only packages that exist — skip missing ones with a warning
  local to_install=()
  for pkg in "$@"; do
    if apt-cache show "$pkg" &>/dev/null 2>&1; then
      to_install+=("$pkg")
    else
      warn "Package '$pkg' not found in apt cache — skipping"
    fi
  done
  if [[ ${#to_install[@]} -gt 0 ]]; then
    DEBIAN_FRONTEND=noninteractive $PKG_MGR install -y --no-install-recommends "${to_install[@]}"
  fi
}

pkg_install_required() {
  # Install packages that MUST succeed — error if any fail
  DEBIAN_FRONTEND=noninteractive $PKG_MGR install -y --no-install-recommends "$@"
}

service_enable_start() {
  systemctl enable --now "$1" 2>/dev/null || true
}

wait_for_port() {
  local host="$1" port="$2" tries=30
  info "Waiting for $host:$port..."
  until nc -z "$host" "$port" 2>/dev/null || [[ $tries -eq 0 ]]; do
    sleep 1; ((tries--))
  done
  [[ $tries -gt 0 ]] || warn "Port $port did not become available in time"
}

# ─── Validate service account name ────────────────────────────────────────────
if [[ ! "$HP_SERVICE_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  error "HP_SERVICE_USER must be a valid lowercase Linux username (got: $HP_SERVICE_USER)"
fi

# Run commands as the HostPanel service user (npm, prisma, build — not root)
panel_exec() {
  sudo -H -u "$HP_SERVICE_USER" env HOME="$HP_SERVICE_HOME" "PATH=$PATH" \
    bash -lc "set -euo pipefail; cd \"$HP_INSTALL_DIR\" && $1"
}

# ─── 1. System update + core deps ─────────────────────────────────────────────
step "Updating package lists and installing core dependencies"

$PKG_MGR update -qq

# Universal core — available on all supported distros
pkg_install_required curl wget gnupg2 lsb-release ca-certificates \
  build-essential git unzip openssl sudo

# Netcat — package name differs by distro
pkg_install netcat-openbsd || pkg_install netcat-traditional || true

# apt-transport-https is a no-op stub on Debian 12+ / Ubuntu 22+ (built into apt)
# but install it if available for older systems
pkg_install apt-transport-https || true

# software-properties-common is Ubuntu-only (provides add-apt-repository)
if [[ "$IS_UBUNTU" == "true" ]]; then
  pkg_install software-properties-common || true
fi

success "Core dependencies installed"

# ─── 2. Node.js ───────────────────────────────────────────────────────────────
step "Installing Node.js $HP_NODE_VERSION LTS"

if command -v node &>/dev/null && node --version | grep -q "^v${HP_NODE_VERSION}"; then
  success "Node.js $(node --version) already installed"
else
  # NodeSource setup script handles Ubuntu + Debian, including trixie
  curl -fsSL "https://deb.nodesource.com/setup_${HP_NODE_VERSION}.x" | bash -
  pkg_install_required nodejs
  npm install -g npm@latest 2>/dev/null || true
  success "Node.js $(node --version) installed"
fi

# ─── 3. PostgreSQL ────────────────────────────────────────────────────────────
step "Installing PostgreSQL 16"

if ! command -v psql &>/dev/null; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
    https://apt.postgresql.org/pub/repos/apt ${OS_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  $PKG_MGR update -qq
  # Try PG16, fall back to PG15 if not yet in the pgdg repo for this codename
  pkg_install postgresql-16 postgresql-client-16 \
    || pkg_install_required postgresql postgresql-client
fi

service_enable_start postgresql

# Create DB user + database
PG_USER="hostpanel"
PG_DB="hostpanel"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER $PG_USER WITH PASSWORD '$HP_DB_PASSWORD';"
  info "PostgreSQL user '$PG_USER' created"
fi

if ! sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -qw "$PG_DB"; then
  sudo -u postgres psql -c "CREATE DATABASE $PG_DB OWNER $PG_USER;"
  info "PostgreSQL database '$PG_DB' created"
fi

success "PostgreSQL ready"

# ─── 4. Redis ─────────────────────────────────────────────────────────────────
step "Installing Redis 7"

if ! command -v redis-server &>/dev/null; then
  # Redis official repo may not yet carry trixie; fall back to distro package if unavailable
  if curl -fsSL https://packages.redis.io/gpg 2>/dev/null \
      | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg 2>/dev/null; then
    echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] \
      https://packages.redis.io/deb ${OS_CODENAME} main" \
      > /etc/apt/sources.list.d/redis.list
    $PKG_MGR update -qq 2>/dev/null || true
  fi
  pkg_install redis-server || pkg_install_required redis
fi

# Configure Redis
REDIS_CONF="/etc/redis/redis.conf"
sed -i 's/^# bind 127.0.0.1/bind 127.0.0.1/' "$REDIS_CONF" 2>/dev/null || true
sed -i 's/^appendonly no/appendonly yes/' "$REDIS_CONF" 2>/dev/null || true

if [[ -n "$HP_REDIS_PASSWORD" ]]; then
  sed -i "s/^# requirepass .*/requirepass $HP_REDIS_PASSWORD/" "$REDIS_CONF" 2>/dev/null || true
fi

service_enable_start redis-server
success "Redis ready"

# ─── 5. Web server ────────────────────────────────────────────────────────────
if [[ "$HP_SKIP_WEBSERVER" != "true" ]]; then
  step "Installing web server: $HP_WEBSERVER"

  case "$HP_WEBSERVER" in
    nginx)
      if ! command -v nginx &>/dev/null; then
        pkg_install nginx
        rm -f /etc/nginx/sites-enabled/default
      fi
      service_enable_start nginx
      success "Nginx installed and running"
      ;;

    apache2)
      if ! command -v apache2 &>/dev/null; then
        pkg_install apache2 libapache2-mod-fcgid
        a2enmod proxy proxy_fcgi headers deflate rewrite ssl
        a2dissite 000-default
      fi
      service_enable_start apache2
      success "Apache2 installed and running"
      ;;

    lighttpd)
      if ! command -v lighttpd &>/dev/null; then
        pkg_install lighttpd lighttpd-mod-deflate
        lighttpd-enable-mod fastcgi accesslog compress 2>/dev/null || true
      fi
      service_enable_start lighttpd
      success "Lighttpd installed and running"
      ;;

    litespeed)
      if ! command -v /usr/local/lsws/bin/lswsctrl &>/dev/null; then
        info "Downloading OpenLiteSpeed..."
        wget -qO /tmp/ols-install.sh https://repo.litespeed.sh
        bash /tmp/ols-install.sh
        pkg_install openlitespeed
      fi
      service_enable_start lsws
      success "LiteSpeed Community installed and running"
      ;;

    *)
      warn "Unknown web server '$HP_WEBSERVER', skipping. You can install it later from the Web Servers panel."
      ;;
  esac
fi

# ─── 6. PHP (optional, for PHP sites) ─────────────────────────────────────────
step "Installing PHP 8.2 FPM (optional, for PHP site support)"

if ! command -v php &>/dev/null; then
  # ondrej/php PPA for Ubuntu (requires software-properties-common + add-apt-repository)
  # sury.org for Debian (all versions including trixie)
  if [[ "$IS_UBUNTU" == "true" ]] && command -v add-apt-repository &>/dev/null; then
    add-apt-repository -y ppa:ondrej/php
  else
    # sury.org supports all current Debian releases
    curl -sSL https://packages.sury.org/php/apt.gpg 2>/dev/null \
      | gpg --dearmor -o /usr/share/keyrings/sury-php.gpg
    echo "deb [signed-by=/usr/share/keyrings/sury-php.gpg] \
      https://packages.sury.org/php ${OS_CODENAME} main" \
      > /etc/apt/sources.list.d/sury-php.list
  fi
  $PKG_MGR update -qq 2>/dev/null || true

  # Try PHP 8.2; fall back to distro-default php-fpm if sury not available yet
  if apt-cache show php8.2-fpm &>/dev/null 2>&1; then
    pkg_install_required php8.2-fpm php8.2-cli php8.2-mbstring php8.2-xml \
      php8.2-curl php8.2-zip php8.2-pgsql php8.2-mysql php8.2-gd php8.2-intl \
      php8.2-bcmath php8.2-opcache
    service_enable_start php8.2-fpm
  else
    warn "PHP 8.2 not available for ${OS_CODENAME} yet — installing distro default PHP"
    pkg_install php-fpm php-cli php-mbstring php-xml php-curl php-zip \
      php-pgsql php-mysql php-gd php-intl php-bcmath php-opcache || true
    PHP_FPM_SVC="$(systemctl list-unit-files 'php*-fpm.service' --no-legend 2>/dev/null \
      | awk '{print $1}' | head -1)"
    [[ -n "$PHP_FPM_SVC" ]] && service_enable_start "$PHP_FPM_SVC" || true
  fi
  success "PHP $(php --version 2>/dev/null | head -1 | cut -d' ' -f2) FPM installed"
else
  success "PHP $(php --version | head -1 | cut -d' ' -f2) already installed"
fi

# ─── 7. CrowdSec ──────────────────────────────────────────────────────────────
if [[ "$HP_CROWDSEC" == "true" ]]; then
  step "Installing CrowdSec"

  if ! command -v cscli &>/dev/null; then
    # CrowdSec official repo setup — works on Debian/Ubuntu including trixie
    curl -s https://install.crowdsec.net | bash 2>/dev/null \
      || curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash
    $PKG_MGR update -qq 2>/dev/null || true
    pkg_install crowdsec || pkg_install_required crowdsec
    service_enable_start crowdsec

    success "CrowdSec installed"
  else
    success "CrowdSec already installed ($(cscli version 2>/dev/null | head -1))"
    service_enable_start crowdsec 2>/dev/null || true
  fi

  # Firewall bouncer (iptables+ipset): Debian package ships api_key: ${API_KEY} — must register with cscli and start the unit
  pkg_install crowdsec-firewall-bouncer-iptables || true
  CS_FW_YAML="/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
  if [[ -f "$CS_FW_YAML" ]]; then
    if grep -qF '${API_KEY}' "$CS_FW_YAML" 2>/dev/null; then
      if ! systemctl is-active --quiet crowdsec 2>/dev/null; then
        systemctl start crowdsec 2>/dev/null || true
        sleep 2
      fi
      CS_FW_KEY=$(cscli bouncers add crowdsec-firewall-bouncer -o raw 2>/dev/null || true)
      if [[ -n "$CS_FW_KEY" ]]; then
        sed -i "s|^api_key:.*|api_key: ${CS_FW_KEY}|" "$CS_FW_YAML"
        success "CrowdSec firewall bouncer API key written to crowdsec-firewall-bouncer.yaml"
      else
        warn "Could not create firewall bouncer API key — is CrowdSec LAPI up? (systemctl status crowdsec)"
      fi
    fi
    systemctl enable crowdsec-firewall-bouncer 2>/dev/null || true
    systemctl restart crowdsec-firewall-bouncer 2>/dev/null || systemctl start crowdsec-firewall-bouncer 2>/dev/null || true
    if systemctl is-active --quiet crowdsec-firewall-bouncer 2>/dev/null; then
      success "crowdsec-firewall-bouncer is active (iptables/ipset bans)"
    else
      warn "crowdsec-firewall-bouncer is not active — journalctl -u crowdsec-firewall-bouncer -n 50 --no-pager"
    fi
  else
    info "crowdsec-firewall-bouncer yaml missing — optional: apt install crowdsec-firewall-bouncer-iptables"
  fi

  if [[ -n "${HP_CROWDSEC_LAPI_URL:-}" ]]; then
    step "CrowdSec: enroll log processor + bouncer to remote LAPI"
    export CROWDSEC_LAPI_URL="${HP_CROWDSEC_LAPI_URL}"
    export CROWDSEC_LAPI_TOKEN="${HP_CROWDSEC_LAPI_TOKEN:-}"
    export HOSTPANEL_ENV="${HP_INSTALL_DIR}/.env"
    export HP_INSTALL_DIR
    if bash "${HP_INSTALL_DIR}/deploy/enroll-crowdsec-remote-lapi.sh"; then
      success "CrowdSec enrolled to ${HP_CROWDSEC_LAPI_URL}"
    else
      warn "Remote LAPI enroll failed — using local LAPI (127.0.0.1:8080). Fix ${HP_CROWDSEC_LAPI_URL} and run deploy/enroll-crowdsec-remote-lapi.sh"
    fi
  fi

  # Create API bouncer key for HostPanel
  CS_KEY_NAME="hostpanel-api"
  CS_EXISTING=$(cscli bouncers list -o json 2>/dev/null | grep -c "\"$CS_KEY_NAME\"" || true)
  if [[ "$CS_EXISTING" -eq 0 ]]; then
    CS_API_KEY=$(cscli bouncers add "$CS_KEY_NAME" -o raw 2>/dev/null || echo "")
    info "CrowdSec bouncer key created: ${CS_API_KEY:0:20}..."
  else
    info "CrowdSec bouncer '$CS_KEY_NAME' already exists"
    CS_API_KEY=""
  fi
fi

# ─── 7b. Service user (before clone — repo owned by app user, not root) ───────
step "Creating system user '$HP_SERVICE_USER'"
if ! id -u "$HP_SERVICE_USER" &>/dev/null; then
  mkdir -p "$HP_SERVICE_HOME"
  useradd --system --home-dir "$HP_SERVICE_HOME" --create-home --shell /usr/sbin/nologin "$HP_SERVICE_USER"
  success "Linux user '$HP_SERVICE_USER' created (home $HP_SERVICE_HOME)"
else
  mkdir -p "$HP_SERVICE_HOME"
  chown "${HP_SERVICE_USER}:${HP_SERVICE_USER}" "$HP_SERVICE_HOME"
  if [[ "$(getent passwd "$HP_SERVICE_USER" | cut -d: -f6)" != "$HP_SERVICE_HOME" ]]; then
    usermod -d "$HP_SERVICE_HOME" "$HP_SERVICE_USER" 2>/dev/null || true
  fi
  success "Linux user '$HP_SERVICE_USER' already exists — refreshed home $HP_SERVICE_HOME"
fi

# Standard nginx/apache packages on Debian/Ubuntu use root:adm and mode 640 under /var/log — supplementary group "adm" allows tail without sudo.
if getent group adm >/dev/null 2>&1; then
  if id -nG "$HP_SERVICE_USER" 2>/dev/null | tr " " "\n" | grep -qx adm; then
    info "User '$HP_SERVICE_USER' is already in group adm (daemon log tail)"
  elif usermod -a -G adm "$HP_SERVICE_USER" 2>/dev/null; then
    info "Added '$HP_SERVICE_USER' to group adm — read /var/log/nginx/*, apache2, etc. Restart API for running processes to pick it up: systemctl restart hostpanel-api"
  else
    warn "Could not add '$HP_SERVICE_USER' to group adm — Web server log tail may show Permission denied (fix: sudo usermod -a -G adm $HP_SERVICE_USER)"
  fi
fi

# ─── 8. Clone / update HostPanel ──────────────────────────────────────────────
step "Installing HostPanel to $HP_INSTALL_DIR"

mkdir -p "$HP_INSTALL_DIR"

if [[ -d "$HP_INSTALL_DIR/.git" ]]; then
  info "Repository already exists — pulling latest..."
  git -C "$HP_INSTALL_DIR" fetch origin
  git -C "$HP_INSTALL_DIR" checkout "$REPO_BRANCH"
  git -C "$HP_INSTALL_DIR" pull origin "$REPO_BRANCH"
else
  # If the script is run from the repo directory (local install), copy files
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$SCRIPT_DIR/package.json" ]] && grep -q '"hostpanel"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
    info "Running from repo directory — copying files..."
    rsync -a --exclude=node_modules --exclude=.next --exclude=dist --exclude=".git" \
      "$SCRIPT_DIR/" "$HP_INSTALL_DIR/"
  else
    info "Cloning from $REPO_URL..."
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$HP_INSTALL_DIR"
  fi
fi

# Repository owned by the service user
chown -R "${HP_SERVICE_USER}:${HP_SERVICE_USER}" "$HP_INSTALL_DIR"

if [[ -n "$HP_EXPECTED_GIT_COMMIT" ]]; then
  step "Verifying repository commit (HP_EXPECTED_GIT_COMMIT)"
  _hp_head="$(git -C "$HP_INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "")"
  if [[ "$_hp_head" != "$HP_EXPECTED_GIT_COMMIT" ]]; then
    error "Repository commit mismatch: expected HP_EXPECTED_GIT_COMMIT=$HP_EXPECTED_GIT_COMMIT but got ${_hp_head:-empty}"
  fi
  success "Repository commit matches HP_EXPECTED_GIT_COMMIT"
fi

# ─── 8b. Panel hostname / IP (browser URL for NextAuth, CORS, optional Nginx vhost) ──
normalize_panel_host() {
  local h="$1"
  h="$(printf '%s' "$h" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$h" ]] && { printf '%s' ""; return 0; }
  h="${h#http://}"
  h="${h#https://}"
  h="${h%%/*}"
  printf '%s' "$h"
}

validate_panel_host() {
  local h="$1"
  [[ -n "$h" ]] || return 1
  [[ "$h" != *[/[:space:]]* ]] || return 1
  [[ "$h" != *:* ]] || return 1
  if [[ "$h" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    local oIFS=$IFS IFS='.'
    # shellcheck disable=SC2206
    local parts=($h)
    IFS=$oIFS
    local oct
    for oct in "${parts[@]}"; do
      [[ "$oct" =~ ^[0-9]+$ && "$oct" -le 255 ]] || return 1
    done
    return 0
  fi
  [[ ${#h} -le 253 ]] || return 1
  [[ "$h" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] && return 0
  [[ ${#h} -eq 1 && "$h" =~ ^[A-Za-z0-9]$ ]] && return 0
  return 1
}

if [[ -z "$HP_DOMAIN" && "$HP_SKIP_PANEL_HOST_PROMPT" != "true" && -t 0 ]]; then
  step "Panel access hostname or IP"
  echo -e "${CYAN}How will you open HostPanel in the browser?${NC}"
  echo -e "  • Enter an ${BOLD}FQDN${NC} (e.g. panel.example.com) or ${BOLD}LAN IP${NC} (e.g. 192.168.1.50)."
  echo -e "  • Do ${BOLD}not${NC} include http/https or port."
  echo -e "  • Press Enter to auto-use this server's first LAN IP (quick LAN tests)."
  read -r -p "Panel hostname or IP [empty = auto]: " _hp_panel_raw || true
  _hp_panel_raw="$(normalize_panel_host "${_hp_panel_raw:-}")"
  if [[ -n "$_hp_panel_raw" ]]; then
    if validate_panel_host "$_hp_panel_raw"; then
      HP_DOMAIN="$_hp_panel_raw"
      success "Panel will use host: $HP_DOMAIN (Nginx vhost + NextAuth/CORS base)."
    else
      warn "Invalid host '$_hp_panel_raw' — using auto LAN IP instead."
    fi
  else
    info "Using auto-detected LAN IP for NextAuth/CORS (remote browsers need this, not localhost)."
  fi
fi

# ─── 9. Environment configuration ─────────────────────────────────────────────
step "Writing environment configuration"

REDIS_URL="redis://127.0.0.1:6379"
[[ -n "$HP_REDIS_PASSWORD" ]] && REDIS_URL="redis://:${HP_REDIS_PASSWORD}@127.0.0.1:6379"

CS_KEY_FOR_ENV="${CS_API_KEY:-}"

# NEXTAUTH_URL + CORS_ORIGIN should match the URL users open in the browser (the API also unions their origins for CORS).
# WebAuthn: rpID must be a domain and a suffix of the request host — for IPv4 we use nip.io
# so the panel URL and rpID stay aligned (open http://192-168-0-1.nip.io:3000 not the raw IP).
HP_SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
if [[ -n "$HP_DOMAIN" ]]; then
  if [[ "$HP_DOMAIN" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    HP_BROWSER_HOST="$(echo "$HP_DOMAIN" | tr '.' '-').nip.io"
  else
    HP_BROWSER_HOST="$HP_DOMAIN"
  fi
else
  if [[ "$HP_SERVER_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    HP_BROWSER_HOST="$(echo "$HP_SERVER_IP" | tr '.' '-').nip.io"
  else
    HP_BROWSER_HOST="$HP_SERVER_IP"
  fi
fi

if [[ -n "$HP_DOMAIN" ]]; then
  if [[ "$HP_WEBSERVER" == "nginx" ]]; then
    HP_NEXTAUTH_URL="http://${HP_BROWSER_HOST}"
    HP_CORS_ORIGIN="http://${HP_BROWSER_HOST}"
  else
    HP_NEXTAUTH_URL="http://${HP_BROWSER_HOST}:${HP_PORT}"
    HP_CORS_ORIGIN="http://${HP_BROWSER_HOST}:${HP_PORT}"
  fi
else
  HP_NEXTAUTH_URL="http://${HP_BROWSER_HOST}:${HP_PORT}"
  HP_CORS_ORIGIN="http://${HP_BROWSER_HOST}:${HP_PORT}"
fi

WEBAUTHN_RP_ID="$HP_BROWSER_HOST"
WEBAUTHN_ORIGIN="${HP_NEXTAUTH_URL}"
WEBAUTHN_RP_NAME="HostPanel"

cat > "$HP_INSTALL_DIR/.env" <<ENV
# HostPanel — auto-generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ─── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://${PG_USER}:${HP_DB_PASSWORD}@127.0.0.1:5432/${PG_DB}"

# ─── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL="${REDIS_URL}"

# ─── API ───────────────────────────────────────────────────────────────────────
API_PORT=${HP_API_PORT}
API_HOST=0.0.0.0
JWT_SECRET="${HP_JWT_SECRET}"
JWT_REFRESH_SECRET="${HP_JWT_REFRESH_SECRET}"
SESSION_SECRET="${HP_SESSION_SECRET}"

# ─── Frontend ──────────────────────────────────────────────────────────────────
# Server-side rewrites + RSC use loopback; browsers use same-origin /api + NEXT_PUBLIC_API_PORT for WS
INTERNAL_API_URL="http://127.0.0.1:${HP_API_PORT}"
NEXT_PUBLIC_API_PORT=${HP_API_PORT}
NEXTAUTH_URL="${HP_NEXTAUTH_URL}"
NEXTAUTH_SECRET="${HP_NEXTAUTH_SECRET}"
PORT=${HP_PORT}

# Passkeys / WebAuthn (see https://www.w3.org/TR/webauthn-2/#dom-publickeycredentialcreationoptions-rp )
WEBAUTHN_RP_ID="${WEBAUTHN_RP_ID}"
WEBAUTHN_ORIGIN="${WEBAUTHN_ORIGIN}"
WEBAUTHN_RP_NAME="${WEBAUTHN_RP_NAME}"
WEBAUTHN_EXTRA_ORIGINS=""

# Browser origins allowed for credentialed API calls (matches panel URL by default)
CORS_ORIGIN="${HP_CORS_ORIGIN}"

# ─── Admin credentials ─────────────────────────────────────────────────────────
ADMIN_EMAIL="${HP_ADMIN_EMAIL}"
ADMIN_PASSWORD="${HP_ADMIN_PASSWORD}"

# ─── SSL / ACME ────────────────────────────────────────────────────────────────
ACME_EMAIL="${HP_ADMIN_EMAIL}"
ACME_STAGING=${HP_STAGING_ACME}
CERTS_DIR="${HP_INSTALL_DIR}/certs"
ACME_WEBROOT="/var/www"

# ─── Web servers ────────────────────────────────────────────────────────────────
NGINX_SITES_DIR="${HP_SERVICE_HOME}/nginx-sites"
HOSTPANEL_TRUSTED_PROXY_IPS="${HP_TRUSTED_PROXY_IPS}"
APACHE_SITES_DIR="/etc/apache2/sites-enabled"
LIGHTTPD_CONF_DIR="/etc/lighttpd/conf-enabled"
LSWS_VHOSTS_DIR="/usr/local/lsws/conf/vhosts"

# ─── CrowdSec ──────────────────────────────────────────────────────────────────
CROWDSEC_API_URL="http://127.0.0.1:8080"
CROWDSEC_API_KEY="${CS_KEY_FOR_ENV}"

# ─── Media uploads ─────────────────────────────────────────────────────────────
MEDIA_DIR="${HP_INSTALL_DIR}/uploads"

# ─── API lifecycle ─────────────────────────────────────────────────────────────
# systemd sets NODE_ENV on the API unit; migrations run at startup when enabled below.
HOSTPANEL_AUTO_MIGRATE=true
ENV

chown "root:${HP_SERVICE_USER}" "$HP_INSTALL_DIR/.env"
chmod 640 "$HP_INSTALL_DIR/.env"
success "Environment file written to $HP_INSTALL_DIR/.env (group-readable by $HP_SERVICE_USER)"

# ─── 10. npm install + build (as $HP_SERVICE_USER, not root) ─────────────────
step "Installing npm dependencies (user: $HP_SERVICE_USER)"

if [[ -f package-lock.json ]]; then
  info "Running npm ci (lockfile) — reproducible production deps..."
  panel_exec "npm ci" || error "npm ci failed — check package-lock.json vs package.json"
else
  info "Running npm install (no package-lock.json)..."
  panel_exec "npm install --prefer-offline" || error "npm install failed"
fi

step "npm audit (critical)"
set +e
sudo -H -u "$HP_SERVICE_USER" env HOME="$HP_SERVICE_HOME" "PATH=$PATH" \
  bash -lc "cd "$HP_INSTALL_DIR" && npm audit --audit-level=critical --omit=dev" 2>&1 | tail -40
AUDIT_EC=${PIPESTATUS[0]}
set -e
if [[ $AUDIT_EC -ne 0 ]]; then
  if [[ "${HP_NPM_AUDIT_FAIL}" == "true" ]]; then
    error "npm audit failed (critical). Fix vulns or set HP_NPM_AUDIT_FAIL=false to continue."
  else
    warn "npm audit reported critical issues — review with: cd ${HP_INSTALL_DIR} && sudo -u $HP_SERVICE_USER npm audit"
  fi
fi

step "Generating Prisma client"
panel_exec "npm run db:generate" || error "Prisma generate failed"

step "Running database migrations"
panel_exec "npm run db:migrate" || error "Database migration failed"

step "Seeding initial admin account"
panel_exec "npm run db:seed" || warn "Seed script failed (database may already be seeded)"

step "Building production bundle (Next.js + API)"
sudo -H -u "$HP_SERVICE_USER" env HOME="$HP_SERVICE_HOME" "PATH=$PATH" NODE_ENV=production \
  bash -lc "set -euo pipefail; cd "$HP_INSTALL_DIR" && npm run build" || error "Production build failed"
success "Build complete (files owned by $HP_SERVICE_USER)"

# ─── 11. Ownership, uploads, and .env permissions ─────────────────────────────
step "Ensuring install tree is owned by '$HP_SERVICE_USER'"

chown -R "${HP_SERVICE_USER}:${HP_SERVICE_USER}" "$HP_INSTALL_DIR"
mkdir -p "$HP_INSTALL_DIR/uploads" "$HP_INSTALL_DIR/certs"
chown "${HP_SERVICE_USER}:${HP_SERVICE_USER}" "$HP_INSTALL_DIR/uploads" "$HP_INSTALL_DIR/certs"

chown "root:${HP_SERVICE_USER}" "$HP_INSTALL_DIR/.env"
chmod 640 "$HP_INSTALL_DIR/.env"

# Allow service user to reload web servers, install packages, etc. (sudoers file lists "hostpanel" — substitute if HP_SERVICE_USER differs)
SUDOERS_FILE="/etc/sudoers.d/hostpanel"
SUDOERS_SRC="${HP_INSTALL_DIR}/deploy/hostpanel.sudoers"
if [[ -f "$SUDOERS_SRC" ]]; then
  sed "s/^hostpanel /${HP_SERVICE_USER} /" "$SUDOERS_SRC" > /tmp/hostpanel-sudoers.gen
  install -m 440 -o root -g root /tmp/hostpanel-sudoers.gen "$SUDOERS_FILE"
  rm -f /tmp/hostpanel-sudoers.gen
else
  warn "Missing $SUDOERS_SRC — writing minimal sudoers fallback"
  cat > "$SUDOERS_FILE" <<SUDOERS
${HP_SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /usr/bin/apt-get
SUDOERS
  chmod 440 "$SUDOERS_FILE"
fi
success "System user and sudoers configured"

# Site vhosts must be writable by User=hostpanel — not under /etc/nginx/sites-enabled.
step "HostPanel-managed nginx site directory (writable by hostpanel user)"
HP_NGX_SITES="${HP_SERVICE_HOME}/nginx-sites"
mkdir -p "$HP_NGX_SITES"
chown "${HP_SERVICE_USER}:${HP_SERVICE_USER}" "$HP_NGX_SITES"
chmod 755 "$HP_NGX_SITES"
if [[ -d /etc/nginx/conf.d ]]; then
  cat > /etc/nginx/conf.d/00-hostpanel-managed-sites.conf <<NGXINC
# HostPanel — per-site vhosts (NGINX_SITES_DIR; user ${HP_SERVICE_USER})
include ${HP_NGX_SITES}/*.conf;
NGXINC
  chmod 644 /etc/nginx/conf.d/00-hostpanel-managed-sites.conf
  if command -v nginx &>/dev/null; then
    nginx -t && nginx -s reload 2>/dev/null || warn "nginx reload failed after adding HostPanel include — run: sudo nginx -t && sudo nginx -s reload"
  fi
  success "Nginx includes managed sites from $HP_NGX_SITES"
else
  warn "/etc/nginx/conf.d missing — add: include $HP_NGX_SITES/*.conf; inside http {} then reload nginx"
fi

# ─── 11b. Docker Engine (rootless, for site terminal / Alpine sidecars) ───────
if [[ "$HP_SKIP_DOCKER" != "true" && "$HP_DOCKER_ROOTLESS" == "true" ]]; then
  step "Installing Docker (rootless first, optional rootful fallback)"
  DOCKER_SCRIPT="${HP_INSTALL_DIR}/deploy/hostpanel-docker-rootless.sh"
  if [[ -f "$DOCKER_SCRIPT" ]]; then
    chmod +x "$DOCKER_SCRIPT"
    export HP_DOCKER_ROOTFUL_ONLY HP_DOCKER_TRY_ROOTLESS HP_DOCKER_FALLBACK_ROOTFUL HP_RESTART_HOSTPANEL_API HP_PULL_ALPINE HOSTPANEL_ALPINE_IMAGE
    bash "$DOCKER_SCRIPT" "$HP_INSTALL_DIR" "$OS_CODENAME" "$OS_ID" \
      || warn "Rootless Docker setup exited non-zero — check output; you can re-run: sudo bash $DOCKER_SCRIPT $HP_INSTALL_DIR $OS_CODENAME $OS_ID"
    chown "root:${HP_SERVICE_USER}" "$HP_INSTALL_DIR/.env" 2>/dev/null || true
    chmod 640 "$HP_INSTALL_DIR/.env" 2>/dev/null || true
  else
    warn "Missing $DOCKER_SCRIPT — skipping Docker install"
  fi
elif [[ "$HP_SKIP_DOCKER" == "true" ]]; then
  info "Skipping Docker (HP_SKIP_DOCKER=true)"
fi

# Helper script for in-panel Node.js installs (API runs via sudo)
mkdir -p /usr/local/hostpanel/bin
if [[ -f "${HP_INSTALL_DIR}/deploy/hostpanel-install-node.sh" ]]; then
  install -m 755 "${HP_INSTALL_DIR}/deploy/hostpanel-install-node.sh" /usr/local/hostpanel/bin/hostpanel-install-node.sh
  success "Installed /usr/local/hostpanel/bin/hostpanel-install-node.sh"
fi
if [[ -f "${HP_INSTALL_DIR}/deploy/hostpanel-docker-rootless.sh" ]]; then
  install -m 755 "${HP_INSTALL_DIR}/deploy/hostpanel-docker-rootless.sh" /usr/local/hostpanel/bin/hostpanel-docker-rootless.sh
  success "Installed /usr/local/hostpanel/bin/hostpanel-docker-rootless.sh (re-run for Docker fixes)"
fi

# ─── 12. systemd service units ────────────────────────────────────────────────
step "Creating systemd service units"

NODE_BIN="$(command -v node)"
NEXT_BIN="${HP_INSTALL_DIR}/node_modules/next/dist/bin/next"
TSX_LOADER="${HP_INSTALL_DIR}/node_modules/tsx/dist/loader.mjs"
[[ -x "$NODE_BIN" ]] || error "node binary not found in PATH"
[[ -f "$NEXT_BIN" ]] || error "Next.js CLI missing at $NEXT_BIN — run npm install in $HP_INSTALL_DIR"
[[ -f "$TSX_LOADER" ]] || error "tsx loader missing at $TSX_LOADER — run npm install in $HP_INSTALL_DIR"

# API service
cat > /etc/systemd/system/hostpanel-api.service <<UNIT
[Unit]
Description=HostPanel API Server
After=network.target postgresql.service redis.service
Wants=postgresql.service redis.service

[Service]
Type=simple
User=${HP_SERVICE_USER}
Group=${HP_SERVICE_USER}
WorkingDirectory=${HP_INSTALL_DIR}/apps/api
EnvironmentFile=${HP_INSTALL_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} --import ${TSX_LOADER} dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hostpanel-api

# API invokes sudo for apt, nginx/apache reload, etc. NoNewPrivileges prevents sudo from
# working; ProtectSystem=full leaves /etc read-only for child apt processes.
NoNewPrivileges=false
ProtectSystem=false
PrivateTmp=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

# Web service (Next.js)
cat > /etc/systemd/system/hostpanel-web.service <<UNIT
[Unit]
Description=HostPanel Web UI (Next.js)
After=network.target hostpanel-api.service
Wants=hostpanel-api.service

[Service]
Type=simple
User=${HP_SERVICE_USER}
Group=${HP_SERVICE_USER}
WorkingDirectory=${HP_INSTALL_DIR}/apps/web
EnvironmentFile=${HP_INSTALL_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${NEXT_BIN} start --hostname 0.0.0.0
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hostpanel-web
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
service_enable_start hostpanel-api
service_enable_start hostpanel-web

success "systemd services installed and started"

# ─── 12b. Smoke test (API /health) ───────────────────────────────────────────
step "Running API smoke test"
wait_for_port 127.0.0.1 "${HP_API_PORT}"
export API_PORT="${HP_API_PORT}"
export API_HOST="127.0.0.1"
if [[ -f "${HP_INSTALL_DIR}/scripts/smoke-test.mjs" ]]; then
  if node "${HP_INSTALL_DIR}/scripts/smoke-test.mjs"; then
    success "Smoke test passed"
  else
    warn "Smoke test failed — check: journalctl -u hostpanel-api -n 80 --no-pager"
  fi
else
  warn "smoke-test.mjs not found — skipping smoke test"
fi

# ─── 13. Nginx management vhost (optional) ────────────────────────────────────
if [[ "$HP_WEBSERVER" == "nginx" && -n "${HP_BROWSER_HOST:-}" ]]; then
  step "Configuring Nginx vhost for ${HP_BROWSER_HOST}"

  cat > "/etc/nginx/sites-enabled/hostpanel-panel.conf" <<VHOST
# HostPanel management panel
server {
    listen 80;
    listen [::]:80;
    server_name ${HP_BROWSER_HOST};

    # Proxy to Next.js
    location / {
        proxy_pass http://127.0.0.1:${HP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Proxy to API (Upgrade headers required for WebSocket terminals under /api/)
    location /api/ {
        proxy_pass http://127.0.0.1:${HP_API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    access_log /var/log/nginx/hostpanel.access.log;
    error_log  /var/log/nginx/hostpanel.error.log;
}
VHOST

  nginx -t && nginx -s reload
  success "Nginx vhost configured for ${HP_BROWSER_HOST}"
fi

if [[ "$HP_WEBSERVER" == "nginx" && -n "${HP_TRUSTED_PROXY_IPS:-}" && -f "${HP_INSTALL_DIR}/scripts/apply-nginx-trusted-proxy.sh" ]]; then
  step "Nginx trusted proxy (real client IP): ${HP_TRUSTED_PROXY_IPS}"
  chmod +x "${HP_INSTALL_DIR}/scripts/apply-nginx-trusted-proxy.sh"
  bash "${HP_INSTALL_DIR}/scripts/apply-nginx-trusted-proxy.sh" "$HP_INSTALL_DIR/.env"
  success "Nginx real_ip configured for trusted proxies"
fi

# ─── 13a. CrowdSec: HostPanel + managed site web logs on host (Docker: bind-mount these paths) ─
if [[ "$HP_CROWDSEC" == "true" ]] && command -v cscli &>/dev/null \
  && [[ -f "${HP_INSTALL_DIR}/deploy/crowdsec-acquis-hostpanel.yaml" ]]; then
  step "CrowdSec: acquiring HostPanel / nginx / OpenResty log files"
  install -m 0644 "${HP_INSTALL_DIR}/deploy/crowdsec-acquis-hostpanel.yaml" \
    /etc/crowdsec/acquis.d/hostpanel-weblogs.yaml
  if [[ -f "${HP_INSTALL_DIR}/deploy/crowdsec-acquis-nodejs.yaml" ]]; then
    install -m 0644 "${HP_INSTALL_DIR}/deploy/crowdsec-acquis-nodejs.yaml" \
      /etc/crowdsec/acquis.d/hostpanel-nodejs.yaml
  fi
  if getent passwd crowdsec &>/dev/null; then
    usermod -a -G adm crowdsec 2>/dev/null || true
    usermod -a -G www-data crowdsec 2>/dev/null || true
  fi
  chmod 0755 /var/log/nginx 2>/dev/null || true
  mkdir -p /var/log/openresty
  chmod 0755 /var/log/openresty 2>/dev/null || true
  systemctl reload crowdsec 2>/dev/null || systemctl restart crowdsec 2>/dev/null || true
  info "CrowdSec tails /var/log/nginx/*.log (includes hostpanel.* + site vhosts). For containerized nginx, mount: -v /var/log/nginx:/var/log/nginx"
  success "CrowdSec log acquisition updated"
fi

if [[ "$HP_CROWDSEC" == "true" ]] && command -v cscli &>/dev/null \
  && [[ -x "${HP_INSTALL_DIR}/deploy/ensure-crowdsec-hub.sh" ]]; then
  step "CrowdSec: install hub parsers and scenarios"
  export HP_INSTALL_DIR
  bash "${HP_INSTALL_DIR}/deploy/ensure-crowdsec-hub.sh" \
    && success "CrowdSec hub collections, parsers, and scenarios installed" \
    || warn "CrowdSec hub install had warnings — re-run: sudo bash ${HP_INSTALL_DIR}/deploy/ensure-crowdsec-hub.sh"
fi

# ─── 13b. Fail2ban (SSH / brute-force) ──────────────────────────────────────
if [[ "${HP_FAIL2BAN}" == "true" ]]; then
  step "Installing fail2ban"
  if pkg_install fail2ban 2>/dev/null; then
    service_enable_start fail2ban
    success "fail2ban installed (protects SSH by default where jail.local exists)"
  else
    warn "fail2ban not available from apt — skip or: apt-get install fail2ban"
  fi
fi

# ─── 14. Firewall ─────────────────────────────────────────────────────────────
step "Configuring firewall (ufw)"

# ufw is not pre-installed on Debian — install it silently
if ! command -v ufw &>/dev/null; then
  pkg_install ufw || true
fi

if command -v ufw &>/dev/null; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow "${HP_PORT}/tcp"    comment "HostPanel UI"
  ufw allow "${HP_API_PORT}/tcp" comment "HostPanel API"
  ufw --force enable
  success "ufw firewall configured"
else
  warn "ufw not found — skipping firewall configuration"
fi

# ─── 15. Logrotate ────────────────────────────────────────────────────────────
cat > /etc/logrotate.d/hostpanel <<LOGROTATE
${HP_INSTALL_DIR}/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ${HP_SERVICE_USER} ${HP_SERVICE_USER}
}
LOGROTATE

# ─── Done! ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  HostPanel installed successfully!${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Access URLs:${NC}"
echo -e "    Web UI : ${CYAN}${HP_NEXTAUTH_URL}${NC}"
if [[ "$HP_WEBSERVER" == "nginx" ]]; then
  echo -e "    API    : ${CYAN}http://${HP_BROWSER_HOST}/api${NC}"
else
  echo -e "    API    : ${CYAN}http://${HP_BROWSER_HOST}:${HP_API_PORT}${NC}"
fi
if [[ "$HP_BROWSER_HOST" == *".nip.io"* ]]; then
  echo -e "  ${YELLOW}Open the panel using the nip.io hostname above (not the raw IP) so passkeys/WebAuthn match WEBAUTHN_RP_ID.${NC}"
fi
echo ""
echo -e "  ${BOLD}Admin credentials:${NC}"
echo -e "    Email    : ${YELLOW}${HP_ADMIN_EMAIL}${NC}"
echo -e "    Password : ${YELLOW}${HP_ADMIN_PASSWORD}${NC}"
echo ""
echo -e "  ${BOLD}Services:${NC}"
echo -e "    hostpanel-api : $(systemctl is-active hostpanel-api 2>/dev/null || echo 'unknown')"
echo -e "    hostpanel-web : $(systemctl is-active hostpanel-web 2>/dev/null || echo 'unknown')"
echo -e "    postgresql    : $(systemctl is-active postgresql 2>/dev/null || echo 'unknown')"
echo -e "    redis         : $(systemctl is-active redis-server 2>/dev/null || echo 'unknown')"
[[ "$HP_CROWDSEC" == "true" ]] && {
  echo -e "    crowdsec                    : $(systemctl is-active crowdsec 2>/dev/null || echo 'unknown')"
  echo -e "    crowdsec-firewall-bouncer  : $(systemctl is-active crowdsec-firewall-bouncer 2>/dev/null || echo 'unknown')"
}
if [[ "$HP_SKIP_DOCKER" != "true" && "$HP_DOCKER_ROOTLESS" == "true" ]]; then
  if grep -q '^DOCKER_HOST=' "${HP_INSTALL_DIR}/.env" 2>/dev/null; then
    echo -e "    docker          : ${GREEN}configured${NC} (DOCKER_HOST in .env — see deploy/hostpanel-docker-rootless.sh)"
  else
    echo -e "    docker          : ${YELLOW}not configured — check install log${NC}"
  fi
fi
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
if [[ -x /usr/local/hostpanel/bin/hostpanel-docker-rootless.sh ]]; then
  echo -e "    Install/fix Docker: ${CYAN}sudo /usr/local/hostpanel/bin/hostpanel-docker-rootless.sh ${HP_INSTALL_DIR} ${OS_CODENAME} ${OS_ID}${NC}"
fi
echo -e "    View API logs : ${CYAN}journalctl -u hostpanel-api -f${NC}"
echo -e "    View web logs : ${CYAN}journalctl -u hostpanel-web -f${NC}"
echo -e "    Restart all   : ${CYAN}systemctl restart hostpanel-api hostpanel-web${NC}"
echo -e "    Edit config   : ${CYAN}nano ${HP_INSTALL_DIR}/.env${NC}"
echo ""
echo -e "  ${YELLOW}⚠  Save your admin password now — it won't be shown again!${NC}"
echo -e "  ${YELLOW}   Config saved in: ${HP_INSTALL_DIR}/.env${NC}"
echo ""
