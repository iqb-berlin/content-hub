#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
for script in "$ROOT_DIR"/scripts/*.sh; do
  bash -n "$script"
done

grep -q 'up -d --wait --wait-timeout 120' "$ROOT_DIR/scripts/restore.sh" || {
  echo "restore does not wait for both PostgreSQL services" >&2
  exit 1
}
grep -q 'up -d --wait --wait-timeout 180' "$ROOT_DIR/scripts/restore.sh" || {
  echo "restore does not wait for the complete application stack" >&2
  exit 1
}
[[ "$(grep -c 'run_compose up -d --wait --wait-timeout 180' "$ROOT_DIR/scripts/update.sh")" -eq 3 ]] || {
  echo "not every managed update/rollback start waits for stack readiness" >&2
  exit 1
}

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/content-hub-script-test.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT
mkdir -p "$temp_dir/scripts" "$temp_dir/bin"
cp "$ROOT_DIR/.env.example" "$temp_dir/.env"
cp "$ROOT_DIR/scripts/update.sh" "$ROOT_DIR/scripts/deploy-common.sh" "$temp_dir/scripts/"

(
  # Exercise the same bundle-to-target copy used by install.sh and update.sh.
  . "$ROOT_DIR/scripts/deploy-common.sh"
  runtime_source="$temp_dir/runtime-source"
  runtime_target="$temp_dir/runtime-target"
  runbook="docs/operations/content-hub-branding.md"
  mkdir -p "$runtime_source"
  "$ROOT_DIR/scripts/build-runtime-bundle.sh" "$temp_dir/branding-runtime.tar.gz" >/dev/null
  tar -xzf "$temp_dir/branding-runtime.tar.gz" -C "$runtime_source"

  ch_install_runtime_artifacts "$runtime_source" "$runtime_target" >/dev/null
  cmp "$ROOT_DIR/$runbook" "$runtime_target/$runbook"

  # Updates must replace a stale runbook while retaining unrelated local docs.
  printf 'old branding instructions\n' >"$runtime_target/$runbook"
  printf 'local operator notes\n' >"$runtime_target/docs/operator-notes.txt"
  ch_install_runtime_artifacts "$runtime_source" "$runtime_target" >/dev/null
  cmp "$ROOT_DIR/$runbook" "$runtime_target/$runbook"
  test "$(cat "$runtime_target/docs/operator-notes.txt")" = 'local operator notes'

  # Only one version of the renamed provider may be loaded by Keycloak.
  printf 'new provider\n' >"$runtime_source/keycloak/providers/content-hub-keycloak-altcha.jar"
  printf 'old provider\n' >"$runtime_target/keycloak/providers/content-pool-keycloak-altcha.jar"
  ch_install_runtime_artifacts "$runtime_source" "$runtime_target" >/dev/null
  test ! -f "$runtime_target/keycloak/providers/content-pool-keycloak-altcha.jar"
  cmp "$runtime_source/keycloak/providers/content-hub-keycloak-altcha.jar" "$runtime_target/keycloak/providers/content-hub-keycloak-altcha.jar"
  mkdir -p "$temp_dir/old-provider/keycloak/providers"
  printf 'old provider\n' >"$temp_dir/old-provider/keycloak/providers/content-pool-keycloak-altcha.jar"
  tar -C "$temp_dir/old-provider" -czf "$temp_dir/old-provider.tgz" keycloak
  (
    cd "$runtime_target"
    tar -xzf "$temp_dir/old-provider.tgz"
    ch_reconcile_provider_archive "$temp_dir/old-provider.tgz"
    test ! -f keycloak/providers/content-hub-keycloak-altcha.jar
    test -f keycloak/providers/content-pool-keycloak-altcha.jar
  )

  # Older release bundles did not contain this optional document.
  rm "$runtime_source/$runbook"
  ch_install_runtime_artifacts "$runtime_source" "$temp_dir/legacy-runtime-target" >/dev/null
  test ! -e "$temp_dir/legacy-runtime-target/$runbook"
)

cat > "$temp_dir/bin/docker" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == compose && "${2:-}" == version ]]; then exit 0; fi
exit 0
SH
chmod +x "$temp_dir/bin/docker"

(
  cd "$temp_dir"
  PATH="$temp_dir/bin:$PATH" ./scripts/update.sh \
    --environment staging --release v0.2.0-rc.1 --dry-run >/dev/null
)

if (
  cd "$temp_dir"
  PATH="$temp_dir/bin:$PATH" ./scripts/update.sh \
    --environment production --release v0.2.0-rc.1 --dry-run >/dev/null 2>&1
); then
  echo "production accepted a release candidate" >&2
  exit 1
fi

fixture_dir="$temp_dir/release-fixture"
mkdir -p "$fixture_dir/source"
printf 'verified runtime\n' >"$fixture_dir/source/probe.txt"
tar -C "$fixture_dir/source" -czf "$fixture_dir/runtime.tar.gz" probe.txt
runtime_sha="$(sha256sum "$fixture_dir/runtime.tar.gz" | awk '{print $1}')"
"$ROOT_DIR/scripts/release_manifest.py" create \
  --release v0.2.0-rc.1 \
  --application-version 0.2.0 \
  --commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --built-at 2026-07-22T10:00:00Z \
  --backend-image "ghcr.io/example/backend@sha256:$(printf 'b%.0s' {1..64})" \
  --frontend-image "ghcr.io/example/frontend@sha256:$(printf 'c%.0s' {1..64})" \
  --runtime-archive runtime.tar.gz \
  --runtime-sha256 "$runtime_sha" \
  --migration-classification none \
  --output "$fixture_dir/release-manifest.json"
(
  cd "$fixture_dir"
  sha256sum runtime.tar.gz release-manifest.json >SHA256SUMS
)
(
  # shellcheck source=deploy-common.sh
  . "$ROOT_DIR/scripts/deploy-common.sh"
  cp "$ROOT_DIR/.env.example" "$fixture_dir/legacy.env"
  ch_env_set "$fixture_dir/legacy.env" COMPOSE_PROJECT_NAME legacy-content-pool
  ch_apply_manifest_env "$fixture_dir/legacy.env" "$fixture_dir/release-manifest.json" \
    staging "$ROOT_DIR/scripts/release_manifest.py"
  test "$(ch_env_get "$fixture_dir/legacy.env" COMPOSE_PROJECT_NAME)" = legacy-content-pool

  printf 'CONTENT_POOL_HOST=iqb-contentpool.de\n' >"$fixture_dir/aliases.env"
  test "$(ch_env_get "$fixture_dir/aliases.env" CONTENT_HUB_HOST)" = iqb-contentpool.de
  printf 'CONTENT_HUB_HOST=\n' >>"$fixture_dir/aliases.env"
  test "$(ch_env_get "$fixture_dir/aliases.env" CONTENT_HUB_HOST)" = iqb-contentpool.de
  ch_env_set "$fixture_dir/aliases.env" CONTENT_HUB_HOST iqb-contentpool.de
  test "$(ch_env_get "$fixture_dir/aliases.env" CONTENT_POOL_HOST)" = iqb-contentpool.de
  printf 'CONTENT_HUB_HOST=conflicting.example.com\n' >>"$fixture_dir/aliases.env"
  if (ch_env_get "$fixture_dir/aliases.env" CONTENT_HUB_HOST) >/dev/null 2>&1; then
    echo 'conflicting legacy configuration was accepted' >&2
    exit 1
  fi

  cp "$ROOT_DIR/.env.example" "$fixture_dir/fresh.env"
  ch_apply_manifest_env "$fixture_dir/fresh.env" "$fixture_dir/release-manifest.json" \
    staging "$ROOT_DIR/scripts/release_manifest.py"
  test "$(ch_env_get "$fixture_dir/fresh.env" COMPOSE_PROJECT_NAME)" = content-hub-staging

  mkdir -p "$fixture_dir/backup-check"
  printf 'backup fixture\n' >"$fixture_dir/backup-check/probe.txt"
  ch_write_sha256s "$fixture_dir/backup-check" probe.txt
  ch_verify_sha256s "$fixture_dir/backup-check"
  printf 'corrupt\n' >>"$fixture_dir/backup-check/probe.txt"
  if ch_verify_sha256s "$fixture_dir/backup-check" >/dev/null 2>&1; then
    echo "backup checksum verification accepted corrupted data" >&2
    exit 1
  fi
)
(
  # shellcheck source=deploy-common.sh
  . "$ROOT_DIR/scripts/deploy-common.sh"
  ch_prepare_release example/repository v0.2.0-rc.1 staging \
    "$fixture_dir/release-manifest.json" "$fixture_dir/prepared" >/dev/null
  test -f "$fixture_dir/prepared/runtime/probe.txt"
)

printf 'corrupt\n' >>"$fixture_dir/runtime.tar.gz"
if (
  . "$ROOT_DIR/scripts/deploy-common.sh"
  ch_prepare_release example/repository v0.2.0-rc.1 staging \
    "$fixture_dir/release-manifest.json" "$fixture_dir/corrupt" >/dev/null 2>&1
); then
  echo "release preparation accepted a checksum mismatch" >&2
  exit 1
fi

if (
  cd "$temp_dir"
  PATH="$temp_dir/bin:$PATH" ./scripts/update.sh \
    --environment staging \
    --release v0.2.0-rc.1 \
    --manifest "$fixture_dir/release-manifest.json" \
    --no-backup \
    --no-keycloak-user-check \
    --yes >/dev/null 2>&1
); then
  echo "managed update accepted a corrupt release bundle" >&2
  exit 1
fi
record="$(find "$temp_dir/deployments" -type f -name '*.json' | head -n 1)"
python3 - "$record" <<'PY'
import json
import sys

record = json.load(open(sys.argv[1], encoding="utf-8"))
assert record["status"] == "failed"
assert record["environment"] == "staging"
assert record["target"]["release"] == "v0.2.0-rc.1"
PY

adopt_dir="$temp_dir/adopt"
mkdir -p "$adopt_dir/scripts"
cp "$ROOT_DIR/.env.example" "$adopt_dir/.env"
cp "$ROOT_DIR/scripts/update.sh" "$ROOT_DIR/scripts/deploy-common.sh" "$adopt_dir/scripts/"
cat > "$temp_dir/bin/docker" <<'SH'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == compose ]]; then
  if [[ "${2:-}" == version ]]; then exit 0; fi
  service="${*: -1}"
  case "$service" in
    content-hub-api) printf 'legacy-api-id\n' ;;
    nginx) printf 'legacy-nginx-id\n' ;;
  esac
  exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  container="${2:-}"
  case "$*" in
    *State.Running*) printf 'true\n' ;;
    *com.docker.compose.project*) printf 'legacy-project\n' ;;
    *.Image*)
      case "$container" in
        legacy-api-id) printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' ;;
        legacy-nginx-id) printf 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' ;;
      esac
      ;;
  esac
  exit 0
fi
if [[ "${1:-}" == image && "${2:-}" == inspect ]]; then
  case "${3:-}" in
    sha256:aaaaaaaa*) printf 'ghcr.io/example/backend@sha256:%064d\n' 1 ;;
    sha256:bbbbbbbb*) printf 'ghcr.io/example/frontend@sha256:%064d\n' 2 ;;
  esac
  exit 0
fi
exit 0
SH
chmod +x "$temp_dir/bin/docker"
(
  cd "$adopt_dir"
  PATH="$temp_dir/bin:$PATH" ./scripts/update.sh \
    --mode server --environment production --adopt-current v0.1.3 >/dev/null
  # shellcheck source=deploy-common.sh
  . ./scripts/deploy-common.sh
  test "$(ch_env_get .env COMPOSE_PROJECT_NAME)" = legacy-project
  test "$(ch_env_get .env RELEASE_VERSION)" = v0.1.3
  ch_verify_sha256s baselines/v0.1.3
  rollback_plan="$(PATH="$temp_dir/bin:$PATH" ./scripts/update.sh \
    --mode server --environment production --rollback-to v0.1.3 --dry-run)"
  grep -q 'Would use local legacy baseline' <<<"$rollback_plan"
  python3 - baselines/v0.1.3/manifest.json <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data["composeProject"] == "legacy-project"
assert data["images"]["backend"].endswith("@sha256:" + "0" * 63 + "1")
assert data["images"]["frontend"].endswith("@sha256:" + "0" * 63 + "2")
assert data["runtime"]["archive"] == "runtime.tgz"
PY
)

cat > "$temp_dir/bin/docker" <<'SH'
#!/usr/bin/env bash
set -eu
if [[ "$1" == compose ]]; then
  case "$*" in
    *'config --services'*) printf 'content-pool-api\ncontent-pool-db\nnginx\n' ;;
    *'ps -q content-pool-db'*) [[ "${TRANSITION_MISSING_DB:-false}" == true ]] || printf 'legacy-db-id\n' ;;
    *'stop content-pool-api content-pool-db'*) printf 'stopped\n' >"$TRANSITION_STOP_LOG" ;;
    *) exit 1 ;;
  esac
elif [[ "$1" == inspect ]]; then
  case "$*" in
    *com.docker.compose.service*) printf 'content-pool-db\n' ;;
    *com.docker.compose.project*) printf 'legacy-content-pool\n' ;;
    *Mounts*) printf 'legacy-content-pool_content-pool-db-data\n' ;;
    *) exit 1 ;;
  esac
else
  exit 1
fi
SH
chmod +x "$temp_dir/bin/docker"
(
  . "$ROOT_DIR/scripts/deploy-common.sh"
  export PATH="$temp_dir/bin:$PATH"
  export TRANSITION_STOP_LOG="$temp_dir/stopped-services"
  CONTENT_HUB_COMPOSE_ARGS=(-f docker-compose.server.yml)
  transition_env="$temp_dir/transition.env"
  printf 'CONTENT_POOL_HOST=iqb-contentpool.de\nPOSTGRES_DB=content_pool\nPOSTGRES_USER=content_pool\nOIDC_CLIENT_ID=contentpool\n' >"$transition_env"
  ch_prepare_identifier_transition "$temp_dir/runtime-source" "$transition_env" >/dev/null
  test "$(ch_env_get "$transition_env" CONTENT_HUB_HOST)" = iqb-contentpool.de
  test "$(ch_env_get "$transition_env" CONTENT_HUB_DB_VOLUME)" = legacy-content-pool_content-pool-db-data
  test "$(ch_env_get "$transition_env" COMPOSE_PROJECT_NAME)" = legacy-content-pool
  test "$(ch_env_get "$transition_env" POSTGRES_DB)" = content_pool
  test "$(ch_env_get "$transition_env" OIDC_CLIENT_ID)" = contentpool
  test -f "$TRANSITION_STOP_LOG"
  # A mismatched volume must stop the transition before touching services.
  rm "$TRANSITION_STOP_LOG"
  ch_env_set "$transition_env" CONTENT_HUB_DB_VOLUME different-volume
  if (ch_prepare_identifier_transition "$temp_dir/runtime-source" "$transition_env") >/dev/null 2>&1; then
    echo 'database volume mismatch was accepted' >&2
    exit 1
  fi
  test ! -f "$TRANSITION_STOP_LOG"
  # A stopped/unavailable old database must never select an empty new volume.
  export TRANSITION_MISSING_DB=true
  if (ch_prepare_identifier_transition "$temp_dir/runtime-source" "$transition_env") >/dev/null 2>&1; then
    echo 'unavailable legacy database was accepted' >&2
    exit 1
  fi
)

echo "Deployment script checks passed"
