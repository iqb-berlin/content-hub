#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT="${1:-}"
[[ -n "$OUTPUT" ]] || {
  printf 'Usage: scripts/build-runtime-bundle.sh OUTPUT.tar.gz\n' >&2
  exit 1
}

case "$OUTPUT" in
  /*) ;;
  *) OUTPUT="${PWD}/${OUTPUT}" ;;
esac

mkdir -p "$(dirname "$OUTPUT")"
cd "$ROOT_DIR"

files=(
  VERSION
  CHANGELOG.md
  RELEASE_CHECKLIST.md
  docs/operations/content-hub-branding.md
  .env.example
  docker-compose.server.yml
  docker-compose.traefik.yml
  nginx.server.conf
  keycloak
  scripts/check-health.sh
  scripts/build-keycloak-altcha.sh
  scripts/configure-keycloak-registration.sh
  scripts/configure-keycloak-registration-db.sh
  scripts/configure-keycloak-smtp.sh
  scripts/configure-hu-postfix-relay.sh
  scripts/init-keycloak.sh
  scripts/deploy-common.sh
  scripts/install.sh
  scripts/update.sh
  scripts/restore.sh
  scripts/release_manifest.py
  scripts/make/server.mk
)

for path in "${files[@]}"; do
  [[ -e "$path" ]] || {
    printf 'Required runtime artifact is missing: %s\n' "$path" >&2
    exit 1
  }
done

tar -czf "$OUTPUT" "${files[@]}"
printf '%s\n' "$OUTPUT"
