#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
COMMON_SH="${SCRIPT_DIR}/deploy-common.sh"
[[ -f "$COMMON_SH" ]] || {
  printf 'Error: scripts/deploy-common.sh is required next to update.sh\n' >&2
  exit 1
}
. "$COMMON_SH"

usage() {
  cat <<'USAGE'
Usage: scripts/update.sh [options]

Deploy a verified Content Hub release with backups, digest pinning, health and
version checks, and application-only rollback.

Options:
  --mode server|traefik             Deployment mode (default: detect from .env)
  --environment staging|production  Target environment (default: .env)
  --release VERSION                 Release or candidate to deploy
  --manifest FILE|URL               Alternate release-manifest.json source
  --rollback-to VERSION             Explicitly permit a downgrade to VERSION
  --adopt-current VERSION           Pin currently running legacy images as a baseline
  --compose-override FILE           Additional Compose file for an isolated deployment
  --base-url URL                    Public/frontend URL used by server-mode health checks
  --backup-dir DIR                  Backup root (default: ./backups)
  --no-backup                       Skip backups (intentional maintenance only)
  --allow-incomplete-backup         Continue if a backup source is not running
  --backup-only                     Create a complete backup and exit
  --keycloak-realm REALM            Realm for user-count verification (default: iqb)
  --no-keycloak-user-check          Skip Keycloak user-count verification
  --no-pull                         Skip docker compose pull
  --no-health-check                 Skip post-update health/version checks
  --repo OWNER/REPO                 Release repository
  --yes                             Do not prompt
  --dry-run                         Validate arguments and print planned actions
  -h, --help                        Show this help
USAGE
}

is_tty() { [[ -t 0 && -t 1 ]]; }

run_compose() {
  ch_compose "$@"
}

running_image_digest() {
  local container="$1"
  local image_id repo_digest
  image_id="$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null)" || return 1
  repo_digest="$(docker image inspect "$image_id" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null | head -n 1)"
  [[ "$repo_digest" =~ @sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$repo_digest"
}

running_service_image_digest() {
  local service="$1" container
  container="$(ch_compose_container_id "$service")" || return 1
  running_image_digest "$container"
}

write_digest_override() {
  local output="$1" backend="$2" frontend="$3"
  local service
  service="$(ch_compose_service_name content-hub-api)" || return 1
  cat >"$output" <<YAML
services:
  ${service}:
    image: ${backend}
  nginx:
    image: ${frontend}
YAML
}

validate_env_safety() {
  local key value failures=0
  [[ "$(ch_env_get .env DB_SYNCHRONIZE)" != "true" ]] || \
    ch_die "DB_SYNCHRONIZE=true is unsafe for managed deployments"
  if [[ "$(ch_env_get .env DB_RUN_MIGRATIONS)" != "true" ]]; then
    ch_warn "DB_RUN_MIGRATIONS is not true; schema migrations will not run"
  fi
  for key in CORS_ORIGIN OIDC_PUBLIC_ISSUER_URL OIDC_REDIRECT_URI; do
    value="$(ch_env_get .env "$key")"
    if ch_env_is_placeholder "$value"; then
      ch_warn "${key} still looks like a placeholder (${value:-empty})"
      failures=$((failures + 1))
    fi
  done
  if [[ "$MODE" == "traefik" ]]; then
    for key in CONTENT_HUB_HOST CONTENT_HUB_AUTH_HOST KEYCLOAK_HOSTNAME; do
      value="$(ch_env_get .env "$key")"
      if ch_env_is_placeholder "$value"; then
        ch_warn "${key} still looks like a placeholder (${value:-empty})"
        failures=$((failures + 1))
      fi
    done
  fi
  [[ "$failures" -eq 0 ]] || ch_die "Refusing deployment with placeholder URL/OIDC values"
}

create_backup_dir() {
  local root="${1%/}" candidate suffix=1
  [[ ! -e "$root" || -d "$root" ]] || ch_die "Backup root is not a directory: $root"
  mkdir -m 700 -p "$root"
  candidate="${root}/update_$(date +%Y%m%d_%H%M%S)"
  while ! mkdir -m 700 "$candidate" 2>/dev/null; do
    candidate="${root}/update_$(date +%Y%m%d_%H%M%S)_${suffix}"
    suffix=$((suffix + 1))
  done
  printf '%s' "$candidate"
}

backup_database() {
  local service="$1" user="$2" database="$3" output="$4" container
  if ch_compose_service_running "$service"; then
    container="$(ch_compose_container_id "$service")"
    ch_info "Backing up ${database} from ${service}"
    if ! docker exec "$container" pg_dump --format=custom -U "$user" "$database" > "$output"; then
      command rm -f "$output"
      ch_die "Database backup failed for ${service}/${database}"
    fi
    if ! docker exec -i "$container" pg_restore --list <"$output" >/dev/null; then
      command rm -f "$output"
      ch_die "Database backup validation failed for ${service}/${database}"
    fi
  elif [[ "$ALLOW_INCOMPLETE_BACKUP" -eq 0 ]]; then
    ch_die "Service ${service} is not running; backup would be incomplete"
  else
    ch_warn "Service ${service} is not running; database backup skipped"
  fi
}

keycloak_user_count() {
  local user="$1" database="$2" realm="$3" count container
  container="$(ch_compose_container_id keycloak-db)" || return 1
  count="$(docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 \
    -v realm_name="$realm" -U "$user" -d "$database" <<'SQL'
select count(*)
from user_entity u
join realm r on r.id = u.realm_id
where r.name = :'realm_name';
SQL
  )" || return 1
  count="${count//[[:space:]]/}"
  [[ "$count" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$count"
}

capture_keycloak_users() {
  [[ "$KEYCLOAK_USER_CHECK" -eq 1 ]] || return 0
  if ! ch_compose_service_running keycloak-db; then
    [[ "$ALLOW_INCOMPLETE_BACKUP" -eq 1 ]] || ch_die "keycloak-db is not running"
    ch_warn "Keycloak user check skipped because keycloak-db is not running"
    KEYCLOAK_USER_CHECK=0
    return 0
  fi
  KEYCLOAK_USERS_BEFORE="$(keycloak_user_count \
    "$(ch_env_get_default .env KEYCLOAK_DB_USER keycloak)" \
    "$(ch_env_get_default .env KEYCLOAK_DB_NAME keycloak)" \
    "$KEYCLOAK_REALM")" || ch_die "Could not count Keycloak users"
  export KEYCLOAK_USERS_BEFORE
}

write_backup_checksums() {
  local backup_dir="$1" path backup_files=(manifest.txt)
  for path in config.tgz content-hub-db.dump keycloak-db.dump uploads.tgz; do
    [[ -f "${backup_dir}/${path}" ]] && backup_files+=("$path")
  done
  ch_write_sha256s "$backup_dir" "${backup_files[@]}"
}

create_backup() {
  local backup_dir old_umask paths=() path api_container
  old_umask="$(umask)"
  umask 077
  backup_dir="$(create_backup_dir "$BACKUP_ROOT")"
  LAST_BACKUP_DIR="$backup_dir"
  for path in .env .release-manifest.json docker-compose.server.yml docker-compose.traefik.yml nginx.server.conf Makefile keycloak scripts; do
    [[ -e "$path" ]] && paths+=("$path")
  done
  [[ "${#paths[@]}" -eq 0 ]] || tar -czf "${backup_dir}/config.tgz" "${paths[@]}"
  backup_database content-hub-db \
    "$(ch_env_get_default .env POSTGRES_USER content_hub)" \
    "$(ch_env_get_default .env POSTGRES_DB content_hub)" \
    "${backup_dir}/content-hub-db.dump"
  backup_database keycloak-db \
    "$(ch_env_get_default .env KEYCLOAK_DB_USER keycloak)" \
    "$(ch_env_get_default .env KEYCLOAK_DB_NAME keycloak)" \
    "${backup_dir}/keycloak-db.dump"
  if ch_compose_service_running content-hub-api; then
    api_container="$(ch_compose_container_id content-hub-api)"
    docker exec "$api_container" tar -C /app -czf - uploads > "${backup_dir}/uploads.tgz" || \
      ch_die "Upload backup failed"
  elif [[ "$ALLOW_INCOMPLETE_BACKUP" -eq 0 ]]; then
    ch_die "content-hub-api is not running; upload backup would be incomplete"
  fi
  {
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'release=%s\n' "$(ch_env_get .env RELEASE_VERSION)"
    printf 'backend_image=%s\n' "${PREVIOUS_BACKEND_IMAGE:-}"
    printf 'frontend_image=%s\n' "${PREVIOUS_FRONTEND_IMAGE:-}"
    printf 'mode=%s\n' "$MODE"
    printf 'environment=%s\n' "$ENVIRONMENT"
    printf 'keycloak_realm=%s\n' "$KEYCLOAK_REALM"
    printf 'keycloak_users_before=%s\n' "${KEYCLOAK_USERS_BEFORE:-}"
  } > "${backup_dir}/manifest.txt"
  write_backup_checksums "$backup_dir"
  chmod 700 "$backup_dir"
  find "$backup_dir" -type f -exec chmod 600 {} \;
  umask "$old_umask"
  ch_info "Backup complete: ${backup_dir}"
}

write_deployment_record() {
  local status="$1" message="${2:-}" ended_at="" record
  mkdir -p deployments
  [[ "$status" == "started" ]] || ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record="${DEPLOYMENT_RECORD:-deployments/$(date -u +%Y%m%dT%H%M%SZ)-${TARGET_RELEASE//[^a-zA-Z0-9._-]/_}.json}"
  DEPLOYMENT_RECORD="$record"
  python3 - "$record" "$status" "$message" "$ENVIRONMENT" "$MODE" \
    "${PREVIOUS_RELEASE:-}" "$TARGET_RELEASE" "${PREVIOUS_BACKEND_IMAGE:-}" \
    "${TARGET_BACKEND_IMAGE:-}" "${PREVIOUS_FRONTEND_IMAGE:-}" \
    "${TARGET_FRONTEND_IMAGE:-}" "${LAST_BACKUP_DIR:-}" "$DEPLOYMENT_STARTED_AT" "$ended_at" <<'PY'
import json, os, sys
from pathlib import Path

(path, status, message, environment, mode, previous_release, target_release,
 previous_backend, target_backend, previous_frontend, target_frontend,
 backup, started_at, ended_at) = sys.argv[1:]
data = {
    "schemaVersion": 1,
    "status": status,
    "message": message,
    "environment": environment,
    "mode": mode,
    "operator": os.environ.get("SUDO_USER") or os.environ.get("USER") or "unknown",
    "startedAt": started_at,
    "endedAt": ended_at or None,
    "previous": {"release": previous_release or None, "backendImage": previous_backend or None, "frontendImage": previous_frontend or None},
    "target": {"release": target_release, "backendImage": target_backend or None, "frontendImage": target_frontend or None},
    "backupDirectory": backup or None,
    "checks": {
        "backup": os.environ.get("DEPLOY_CHECK_BACKUP", "not-run"),
        "compose": os.environ.get("DEPLOY_CHECK_COMPOSE", "not-run"),
        "imageDigests": os.environ.get("DEPLOY_CHECK_IMAGES", "not-run"),
        "start": os.environ.get("DEPLOY_CHECK_START", "not-run"),
        "healthAndVersion": os.environ.get("DEPLOY_CHECK_HEALTH", "not-run"),
        "keycloakUsers": os.environ.get("DEPLOY_CHECK_KEYCLOAK", "not-run"),
    },
    "keycloakUserCount": {
        "before": int(os.environ["KEYCLOAK_USERS_BEFORE"]) if os.environ.get("KEYCLOAK_USERS_BEFORE") else None,
        "after": int(os.environ["KEYCLOAK_USERS_AFTER"]) if os.environ.get("KEYCLOAK_USERS_AFTER") else None,
    },
}
Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
}

run_health_check() {
  local keycloak_url api_url frontend_url content_host
  [[ "$HEALTH_CHECK" -eq 1 ]] || return 0
  if [[ -n "$BASE_URL" ]]; then
    keycloak_url="$(ch_env_get .env OIDC_PUBLIC_ISSUER_URL)"
    api_url="${BASE_URL%/}/api"
    frontend_url="${BASE_URL%/}"
  elif [[ "$MODE" == "traefik" ]]; then
    content_host="$(ch_env_get .env CONTENT_HUB_HOST)"
    keycloak_url="$(ch_env_get .env OIDC_PUBLIC_ISSUER_URL)"
    api_url="https://${content_host}/api"
    frontend_url="https://${content_host}"
  else
    keycloak_url="$(ch_env_get .env OIDC_PUBLIC_ISSUER_URL)"
    api_url="http://localhost/api"
    frontend_url="http://localhost"
  fi
  ./scripts/check-health.sh "$MODE" "$keycloak_url" "$api_url" "$frontend_url" \
    "$TARGET_APPLICATION_VERSION" "$TARGET_COMMIT"
}

restore_previous_application() {
  local digest_override
  ch_warn "Restoring previous runtime files and image references; database migrations are not reverted"
  if [[ -n "$LAST_BACKUP_DIR" && -f "${LAST_BACKUP_DIR}/config.tgz" ]]; then
    run_compose stop content-hub-api content-hub-db >/dev/null 2>&1 || true
    tar -xzf "${LAST_BACKUP_DIR}/config.tgz" -C .
    ch_reconcile_provider_archive "${LAST_BACKUP_DIR}/config.tgz"
    ch_set_compose_args "$MODE" "$COMPOSE_OVERRIDE"
    digest_override="${LAST_BACKUP_DIR}/rollback-images.yml"
    write_digest_override "$digest_override" "$PREVIOUS_BACKEND_IMAGE" "$PREVIOUS_FRONTEND_IMAGE"
    CONTENT_HUB_COMPOSE_ARGS+=(-f "$digest_override")
    if run_compose up -d --wait --wait-timeout 180; then
      ch_warn "Previous application release restarted"
    else
      ch_warn "Previous application restart failed"
    fi
  else
    ch_warn "No configuration backup is available for automatic application rollback"
  fi
  run_compose stop nginx >/dev/null 2>&1 || true
}

fail_deployment() {
  local message="$1"
  restore_previous_application
  write_deployment_record failed "$message"
  DEPLOYMENT_ACTIVE=0
  ch_die "$message; inspect ${LAST_BACKUP_DIR:-the latest backup} before reopening traffic"
}

cleanup_update() {
  local status="$?"
  if [[ -n "${RELEASE_WORK_DIR:-}" && -d "$RELEASE_WORK_DIR" ]]; then
    command rm -rf "$RELEASE_WORK_DIR"
  fi
  if [[ "${DEPLOYMENT_ACTIVE:-0}" -eq 1 && "$status" -ne 0 ]]; then
    set +e
    write_deployment_record failed "Deployment aborted before completion"
  fi
  exit "$status"
}

adopt_current() {
  local baseline="$1" backend frontend compose_project api_container frontend_container
  local baseline_dir runtime_archive runtime_sha paths=() path
  [[ "$baseline" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || ch_die "--adopt-current requires stable vMAJOR.MINOR.PATCH"
  ch_compose_service_running content-hub-api || ch_die "content-hub-api is not running"
  ch_compose_service_running nginx || ch_die "nginx is not running"
  api_container="$(ch_compose_container_id content-hub-api)"
  frontend_container="$(ch_compose_container_id nginx)"
  backend="$(running_image_digest "$api_container")" || ch_die "Cannot resolve running backend RepoDigest"
  frontend="$(running_image_digest "$frontend_container")" || ch_die "Cannot resolve running frontend RepoDigest"
  compose_project="$(docker inspect "$api_container" \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null)" || \
    ch_die "Cannot determine the legacy Compose project"
  [[ -n "$compose_project" ]] || ch_die "Running backend has no Compose project label"
  ch_env_set .env DEPLOYMENT_ENV "$ENVIRONMENT"
  ch_env_set .env COMPOSE_PROJECT_NAME "$compose_project"
  ch_env_set .env RELEASE_VERSION "$baseline"
  ch_env_set .env APPLICATION_VERSION "${baseline#v}"
  ch_env_set .env RELEASE_COMMIT 0000000000000000000000000000000000000000
  ch_env_set .env RELEASE_BUILT_AT 1970-01-01T00:00:00Z
  ch_env_set .env CONTENT_HUB_BACKEND_IMAGE "$backend"
  ch_env_set .env CONTENT_HUB_FRONTEND_IMAGE "$frontend"

  baseline_dir="baselines/${baseline}"
  mkdir -m 700 -p deployments "$baseline_dir"
  for path in .env .release-manifest.json docker-compose.server.yml docker-compose.traefik.yml nginx.server.conf Makefile keycloak scripts; do
    [[ -e "$path" ]] && paths+=("$path")
  done
  runtime_archive="${baseline_dir}/runtime.tgz"
  tar -czf "$runtime_archive" "${paths[@]}"
  runtime_sha="$(ch_sha256_file "$runtime_archive")"
  python3 - "$baseline" "$ENVIRONMENT" "$compose_project" "$backend" "$frontend" "$runtime_sha" \
    > "${baseline_dir}/manifest.json" <<'PY'
import json
import sys

print(json.dumps({
    "schemaVersion": 1,
    "type": "legacy-baseline",
    "release": sys.argv[1],
    "environment": sys.argv[2],
    "composeProject": sys.argv[3],
    "images": {"backend": sys.argv[4], "frontend": sys.argv[5]},
    "runtime": {"archive": "runtime.tgz", "sha256": sys.argv[6]},
}, indent=2))
PY
  ch_write_sha256s "$baseline_dir" manifest.json runtime.tgz
  command cp -f "${baseline_dir}/manifest.json" "deployments/baseline-${baseline}.json"
  chmod 600 "${baseline_dir}"/* "deployments/baseline-${baseline}.json"
  ch_info "Adopted ${baseline} with immutable running image digests"
  ch_info "Baseline: ${baseline_dir}"
}

baseline_get() {
  local manifest="$1" field="$2"
  python3 - "$manifest" "$field" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

validate_local_baseline() {
  local baseline="$1" baseline_dir="baselines/${1}" manifest
  manifest="${baseline_dir}/manifest.json"
  [[ -f "$manifest" && -f "${baseline_dir}/runtime.tgz" ]] || return 1
  ch_verify_sha256s "$baseline_dir" || ch_die "Legacy baseline checksum validation failed"
  ch_validate_tar_archive "${baseline_dir}/runtime.tgz" || ch_die "Unsafe legacy baseline archive"
  python3 - "$manifest" "$baseline" "$ENVIRONMENT" <<'PY'
import json
import re
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
if data.get("schemaVersion") != 1 or data.get("type") != "legacy-baseline":
    raise SystemExit("invalid legacy baseline schema")
if data.get("release") != sys.argv[2] or data.get("environment") != sys.argv[3]:
    raise SystemExit("legacy baseline target mismatch")
if not data.get("composeProject"):
    raise SystemExit("legacy baseline compose project is missing")
images = data.get("images")
if not isinstance(images, dict) or set(images) != {"backend", "frontend"}:
    raise SystemExit("legacy baseline images are incomplete")
for image in images.values():
    if not isinstance(image, str) or not re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", image):
        raise SystemExit("legacy baseline image is not digest-pinned")
runtime = data.get("runtime", {})
if runtime.get("archive") != "runtime.tgz" or not re.fullmatch(r"[0-9a-f]{64}", str(runtime.get("sha256", ""))):
    raise SystemExit("invalid legacy baseline runtime metadata")
PY
}

rollback_local_baseline() {
  local baseline="$1" baseline_dir="baselines/${1}" manifest digest_override users_after
  manifest="${baseline_dir}/manifest.json"
  validate_local_baseline "$baseline" || ch_die "Local legacy baseline not found: ${baseline}"
  TARGET_RELEASE="$baseline"
  TARGET_APPLICATION_VERSION=""
  TARGET_COMMIT=""
  TARGET_BACKEND_IMAGE="$(baseline_get "$manifest" images.backend)"
  TARGET_FRONTEND_IMAGE="$(baseline_get "$manifest" images.frontend)"

  if [[ "$YES" -eq 0 ]] && is_tty; then
    printf 'Roll back application to local baseline %s? [y/N]: ' "$baseline"
    read -r answer
    [[ "$answer" =~ ^([yY]|yes|YES)$ ]] || ch_die "Rollback aborted"
  fi

  DEPLOYMENT_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  DEPLOYMENT_RECORD=""
  DEPLOYMENT_ACTIVE=1
  RELEASE_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/content-hub-rollback.XXXXXX")"
  write_deployment_record started
  trap cleanup_update EXIT
  capture_keycloak_users
  if [[ "$BACKUP" -eq 1 ]]; then
    create_backup
    export DEPLOY_CHECK_BACKUP=passed
  else
    export DEPLOY_CHECK_BACKUP=skipped
  fi

  tar -xzf "${baseline_dir}/runtime.tgz" -C .
  ch_reconcile_provider_archive "${baseline_dir}/runtime.tgz"
  ch_set_compose_args "$MODE" "$COMPOSE_OVERRIDE"
  digest_override="${RELEASE_WORK_DIR}/rollback-images.yml"
  write_digest_override "$digest_override" "$TARGET_BACKEND_IMAGE" "$TARGET_FRONTEND_IMAGE"
  CONTENT_HUB_COMPOSE_ARGS+=(-f "$digest_override")
  run_compose config >/dev/null || fail_deployment "Legacy baseline Compose validation failed"
  export DEPLOY_CHECK_COMPOSE=passed
  if [[ "$PULL" -eq 1 ]]; then
    run_compose pull || fail_deployment "Pulling legacy baseline images failed"
  fi
  docker image inspect "$TARGET_BACKEND_IMAGE" >/dev/null 2>&1 || fail_deployment "Legacy backend digest is unavailable"
  docker image inspect "$TARGET_FRONTEND_IMAGE" >/dev/null 2>&1 || fail_deployment "Legacy frontend digest is unavailable"
  export DEPLOY_CHECK_IMAGES=passed
  run_compose up -d --wait --wait-timeout 180 || \
    fail_deployment "Starting legacy baseline failed"
  export DEPLOY_CHECK_START=passed
  run_health_check || fail_deployment "Legacy baseline health check failed"
  export DEPLOY_CHECK_HEALTH=$([[ "$HEALTH_CHECK" -eq 1 ]] && printf passed || printf skipped)

  if [[ "$KEYCLOAK_USER_CHECK" -eq 1 ]]; then
    users_after="$(keycloak_user_count \
      "$(ch_env_get_default .env KEYCLOAK_DB_USER keycloak)" \
      "$(ch_env_get_default .env KEYCLOAK_DB_NAME keycloak)" \
      "$KEYCLOAK_REALM")" || fail_deployment "Could not count Keycloak users after rollback"
    (( users_after >= KEYCLOAK_USERS_BEFORE )) || fail_deployment "Keycloak user count decreased during rollback"
    KEYCLOAK_USERS_AFTER="$users_after"
    export KEYCLOAK_USERS_AFTER DEPLOY_CHECK_KEYCLOAK=passed
  else
    export DEPLOY_CHECK_KEYCLOAK=skipped
  fi
  write_deployment_record succeeded
  DEPLOYMENT_ACTIVE=0
  ch_info "Application rollback complete: ${baseline}; database migrations were not reverted"
  ch_info "Record: ${DEPLOYMENT_RECORD}"
}

MODE="${CONTENT_HUB_DEPLOY_MODE:-}"
ENVIRONMENT="${DEPLOYMENT_ENV:-}"
RELEASE=""
ROLLBACK_TO=""
ADOPT_CURRENT=""
MANIFEST_SOURCE=""
COMPOSE_OVERRIDE=""
BASE_URL=""
REPO="${CONTENT_HUB_REPO:-$CONTENT_HUB_REPO_DEFAULT}"
BACKUP_ROOT=backups
BACKUP=1
BACKUP_ONLY=0
ALLOW_INCOMPLETE_BACKUP=0
KEYCLOAK_REALM="${KEYCLOAK_REALM:-iqb}"
KEYCLOAK_USER_CHECK=1
KEYCLOAK_USERS_BEFORE=""
KEYCLOAK_USERS_AFTER=""
LAST_BACKUP_DIR=""
PULL=1
HEALTH_CHECK=1
YES=0
DRY_RUN=0
export DEPLOY_CHECK_BACKUP=not-run
export DEPLOY_CHECK_COMPOSE=not-run
export DEPLOY_CHECK_IMAGES=not-run
export DEPLOY_CHECK_START=not-run
export DEPLOY_CHECK_HEALTH=not-run
export DEPLOY_CHECK_KEYCLOAK=not-run

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --mode=*) MODE="${1#*=}"; shift ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --environment=*) ENVIRONMENT="${1#*=}"; shift ;;
    --release) RELEASE="$2"; shift 2 ;;
    --release=*) RELEASE="${1#*=}"; shift ;;
    --rollback-to) ROLLBACK_TO="$2"; shift 2 ;;
    --rollback-to=*) ROLLBACK_TO="${1#*=}"; shift ;;
    --adopt-current) ADOPT_CURRENT="$2"; shift 2 ;;
    --adopt-current=*) ADOPT_CURRENT="${1#*=}"; shift ;;
    --manifest) MANIFEST_SOURCE="$2"; shift 2 ;;
    --manifest=*) MANIFEST_SOURCE="${1#*=}"; shift ;;
    --compose-override) COMPOSE_OVERRIDE="$2"; shift 2 ;;
    --compose-override=*) COMPOSE_OVERRIDE="${1#*=}"; shift ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --base-url=*) BASE_URL="${1#*=}"; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    --repo=*) REPO="${1#*=}"; shift ;;
    --backup-dir) BACKUP_ROOT="$2"; shift 2 ;;
    --backup-dir=*) BACKUP_ROOT="${1#*=}"; shift ;;
    --no-backup) BACKUP=0; shift ;;
    --allow-incomplete-backup) ALLOW_INCOMPLETE_BACKUP=1; shift ;;
    --backup-only) BACKUP_ONLY=1; shift ;;
    --keycloak-realm) KEYCLOAK_REALM="$2"; shift 2 ;;
    --keycloak-realm=*) KEYCLOAK_REALM="${1#*=}"; shift ;;
    --no-keycloak-user-check) KEYCLOAK_USER_CHECK=0; shift ;;
    --no-pull) PULL=0; shift ;;
    --no-health-check) HEALTH_CHECK=0; shift ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --image-version|--refresh-artifacts|--ref|--image-version=*|--ref=*)
      ch_die "$1 is obsolete; use --release and a verified release manifest"
      ;;
    -h|--help) usage; exit 0 ;;
    *) ch_die "Unknown option: $1" ;;
  esac
done

[[ -f .env ]] || ch_die ".env not found; run scripts/install.sh first"
[[ -n "$MODE" ]] || MODE="$(ch_detect_mode .env)"
ch_validate_mode "$MODE"
[[ -n "$ENVIRONMENT" ]] || ENVIRONMENT="$(ch_env_get .env DEPLOYMENT_ENV)"
ch_validate_environment "$ENVIRONMENT"
ch_require_docker_compose
ch_require_cmd python3
ch_set_compose_args "$MODE" "$COMPOSE_OVERRIDE"

if [[ -n "$ADOPT_CURRENT" ]]; then
  [[ -z "$RELEASE" && -z "$ROLLBACK_TO" ]] || ch_die "--adopt-current cannot be combined with a release"
  [[ "$DRY_RUN" -eq 0 ]] || { ch_info "Would adopt current deployment as ${ADOPT_CURRENT}"; exit 0; }
  adopt_current "$ADOPT_CURRENT"
  exit 0
fi

PREVIOUS_RELEASE="$(ch_env_get .env RELEASE_VERSION)"
PREVIOUS_BACKEND_IMAGE="$(running_service_image_digest content-hub-api 2>/dev/null || ch_env_get .env CONTENT_HUB_BACKEND_IMAGE)"
PREVIOUS_FRONTEND_IMAGE="$(running_service_image_digest nginx 2>/dev/null || ch_env_get .env CONTENT_HUB_FRONTEND_IMAGE)"

if [[ "$BACKUP_ONLY" -eq 1 ]]; then
  capture_keycloak_users
  create_backup
  exit 0
fi

[[ -z "$RELEASE" || -z "$ROLLBACK_TO" ]] || ch_die "Use either --release or --rollback-to"
TARGET_RELEASE="${ROLLBACK_TO:-$RELEASE}"
[[ -n "$TARGET_RELEASE" ]] || ch_die "--release vX.Y.Z[-rc.N] is required"
ch_validate_release_for_environment "$TARGET_RELEASE" "$ENVIRONMENT"

if [[ "$DRY_RUN" -eq 1 ]]; then
  ch_info "Would deploy ${TARGET_RELEASE} to ${ENVIRONMENT} using mode ${MODE}"
  if [[ -n "$ROLLBACK_TO" && -f "baselines/${TARGET_RELEASE}/manifest.json" ]]; then
    ch_info "Would use local legacy baseline: baselines/${TARGET_RELEASE}"
  else
    ch_info "Would use manifest: ${MANIFEST_SOURCE:-GitHub release asset}"
  fi
  ch_info "Would create backup: $([[ "$BACKUP" -eq 1 ]] && printf yes || printf no)"
  exit 0
fi

if [[ -n "$ROLLBACK_TO" && -f "baselines/${TARGET_RELEASE}/manifest.json" ]]; then
  rollback_local_baseline "$TARGET_RELEASE"
  exit 0
fi

DEPLOYMENT_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DEPLOYMENT_RECORD=""
DEPLOYMENT_ACTIVE=1
RELEASE_WORK_DIR=""
write_deployment_record started
trap cleanup_update EXIT

RELEASE_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/content-hub-update.XXXXXX")"
MANIFEST_TOOL="$(ch_prepare_release "$REPO" "$TARGET_RELEASE" "$ENVIRONMENT" "$MANIFEST_SOURCE" "$RELEASE_WORK_DIR")"
TARGET_MANIFEST="${RELEASE_WORK_DIR}/release-manifest.json"
TARGET_BACKEND_IMAGE="$(ch_manifest_get "$MANIFEST_TOOL" "$TARGET_MANIFEST" images.backend)"
TARGET_FRONTEND_IMAGE="$(ch_manifest_get "$MANIFEST_TOOL" "$TARGET_MANIFEST" images.frontend)"
TARGET_COMMIT="$(ch_manifest_get "$MANIFEST_TOOL" "$TARGET_MANIFEST" sourceCommit)"
TARGET_APPLICATION_VERSION="$(ch_manifest_get "$MANIFEST_TOOL" "$TARGET_MANIFEST" applicationVersion)"
MIGRATION_CLASSIFICATION="$(ch_manifest_get "$MANIFEST_TOOL" "$TARGET_MANIFEST" migrations.classification)"
write_deployment_record started
if [[ "$ENVIRONMENT" == "production" && "$MIGRATION_CLASSIFICATION" == "manual" ]]; then
  ch_die "Manual/incompatible migrations require a separate reviewed maintenance procedure"
fi

if [[ -n "$PREVIOUS_RELEASE" && -z "$ROLLBACK_TO" ]]; then
  comparison="$(python3 "$MANIFEST_TOOL" compare --current "$PREVIOUS_RELEASE" --target "$TARGET_RELEASE")" || \
    ch_die "Cannot compare current and target releases; adopt the legacy deployment first"
  [[ "$comparison" != "older" ]] || ch_die "Downgrade requires --rollback-to ${TARGET_RELEASE}"
fi

validate_env_safety
if [[ "$YES" -eq 0 ]] && is_tty; then
  printf 'Deploy %s to %s using %s? [y/N]: ' "$TARGET_RELEASE" "$ENVIRONMENT" "$MODE"
  read -r answer
  [[ "$answer" =~ ^([yY]|yes|YES)$ ]] || ch_die "Deployment aborted"
fi

capture_keycloak_users
if [[ "$BACKUP" -eq 1 ]]; then
  create_backup
  export DEPLOY_CHECK_BACKUP=passed
else
  export DEPLOY_CHECK_BACKUP=skipped
fi
write_deployment_record started

if ! ch_prepare_identifier_transition "${RELEASE_WORK_DIR}/runtime" .env; then
  fail_deployment "Preparing Content Hub identifiers failed"
fi
if ! ch_install_runtime_artifacts "${RELEASE_WORK_DIR}/runtime" "$PWD"; then
  fail_deployment "Installing runtime artifacts failed"
fi
if ! ch_apply_manifest_env .env "$TARGET_MANIFEST" "$ENVIRONMENT" "$MANIFEST_TOOL"; then
  fail_deployment "Applying release metadata failed"
fi
if ! ch_validate_required_configuration .env "$TARGET_MANIFEST"; then
  fail_deployment "Required release configuration is missing"
fi

if [[ "$MODE" == "traefik" ]]; then
  network="$(ch_env_get .env TRAEFIK_DOCKER_NETWORK)"
  docker network inspect "${network:-ingress-net}" >/dev/null 2>&1 || fail_deployment "Traefik network is missing"
fi

run_compose config >/dev/null || fail_deployment "Docker Compose validation failed"
export DEPLOY_CHECK_COMPOSE=passed
if [[ "$PULL" -eq 1 ]]; then
  run_compose pull || fail_deployment "Pulling release images failed"
fi
docker image inspect "$TARGET_BACKEND_IMAGE" >/dev/null 2>&1 || \
  fail_deployment "Pulled backend image does not match the manifest digest"
docker image inspect "$TARGET_FRONTEND_IMAGE" >/dev/null 2>&1 || \
  fail_deployment "Pulled frontend image does not match the manifest digest"
export DEPLOY_CHECK_IMAGES=passed
run_compose up -d --wait --wait-timeout 180 || fail_deployment "Starting the release failed"
export DEPLOY_CHECK_START=passed
run_health_check || fail_deployment "Health or version check failed"
export DEPLOY_CHECK_HEALTH=$([[ "$HEALTH_CHECK" -eq 1 ]] && printf passed || printf skipped)

if [[ "$KEYCLOAK_USER_CHECK" -eq 1 ]]; then
  users_after="$(keycloak_user_count \
    "$(ch_env_get_default .env KEYCLOAK_DB_USER keycloak)" \
    "$(ch_env_get_default .env KEYCLOAK_DB_NAME keycloak)" \
    "$KEYCLOAK_REALM")" || fail_deployment "Could not count Keycloak users after deployment"
  (( users_after >= KEYCLOAK_USERS_BEFORE )) || fail_deployment "Keycloak user count decreased"
  KEYCLOAK_USERS_AFTER="$users_after"
  export KEYCLOAK_USERS_AFTER
  if [[ -n "$LAST_BACKUP_DIR" && -f "${LAST_BACKUP_DIR}/manifest.txt" ]]; then
    printf 'keycloak_users_after=%s\n' "$KEYCLOAK_USERS_AFTER" >>"${LAST_BACKUP_DIR}/manifest.txt"
    write_backup_checksums "$LAST_BACKUP_DIR"
  fi
  export DEPLOY_CHECK_KEYCLOAK=passed
else
  export DEPLOY_CHECK_KEYCLOAK=skipped
fi

command cp -f "$TARGET_MANIFEST" .release-manifest.json
write_deployment_record succeeded
DEPLOYMENT_ACTIVE=0
ch_info "Deployment complete: ${TARGET_RELEASE} (${ENVIRONMENT})"
ch_info "Record: ${DEPLOYMENT_RECORD}"
