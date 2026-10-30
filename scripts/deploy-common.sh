#!/usr/bin/env bash

# shellcheck disable=SC2034 # used by scripts that source this file
CONTENT_HUB_REPO_DEFAULT="iqb-berlin/content-hub"

# Accept exported legacy configuration during the transition; never guess on conflicts.
ch_import_legacy_environment() {
  local suffix canonical legacy
  for suffix in REPO GITHUB_TOKEN INSTALL_DIR DEPLOY_MODE HOST AUTH_HOST BACKEND_IMAGE FRONTEND_IMAGE DIR; do
    canonical="CONTENT_HUB_${suffix}"
    legacy="CONTENT_POOL_${suffix}"
    if [[ -n "${!canonical:-}" && -n "${!legacy:-}" && "${!canonical}" != "${!legacy}" ]]; then
      ch_die "Conflicting configuration: ${canonical} and ${legacy}"
    fi
    if [[ -z "${!canonical:-}" && -n "${!legacy:-}" ]]; then
      export "${canonical}=${!legacy}"
    fi
  done
}

ch_info() {
  printf '==> %s\n' "$*"
}

ch_warn() {
  printf 'Warning: %s\n' "$*" >&2
}

ch_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

ch_require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || ch_die "Required command not found: $cmd"
}

ch_require_docker_compose() {
  ch_require_cmd docker
  docker compose version >/dev/null 2>&1 || ch_die "Docker Compose v2 is required (docker compose version failed)"
}

ch_abs_path() {
  local path="$1"
  mkdir -p "$path"
  (cd "$path" && pwd -P)
}

ch_env_get() {
  local file="$1"
  local key="$2"
  local line
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    if [[ "$key" == CONTENT_HUB_* ]]; then
      ch_env_get "$file" "CONTENT_POOL_${key#CONTENT_HUB_}"
    fi
    return 0
  fi

  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  elif [[ "$value" == \'* && "$value" == *\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
  fi
  if [[ "$key" == CONTENT_HUB_* ]]; then
    local legacy_value
    legacy_value="$(ch_env_get "$file" "CONTENT_POOL_${key#CONTENT_HUB_}")"
    if [[ -z "$value" && -n "$legacy_value" ]]; then
      printf '%s' "$legacy_value"
      return 0
    fi
    [[ -z "$legacy_value" || "$legacy_value" == "$value" ]] || ch_die "Conflicting new and legacy configuration for ${key}"
  fi
  printf '%s' "$value"
}

ch_env_get_default() {
  local file="$1"
  local key="$2"
  local fallback="$3"
  local value
  value="$(ch_env_get "$file" "$key")"
  printf '%s' "${value:-$fallback}"
}

ch_env_set() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  touch "$file"
  tmp="$(mktemp "${TMPDIR:-/tmp}/content-hub-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  if [[ "$key" == CONTENT_HUB_* ]] && grep -q "^CONTENT_POOL_${key#CONTENT_HUB_}=" "$file"; then
    ch_env_set "$file" "CONTENT_POOL_${key#CONTENT_HUB_}" "$value"
  fi
}

ch_env_is_placeholder() {
  local value="$1"
  case "$value" in
    ""|change-me*|*example.com*|*YOUR_SERVER_IP*|hostname.de)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ch_env_set_if_placeholder() {
  local file="$1"
  local key="$2"
  local value="$3"
  local current

  current="$(ch_env_get "$file" "$key")"
  if ch_env_is_placeholder "$current"; then
    ch_env_set "$file" "$key" "$value"
  fi
}

ch_random_secret() {
  local length="${1:-48}"
  ch_require_cmd openssl
  openssl rand -hex "$(( (length + 1) / 2 ))" | cut -c "1-${length}"
}

ch_validate_mode() {
  local mode="$1"
  case "$mode" in
    server|traefik)
      ;;
    *)
      ch_die "Unsupported deployment mode: $mode (expected: server or traefik)"
      ;;
  esac
}

ch_validate_environment() {
  case "$1" in
    staging|production) ;;
    *) ch_die "Unsupported deployment environment: $1 (expected: staging or production)" ;;
  esac
}

ch_validate_release_for_environment() {
  local release="$1"
  local environment="$2"
  [[ "$release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$ ]] || \
    ch_die "Invalid release: $release"
  if [[ "$environment" == "production" && "$release" == *-rc.* ]]; then
    ch_die "Release candidates cannot be deployed to production"
  fi
}

ch_release_asset_url() {
  local repo="$1"
  local release="$2"
  local asset="$3"
  printf 'https://github.com/%s/releases/download/%s/%s' "$repo" "$release" "$asset"
}

ch_download_file() {
  local source="$1"
  local output="$2"
  local token="${CONTENT_HUB_GITHUB_TOKEN:-${GH_TOKEN:-}}"
  local curl_args=(-fsSL)
  ch_require_cmd curl
  if [[ -n "$token" ]]; then
    case "$source" in
      https://github.com/*|https://raw.githubusercontent.com/*)
        curl_args+=(-H "Authorization: Bearer ${token}")
        ;;
    esac
  fi
  case "$source" in
    http://*|https://*) curl "${curl_args[@]}" "$source" -o "$output" || ch_die "Download failed: $source" ;;
    *)
      [[ -f "$source" ]] || ch_die "File not found: $source"
      command cp -f "$source" "$output" || ch_die "Copy failed: $source"
      ;;
  esac
}

ch_validate_tar_archive() {
  local archive="$1"
  python3 - "$archive" <<'PY'
import posixpath
import sys
import tarfile
from pathlib import PurePosixPath

with tarfile.open(sys.argv[1], "r:gz") as bundle:
    for member in bundle.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe archive path: {member.name}")
        if member.issym() or member.islnk():
            target = member.linkname
            combined = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), target))
            if target.startswith("/") or combined == ".." or combined.startswith("../"):
                raise SystemExit(f"unsafe archive link: {member.name} -> {target}")
PY
}

ch_manifest_tool() {
  local repo="$1"
  local release="$2"
  local candidate="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/release_manifest.py"
  if [[ -f "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi

  candidate="$(mktemp "${TMPDIR:-/tmp}/content-hub-release-manifest.XXXXXX.py")"
  ch_download_file \
    "https://raw.githubusercontent.com/${repo}/${release}/scripts/release_manifest.py" \
    "$candidate"
  printf '%s' "$candidate"
}

ch_manifest_get() {
  local tool="$1"
  local manifest="$2"
  local field="$3"
  python3 "$tool" get --manifest "$manifest" --field "$field" || \
    ch_die "Could not read ${field} from release manifest"
}

ch_prepare_release() {
  local repo="$1"
  local release="$2"
  local environment="$3"
  local manifest_source="$4"
  local work_dir="$5"
  local tool manifest archive_name archive_path checksums_path

  ch_validate_environment "$environment"
  ch_require_cmd python3
  ch_require_cmd tar
  mkdir -p "$work_dir/runtime"
  manifest="${work_dir}/release-manifest.json"
  if [[ -n "$manifest_source" ]]; then
    ch_download_file "$manifest_source" "$manifest"
  else
    ch_download_file "$(ch_release_asset_url "$repo" "$release" release-manifest.json)" "$manifest"
  fi

  tool="$(ch_manifest_tool "$repo" "$release")"
  python3 "$tool" validate \
    --manifest "$manifest" \
    --expected-release "$release" \
    --environment "$environment" || ch_die "Release manifest validation failed"

  archive_name="$(ch_manifest_get "$tool" "$manifest" runtime.archive)"
  [[ "$archive_name" == "$(basename "$archive_name")" ]] || ch_die "Unsafe runtime archive name in release manifest"
  archive_path="${work_dir}/${archive_name}"
  if [[ -n "$manifest_source" ]]; then
    case "$manifest_source" in
      http://*|https://*) ch_download_file "${manifest_source%/*}/${archive_name}" "$archive_path" ;;
      *)
        [[ -f "$(dirname "$manifest_source")/${archive_name}" ]] || \
          ch_die "Runtime archive not found next to local manifest: ${archive_name}"
        ch_download_file "$(dirname "$manifest_source")/${archive_name}" "$archive_path"
        ;;
    esac
  else
    ch_download_file "$(ch_release_asset_url "$repo" "$release" "$archive_name")" "$archive_path"
  fi

  checksums_path="${work_dir}/SHA256SUMS"
  if [[ -n "$manifest_source" ]]; then
    case "$manifest_source" in
      http://*|https://*) ch_download_file "${manifest_source%/*}/SHA256SUMS" "$checksums_path" ;;
      *) ch_download_file "$(dirname "$manifest_source")/SHA256SUMS" "$checksums_path" ;;
    esac
  else
    ch_download_file "$(ch_release_asset_url "$repo" "$release" SHA256SUMS)" "$checksums_path"
  fi
  python3 - "$checksums_path" "$manifest" "$archive_path" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

sums = {}
for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([0-9a-f]{64})\s+\*?(.+)", line)
    if match:
        sums[Path(match.group(2)).name] = match.group(1)
for value in sys.argv[2:]:
    path = Path(value)
    expected = sums.get(path.name)
    if expected is None:
        raise SystemExit(f"missing checksum for {path.name}")
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"checksum mismatch for {path.name}: expected {expected}, got {actual}")
PY
  [[ "$?" -eq 0 ]] || ch_die "Release checksum validation failed"

  python3 "$tool" validate \
    --manifest "$manifest" \
    --expected-release "$release" \
    --environment "$environment" \
    --runtime-archive "$archive_path" || ch_die "Release archive validation failed"

  ch_validate_tar_archive "$archive_path" || ch_die "Unsafe runtime archive"
  tar -xzf "$archive_path" -C "$work_dir/runtime" || ch_die "Extracting runtime archive failed"
  printf '%s' "$tool"
}

ch_apply_manifest_env() {
  local env_file="$1"
  local manifest="$2"
  local environment="$3"
  local tool="$4"
  local compose_project

  ch_env_set "$env_file" DEPLOYMENT_ENV "$environment"
  compose_project="$(ch_env_get "$env_file" COMPOSE_PROJECT_NAME)"
  if [[ -z "$compose_project" ]]; then
    ch_env_set "$env_file" COMPOSE_PROJECT_NAME "content-hub-${environment}"
  fi
  ch_env_set "$env_file" RELEASE_VERSION "$(ch_manifest_get "$tool" "$manifest" release)"
  ch_env_set "$env_file" APPLICATION_VERSION "$(ch_manifest_get "$tool" "$manifest" applicationVersion)"
  ch_env_set "$env_file" RELEASE_COMMIT "$(ch_manifest_get "$tool" "$manifest" sourceCommit)"
  ch_env_set "$env_file" RELEASE_BUILT_AT "$(ch_manifest_get "$tool" "$manifest" builtAt)"
  ch_env_set "$env_file" CONTENT_HUB_BACKEND_IMAGE "$(ch_manifest_get "$tool" "$manifest" images.backend)"
  ch_env_set "$env_file" CONTENT_HUB_FRONTEND_IMAGE "$(ch_manifest_get "$tool" "$manifest" images.frontend)"
}

ch_validate_required_configuration() {
  local env_file="$1"
  local manifest="$2"
  local key value
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    value="$(ch_env_get "$env_file" "$key")"
    if [[ -z "$value" ]]; then
      ch_warn "Release requires missing configuration key: $key"
      return 1
    fi
  done < <(python3 - "$manifest" <<'PY'
import json, sys
for key in json.load(open(sys.argv[1], encoding="utf-8"))["requiredConfiguration"]:
    print(key)
PY
  )
}

ch_set_compose_args() {
  local mode="$1"
  local override="${2:-}"
  ch_validate_mode "$mode"
  CONTENT_HUB_COMPOSE_ARGS=(-f docker-compose.server.yml)
  if [[ "$mode" == "traefik" ]]; then
    CONTENT_HUB_COMPOSE_ARGS+=(-f docker-compose.traefik.yml)
  fi
  if [[ -n "$override" ]]; then
    [[ -f "$override" ]] || ch_die "Compose override not found: $override"
    CONTENT_HUB_COMPOSE_ARGS+=(-f "$override")
  fi
}

ch_compose_container_id() {
  local service="$1"
  local container
  container="$(ch_compose ps -q "$service" 2>/dev/null | head -n 1)"
  [[ -n "$container" ]] || return 1
  printf '%s' "$container"
}

ch_compose_service_name() {
  local service="$1" legacy services
  case "$service" in
    content-hub-api|content-hub-db|content-hub-web)
      legacy="${service/content-hub/content-pool}"
      services="$(docker compose "${CONTENT_HUB_COMPOSE_ARGS[@]}" config --services 2>/dev/null)" || return 1
      if ! grep -Fxq "$service" <<<"$services" && grep -Fxq "$legacy" <<<"$services"; then
        printf '%s' "$legacy"
        return
      fi
      ;;
  esac
  printf '%s' "$service"
}

ch_compose() {
  local arg args=()
  for arg in "$@"; do
    case "$arg" in
      content-hub-api|content-hub-db|content-hub-web) arg="$(ch_compose_service_name "$arg")" || return 1 ;;
    esac
    args+=("$arg")
  done
  docker compose "${CONTENT_HUB_COMPOSE_ARGS[@]}" "${args[@]}"
}

# Called after the configuration/database backup and before installing new Compose files.
ch_prepare_identifier_transition() {
  local runtime="$1" env_file="$2" key suffix value container old_service volume project configured service
  for suffix in HOST AUTH_HOST BACKEND_IMAGE FRONTEND_IMAGE; do
    key="CONTENT_HUB_${suffix}"
    value="$(ch_env_get "$env_file" "$key")"
    [[ -z "$value" ]] || ch_env_set "$env_file" "$key" "$value"
  done
  grep -q '^  content-hub-db:' "$runtime/docker-compose.server.yml" || return 0
  service="$(ch_compose_service_name content-hub-db)" || return 1
  if ! container="$(ch_compose_container_id content-hub-db)"; then
    [[ "$service" != content-pool-db ]] || ch_die "Start the existing database before migrating its volume assignment"
    return 0
  fi
  old_service="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.service"}}')" || return 1
  [[ "$old_service" == content-pool-db ]] || return 0
  project="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}')" || return 1
  [[ -n "$project" ]] || ch_die "Cannot identify existing Compose project"
  configured="$(ch_env_get "$env_file" COMPOSE_PROJECT_NAME)"
  [[ -z "$configured" || "$configured" == "$project" ]] || ch_die "Existing Compose project differs from configuration"
  ch_env_set "$env_file" COMPOSE_PROJECT_NAME "$project"
  volume="$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')" || return 1
  [[ -n "$volume" ]] || ch_die "Existing database uses a custom mount; provide a reviewed Compose override"
  configured="$(ch_env_get "$env_file" CONTENT_HUB_DB_VOLUME)"
  [[ -z "$configured" || "$configured" == "$volume" ]] || ch_die "Configured database volume differs from existing data"
  ch_env_set "$env_file" CONTENT_HUB_DB_VOLUME "$volume"
  ch_info "Retaining existing database volume and Compose project during service rename"
  ch_compose stop content-hub-api content-hub-db
}

ch_compose_service_running() {
  local service="$1"
  local container state
  container="$(ch_compose_container_id "$service")" || return 1
  state="$(docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null)" || return 1
  [[ "$state" == "true" ]]
}

ch_sha256_file() {
  python3 - "$1" <<'PY'
import hashlib
import sys

digest = hashlib.sha256()
with open(sys.argv[1], "rb") as source:
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
print(digest.hexdigest())
PY
}

ch_write_sha256s() {
  local directory="$1"
  shift
  python3 - "$directory" "$@" <<'PY'
import hashlib
import sys
from pathlib import Path

directory = Path(sys.argv[1])
lines = []
for name in sys.argv[2:]:
    path = directory / name
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    lines.append(f"{digest.hexdigest()}  {name}")
(directory / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

ch_verify_sha256s() {
  local directory="$1"
  python3 - "$directory" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

directory = Path(sys.argv[1])
sums = directory / "SHA256SUMS"
if not sums.is_file():
    raise SystemExit("SHA256SUMS is missing")
seen = set()
for line in sums.read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([0-9a-f]{64})  ([^/]+)", line)
    if not match:
        raise SystemExit(f"invalid checksum line: {line}")
    expected, name = match.groups()
    if name == "SHA256SUMS" or name in seen:
        raise SystemExit(f"invalid checksum target: {name}")
    seen.add(name)
    path = directory / name
    if not path.is_file():
        raise SystemExit(f"checksummed file is missing: {name}")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise SystemExit(f"checksum mismatch: {name}")
PY
}

ch_detect_mode() {
  local env_file="${1:-.env}"
  local content_host
  content_host="$(ch_env_get "$env_file" CONTENT_HUB_HOST)"
  if [[ -f docker-compose.traefik.yml ]] && ! ch_env_is_placeholder "$content_host"; then
    printf 'traefik'
  else
    printf 'server'
  fi
}

ch_download_source() {
  local repo="$1"
  local ref="$2"
  local temp_dir tarball source_dir

  ch_require_cmd curl
  ch_require_cmd tar

  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/content-hub-source.XXXXXX")"
  tarball="${temp_dir}/source.tar.gz"

  ch_info "Downloading ${repo}@${ref}" >&2
  curl -fsSL "https://github.com/${repo}/archive/${ref}.tar.gz" -o "$tarball"
  tar -xzf "$tarball" -C "$temp_dir"

  source_dir="$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [[ -n "$source_dir" ]] || ch_die "Downloaded archive did not contain a source directory"
  printf '%s' "$source_dir"
}

ch_copy_file_if_present() {
  local source_root="$1"
  local target_root="$2"
  local path="$3"
  local target_file target_dir tmp_file

  if [[ -f "${source_root}/${path}" ]]; then
    target_file="${target_root}/${path}"
    target_dir="$(dirname "$target_file")"
    mkdir -p "$target_dir"
    tmp_file="$(mktemp "${target_dir}/.$(basename "$path").XXXXXX")"
    command cp -f "${source_root}/${path}" "$tmp_file"
    command mv -f "$tmp_file" "$target_file"
  fi
}

ch_copy_tree_if_present() {
  local source_root="$1"
  local target_root="$2"
  local path="$3"

  if [[ -d "${source_root}/${path}" ]]; then
    mkdir -p "${target_root}"
    (cd "$source_root" && tar -cf - "$path") | (cd "$target_root" && tar -xf -)
  fi
}

ch_install_runtime_artifacts() {
  local source_root="$1"
  local target_root="$2"
  local source_abs target_abs

  source_abs="$(cd "$source_root" && pwd -P)"
  target_abs="$(ch_abs_path "$target_root")"

  if [[ "$source_abs" == "$target_abs" ]]; then
    ch_info "Using current repository as deployment directory"
    return 0
  fi

  ch_info "Installing deployment artifacts into ${target_abs}"

  local file
  for file in \
    VERSION \
    CHANGELOG.md \
    RELEASE_CHECKLIST.md \
    docs/operations/content-hub-branding.md \
    .env.example \
    docker-compose.server.yml \
    docker-compose.traefik.yml \
    nginx.server.conf
  do
    ch_copy_file_if_present "$source_abs" "$target_abs" "$file"
  done

  ch_copy_tree_if_present "$source_abs" "$target_abs" keycloak
  if [[ -f "${source_abs}/keycloak/providers/content-hub-keycloak-altcha.jar" ]]; then
    command rm -f "${target_abs}/keycloak/providers/content-pool-keycloak-altcha.jar"
  elif [[ -f "${source_abs}/keycloak/providers/content-pool-keycloak-altcha.jar" ]]; then
    command rm -f "${target_abs}/keycloak/providers/content-hub-keycloak-altcha.jar"
  fi

  mkdir -p "${target_abs}/scripts/make"
  for file in \
    scripts/check-health.sh \
    scripts/build-keycloak-altcha.sh \
    scripts/configure-keycloak-registration.sh \
    scripts/configure-keycloak-registration-db.sh \
    scripts/configure-keycloak-smtp.sh \
    scripts/configure-hu-postfix-relay.sh \
    scripts/init-keycloak.sh \
    scripts/deploy-common.sh \
    scripts/install.sh \
    scripts/update.sh \
    scripts/restore.sh \
    scripts/release_manifest.py \
    scripts/migrate-keycloak-client.py \
    scripts/make/server.mk
  do
    ch_copy_file_if_present "$source_abs" "$target_abs" "$file"
  done

  if [[ -f "${source_abs}/scripts/make/server.mk" ]] && [[ ! -d "${target_abs}/backend" || ! -d "${target_abs}/frontend" ]]; then
    command cp -f "${source_abs}/scripts/make/server.mk" "${target_abs}/Makefile"
  elif [[ -f "${source_abs}/Makefile" && ! -f "${target_abs}/Makefile" ]]; then
    command cp -f "${source_abs}/Makefile" "${target_abs}/Makefile"
  fi

  chmod +x "${target_abs}"/scripts/*.sh 2>/dev/null || true
}

ch_reconcile_provider_archive() {
  local archive="$1" listing
  listing="$(tar -tzf "$archive")" || return 1
  if grep -q '^keycloak/providers/content-hub-keycloak-altcha.jar$' <<<"$listing"; then
    command rm -f keycloak/providers/content-pool-keycloak-altcha.jar
  elif grep -q '^keycloak/providers/content-pool-keycloak-altcha.jar$' <<<"$listing"; then
    command rm -f keycloak/providers/content-hub-keycloak-altcha.jar
  fi
}

ch_has_running_container() {
  local name="$1"
  docker ps --format '{{.Names}}' | grep -Fx "$name" >/dev/null 2>&1
}

ch_import_legacy_environment
