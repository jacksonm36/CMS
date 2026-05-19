#!/usr/bin/env bash
# Load only allowlisted MAXMIND_* keys from a file (no shell execution), then run download-geolite2-country.sh.
# Usage: run-geolite2-download-with-env-file.sh [/path/to/geolite2-maxmind.env]
set -euo pipefail
shopt -s extglob

ENV_FILE="${1:-${GEOLITE_ENV:-/etc/hostpanel/geolite2-maxmind.env}}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DL="${SCRIPT_DIR}/download-geolite2-country.sh"

[[ -f "$ENV_FILE" ]] || { echo "error: env file not found: $ENV_FILE" >&2; exit 1; }
[[ -f "$DL" ]] || { echo "error: missing $DL" >&2; exit 1; }

strip_outer_quotes() {
  local v="$1"
  if [[ ${#v} -ge 2 ]]; then
    if [[ "$v" == \"*\" ]]; then v="${v#\"}"; v="${v%\"}"; fi
    if [[ "$v" == \'*\' ]]; then v="${v#\'}"; v="${v%\'}"; fi
  fi
  printf '%s' "$v"
}

unset MAXMIND_ACCOUNT_ID MAXMIND_LICENSE_KEY MAXMIND_GEOLITE2_DIR 2>/dev/null || true

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  line="${line##+([[:space:]])}"
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line//[[:space:]]/}" ]] && continue
  (( ${#line} <= 4096 )) || { echo "error: line too long in $ENV_FILE" >&2; exit 1; }

  case "$line" in
    MAXMIND_ACCOUNT_ID=*)
      MAXMIND_ACCOUNT_ID="$(strip_outer_quotes "${line#MAXMIND_ACCOUNT_ID=}")"
      ;;
    MAXMIND_LICENSE_KEY=*)
      MAXMIND_LICENSE_KEY="$(strip_outer_quotes "${line#MAXMIND_LICENSE_KEY=}")"
      ;;
    MAXMIND_GEOLITE2_DIR=*)
      MAXMIND_GEOLITE2_DIR="$(strip_outer_quotes "${line#MAXMIND_GEOLITE2_DIR=}")"
      ;;
    MAXMIND_*=*)
      echo "error: unsupported key in $ENV_FILE (only MAXMIND_ACCOUNT_ID, MAXMIND_LICENSE_KEY, MAXMIND_GEOLITE2_DIR)" >&2
      exit 1
      ;;
  esac
done <"$ENV_FILE"

export MAXMIND_ACCOUNT_ID MAXMIND_LICENSE_KEY
[[ -n "${MAXMIND_GEOLITE2_DIR:-}" ]] && export MAXMIND_GEOLITE2_DIR

exec /bin/bash "$DL"
