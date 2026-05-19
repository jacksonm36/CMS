#!/usr/bin/env bash
# Add the HostPanel service user to group "adm" so the API can tail standard daemon logs
# (e.g. /var/log/nginx/error.log — typically root:adm, mode 0640 on Debian/Ubuntu).
#
# Run as root after install or if log tail shows: Permission denied
#   sudo HP_SERVICE_USER=hostpanel bash scripts/ensure-hostpanel-adm-log-access.sh
#   sudo systemctl restart hostpanel-api hostpanel-web
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }

U="${HP_SERVICE_USER:-hostpanel}"
getent passwd "$U" &>/dev/null || { echo "No such user: $U (set HP_SERVICE_USER)" >&2; exit 1; }
getent group adm &>/dev/null || { echo "No group 'adm' on this system — set log ACLs or permissions manually." >&2; exit 1; }

if id -nG "$U" | tr " " "\n" | grep -qx adm; then
  echo "User $U is already in group adm."
else
  usermod -a -G adm "$U"
  echo "Added $U to group adm."
fi
echo "Restart panel services so the new group is applied: systemctl restart hostpanel-api hostpanel-web"
