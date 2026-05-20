#!/bin/bash
# HostPanel — Drupal performance tuning (run after install; needs drush in site vendor).
# Usage: optimize-drupal-site.sh <site-root>
set -euo pipefail

ROOT="${1:?site root}"
WEB="${ROOT}/web"
DRUSH="${ROOT}/vendor/bin/drush"

if [[ ! -x "$DRUSH" ]]; then
  echo "skip: no vendor/bin/drush at ${ROOT}" >&2
  exit 0
fi

cd "$WEB"
sudo -u www-data "$DRUSH" config:set system.performance cache.page.max_age 3600 -y
sudo -u www-data "$DRUSH" config:set system.performance css.preprocess true -y
sudo -u www-data "$DRUSH" config:set system.performance js.preprocess true -y
sudo -u www-data "$DRUSH" config:set system.performance response.gzip true -y
sudo -u www-data "$DRUSH" config:set system.performance fast_404.enabled true -y
# Avoid multi-minute search index on empty sites during automated cron
sudo -u www-data "$DRUSH" config:set search.settings index.cron_limit 25 -y 2>/dev/null || true
sudo -u www-data "$DRUSH" cache:rebuild -y
echo "optimize-drupal-site: done root=${ROOT}"
