#!/bin/bash
# HostPanel — post-install CMS prep: secure DB loader, config inject, www-data writables.
# Usage: provision-cms-install.sh <site-root> <profile>
set -euo pipefail

ROOT="${1:?site root}"
PROFILE="${2:?cms profile (drupal|wordpress|moodle|...)}"
LOADER_SRC="/opt/hostpanel/scripts/hostpanel-load-db.php"
LOADER_DST="${ROOT}/.hostpanel-load-db.php"
ENV_FILE="${ROOT}/.hostpanel-db.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "skip: no .hostpanel-db.env" >&2
  exit 0
fi

install_loader() {
  cp "$LOADER_SRC" "$LOADER_DST"
  chown hostpanel:www-data "$LOADER_DST"
  chmod 640 "$LOADER_DST"
  # www-data (php-fpm) must read this during CMS install; not web-served (docroot is web/).
  chown hostpanel:www-data "$ENV_FILE"
  chmod 640 "$ENV_FILE"
}

www_data_dir() {
  local d="$1"
  [[ -d "$d" ]] || mkdir -p "$d"
  chown -R hostpanel:www-data "$d"
  chmod -R g+rwX "$d"
  find "$d" -type d -exec chmod g+s {} \; 2>/dev/null || true
}

www_data_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  chown hostpanel:www-data "$f"
  chmod g+rw "$f"
}

install_loader
/usr/bin/php /opt/hostpanel/scripts/cms-db-inject.php "$ROOT" "$PROFILE"

if [[ "$PROFILE" == "drupal" && -x /opt/hostpanel/scripts/optimize-drupal-site.sh ]]; then
  /opt/hostpanel/scripts/optimize-drupal-site.sh "$ROOT" || true
fi

echo "provision-cms-install: profile=${PROFILE} root=${ROOT}"
