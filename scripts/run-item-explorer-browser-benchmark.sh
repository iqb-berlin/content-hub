#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_ROOT="${ITEM_EXPLORER_BENCHMARK_BASELINE_ROOT:-}"
CANDIDATE_ROOT="${ITEM_EXPLORER_BENCHMARK_CANDIDATE_ROOT:-$REPOSITORY_ROOT}"
EXPECTED_BASELINE_REVISION="${ITEM_EXPLORER_BENCHMARK_BASELINE_REVISION:-5cb549b}"
BENCHMARK_RUNS="${ITEM_EXPLORER_BENCHMARK_RUNS:-6}"
DATABASE_CONTAINER="content-hub-browser-benchmark-$$"
DATABASE_PORT="${ITEM_EXPLORER_BENCHMARK_DATABASE_PORT:-55432}"
DATABASE_CONTAINER_STARTED=false
RESULT_DIRECTORY="${ITEM_EXPLORER_BENCHMARK_RESULT_DIR:-$REPOSITORY_ROOT/frontend/benchmark-results/item-explorer-ab-$(date +%Y%m%d-%H%M%S)-$$}"

validate_app_root() {
  local app_root="$1"
  local label="$2"
  if [[ ! -f "$app_root/backend/package.json" ||
    ! -f "$app_root/frontend/package.json" ]]; then
    echo "$label root must contain prepared backend and frontend checkouts: $app_root" >&2
    exit 1
  fi
}

revision_for() {
  local app_root="$1"
  local revision
  revision="$(git -C "$app_root" rev-parse HEAD)"
  if [[ -n "$(git -C "$app_root" status --porcelain)" ]]; then
    revision="${revision}-dirty"
  fi
  printf "%s" "$revision"
}

validate_baseline_revision() {
  local actual_revision
  local expected_revision
  if ! expected_revision="$(
    git -C "$BASELINE_ROOT" rev-parse --verify \
      "${EXPECTED_BASELINE_REVISION}^{commit}" 2>/dev/null
  )"; then
    echo "Baseline revision does not exist: $EXPECTED_BASELINE_REVISION" >&2
    exit 1
  fi
  actual_revision="$(git -C "$BASELINE_ROOT" rev-parse HEAD)"
  if [[ "$actual_revision" != "$expected_revision" ]]; then
    echo "Baseline root must be at $EXPECTED_BASELINE_REVISION, found $actual_revision." >&2
    exit 1
  fi
  if [[ -n "$(git -C "$BASELINE_ROOT" status --porcelain --untracked-files=no)" ]]; then
    echo "Baseline root must not contain tracked changes: $BASELINE_ROOT" >&2
    exit 1
  fi
}

cleanup() {
  if [[ "$DATABASE_CONTAINER_STARTED" == "true" ]]; then
    docker stop "$DATABASE_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "$BASELINE_ROOT" ]]; then
  echo "ITEM_EXPLORER_BENCHMARK_BASELINE_ROOT must point to the prepared baseline worktree." >&2
  exit 1
fi
if [[ ! "$BENCHMARK_RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ITEM_EXPLORER_BENCHMARK_RUNS must be a positive even integer." >&2
  exit 1
fi
BENCHMARK_RUNS=$((10#$BENCHMARK_RUNS))
if ((BENCHMARK_RUNS % 2 != 0)); then
  echo "ITEM_EXPLORER_BENCHMARK_RUNS must be a positive even integer." >&2
  exit 1
fi

BASELINE_ROOT="$(cd "$BASELINE_ROOT" && pwd)"
CANDIDATE_ROOT="$(cd "$CANDIDATE_ROOT" && pwd)"
validate_app_root "$BASELINE_ROOT" "Baseline"
validate_app_root "$CANDIDATE_ROOT" "Candidate"
validate_baseline_revision

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to run the Item Explorer browser benchmark." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "A running Docker daemon is required to run the Item Explorer browser benchmark." >&2
  exit 1
}
docker run --rm -d \
  --name "$DATABASE_CONTAINER" \
  -e POSTGRES_DB=contenthub_e2e \
  -e POSTGRES_USER=contenthub \
  -e POSTGRES_PASSWORD=contenthub_dev \
  -p "$DATABASE_PORT:5432" \
  postgres:16-alpine >/dev/null
DATABASE_CONTAINER_STARTED=true

database_ready=false
for _attempt in $(seq 1 30); do
  if docker exec "$DATABASE_CONTAINER" \
    pg_isready -U contenthub -d contenthub_e2e >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done
if [[ "$database_ready" != "true" ]]; then
  echo "The benchmark database did not become ready." >&2
  exit 1
fi

mkdir -p "$RESULT_DIRECTORY"
(cd "$REPOSITORY_ROOT/frontend" && npx playwright install chromium)

result_files=()
run_variant() {
  local variant="$1"
  local run_index="$2"
  local app_root="$3"
  local revision
  local result_path
  revision="$(revision_for "$app_root")"
  result_path="$RESULT_DIRECTORY/run-$(printf "%02d" "$run_index")-$variant.json"
  printf "Benchmark run %s/%s: %s (%s)\n" \
    "$run_index" "$BENCHMARK_RUNS" "$variant" "$revision"

  ITEM_EXPLORER_BENCHMARK_VARIANT="$variant" \
    ITEM_EXPLORER_BENCHMARK_APP_ROOT="$app_root" \
    ITEM_EXPLORER_BENCHMARK_REVISION="$revision" \
    ITEM_EXPLORER_BENCHMARK_RUN_INDEX="$run_index" \
    ITEM_EXPLORER_BENCHMARK_RESULT="$result_path" \
    BROWSER_E2E_USE_EXISTING_DATABASE=true \
    BROWSER_E2E_DATABASE_PORT="$DATABASE_PORT" \
    BROWSER_E2E_SEED_SCRIPT=test:e2e:seed-browser-benchmark \
    BROWSER_E2E_SKIP_BROWSER_INSTALL=true \
    "$REPOSITORY_ROOT/scripts/run-browser-e2e.sh" \
    --config playwright.benchmark.config.ts
  result_files+=("$result_path")
}

for run_index in $(seq 1 "$BENCHMARK_RUNS"); do
  if ((run_index % 2 == 1)); then
    run_variant "baseline" "$run_index" "$BASELINE_ROOT"
    run_variant "candidate" "$run_index" "$CANDIDATE_ROOT"
  else
    run_variant "candidate" "$run_index" "$CANDIDATE_ROOT"
    run_variant "baseline" "$run_index" "$BASELINE_ROOT"
  fi
done

node "$REPOSITORY_ROOT/scripts/validate-item-explorer-browser-benchmark.mjs" \
  --expected-runs "$BENCHMARK_RUNS" \
  --output "$RESULT_DIRECTORY/summary.json" \
  "${result_files[@]}"

printf "Benchmark summary: %s\n" "$RESULT_DIRECTORY/summary.json"
