#!/usr/bin/env bash
# HostPanel — Docker setup for user `hostpanel` (rootless first, optional rootful fallback).
# Run as root after the `hostpanel` user exists. Idempotent.
#
# Usage: hostpanel-docker-rootless.sh <install-dir> <os-codename> <os-id>
# Example: hostpanel-docker-rootless.sh /opt/hostpanel bookworm debian
#
# ─── Behaviour ────────────────────────────────────────────────────────────────
# 1. If rootless already works → sync .env (rootless socket), optional pull, optional API restart.
# 2. Else if rootful already works for `hostpanel` (docker group + /var/run/docker.sock) → sync .env.
# 3. Else if HP_DOCKER_ROOTFUL_ONLY=true → skip rootless; install/start rootful dockerd only.
# 4. Else try rootless (docker-ce-cli + rootless-extras + dockerd-rootless-setuptool).
# 5. If rootless fails and HP_DOCKER_FALLBACK_ROOTFUL is not "false" → install docker-ce (rootful),
#    add `hostpanel` to group `docker`, write DOCKER_HOST=unix:///var/run/docker.sock.
# 6. Last resort: docker.io from distro if CE packages are unavailable.
#
# VM / bare metal: rootless usually works (subuid/subgid + user namespaces). Prefer leaving
# HP_DOCKER_ROOTFUL_ONLY unset so rootless is attempted first.
#
# Unprivileged LXC / some VPS: rootless often fails (newuidmap: Operation not permitted). The
# rootful fallback is the practical default; for true rootless in LXC you need CT idmaps / host
# settings — see https://rootlesscontaine.rs/getting-started/common/
#
# Env:
#   HP_PULL_ALPINE=true               — docker pull HOSTPANEL_ALPINE_IMAGE after success (default true)
#   HOSTPANEL_ALPINE_IMAGE=alpine:3.19 — image to pull when HP_PULL_ALPINE=true
#   HP_DOCKER_FALLBACK_ROOTFUL=true   — install rootful dockerd if rootless fails (default true)
#   HP_DOCKER_ROOTFUL_ONLY=false      — if true, never run rootless setuptool (good for known LXC)
#   HP_DOCKER_TRY_ROOTLESS=true       — if false, same as ROOTFUL_ONLY (skip rootless attempt)
#   HP_RESTART_HOSTPANEL_API=true     — systemctl restart hostpanel-api when .env changes (default true)
#   HP_DOCKER_SUBID_RANGE=100000:65536 — subuid/subgid range for hostpanel if missing
# =============================================================================

set -euo pipefail

HP_INSTALL_DIR="${1:?install directory required}"
OS_CODENAME="${2:?codename required (e.g. bookworm, jammy)}"
OS_ID_RAW="${3:?os id required}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${BLUE}[docker]${NC} $*"; }
warn() { echo -e "${YELLOW}[docker]${NC} $*" >&2; }
ok() { echo -e "${GREEN}[docker]${NC} $*"; }

HP_PULL_ALPINE="${HP_PULL_ALPINE:-true}"
HP_DOCKER_FALLBACK_ROOTFUL="${HP_DOCKER_FALLBACK_ROOTFUL:-true}"
HP_DOCKER_ROOTFUL_ONLY="${HP_DOCKER_ROOTFUL_ONLY:-false}"
HP_DOCKER_TRY_ROOTLESS="${HP_DOCKER_TRY_ROOTLESS:-true}"
HP_RESTART_HOSTPANEL_API="${HP_RESTART_HOSTPANEL_API:-true}"
ALPINE_TAG="${HOSTPANEL_ALPINE_IMAGE:-alpine:3.19}"

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
id hostpanel &>/dev/null || { echo "User hostpanel does not exist." >&2; exit 1; }

case "$OS_ID_RAW" in
  ubuntu) DOCKER_APT_DISTRO="ubuntu" ;;
  raspbian|debian) DOCKER_APT_DISTRO="debian" ;;
  *) DOCKER_APT_DISTRO="debian" ;;
esac

# Docker CE apt repo may lag behind the latest distro release. Map unsupported
# codenames to the latest known-good one so packages are always installable.
# For Debian: trixie/forky/sid → bookworm (CE bookworm packages work on Debian 13+)
# For Ubuntu: anything after noble → noble
resolve_docker_ce_codename() {
  local distro="$1" codename="$2"
  if [[ "$distro" == "debian" ]]; then
    case "$codename" in
      buster|bullseye|bookworm) echo "$codename" ;;
      *) echo "bookworm" ;;
    esac
  elif [[ "$distro" == "ubuntu" ]]; then
    case "$codename" in
      focal|jammy|mantic|noble) echo "$codename" ;;
      *) echo "noble" ;;
    esac
  else
    echo "$codename"
  fi
}
DOCKER_CE_CODENAME="$(resolve_docker_ce_codename "$DOCKER_APT_DISTRO" "$OS_CODENAME")"

export DEBIAN_FRONTEND=noninteractive

virt_environment_hint() {
  # systemd-detect-virt exits non-zero on bare metal — do not trip set -e
  local v
  v="$(systemd-detect-virt 2>/dev/null || echo none)"
  [[ -z "$v" ]] && v="none"
  case "$v" in
    lxc|openvz|podman|docker|wsl|microsoft)
      info "Detected virtualization: $v — rootless Docker may fail (subuid/user-ns). Rootful fallback is enabled by default (HP_DOCKER_FALLBACK_ROOTFUL)."
      ;;
    none|kvm|qemu|vmware|xen|bochs|uml|parallels|bhyve|zvm|apple|powervm)
      info "Detected virtualization: $v — rootless Docker is usually viable on VMs/bare metal."
      ;;
    *)
      if [[ "$v" != "none" ]]; then info "systemd-detect-virt: $v"; fi
      ;;
  esac
  if [[ -f /run/.containerenv ]]; then info "/run/.containerenv present (container)."; fi
  return 0
}

ensure_home() {
  local hp_home="/var/lib/hostpanel"
  mkdir -p "$hp_home"
  chown hostpanel:hostpanel "$hp_home"
  if [[ "$(getent passwd hostpanel | cut -d: -f6)" != "$hp_home" ]]; then
    usermod -d "$hp_home" hostpanel 2>/dev/null || true
  fi
}

ensure_subids() {
  local range="${HP_DOCKER_SUBID_RANGE:-100000:65536}"
  grep -q '^hostpanel:' /etc/subuid 2>/dev/null || echo "hostpanel:${range}" >> /etc/subuid
  grep -q '^hostpanel:' /etc/subgid 2>/dev/null || echo "hostpanel:${range}" >> /etc/subgid
}

ensure_docker_ce_repo() {
  if [[ ! -f /etc/apt/sources.list.d/docker-ce.list ]]; then
    install -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${DOCKER_APT_DISTRO}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DOCKER_APT_DISTRO} ${DOCKER_CE_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker-ce.list
    if [[ "$DOCKER_CE_CODENAME" != "$OS_CODENAME" ]]; then
      info "Docker CE repo: using codename '${DOCKER_CE_CODENAME}' for OS release '${OS_CODENAME}' (CE repo ahead-of-release fallback)"
    fi
  fi
}

install_docker_ce_cli_rootless() {
  apt-get update -qq
  # Core userspace deps — always available in Debian/Ubuntu repos
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg iptables \
    slirp4netns fuse-overlayfs dbus-user-session uidmap 2>/dev/null || \
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg iptables uidmap 2>/dev/null || true
  # Docker CE packages from the Docker CE repo (requires ensure_docker_ce_repo first)
  apt-get install -y --no-install-recommends \
    docker-ce-cli docker-ce-rootless-extras
}

strip_docker_env_lines() {
  local env_file="${HP_INSTALL_DIR}/.env"
  [[ -f "$env_file" ]] || return 0
  sed -i \
    -e '/^DOCKER_HOST=/d' \
    -e '/^HOSTPANEL_TERMINAL_DOCKER=/d' \
    -e '/^# ─── Docker /d' \
    "$env_file"
}

append_env_rootless() {
  local env_file="${HP_INSTALL_DIR}/.env"
  [[ -f "$env_file" ]] || return 1
  strip_docker_env_lines
  local uid
  uid="$(id -u hostpanel)"
  cat >> "$env_file" <<EOF

# ─── Docker (rootless, via deploy/hostpanel-docker-rootless.sh) ───────────────
DOCKER_HOST=unix:///run/user/${uid}/docker.sock
HOSTPANEL_TERMINAL_DOCKER=true
EOF
  chmod 600 "$env_file"
  chown root:root "$env_file" 2>/dev/null || true
  ok "Wrote rootless DOCKER_HOST to .env"
}

append_env_rootful() {
  local env_file="${HP_INSTALL_DIR}/.env"
  [[ -f "$env_file" ]] || return 1
  strip_docker_env_lines
  cat >> "$env_file" <<'EOF'

# ─── Docker (rootful dockerd; members of group "docker" can access the socket — treat as privileged)
DOCKER_HOST=unix:///var/run/docker.sock
HOSTPANEL_TERMINAL_DOCKER=true
EOF
  chmod 600 "$env_file"
  chown root:root "$env_file" 2>/dev/null || true
  ok "Wrote rootful DOCKER_HOST to .env"
}

verify_docker_rootless_sock() {
  local uid sock
  uid="$(id -u hostpanel)"
  sock="unix:///run/user/${uid}/docker.sock"
  if runuser -u hostpanel -- env DOCKER_HOST="$sock" docker info &>/dev/null; then
    return 0
  fi
  return 1
}

docker_as_hostpanel() {
  if command -v sudo &>/dev/null; then
    sudo -u hostpanel -- "$@"
  else
    runuser -u hostpanel -- "$@"
  fi
}

verify_docker_rootful() {
  # Try as hostpanel user with sg to activate the docker group in the same command
  if sg docker -c "docker info" &>/dev/null 2>&1; then
    return 0
  fi
  # sg not available or not yet in group — fall back to sudo/runuser
  if docker_as_hostpanel docker info &>/dev/null 2>&1; then
    return 0
  fi
  # Last check: can root reach the socket? (daemon running but group not yet effective)
  if docker info &>/dev/null 2>&1; then
    return 0
  fi
  return 1
}

maybe_pull_alpine_rootless() {
  local uid="$1"
  [[ "$HP_PULL_ALPINE" == "true" ]] || return 0
  info "Pull ${ALPINE_TAG} (optional warm cache, rootless)"
  runuser -u hostpanel -- env DOCKER_HOST="unix:///run/user/${uid}/docker.sock" \
    docker pull "$ALPINE_TAG" || warn "docker pull $ALPINE_TAG failed (offline mirror?)"
}

maybe_pull_alpine_rootful() {
  [[ "$HP_PULL_ALPINE" == "true" ]] || return 0
  info "Pull ${ALPINE_TAG} (optional warm cache, rootful)"
  docker_as_hostpanel docker pull "$ALPINE_TAG" || warn "docker pull $ALPINE_TAG failed"
}

maybe_restart_hostpanel_api() {
  [[ "$HP_RESTART_HOSTPANEL_API" == "true" ]] || return 0
  if systemctl cat hostpanel-api.service &>/dev/null; then
    systemctl restart hostpanel-api 2>/dev/null && ok "Restarted hostpanel-api (picked up .env / docker group)" \
      || warn "hostpanel-api restart failed — run: systemctl restart hostpanel-api"
  fi
}

finish_rootless_ok() {
  local uid="$1"
  append_env_rootless
  maybe_pull_alpine_rootless "$uid"
  maybe_restart_hostpanel_api
  ok "Docker rootless setup finished."
  exit 0
}

reset_docker_context_to_default() {
  # dockerd-rootless-setuptool may have switched the hostpanel user's context to "rootless".
  # For rootful setups, reset it to "default" so docker commands work without DOCKER_HOST override.
  if docker_as_hostpanel docker context inspect rootless &>/dev/null 2>&1; then
    docker_as_hostpanel docker context use default 2>/dev/null || true
    docker_as_hostpanel docker context rm rootless 2>/dev/null || true
    ok "Reset docker context to 'default' for hostpanel user (removed stale 'rootless' context)"
  fi
}

finish_rootful_ok() {
  reset_docker_context_to_default
  append_env_rootful
  maybe_pull_alpine_rootful
  maybe_restart_hostpanel_api
  ok "Docker rootful setup finished."
  exit 0
}

install_rootful_docker_ce() {
  info "Installing rootful Docker Engine (docker-ce) — hostpanel user must be in group 'docker'"
  ensure_docker_ce_repo
  apt-get update -qq
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin 2>/dev/null \
    || apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io
  systemctl enable --now docker.service 2>/dev/null || true
  usermod -aG docker hostpanel 2>/dev/null || true
  sleep 3
  if verify_docker_rootful; then
    ok "Rootful Docker is reachable at unix:///var/run/docker.sock"
    return 0
  fi
  warn "Rootful docker info still failing — check: journalctl -u docker -n 40"
  return 1
}

install_rootful_docker_io() {
  info "Installing distro docker.io (last resort — no Docker CE repo required)"
  apt-get update -qq
  apt-get install -y --no-install-recommends docker.io || return 1
  # On Debian 13+ the CLI is split into docker-cli; install it if available
  apt-get install -y --no-install-recommends docker-cli 2>/dev/null || true
  systemctl enable --now docker.service 2>/dev/null || systemctl enable --now docker.io 2>/dev/null || true
  usermod -aG docker hostpanel 2>/dev/null || true
  sleep 3
  verify_docker_rootful
}

# ─── Main ─────────────────────────────────────────────────────────────────────
virt_environment_hint
info "Prerequisites (home, subuid/subgid)"
ensure_home
ensure_subids

HP_UID="$(id -u hostpanel)"

# Fast path: already working
if verify_docker_rootless_sock; then
  ok "Rootless Docker already running (unix:///run/user/${HP_UID}/docker.sock)"
  finish_rootless_ok "$HP_UID"
fi

if verify_docker_rootful; then
  ok "Rootful Docker already usable by hostpanel"
  finish_rootful_ok
fi

# Skip rootless entirely (e.g. Proxmox LXC where you know it will fail)
if [[ "$HP_DOCKER_ROOTFUL_ONLY" == "true" || "$HP_DOCKER_TRY_ROOTLESS" == "false" ]]; then
  info "Skipping rootless (HP_DOCKER_ROOTFUL_ONLY or HP_DOCKER_TRY_ROOTLESS=false)"
  if [[ "$HP_DOCKER_FALLBACK_ROOTFUL" != "false" ]]; then
    install_rootful_docker_ce && finish_rootful_ok
    install_rootful_docker_io && finish_rootful_ok || true
  fi
  warn "Rootful-only path did not yield a working docker — fix packages or CT/VM config."
  exit 0
fi

info "Docker CE apt repository (${DOCKER_APT_DISTRO}, ${OS_CODENAME})"
ensure_docker_ce_repo

info "Install docker-ce-cli and docker-ce-rootless-extras"
if ! install_docker_ce_cli_rootless; then
  warn "docker-ce-cli / rootless-extras install failed — attempting rootful fallback (Docker CE repo kept)"
  if [[ "$HP_DOCKER_FALLBACK_ROOTFUL" == "true" ]]; then
    install_rootful_docker_ce && finish_rootful_ok
    install_rootful_docker_io && finish_rootful_ok || true
  fi
  warn "Could not install Docker packages from Docker CE repo."
  exit 0
fi

SETUPTOOL="$(command -v dockerd-rootless-setuptool.sh || command -v dockerd-rootless-setuptool || true)"
if [[ -z "$SETUPTOOL" || ! -x "$SETUPTOOL" ]]; then
  warn "dockerd-rootless-setuptool.sh missing after package install"
  if [[ "$HP_DOCKER_FALLBACK_ROOTFUL" == "true" ]]; then
    install_rootful_docker_ce && finish_rootful_ok
    install_rootful_docker_io && finish_rootful_ok || true
  fi
  exit 0
fi

info "Enable lingering for user hostpanel (rootless daemon survives logout)"
loginctl enable-linger hostpanel 2>/dev/null || warn "loginctl enable-linger failed (non-systemd?)"

RUN_DIR="/run/user/${HP_UID}"
mkdir -p "$RUN_DIR"
chown "hostpanel:hostpanel" "$RUN_DIR"
chmod 700 "$RUN_DIR"

info "Install rootless Docker daemon (dockerd-rootless-setuptool)"
set +e
runuser -u hostpanel -- env \
  HOME=/var/lib/hostpanel \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  "$SETUPTOOL" install --force
ST=$?
set -e
if [[ $ST -ne 0 ]]; then warn "dockerd-rootless-setuptool install exited $ST — see https://rootlesscontaine.rs/getting-started/common/"; fi

info "Start rootless Docker (user systemd)"
runuser -u hostpanel -- env XDG_RUNTIME_DIR="$RUN_DIR" systemctl --user daemon-reload 2>/dev/null || true
runuser -u hostpanel -- env XDG_RUNTIME_DIR="$RUN_DIR" systemctl --user enable --now docker.service 2>/dev/null || true

sleep 2

if verify_docker_rootless_sock; then
  ok "Rootless Docker is reachable at unix:///run/user/${HP_UID}/docker.sock"
  finish_rootless_ok "$HP_UID"
fi

warn "Rootless Docker did not become ready (common in LXC: newuidmap / user namespaces blocked)."

if [[ "$HP_DOCKER_FALLBACK_ROOTFUL" == "true" ]]; then
  if install_rootful_docker_ce; then
    finish_rootful_ok
  fi
  if install_rootful_docker_io; then
    finish_rootful_ok
  fi
fi

warn "No working Docker — set HP_DOCKER_ROOTFUL_ONLY=true on LXC, or fix VM/CT idmaps for rootless; see rootlesscontainers docs."
exit 0
