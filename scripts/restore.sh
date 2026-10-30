#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "${SCRIPT_DIR}/deploy-common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/restore.sh --from-backup DIR [options]

Perform an explicit downtime restore of Content Hub configuration, both
PostgreSQL databases, and uploads from one update backup.

Options:
  --from-backup DIR        Backup directory created by update.sh (required)
  --mode server|traefik    Deployment mode (default: backup manifest/.env)
  --compose-override FILE  Additional Compose file for an isolated restore
  --base-url URL           Public/frontend URL used by server-mode health checks
  --yes                    Required for non-interactive execution
  --no-health-check        Skip the final stack health check
  -h, --help               Show this help
USAGE
}

BACKUP_DIR=""
MODE=""
COMPOSE_OVERRIDE=""
BASE_URL=""
YES=0
HEALTH_CHECK=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-backup) BACKUP_DIR="$2"; shift 2 ;;
    --from-backup=*) BACKUP_DIR="${1#*=}"; shift ;;
    --mode) MODE="$2"; shift 2 ;;
    --mode=*) MODE="${1#*=}"; shift ;;
    --compose-override) COMPOSE_OVERRIDE="$2"; shift 2 ;;
    --compose-override=*) COMPOSE_OVERRIDE="${1#*=}"; shift ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --base-url=*) BASE_URL="${1#*=}"; shift ;;
    --yes) YES=1; shift ;;
    --no-health-check) HEALTH_CHECK=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) ch_die "Unknown option: $1" ;;
  esac
done

[[ -n "$BACKUP_DIR" ]] || ch_die "--from-backup DIR is required"
[[ -d "$BACKUP_DIR" ]] || ch_die "Backup directory not found: $BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
[[ "$BACKUP_DIR" != "/" ]] || ch_die "Refusing to use filesystem root as a backup"

APP_DUMP="content-hub-db.dump"
[[ -f "${BACKUP_DIR}/${APP_DUMP}" ]] || APP_DUMP="content-pool-db.dump"
for file in manifest.txt config.tgz "$APP_DUMP" keycloak-db.dump uploads.tgz SHA256SUMS; do
  [[ -f "${BACKUP_DIR}/${file}" ]] || ch_die "Incomplete backup: ${file} is missing"
done

if [[ -z "$MODE" ]]; then
  MODE="$(awk -F= '$1 == "mode" { print $2 }' "${BACKUP_DIR}/manifest.txt" | tail -n 1)"
fi
[[ -n "$MODE" ]] || MODE="$(ch_detect_mode .env)"
ch_validate_mode "$MODE"
ch_require_docker_compose
ch_require_cmd python3
ch_set_compose_args "$MODE" "$COMPOSE_OVERRIDE"
ch_verify_sha256s "$BACKUP_DIR" || ch_die "Backup checksum validation failed"
ch_validate_tar_archive "${BACKUP_DIR}/config.tgz" || ch_die "Unsafe configuration archive"
ch_validate_tar_archive "${BACKUP_DIR}/uploads.tgz" || ch_die "Unsafe uploads archive"

if [[ "$YES" -eq 0 ]]; then
  [[ -t 0 && -t 1 ]] || ch_die "Non-interactive restore requires --yes"
  printf 'This will replace configuration, both databases, and uploads from:\n  %s\nContinue? [y/N]: ' "$BACKUP_DIR"
  read -r answer
  [[ "$answer" =~ ^([yY]|yes|YES)$ ]] || ch_die "Restore aborted"
fi

ch_info "Stopping public and application services"
ch_compose stop nginx content-hub-api keycloak || true

ch_info "Restoring runtime configuration"
tar -xzf "${BACKUP_DIR}/config.tgz" -C .
ch_reconcile_provider_archive "${BACKUP_DIR}/config.tgz"
ch_set_compose_args "$MODE" "$COMPOSE_OVERRIDE"
ch_info "Waiting for both restore databases to become ready"
ch_compose up -d --wait --wait-timeout 120 \
  content-hub-db keycloak-db

restore_database() {
  local service="$1" user="$2" database="$3" dump="$4" container
  container="$(ch_compose_container_id "$service")" || ch_die "Restore service is unavailable: $service"
  docker exec -i "$container" pg_restore --list < "$dump" >/dev/null || \
    ch_die "Invalid PostgreSQL custom dump: $dump"
  ch_info "Restoring ${database} in ${service} with pg_restore"
  docker exec -i "$container" pg_restore \
    --clean --if-exists --no-owner --no-privileges --exit-on-error \
    -U "$user" -d "$database" < "$dump"
}

restore_database content-hub-db \
  "$(ch_env_get .env POSTGRES_USER)" \
  "$(ch_env_get .env POSTGRES_DB)" \
  "${BACKUP_DIR}/${APP_DUMP}"
restore_database keycloak-db \
  "$(ch_env_get .env KEYCLOAK_DB_USER)" \
  "$(ch_env_get .env KEYCLOAK_DB_NAME)" \
  "${BACKUP_DIR}/keycloak-db.dump"

expected_keycloak_users="$(awk -F= '$1 == "keycloak_users_before" { print $2 }' \
  "${BACKUP_DIR}/manifest.txt" | tail -n 1)"
if [[ -n "$expected_keycloak_users" ]]; then
  keycloak_realm="$(awk -F= '$1 == "keycloak_realm" { print $2 }' \
    "${BACKUP_DIR}/manifest.txt" | tail -n 1)"
  keycloak_realm="${keycloak_realm:-iqb}"
  keycloak_db_container="$(ch_compose_container_id keycloak-db)" || ch_die "keycloak-db is unavailable"
  restored_keycloak_users="$(docker exec -i "$keycloak_db_container" psql -qAt -v ON_ERROR_STOP=1 \
    -v realm_name="$keycloak_realm" \
    -U "$(ch_env_get_default .env KEYCLOAK_DB_USER keycloak)" \
    -d "$(ch_env_get_default .env KEYCLOAK_DB_NAME keycloak)" <<'SQL'
select count(*)
from user_entity u
join realm r on r.id = u.realm_id
where r.name = :'realm_name';
SQL
  )"
  restored_keycloak_users="${restored_keycloak_users//[[:space:]]/}"
  [[ "$restored_keycloak_users" == "$expected_keycloak_users" ]] || \
    ch_die "Restored Keycloak user count ${restored_keycloak_users} differs from backup ${expected_keycloak_users}"
  ch_info "Verified ${restored_keycloak_users} restored Keycloak users"
fi

ch_info "Restoring uploads volume"
ch_compose run --rm --no-deps -T \
  --entrypoint sh content-hub-api \
  -c 'find /app/uploads -mindepth 1 -delete && tar -xzf - -C /app' \
  < "${BACKUP_DIR}/uploads.tgz"

ch_compose config >/dev/null
ch_info "Waiting for the restored application stack to become ready"
ch_compose up -d --wait --wait-timeout 180

if [[ "$HEALTH_CHECK" -eq 1 ]]; then
  release="$(ch_env_get .env APPLICATION_VERSION)"
  commit="$(ch_env_get .env RELEASE_COMMIT)"
  if [[ -n "$BASE_URL" ]]; then
    ./scripts/check-health.sh "$MODE" "$(ch_env_get .env OIDC_PUBLIC_ISSUER_URL)" \
      "${BASE_URL%/}/api" "${BASE_URL%/}" "$release" "$commit"
  elif [[ "$MODE" == "traefik" ]]; then
    host="$(ch_env_get .env CONTENT_HUB_HOST)"
    ./scripts/check-health.sh "$MODE" "$(ch_env_get .env OIDC_PUBLIC_ISSUER_URL)" \
      "https://${host}/api" "https://${host}" "$release" "$commit"
  else
    ./scripts/check-health.sh "$MODE" "$(ch_env_get .env OIDC_PUBLIC_ISSUER_URL)" \
      http://localhost/api http://localhost "$release" "$commit"
  fi
fi

ch_info "Downtime restore complete from ${BACKUP_DIR}"
