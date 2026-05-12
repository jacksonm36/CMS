#!/usr/bin/env bash
# Regenerate hostpanel-api / hostpanel-web systemd units (matches install.sh §12).
# Run as root after changing Node paths or HostPanel install directory.
# Usage: sudo HP_INSTALL_DIR=/opt/hostpanel bash scripts/refresh-systemd-units.sh [--restart]

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }

HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}"
RESTART="${1:-}"

NODE_BIN="$(command -v node)"
NEXT_BIN="${HP_INSTALL_DIR}/node_modules/next/dist/bin/next"
TSX_LOADER="${HP_INSTALL_DIR}/node_modules/tsx/dist/loader.mjs"

[[ -x "$NODE_BIN" ]] || { echo "node not found in PATH" >&2; exit 1; }
[[ -f "$NEXT_BIN" ]] || { echo "Missing Next.js CLI: $NEXT_BIN" >&2; exit 1; }
[[ -f "$TSX_LOADER" ]] || { echo "Missing tsx loader: $TSX_LOADER" >&2; exit 1; }

SUDOERS_SRC="${HP_INSTALL_DIR}/deploy/hostpanel.sudoers"
if [[ -f "$SUDOERS_SRC" ]]; then
  install -m 440 -o root -g root "$SUDOERS_SRC" /etc/sudoers.d/hostpanel
  echo "Updated /etc/sudoers.d/hostpanel"
fi

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
ExecStart=${NODE_BIN} --import ${TSX_LOADER} dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hostpanel-api

# Must allow sudo/apt for web server installs (NoNewPrivileges breaks sudo entirely).
# ProtectSystem=full keeps /etc read-only for all processes in this unit, including sudo→apt.
NoNewPrivileges=false
ProtectSystem=false
PrivateTmp=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

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
echo "Wrote /etc/systemd/system/hostpanel-api.service and hostpanel-web.service"

if [[ "$RESTART" == "--restart" ]]; then
  systemctl restart hostpanel-api hostpanel-web
  echo "Restarted hostpanel-api hostpanel-web"
fi
