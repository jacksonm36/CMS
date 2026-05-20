#!/bin/bash
# Deprecated wrapper — use provision-cms-install.sh <root> <profile>
set -euo pipefail
exec /opt/hostpanel/scripts/provision-cms-install.sh "${1:?}" "drupal"
