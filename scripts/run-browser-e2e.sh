#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_CONTAINER="content-pool-browser-e2e-$$"
DATABASE_PORT="${BROWSER_E2E_DATABASE_PORT:-55432}"
USE_EXISTING_DATABASE="${BROWSER_E2E_USE_EXISTING_DATABASE:-false}"
DATABASE_CONTAINER_STARTED=false
SEED_SCRIPT="${BROWSER_E2E_SEED_SCRIPT:-test:e2e:seed-browser}"
SKIP_BROWSER_INSTALL="${BROWSER_E2E_SKIP_BROWSER_INSTALL:-false}"
RUN_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/content-pool-e2e.XXXXXXXX")"

# The seed, uploads, and snapshots must never share the application's regular
# storage directory (or a previous browser run's fixture files).
export BROWSER_E2E_FIXTURE_DIR="$RUN_DIRECTORY/fixtures"
export FILE_STORAGE_PATH="$RUN_DIRECTORY/uploads"

export NODE_ENV=test
export DB_HOST=127.0.0.1
export DB_PORT="$DATABASE_PORT"
export DB_USERNAME=contentpool
export DB_PASSWORD=contentpool_dev
export DB_DATABASE=contentpool_e2e
export DB_SYNCHRONIZE=true
export DB_RUN_MIGRATIONS=false
export JWT_SECRET=browser-e2e-secret-at-least-32-characters
export PORT=3100
export CORS_ORIGIN=http://127.0.0.1:4300
export BROWSER_E2E_BACKEND_PORT=3100
export BROWSER_E2E_FRONTEND_PORT=4300

cleanup() {
  if [[ "$USE_EXISTING_DATABASE" != "true" && "$DATABASE_CONTAINER_STARTED" == "true" ]]; then
    docker stop "$DATABASE_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ "$RUN_DIRECTORY" == "${TMPDIR:-/tmp}/content-pool-e2e."* && -d "$RUN_DIRECTORY" ]]; then
    rm -rf -- "$RUN_DIRECTORY"
  fi
}
trap cleanup EXIT

if [[ "$USE_EXISTING_DATABASE" != "true" ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "Docker is required to start the isolated browser E2E database." >&2
    exit 1
  }
  docker info >/dev/null 2>&1 || {
    echo "A running Docker daemon is required to start the isolated browser E2E database." >&2
    exit 1
  }
  docker run --rm -d \
    --name "$DATABASE_CONTAINER" \
    -e POSTGRES_DB="$DB_DATABASE" \
    -e POSTGRES_USER="$DB_USERNAME" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -p "$DATABASE_PORT:5432" \
    postgres:16-alpine >/dev/null
  DATABASE_CONTAINER_STARTED=true

  database_ready=false
  for _attempt in $(seq 1 30); do
    if docker exec "$DATABASE_CONTAINER" \
      pg_isready -U "$DB_USERNAME" -d "$DB_DATABASE" >/dev/null 2>&1; then
      database_ready=true
      break
    fi
    sleep 1
  done
  if [[ "$database_ready" != "true" ]]; then
    echo "The isolated browser E2E database did not become ready." >&2
    exit 1
  fi
fi

if [[ "$SKIP_BROWSER_INSTALL" != "true" ]]; then
  (cd "$REPOSITORY_ROOT/frontend" && npx playwright install chromium firefox webkit)
fi
(cd "$REPOSITORY_ROOT/backend" && npm run "$SEED_SCRIPT")
# The seed process has already synchronized the complete schema. Repeating
# synchronization during the Playwright backend startup is redundant and makes
# TypeORM issue concurrent pg queries on one schema-inspection client.
export DB_SYNCHRONIZE=false
(cd "$REPOSITORY_ROOT/frontend" && npm run e2e:playwright -- "$@")
