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
#    HP_NODE_VERSION=20               (Node.js major version)
#    HP_SKIP_WEBSERVER=false          (skip web server install entirely)
#    HP_STAGING_ACME=true             (use Let's Encrypt staging, set false for prod)
#    HP_SKIP_DOCKER=false             (skip Docker install entirely)
#    HP_DOCKER_ROOTLESS=true          (run deploy/hostpanel-docker-rootless.sh after user exists)
#    HP_DOCKER_ROOTFUL_ONLY=false     (pass through to script: LXC — skip rootless, install rootful only)
#    HP_DOCKER_TRY_ROOTLESS=true      (pass through: set false with ROOTFUL_ONLY to skip rootless)
#    HP_DOCKER_FALLBACK_ROOTFUL=true  (default: if rootless fails, install rootful docker-ce)
#    HP_RESTART_HOSTPANEL_API=true    (restart hostpanel-api after Docker .env changes; set false to skip)
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
HP_STAGING_ACME="${HP_STAGING_ACME:-true}"
HP_SKIP_DOCKER="${HP_SKIP_DOCKER:-false}"
HP_DOCKER_ROOTLESS="${HP_DOCKER_ROOTLESS:-true}"
HP_DOCKER_ROOTFUL_ONLY="${HP_DOCKER_ROOTFUL_ONLY:-false}"
HP_DOCKER_TRY_ROOTLESS="${HP_DOCKER_TRY_ROOTLESS:-true}"
HP_DOCKER_FALLBACK_ROOTFUL="${HP_DOCKER_FALLBACK_ROOTFUL:-true}"
HP_RESTART_HOSTPANEL_API="${HP_RESTART_HOSTPANEL_API:-true}"
HP_JWT_SECRET="$(openssl rand -base64 48 | tr -d '=+/')"
HP_SESSION_SECRET="$(openssl rand -base64 48 | tr -d '=+/')"
HP_DOMAIN="${HP_DOMAIN:-}"
HP_SKIP_PANEL_HOST_PROMPT="${HP_SKIP_PANEL_HOST_PROMPT:-false}"

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
echo -e "${NC}  Bare Metal Installer — v1.0.0\n"

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

# ─── 1. System update + core deps ─────────────────────────────────────────────
step "Updating package lists and installing core dependencies"

$PKG_MGR update -qq

# Universal core — available on all supported distros
pkg_install_required curl wget gnupg2 lsb-release ca-certificates \
  build-essential git unzip openssl

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
    pkg_install crowdsec-firewall-bouncer-iptables || true
    service_enable_start crowdsec

    # Install community-recommended collections
    cscli collections install crowdsecurity/linux 2>/dev/null || true
    cscli collections install crowdsecurity/nginx 2>/dev/null || true

    success "CrowdSec installed with linux + nginx collections"
  else
    success "CrowdSec already installed ($(cscli version 2>/dev/null | head -1))"
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

# NEXTAUTH_URL + CORS_ORIGIN must match the URL users open in the browser
if [[ -n "$HP_DOMAIN" ]]; then
  if [[ "$HP_WEBSERVER" == "nginx" ]]; then
    HP_NEXTAUTH_URL="http://${HP_DOMAIN}"
    HP_CORS_ORIGIN="http://${HP_DOMAIN}"
  else
    HP_NEXTAUTH_URL="http://${HP_DOMAIN}:${HP_PORT}"
    HP_CORS_ORIGIN="http://${HP_DOMAIN}:${HP_PORT}"
  fi
else
  HP_SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
  HP_NEXTAUTH_URL="http://${HP_SERVER_IP}:${HP_PORT}"
  HP_CORS_ORIGIN="http://${HP_SERVER_IP}:${HP_PORT}"
fi

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
SESSION_SECRET="${HP_SESSION_SECRET}"

# ─── Frontend ──────────────────────────────────────────────────────────────────
# Server-side rewrites + RSC use loopback; browsers use same-origin /api + NEXT_PUBLIC_API_PORT for WS
INTERNAL_API_URL="http://127.0.0.1:${HP_API_PORT}"
NEXT_PUBLIC_API_PORT=${HP_API_PORT}
NEXTAUTH_URL="${HP_NEXTAUTH_URL}"
PORT=${HP_PORT}

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
NGINX_SITES_DIR="/var/lib/hostpanel/nginx-sites"
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

chmod 600 "$HP_INSTALL_DIR/.env"
success "Environment file written to $HP_INSTALL_DIR/.env"

# ─── 10. npm install + build ──────────────────────────────────────────────────
step "Installing npm dependencies"

cd "$HP_INSTALL_DIR"
info "Running npm install (output may be lengthy)..."
npm install --prefer-offline || error "npm install failed"

step "Generating Prisma client"
npm run db:generate || error "Prisma generate failed"

step "Running database migrations"
npm run db:migrate || error "Database migration failed"

step "Seeding initial admin account"
npm run db:seed || warn "Seed script failed (database may already be seeded)"

step "Building frontend (Next.js)"
npm run build || error "Production build failed"
success "Build complete"

# ─── 11. Create system user ───────────────────────────────────────────────────
step "Creating system user 'hostpanel'"

if ! id -u hostpanel &>/dev/null; then
  mkdir -p /var/lib/hostpanel
  useradd --system --home-dir /var/lib/hostpanel --create-home --shell /usr/sbin/nologin hostpanel
else
  mkdir -p /var/lib/hostpanel
  chown hostpanel:hostpanel /var/lib/hostpanel
  if [[ "$(getent passwd hostpanel | cut -d: -f6)" != "/var/lib/hostpanel" ]]; then
    usermod -d /var/lib/hostpanel hostpanel 2>/dev/null || true
  fi
fi

chown -R hostpanel:hostpanel "$HP_INSTALL_DIR"
mkdir -p "$HP_INSTALL_DIR/uploads" "$HP_INSTALL_DIR/certs"
chown hostpanel:hostpanel "$HP_INSTALL_DIR/uploads" "$HP_INSTALL_DIR/certs"

# Secrets: keep .env root-owned mode 600 so only root reads it; systemd still loads
# EnvironmentFile= into hostpanel-api / hostpanel-web as root before dropping privileges.
chown root:root "$HP_INSTALL_DIR/.env"
chmod 600 "$HP_INSTALL_DIR/.env"

# Allow hostpanel to reload web servers, install packages, etc. (sudoers)
SUDOERS_FILE="/etc/sudoers.d/hostpanel"
SUDOERS_SRC="${HP_INSTALL_DIR}/deploy/hostpanel.sudoers"
if [[ -f "$SUDOERS_SRC" ]]; then
  install -m 440 -o root -g root "$SUDOERS_SRC" "$SUDOERS_FILE"
else
  warn "Missing $SUDOERS_SRC — writing minimal sudoers fallback"
  cat > "$SUDOERS_FILE" <<'SUDOERS'
hostpanel ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /usr/bin/apt-get
SUDOERS
  chmod 440 "$SUDOERS_FILE"
fi
success "System user and sudoers configured"

# Site vhosts must be writable by User=hostpanel — not under /etc/nginx/sites-enabled.
step "HostPanel-managed nginx site directory (writable by hostpanel user)"
HP_NGX_SITES="/var/lib/hostpanel/nginx-sites"
mkdir -p "$HP_NGX_SITES"
chown hostpanel:hostpanel "$HP_NGX_SITES"
chmod 755 "$HP_NGX_SITES"
if [[ -d /etc/nginx/conf.d ]]; then
  cat > /etc/nginx/conf.d/00-hostpanel-managed-sites.conf <<'NGXINC'
# HostPanel — per-site vhosts written by the `hostpanel` user (NGINX_SITES_DIR in HostPanel .env)
include /var/lib/hostpanel/nginx-sites/*.conf;
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
    chown root:root "$HP_INSTALL_DIR/.env" 2>/dev/null || true
    chmod 600 "$HP_INSTALL_DIR/.env" 2>/dev/null || true
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
User=hostpanel
Group=hostpanel
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
User=hostpanel
Group=hostpanel
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
if [[ "$HP_WEBSERVER" == "nginx" && -n "$HP_DOMAIN" ]]; then
  step "Configuring Nginx vhost for $HP_DOMAIN"

  cat > "/etc/nginx/sites-enabled/hostpanel-panel.conf" <<VHOST
# HostPanel management panel
server {
    listen 80;
    listen [::]:80;
    server_name ${HP_DOMAIN};

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

    # Proxy to API
    location /api/ {
        proxy_pass http://127.0.0.1:${HP_API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    access_log /var/log/nginx/hostpanel.access.log;
    error_log  /var/log/nginx/hostpanel.error.log;
}
VHOST

  nginx -t && nginx -s reload
  success "Nginx vhost configured for $HP_DOMAIN"
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
    create 0640 hostpanel hostpanel
}
LOGROTATE

# ─── Done! ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  HostPanel installed successfully! 🎉${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Access URLs:${NC}"
if [[ -n "$HP_DOMAIN" ]]; then
  if [[ "$HP_WEBSERVER" == "nginx" ]]; then
    echo -e "    Web UI : ${CYAN}http://${HP_DOMAIN}${NC}"
    echo -e "    API    : ${CYAN}http://${HP_DOMAIN}/api${NC}"
  else
    echo -e "    Web UI : ${CYAN}http://${HP_DOMAIN}:${HP_PORT}${NC}"
    echo -e "    API    : ${CYAN}http://${HP_DOMAIN}:${HP_API_PORT}${NC}"
  fi
else
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "    Web UI : ${CYAN}http://${SERVER_IP}:${HP_PORT}${NC}"
echo -e "    API    : ${CYAN}http://${SERVER_IP}:${HP_API_PORT}${NC}"
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
[[ "$HP_CROWDSEC" == "true" ]] && \
echo -e "    crowdsec      : $(systemctl is-active crowdsec 2>/dev/null || echo 'unknown')"
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
