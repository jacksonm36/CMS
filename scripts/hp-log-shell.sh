#!/usr/bin/env bash
# HostPanel — run a read-only log tail pipeline as root (sudoers-whitelisted).
# Usage: hp-log-shell.sh '<inner shell>'
set -euo pipefail

inner="${1:-}"
[[ -n "$inner" ]] || exit 1
[[ "$inner" != *".."* ]] || exit 1

# Block command substitution / subshells (allow stderr redirect to /dev/null only)
sanitized="${inner//2>\/dev\/null/}"
case "$sanitized" in
  *\`*) exit 1 ;;
  *\$\(* ) exit 1 ;;
  *">"*) exit 1 ;;
esac

for bad in rm mv cp curl wget chmod chown sudo tee dd python perl node; do
  if [[ "$inner" =~ (^|[;&|[:space:]])${bad}([[:space:]]|;|$) ]]; then
    exit 1
  fi
done

ALLOWED_PREFIXES=(/var/log/ /usr/local/lsws/logs/)

for path in $(printf '%s\n' "$inner" | grep -oE '/[a-zA-Z0-9][a-zA-Z0-9/_.+*-]*' || true); do
  [[ "$path" == "/dev/null" ]] && continue
  ok=0
  for pre in "${ALLOWED_PREFIXES[@]}"; do
    if [[ "$path" == "$pre"* ]]; then
      ok=1
      break
    fi
  done
  [[ "$ok" -eq 1 ]] || exit 1
done

# Pipe script to bash -s so $variables in loop bodies are not expanded here
{
  printf '%s\n' 'set +e'
  printf '%s\n' "$inner"
  printf '%s\n' 'true'
} | exec bash -s
