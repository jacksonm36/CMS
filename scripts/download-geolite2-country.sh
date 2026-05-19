#!/usr/bin/env bash
# Download GeoLite2-Country (tar.gz) from MaxMind using Basic auth.
# Requires: MAXMIND_ACCOUNT_ID, MAXMIND_LICENSE_KEY
# Optional: MAXMIND_GEOLITE2_DIR (default /var/lib/GeoIP) — writes GeoLite2-Country.mmdb there.
# Twice-daily cron: sudo bash scripts/install-geolite2-cron.sh (uses run-geolite2-download-with-env-file.sh).
set -euo pipefail
umask 022

: "${MAXMIND_ACCOUNT_ID:?Set MAXMIND_ACCOUNT_ID}"
: "${MAXMIND_LICENSE_KEY:?Set MAXMIND_LICENSE_KEY}"

resolve_path() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1"
  else
    readlink -f "$1"
  fi
}

OUT_DIR="${MAXMIND_GEOLITE2_DIR:-/var/lib/GeoIP}"
mkdir -p "$OUT_DIR"
OUT_DIR_REAL=$(resolve_path "$OUT_DIR")

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
TMP_REAL=$(resolve_path "$TMP")

URL='https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz'
curl -fsSL -L -u "${MAXMIND_ACCOUNT_ID}:${MAXMIND_LICENSE_KEY}" "$URL" -o "$TMP/geo.tar.gz"

if ! gzip -t "$TMP/geo.tar.gz" 2>/dev/null; then
  echo "error: download is not a valid gzip file (wrong URL, credentials, or HTML error body)" >&2
  exit 1
fi

if tar -tzf "$TMP/geo.tar.gz" | grep -qE '(^|/)\\.\\./|^/'; then
  echo "error: tarball contains unsafe path components" >&2
  exit 1
fi

tar -xzf "$TMP/geo.tar.gz" -C "$TMP"

MMDB=$(find "$TMP" -maxdepth 6 -name 'GeoLite2-Country.mmdb' -print -quit)
if [[ -z "$MMDB" ]]; then
  echo "error: GeoLite2-Country.mmdb not found in archive" >&2
  exit 1
fi
MMDB_REAL=$(resolve_path "$MMDB")
if [[ "$MMDB_REAL" != "$TMP_REAL"/* ]]; then
  echo "error: unexpected path inside archive (refusing path traversal)" >&2
  exit 1
fi

FINAL="${OUT_DIR}/GeoLite2-Country.mmdb"
STAGE="${OUT_DIR}/.GeoLite2-Country.mmdb.$$"
cp -f -- "$MMDB" "$STAGE" || exit 1
if ! mv -f -- "$STAGE" "$FINAL"; then
  rm -f "$STAGE"
  exit 1
fi
chmod 644 -- "$FINAL" 2>/dev/null || true
FINAL_REAL=$(resolve_path "$FINAL")
case "$FINAL_REAL" in
"$OUT_DIR_REAL"/*) ;;
*)
  echo "error: install path left output directory" >&2
  exit 1
  ;;
esac

echo "Installed ${FINAL}"
echo "Set MAXMIND_GEOLITE2_COUNTRY_PATH=${FINAL} for the API (hostpanel-api reloads the file when its mtime changes)."
