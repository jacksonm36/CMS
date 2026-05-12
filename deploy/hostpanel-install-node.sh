#!/usr/bin/env bash
# HostPanel — install or refresh Node.js on the host (invoked via sudo by hostpanel API).
# Usage: hostpanel-install-node.sh <profile>
# Profiles: distro | ns18 | ns20 | ns22 | ns24
set -euo pipefail

PROFILE="${1:?usage: hostpanel-install-node.sh distro|ns18|ns20|ns22|ns24}"
APT="/usr/bin/apt-get"

export DEBIAN_FRONTEND=noninteractive

case "$PROFILE" in
  distro)
    echo "[hostpanel] Installing Node.js from distribution repositories (nodejs, npm)…"
    $APT update -qq
    $APT install -y nodejs npm
    ;;
  ns18|ns20|ns22|ns24)
    MAJOR="${PROFILE#ns}"
    echo "[hostpanel] NodeSource setup for Node.js ${MAJOR}.x …"
    if ! command -v curl >/dev/null 2>&1; then
      $APT update -qq
      $APT install -y curl ca-certificates gnupg
    fi
    curl -fsSL "https://deb.nodesource.com/setup_${MAJOR}.x" | bash -
    $APT update -qq
    $APT install -y nodejs
    npm install -g npm@latest 2>/dev/null || true
    ;;
  *)
    echo "Unknown profile: $PROFILE" >&2
    exit 1
    ;;
esac

echo "[hostpanel] Result:"
command -v node >/dev/null && node -v || { echo "node not found" >&2; exit 1; }
command -v npm >/dev/null && npm -v || echo "[hostpanel] npm not on PATH"
