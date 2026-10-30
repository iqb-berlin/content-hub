#!/usr/bin/env bash

# shellcheck disable=SC2034 # used by scripts that source this file
CONTENT_POOL_REPO_DEFAULT="iqb-berlin/content-pool-next"

cp_info() {
  printf '==> %s\n' "$*"
}

cp_warn() {
  printf 'Warning: %s\n' "$*" >&2
}

cp_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

cp_require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || cp_die "Required command not found: $cmd"
}

cp_require_docker_compose() {
  cp_require_cmd docker
  docker compose version >/dev/null 2>&1 || cp_die "Docker Compose v2 is required (docker compose version failed)"
}

cp_abs_path() {
  local path="$1"
  mkdir -p "$path"
  (cd "$path" && pwd -P)
}

cp_env_get() {
  local file="$1"
  local key="$2"
  local line
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0

  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  elif [[ "$value" == \'* && "$value" == *\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
  fi
  printf '%s' "$value"
}

cp_env_get_default() {
  local file="$1"
  local key="$2"
  local fallback="$3"
  local value
  value="$(cp_env_get "$file" "$key")"
  printf '%s' "${value:-$fallback}"
}

cp_env_set() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  touch "$file"
  tmp="$(mktemp "${TMPDIR:-/tmp}/content-pool-env.XXXXXX")"
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
}

cp_env_is_placeholder() {
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

cp_env_set_if_placeholder() {
  local file="$1"
  local key="$2"
  local value="$3"
  local current

  current="$(cp_env_get "$file" "$key")"
  if cp_env_is_placeholder "$current"; then
    cp_env_set "$file" "$key" "$value"
  fi
}

cp_random_secret() {
  local length="${1:-48}"
  cp_require_cmd openssl
  openssl rand -hex "$(( (length + 1) / 2 ))" | cut -c "1-${length}"
}

cp_validate_mode() {
  local mode="$1"
  case "$mode" in
    server|traefik)
      ;;
    *)
      cp_die "Unsupported deployment mode: $mode (expected: server or traefik)"
      ;;
  esac
}

cp_validate_environment() {
  case "$1" in
    staging|production) ;;
    *) cp_die "Unsupported deployment environment: $1 (expected: staging or production)" ;;
  esac
}

cp_validate_release_for_environment() {
  local release="$1"
  local environment="$2"
  [[ "$release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$ ]] || \
    cp_die "Invalid release: $release"
  if [[ "$environment" == "production" && "$release" == *-rc.* ]]; then
    cp_die "Release candidates cannot be deployed to production"
  fi
}

cp_release_asset_url() {
  local repo="$1"
  local release="$2"
  local asset="$3"
  printf 'https://github.com/%s/releases/download/%s/%s' "$repo" "$release" "$asset"
}

cp_download_file() {
  local source="$1"
  local output="$2"
  local token="${CONTENT_POOL_GITHUB_TOKEN:-${GH_TOKEN:-}}"
  local curl_args=(-fsSL)
  cp_require_cmd curl
  if [[ -n "$token" ]]; then
    case "$source" in
      https://github.com/*|https://raw.githubusercontent.com/*)
        curl_args+=(-H "Authorization: Bearer ${token}")
        ;;
    esac
  fi
  case "$source" in
    http://*|https://*) curl "${curl_args[@]}" "$source" -o "$output" || cp_die "Download failed: $source" ;;
    *)
      [[ -f "$source" ]] || cp_die "File not found: $source"
      command cp -f "$source" "$output" || cp_die "Copy failed: $source"
      ;;
  esac
}

cp_validate_tar_archive() {
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

cp_manifest_tool() {
  local repo="$1"
  local release="$2"
  local candidate="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/release_manifest.py"
  if [[ -f "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi

  candidate="$(mktemp "${TMPDIR:-/tmp}/content-pool-release-manifest.XXXXXX.py")"
  cp_download_file \
    "https://raw.githubusercontent.com/${repo}/${release}/scripts/release_manifest.py" \
    "$candidate"
  printf '%s' "$candidate"
}

cp_manifest_get() {
  local tool="$1"
  local manifest="$2"
  local field="$3"
  python3 "$tool" get --manifest "$manifest" --field "$field" || \
    cp_die "Could not read ${field} from release manifest"
}

cp_prepare_release() {
  local repo="$1"
  local release="$2"
  local environment="$3"
  local manifest_source="$4"
  local work_dir="$5"
  local tool manifest archive_name archive_path checksums_path

  cp_validate_environment "$environment"
  cp_require_cmd python3
  cp_require_cmd tar
  mkdir -p "$work_dir/runtime"
  manifest="${work_dir}/release-manifest.json"
  if [[ -n "$manifest_source" ]]; then
    cp_download_file "$manifest_source" "$manifest"
  else
    cp_download_file "$(cp_release_asset_url "$repo" "$release" release-manifest.json)" "$manifest"
  fi

  tool="$(cp_manifest_tool "$repo" "$release")"
  python3 "$tool" validate \
    --manifest "$manifest" \
    --expected-release "$release" \
    --environment "$environment" || cp_die "Release manifest validation failed"

  archive_name="$(cp_manifest_get "$tool" "$manifest" runtime.archive)"
  [[ "$archive_name" == "$(basename "$archive_name")" ]] || cp_die "Unsafe runtime archive name in release manifest"
  archive_path="${work_dir}/${archive_name}"
  if [[ -n "$manifest_source" ]]; then
    case "$manifest_source" in
      http://*|https://*) cp_download_file "${manifest_source%/*}/${archive_name}" "$archive_path" ;;
      *)
        [[ -f "$(dirname "$manifest_source")/${archive_name}" ]] || \
          cp_die "Runtime archive not found next to local manifest: ${archive_name}"
        cp_download_file "$(dirname "$manifest_source")/${archive_name}" "$archive_path"
        ;;
    esac
  else
    cp_download_file "$(cp_release_asset_url "$repo" "$release" "$archive_name")" "$archive_path"
  fi

  checksums_path="${work_dir}/SHA256SUMS"
  if [[ -n "$manifest_source" ]]; then
    case "$manifest_source" in
      http://*|https://*) cp_download_file "${manifest_source%/*}/SHA256SUMS" "$checksums_path" ;;
      *) cp_download_file "$(dirname "$manifest_source")/SHA256SUMS" "$checksums_path" ;;
    esac
  else
    cp_download_file "$(cp_release_asset_url "$repo" "$release" SHA256SUMS)" "$checksums_path"
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
  [[ "$?" -eq 0 ]] || cp_die "Release checksum validation failed"

  python3 "$tool" validate \
    --manifest "$manifest" \
    --expected-release "$release" \
    --environment "$environment" \
    --runtime-archive "$archive_path" || cp_die "Release archive validation failed"

  cp_validate_tar_archive "$archive_path" || cp_die "Unsafe runtime archive"
  tar -xzf "$archive_path" -C "$work_dir/runtime" || cp_die "Extracting runtime archive failed"
  printf '%s' "$tool"
}

cp_apply_manifest_env() {
  local env_file="$1"
  local manifest="$2"
  local environment="$3"
  local tool="$4"
  local compose_project

  cp_env_set "$env_file" DEPLOYMENT_ENV "$environment"
  compose_project="$(cp_env_get "$env_file" COMPOSE_PROJECT_NAME)"
  if [[ -z "$compose_project" ]]; then
    cp_env_set "$env_file" COMPOSE_PROJECT_NAME "content-pool-${environment}"
  fi
  cp_env_set "$env_file" RELEASE_VERSION "$(cp_manifest_get "$tool" "$manifest" release)"
  cp_env_set "$env_file" APPLICATION_VERSION "$(cp_manifest_get "$tool" "$manifest" applicationVersion)"
  cp_env_set "$env_file" RELEASE_COMMIT "$(cp_manifest_get "$tool" "$manifest" sourceCommit)"
  cp_env_set "$env_file" RELEASE_BUILT_AT "$(cp_manifest_get "$tool" "$manifest" builtAt)"
  cp_env_set "$env_file" CONTENT_POOL_BACKEND_IMAGE "$(cp_manifest_get "$tool" "$manifest" images.backend)"
  cp_env_set "$env_file" CONTENT_POOL_FRONTEND_IMAGE "$(cp_manifest_get "$tool" "$manifest" images.frontend)"
}

cp_validate_required_configuration() {
  local env_file="$1"
  local manifest="$2"
  local key value
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    value="$(cp_env_get "$env_file" "$key")"
    if [[ -z "$value" ]]; then
      cp_warn "Release requires missing configuration key: $key"
      return 1
    fi
  done < <(python3 - "$manifest" <<'PY'
import json, sys
for key in json.load(open(sys.argv[1], encoding="utf-8"))["requiredConfiguration"]:
    print(key)
PY
  )
}

cp_set_compose_args() {
  local mode="$1"
  local override="${2:-}"
  cp_validate_mode "$mode"
  CONTENT_POOL_COMPOSE_ARGS=(-f docker-compose.server.yml)
  if [[ "$mode" == "traefik" ]]; then
    CONTENT_POOL_COMPOSE_ARGS+=(-f docker-compose.traefik.yml)
  fi
  if [[ -n "$override" ]]; then
    [[ -f "$override" ]] || cp_die "Compose override not found: $override"
    CONTENT_POOL_COMPOSE_ARGS+=(-f "$override")
  fi
}

cp_compose_container_id() {
  local service="$1"
  local container
  container="$(docker compose "${CONTENT_POOL_COMPOSE_ARGS[@]}" ps -q "$service" 2>/dev/null | head -n 1)"
  [[ -n "$container" ]] || return 1
  printf '%s' "$container"
}

cp_compose_service_running() {
  local service="$1"
  local container state
  container="$(cp_compose_container_id "$service")" || return 1
  state="$(docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null)" || return 1
  [[ "$state" == "true" ]]
}

cp_sha256_file() {
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

cp_write_sha256s() {
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

cp_verify_sha256s() {
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

cp_detect_mode() {
  local env_file="${1:-.env}"
  local content_host
  content_host="$(cp_env_get "$env_file" CONTENT_POOL_HOST)"
  if [[ -f docker-compose.traefik.yml ]] && ! cp_env_is_placeholder "$content_host"; then
    printf 'traefik'
  else
    printf 'server'
  fi
}

cp_download_source() {
  local repo="$1"
  local ref="$2"
  local temp_dir tarball source_dir

  cp_require_cmd curl
  cp_require_cmd tar

  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/content-pool-source.XXXXXX")"
  tarball="${temp_dir}/source.tar.gz"

  cp_info "Downloading ${repo}@${ref}" >&2
  curl -fsSL "https://github.com/${repo}/archive/${ref}.tar.gz" -o "$tarball"
  tar -xzf "$tarball" -C "$temp_dir"

  source_dir="$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [[ -n "$source_dir" ]] || cp_die "Downloaded archive did not contain a source directory"
  printf '%s' "$source_dir"
}

cp_copy_file_if_present() {
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

cp_copy_tree_if_present() {
  local source_root="$1"
  local target_root="$2"
  local path="$3"

  if [[ -d "${source_root}/${path}" ]]; then
    mkdir -p "${target_root}"
    (cd "$source_root" && tar -cf - "$path") | (cd "$target_root" && tar -xf -)
  fi
}

cp_install_runtime_artifacts() {
  local source_root="$1"
  local target_root="$2"
  local source_abs target_abs

  source_abs="$(cd "$source_root" && pwd -P)"
  target_abs="$(cp_abs_path "$target_root")"

  if [[ "$source_abs" == "$target_abs" ]]; then
    cp_info "Using current repository as deployment directory"
    return 0
  fi

  cp_info "Installing deployment artifacts into ${target_abs}"

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
    cp_copy_file_if_present "$source_abs" "$target_abs" "$file"
  done

  cp_copy_tree_if_present "$source_abs" "$target_abs" keycloak

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
    scripts/make/server.mk
  do
    cp_copy_file_if_present "$source_abs" "$target_abs" "$file"
  done

  if [[ -f "${source_abs}/scripts/make/server.mk" ]] && [[ ! -d "${target_abs}/backend" || ! -d "${target_abs}/frontend" ]]; then
    command cp -f "${source_abs}/scripts/make/server.mk" "${target_abs}/Makefile"
  elif [[ -f "${source_abs}/Makefile" && ! -f "${target_abs}/Makefile" ]]; then
    command cp -f "${source_abs}/Makefile" "${target_abs}/Makefile"
  fi

  chmod +x "${target_abs}"/scripts/*.sh 2>/dev/null || true
}

cp_has_running_container() {
  local name="$1"
  docker ps --format '{{.Names}}' | grep -Fx "$name" >/dev/null 2>&1
}
