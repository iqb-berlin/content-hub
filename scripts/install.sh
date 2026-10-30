#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BOOTSTRAP_REPO="${CONTENT_HUB_REPO:-${CONTENT_POOL_REPO:-iqb-berlin/content-hub}}"
BOOTSTRAP_REF=""

for ((i = 1; i <= $#; i++)); do
  arg="${!i}"
  case "$arg" in
    --repo)
      next=$((i + 1))
      BOOTSTRAP_REPO="${!next-}"
      ;;
    --repo=*)
      BOOTSTRAP_REPO="${arg#*=}"
      ;;
    --release)
      next=$((i + 1))
      BOOTSTRAP_REF="${!next-}"
      ;;
    --release=*)
      BOOTSTRAP_REF="${arg#*=}"
      ;;
  esac
done

COMMON_SH="${SCRIPT_DIR}/deploy-common.sh"
if [[ ! -f "$COMMON_SH" ]]; then
  [[ "$BOOTSTRAP_REF" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[1-9][0-9]*)?$ ]] || {
    printf 'Error: standalone bootstrap requires --release vX.Y.Z[-rc.N]\n' >&2
    exit 1
  }
  tmp_common="$(mktemp "${TMPDIR:-/tmp}/content-hub-deploy-common.XXXXXX")"
  command -v curl >/dev/null 2>&1 || {
    printf 'Error: scripts/deploy-common.sh is missing and curl is not available for bootstrap\n' >&2
    exit 1
  }
  bootstrap_curl_args=(-fsSL)
  bootstrap_token="${CONTENT_HUB_GITHUB_TOKEN:-${CONTENT_POOL_GITHUB_TOKEN:-${GH_TOKEN:-}}}"
  [[ -z "$bootstrap_token" ]] || bootstrap_curl_args+=(-H "Authorization: Bearer ${bootstrap_token}")
  curl "${bootstrap_curl_args[@]}" \
    "https://raw.githubusercontent.com/${BOOTSTRAP_REPO}/${BOOTSTRAP_REF}/scripts/deploy-common.sh" \
    -o "$tmp_common"
  COMMON_SH="$tmp_common"
fi

# shellcheck source=deploy-common.sh
. "$COMMON_SH"

usage() {
  cat <<'USAGE'
Usage: scripts/install.sh [options]

Install a Content Hub server deployment from a verified GitHub release bundle.

Options:
  --dir DIR                         Target directory (default: prompt or current directory)
  --mode server|traefik             Deployment mode (default: prompt or server in non-interactive mode)
  --environment staging|production  Isolated target environment (required)
  --release VERSION                 Release or candidate, for example v0.2.0-rc.1 (required)
  --manifest FILE|URL               Alternate release-manifest.json source
  --compose-override FILE           Additional Compose file for an isolated deployment
  --base-url URL                    Public/frontend URL used by server-mode health checks
  --repo OWNER/REPO                 GitHub repository (default: iqb-berlin/content-hub)
  --download                        Deprecated compatibility flag; release assets are always used
  --start                           Start the stack after validation
  --non-interactive                 Do not prompt; use env values, generated secrets, and defaults
  --force-env                       Recreate .env from .env.example, backing up an existing .env
  --skip-traefik-network-check      Do not fail --start when the Traefik Docker network is missing
  -h, --help                        Show this help

Environment overrides such as CONTENT_HUB_HOST,
CONTENT_HUB_AUTH_HOST, POSTGRES_PASSWORD, KEYCLOAK_DB_PASSWORD,
KEYCLOAK_ADMIN_PASSWORD, and JWT_SECRET are written into .env when set.
USAGE
}

is_tty() {
  [[ -t 0 && -t 1 ]]
}

prompt_value() {
  local label="$1"
  local default="$2"
  local value

  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    printf '%s' "$default"
    return 0
  fi

  read -r -p "${label} [${default}]: " value
  printf '%s' "${value:-$default}"
}

url_host() {
  local url="$1"
  url="${url#http://}"
  url="${url#https://}"
  printf '%s' "${url%%/*}"
}

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

first_csv_value() {
  local value="$1"
  value="${value%%,*}"
  trim_value "$value"
}

apply_env_overrides() {
  local env_file="$1"
  local key value

  for key in \
    APP_PORT \
    CONTENT_HUB_HOST CONTENT_HUB_AUTH_HOST TRAEFIK_DOCKER_NETWORK TRAEFIK_ENTRYPOINT TRAEFIK_TLS_CERTRESOLVER \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD \
    JWT_SECRET JWT_EXPIRATION CORS_ORIGIN \
    KEYCLOAK_HOSTNAME KEYCLOAK_DB_NAME KEYCLOAK_DB_USER KEYCLOAK_DB_PASSWORD \
    KEYCLOAK_ADMIN_USER KEYCLOAK_ADMIN_PASSWORD \
    OIDC_ISSUER_URL OIDC_PUBLIC_ISSUER_URL OIDC_REDIRECT_URI OIDC_CLIENT_ID OIDC_SCOPE
  do
    value="${!key-}"
    if [[ -n "$value" ]]; then
      ch_env_set "$env_file" "$key" "$value"
    fi
  done
}

ensure_secret() {
  local env_file="$1"
  local key="$2"
  local length="$3"
  local current

  current="$(ch_env_get "$env_file" "$key")"
  if ch_env_is_placeholder "$current"; then
    ch_env_set "$env_file" "$key" "$(ch_random_secret "$length")"
  fi
}

configure_urls() {
  local env_file="$1"
  local mode="$2"
  local app_host auth_host app_url auth_url cors_origins redirect_uri

  if [[ "$mode" == "traefik" ]]; then
    app_host="$(ch_env_get "$env_file" CONTENT_HUB_HOST)"
    auth_host="$(ch_env_get "$env_file" CONTENT_HUB_AUTH_HOST)"
    app_host="$(prompt_value "Content Hub app host" "${CONTENT_HUB_HOST:-${app_host:-content-hub.example.com}}")"
    auth_host="$(prompt_value "Content Hub auth host" "${CONTENT_HUB_AUTH_HOST:-${auth_host:-auth-content-hub.example.com}}")"

    ch_env_set "$env_file" CONTENT_HUB_HOST "$app_host"
    ch_env_set "$env_file" CONTENT_HUB_AUTH_HOST "$auth_host"
    ch_env_set_if_placeholder "$env_file" TRAEFIK_DOCKER_NETWORK "${TRAEFIK_DOCKER_NETWORK:-ingress-net}"
    ch_env_set_if_placeholder "$env_file" TRAEFIK_ENTRYPOINT "${TRAEFIK_ENTRYPOINT:-websecure}"
    if [[ -n "${CORS_ORIGIN-}" ]]; then
      ch_env_set "$env_file" CORS_ORIGIN "$CORS_ORIGIN"
    else
      ch_env_set "$env_file" CORS_ORIGIN "https://${app_host}"
    fi
    ch_env_set "$env_file" KEYCLOAK_HOSTNAME "$auth_host"
    ch_env_set "$env_file" OIDC_PUBLIC_ISSUER_URL "https://${auth_host}/realms/iqb"
    ch_env_set "$env_file" OIDC_REDIRECT_URI "${OIDC_REDIRECT_URI:-https://${app_host}/auth/callback}"
  else
    cors_origins="${CORS_ORIGIN:-$(ch_env_get "$env_file" CORS_ORIGIN)}"
    app_url="$(first_csv_value "$cors_origins")"
    auth_url="$(ch_env_get "$env_file" OIDC_PUBLIC_ISSUER_URL)"
    app_url="$(prompt_value "Public Content Hub app URL" "${app_url:-https://app.example.com}")"
    auth_url="$(prompt_value "Public Keycloak issuer URL" "${OIDC_PUBLIC_ISSUER_URL:-${auth_url:-https://auth.example.com/realms/iqb}}")"

    if [[ -n "${CORS_ORIGIN-}" ]]; then
      ch_env_set "$env_file" CORS_ORIGIN "$CORS_ORIGIN"
    elif ch_env_is_placeholder "$cors_origins"; then
      ch_env_set "$env_file" CORS_ORIGIN "$app_url"
    else
      ch_env_set "$env_file" CORS_ORIGIN "$cors_origins"
    fi
    ch_env_set "$env_file" OIDC_PUBLIC_ISSUER_URL "$auth_url"
    ch_env_set "$env_file" OIDC_REDIRECT_URI "${OIDC_REDIRECT_URI:-${app_url%/}/auth/callback}"
    ch_env_set "$env_file" KEYCLOAK_HOSTNAME "$(url_host "$auth_url")"
  fi

  redirect_uri="$(ch_env_get "$env_file" OIDC_REDIRECT_URI)"
  if [[ "$redirect_uri" == *,* ]]; then
    ch_die "OIDC_REDIRECT_URI must be a single URL. Use CORS_ORIGIN for comma-separated additional origins."
  fi
}

configure_realm_export() {
  local target_dir="$1"
  local env_file="$2"
  local realm_file="${target_dir}/keycloak/realm-export.json"
  local app_origins redirect_uri

  [[ -f "$realm_file" ]] || return 0
  command -v python3 >/dev/null 2>&1 || {
    ch_warn "python3 not found; keycloak/realm-export.json was not adjusted automatically"
    return 0
  }

  app_origins="$(ch_env_get "$env_file" CORS_ORIGIN)"
  redirect_uri="$(ch_env_get "$env_file" OIDC_REDIRECT_URI)"

  if ch_env_is_placeholder "$app_origins" || ch_env_is_placeholder "$redirect_uri"; then
    ch_warn "Public URLs still contain placeholders; keycloak/realm-export.json was left unchanged"
    return 0
  fi

  python3 - "$realm_file" "$app_origins" "$redirect_uri" <<'PY'
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

realm_path = Path(sys.argv[1])
app_origins = [
    origin.strip().rstrip("/")
    for origin in sys.argv[2].split(",")
    if origin.strip()
]
redirect_uri = sys.argv[3]

if not app_origins:
    raise SystemExit("CORS_ORIGIN must contain at least one origin")

redirect_parts = urlsplit(redirect_uri)
primary_origin = urlunsplit((redirect_parts.scheme, redirect_parts.netloc, "", "", "")).rstrip("/")
if not primary_origin:
    primary_origin = app_origins[0]
logout_uri = f"{primary_origin}/login"

def unique(values):
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result

data = json.loads(realm_path.read_text(encoding="utf-8"))

for client in data.get("clients", []):
    if client.get("clientId") != "contenthub":
        continue

    local_redirects = [
        uri for uri in client.get("redirectUris", [])
        if "localhost" in uri or "127.0.0.1" in uri
    ]
    local_origins = [
        uri for uri in client.get("webOrigins", [])
        if "localhost" in uri or "127.0.0.1" in uri
    ]

    client["redirectUris"] = unique([redirect_uri, *local_redirects])
    client["webOrigins"] = unique([*app_origins, *local_origins])

    attributes = client.setdefault("attributes", {})
    local_logout = [
        uri for uri in attributes.get("post.logout.redirect.uris", "").split("##")
        if "localhost" in uri or "127.0.0.1" in uri
    ]
    attributes["post.logout.redirect.uris"] = "##".join([logout_uri, *local_logout])
    break

realm_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY
}

validate_placeholders() {
  local env_file="$1"
  local mode="$2"
  local keys key value failures=0

  keys=(POSTGRES_PASSWORD KEYCLOAK_DB_PASSWORD KEYCLOAK_ADMIN_PASSWORD JWT_SECRET CORS_ORIGIN OIDC_PUBLIC_ISSUER_URL OIDC_REDIRECT_URI)
  if [[ "$mode" == "traefik" ]]; then
    keys+=(CONTENT_HUB_HOST CONTENT_HUB_AUTH_HOST)
  fi

  for key in "${keys[@]}"; do
    value="$(ch_env_get "$env_file" "$key")"
    if ch_env_is_placeholder "$value"; then
      ch_warn "${key} still looks like a placeholder (${value:-empty})"
      failures=$((failures + 1))
    fi
  done

  if [[ "$failures" -gt 0 ]]; then
    ch_warn "Review .env before using this deployment in production"
  fi
}

check_traefik_network() {
  local env_file="$1"
  local strict="$2"
  local network

  network="$(ch_env_get "$env_file" TRAEFIK_DOCKER_NETWORK)"
  network="${network:-ingress-net}"

  if docker network inspect "$network" >/dev/null 2>&1; then
    ch_info "Traefik Docker network exists: ${network}"
  elif [[ "$strict" -eq 1 ]]; then
    ch_die "Traefik Docker network '${network}' does not exist. Start Traefik first or create the external network."
  else
    ch_warn "Traefik Docker network '${network}' does not exist yet"
  fi
}

TARGET_DIR="${CONTENT_HUB_INSTALL_DIR:-}"
MODE="${CONTENT_HUB_DEPLOY_MODE:-}"
REPO="$BOOTSTRAP_REPO"
ENVIRONMENT="${DEPLOYMENT_ENV:-}"
RELEASE=""
MANIFEST_SOURCE=""
COMPOSE_OVERRIDE=""
BASE_URL=""
START=0
NON_INTERACTIVE=0
FORCE_ENV=0
SKIP_TRAEFIK_NETWORK_CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --dir=*)
      TARGET_DIR="${1#*=}"
      shift
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --environment=*)
      ENVIRONMENT="${1#*=}"
      shift
      ;;
    --release)
      RELEASE="$2"
      shift 2
      ;;
    --release=*)
      RELEASE="${1#*=}"
      shift
      ;;
    --manifest)
      MANIFEST_SOURCE="$2"
      shift 2
      ;;
    --manifest=*)
      MANIFEST_SOURCE="${1#*=}"
      shift
      ;;
    --compose-override)
      COMPOSE_OVERRIDE="$2"
      shift 2
      ;;
    --compose-override=*)
      COMPOSE_OVERRIDE="${1#*=}"
      shift
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --base-url=*)
      BASE_URL="${1#*=}"
      shift
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --repo=*)
      REPO="${1#*=}"
      shift
      ;;
    --download)
      shift
      ;;
    --start)
      START=1
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --force-env)
      FORCE_ENV=1
      shift
      ;;
    --skip-traefik-network-check)
      SKIP_TRAEFIK_NETWORK_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ch_die "Unknown option: $1"
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    MODE="server"
  else
    MODE="$(prompt_value "Deployment mode (server or traefik)" "traefik")"
  fi
fi
ch_validate_mode "$MODE"
[[ -n "$ENVIRONMENT" ]] || ch_die "--environment staging|production is required"
ch_validate_environment "$ENVIRONMENT"
[[ -n "$RELEASE" ]] || ch_die "--release vX.Y.Z[-rc.N] is required"
ch_validate_release_for_environment "$RELEASE" "$ENVIRONMENT"
if [[ -n "$COMPOSE_OVERRIDE" ]]; then
  [[ -f "$COMPOSE_OVERRIDE" ]] || ch_die "Compose override not found: $COMPOSE_OVERRIDE"
  COMPOSE_OVERRIDE="$(cd "$(dirname "$COMPOSE_OVERRIDE")" && pwd -P)/$(basename "$COMPOSE_OVERRIDE")"
fi

if [[ -z "$TARGET_DIR" ]]; then
  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    TARGET_DIR="$PWD"
  else
    TARGET_DIR="$(prompt_value "Install directory" "$PWD")"
  fi
fi

ch_require_docker_compose
ch_require_cmd openssl

RELEASE_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/content-hub-install.XXXXXX")"
trap 'rm -rf "$RELEASE_WORK_DIR"' EXIT
MANIFEST_TOOL="$(ch_prepare_release "$REPO" "$RELEASE" "$ENVIRONMENT" "$MANIFEST_SOURCE" "$RELEASE_WORK_DIR")"
SOURCE_ROOT="${RELEASE_WORK_DIR}/runtime"

TARGET_DIR="$(ch_abs_path "$TARGET_DIR")"
ch_install_runtime_artifacts "$SOURCE_ROOT" "$TARGET_DIR"

ENV_FILE="${TARGET_DIR}/.env"
if [[ -f "$ENV_FILE" && "$FORCE_ENV" -eq 1 ]]; then
  backup="${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
  ch_info "Backing up existing .env to ${backup}"
  command cp -f "$ENV_FILE" "$backup"
  command cp -f "${TARGET_DIR}/.env.example" "$ENV_FILE"
elif [[ ! -f "$ENV_FILE" ]]; then
  ch_info "Creating .env from .env.example"
  command cp -f "${TARGET_DIR}/.env.example" "$ENV_FILE"
fi

apply_env_overrides "$ENV_FILE"
ch_apply_manifest_env "$ENV_FILE" "${RELEASE_WORK_DIR}/release-manifest.json" "$ENVIRONMENT" "$MANIFEST_TOOL"
ch_validate_required_configuration "$ENV_FILE" "${RELEASE_WORK_DIR}/release-manifest.json" || \
  ch_die "Required release configuration is missing"
ensure_secret "$ENV_FILE" POSTGRES_PASSWORD 48
ensure_secret "$ENV_FILE" KEYCLOAK_DB_PASSWORD 48
ensure_secret "$ENV_FILE" KEYCLOAK_ADMIN_PASSWORD 48
ensure_secret "$ENV_FILE" JWT_SECRET 64
configure_urls "$ENV_FILE" "$MODE"
configure_realm_export "$TARGET_DIR" "$ENV_FILE"
validate_placeholders "$ENV_FILE" "$MODE"

if [[ "$MODE" == "traefik" ]]; then
  strict_network=0
  if [[ "$START" -eq 1 && "$SKIP_TRAEFIK_NETWORK_CHECK" -eq 0 ]]; then
    strict_network=1
  fi
  check_traefik_network "$ENV_FILE" "$strict_network"
fi

ch_info "Validating Docker Compose configuration"
(
  cd "$TARGET_DIR"
  ch_set_compose_args "$MODE" "$COMPOSE_OVERRIDE"
  docker compose "${CONTENT_HUB_COMPOSE_ARGS[@]}" config >/dev/null
)

command cp -f "${RELEASE_WORK_DIR}/release-manifest.json" "${TARGET_DIR}/.release-manifest.json"

if [[ "$START" -eq 1 ]]; then
  ch_info "Starting and verifying Content Hub (${MODE})"
  (
    cd "$TARGET_DIR"
    update_args=(
      --mode "$MODE"
      --environment "$ENVIRONMENT"
      --release "$RELEASE"
      --manifest "${RELEASE_WORK_DIR}/release-manifest.json"
      --no-backup
      --no-keycloak-user-check
      --yes
    )
    [[ -z "$COMPOSE_OVERRIDE" ]] || update_args+=(--compose-override "$COMPOSE_OVERRIDE")
    [[ -z "$BASE_URL" ]] || update_args+=(--base-url "$BASE_URL")
    ./scripts/update.sh "${update_args[@]}"
  )
fi

ch_info "Install complete: ${TARGET_DIR}"
ch_info "Release: ${RELEASE} (${ENVIRONMENT})"
[[ "$START" -eq 1 ]] || ch_info "Re-run the installer with --start after reviewing ${TARGET_DIR}/.env"
