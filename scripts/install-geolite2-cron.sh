#!/usr/bin/env bash
# Install /etc/cron.d/hostpanel-geolite2: refresh GeoLite2-Country.mmdb twice daily (MaxMind direct download).
# Requires /etc/hostpanel/geolite2-maxmind.env — copy from deploy/geolite2-maxmind.env.example and chmod 600.
# Cron invokes run-geolite2-download-with-env-file.sh (allowlisted keys only; does not source the file as shell).
# Remove: sudo rm /etc/cron.d/hostpanel-geolite2
#
# Usage: sudo HP_INSTALL_DIR=/opt/hostpanel bash scripts/install-geolite2-cron.sh

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }

HP_INSTALL_DIR="${HP_INSTALL_DIR:-/opt/hostpanel}"
GEOLITE_ENV="${GEOLITE_ENV:-/etc/hostpanel/geolite2-maxmind.env}"
CRON_PATH="/etc/cron.d/hostpanel-geolite2"
LOG_PATH="${GEOLITE_CRON_LOG:-/var/log/hostpanel-geolite2.log}"
DL="${HP_INSTALL_DIR}/scripts/download-geolite2-country.sh"
WRAPPER="${HP_INSTALL_DIR}/scripts/run-geolite2-download-with-env-file.sh"

cron_safe_literal() {
  local v="$1"
  if [[ "$v" == *$'\n'* || "$v" == *$'\r'* ]]; then return 1; fi
  if [[ "$v" == *[\"\$\`]* || "$v" == *[\;\|\&]* ]]; then return 1; fi
  return 0
}

cron_safe_literal "$HP_INSTALL_DIR" || { echo "HP_INSTALL_DIR has unsafe characters for cron" >&2; exit 1; }
cron_safe_literal "$GEOLITE_ENV" || { echo "GEOLITE_ENV has unsafe characters for cron" >&2; exit 1; }
cron_safe_literal "$LOG_PATH" || { echo "GEOLITE_CRON_LOG has unsafe characters for cron" >&2; exit 1; }

[[ -f "$DL" ]] || { echo "Missing download script: $DL" >&2; exit 1; }
[[ -f "$WRAPPER" ]] || { echo "Missing env wrapper: $WRAPPER" >&2; exit 1; }
[[ -f "$GEOLITE_ENV" ]] || {
  echo "Missing $GEOLITE_ENV" >&2
  echo "Copy deploy/geolite2-maxmind.env.example to that path, fill MAXMIND_* , chmod 600, then re-run." >&2
  exit 1
}

install -d -m 0755 -o root -g root /etc/hostpanel

cat > "$CRON_PATH" <<EOF
# HostPanel — GeoLite2-Country.mmdb (MaxMind), twice daily. Env file (allowlisted keys only): ${GEOLITE_ENV}
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

17 4,16 * * * root /bin/bash "${WRAPPER}" "${GEOLITE_ENV}" >>"${LOG_PATH}" 2>&1
EOF
chmod 0644 "$CRON_PATH"
chown root:root "$CRON_PATH"

echo "Installed $CRON_PATH (04:17 and 16:17 server local time)."
echo "Log: $LOG_PATH"
echo "Ensure hostpanel-api has MAXMIND_GEOLITE2_COUNTRY_PATH set to the .mmdb under MAXMIND_GEOLITE2_DIR."
