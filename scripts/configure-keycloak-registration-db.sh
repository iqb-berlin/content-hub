#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.server.yml -f docker-compose.traefik.yml}"
ALTCHA_PROVIDER_JAR="${ALTCHA_PROVIDER_JAR:-keycloak/providers/content-hub-keycloak-altcha.jar}"
KEYCLOAK_IMAGE="${KEYCLOAK_IMAGE:-}"

# COMPOSE_FILES is intentionally a command-fragment env var, matching the
# existing deployment scripts in this repository.
# shellcheck disable=SC2206
COMPOSE_ARGS=($COMPOSE_FILES)

read_env_value() {
  local key="$1"
  local default_value="${2:-}"
  local line
  local value

  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi

  if [[ -f "$ENV_FILE" ]]; then
    line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      value="${line#*=}"
      value="${value%$'\r'}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      printf '%s' "$value"
      return 0
    fi
  fi

  printf '%s' "$default_value"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

validate_compose_args() {
  local expect_file=0
  local arg

  if [[ ${#COMPOSE_ARGS[@]} -eq 0 ]]; then
    echo "COMPOSE_FILES must not be empty." >&2
    exit 1
  fi

  for arg in "${COMPOSE_ARGS[@]}"; do
    if (( expect_file )); then
      if [[ ! -f "$arg" ]]; then
        echo "Compose file not found: $arg" >&2
        exit 1
      fi
      expect_file=0
      continue
    fi

    case "$arg" in
      -f|--file)
        expect_file=1
        ;;
      -f*)
        if [[ ! -f "${arg#-f}" ]]; then
          echo "Compose file not found: ${arg#-f}" >&2
          exit 1
        fi
        ;;
      --file=*)
        if [[ ! -f "${arg#--file=}" ]]; then
          echo "Compose file not found: ${arg#--file=}" >&2
          exit 1
        fi
        ;;
    esac
  done

  if (( expect_file )); then
    echo "COMPOSE_FILES ends with -f/--file but no file path." >&2
    exit 1
  fi
}

resolve_keycloak_image() {
  local image

  if command -v python3 >/dev/null 2>&1; then
    image="$(
      sudo docker compose "${COMPOSE_ARGS[@]}" config --format json keycloak |
        python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("services", {}).get("keycloak", {}).get("image", ""))
'
    )"
  else
    image="$(
      sudo docker compose "${COMPOSE_ARGS[@]}" config keycloak |
        awk '
          $0 == "  keycloak:" { in_keycloak = 1; next }
          in_keycloak && $0 ~ /^  [^[:space:]][^:]*:/ { in_keycloak = 0 }
          in_keycloak && $1 == "image:" { print $2; exit }
        '
    )"
  fi

  if [[ -z "$image" ]]; then
    echo "Could not resolve Keycloak image from Docker Compose service 'keycloak'." >&2
    echo "Set KEYCLOAK_IMAGE explicitly to override." >&2
    exit 1
  fi

  printf '%s' "$image"
}

validate_keycloak_provider() {
  local provider_dir
  local provider_dir_abs
  local provider_name

  if [[ ! -s "$ALTCHA_PROVIDER_JAR" ]]; then
    echo "ALTCHA provider JAR missing or empty: $ALTCHA_PROVIDER_JAR" >&2
    echo "Run: make keycloak-altcha-provider" >&2
    exit 1
  fi

  provider_dir="$(dirname -- "$ALTCHA_PROVIDER_JAR")"
  provider_name="$(basename -- "$ALTCHA_PROVIDER_JAR")"
  provider_dir_abs="$(cd "$provider_dir" && pwd -P)"

  echo "Validating ALTCHA provider with Keycloak build..."
  sudo docker run --rm \
    --entrypoint /bin/sh \
    -v "${provider_dir_abs}:/opt/keycloak/providers:ro" \
    "$KEYCLOAK_IMAGE" \
    -c '
    set -eu
    test -s "/opt/keycloak/providers/$1"
    /opt/keycloak/bin/kc.sh build >/tmp/keycloak-build.log 2>&1 || {
      cat /tmp/keycloak-build.log >&2
      exit 1
    }
  ' sh "$provider_name" >/dev/null
}

new_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    date +%s%N | sha256sum | cut -c1-32
  fi
}

require_command sudo
require_command docker

KEYCLOAK_REALM="$(read_env_value KEYCLOAK_REALM iqb)"
KEYCLOAK_DB_USER="$(read_env_value KEYCLOAK_DB_USER keycloak)"
KEYCLOAK_DB_NAME="$(read_env_value KEYCLOAK_DB_NAME keycloak)"
REGISTRATION_FLOW_ALIAS="$(read_env_value KEYCLOAK_REGISTRATION_FLOW_ALIAS registration)"
REGISTRATION_FORM_FLOW_ALIAS="$(read_env_value KEYCLOAK_REGISTRATION_FORM_FLOW_ALIAS "registration form")"
KEYCLOAK_IMAGE="$(read_env_value KEYCLOAK_IMAGE "$KEYCLOAK_IMAGE")"
ALTCHA_PROVIDER_ID="registration-altcha-action"
EXECUTION_ID="$(new_id)"

validate_compose_args
sudo -v
echo "Validating Docker Compose configuration..."
sudo docker compose "${COMPOSE_ARGS[@]}" config >/dev/null
if [[ -z "$KEYCLOAK_IMAGE" ]]; then
  KEYCLOAK_IMAGE="$(resolve_keycloak_image)"
fi
validate_keycloak_provider

sudo docker exec -i keycloak-db psql \
  -v ON_ERROR_STOP=1 \
  -v realm_name="$KEYCLOAK_REALM" \
  -v flow_alias="$REGISTRATION_FLOW_ALIAS" \
  -v form_flow_alias="$REGISTRATION_FORM_FLOW_ALIAS" \
  -v provider_id="$ALTCHA_PROVIDER_ID" \
  -v execution_id="$EXECUTION_ID" \
  -U "$KEYCLOAK_DB_USER" \
  -d "$KEYCLOAK_DB_NAME" <<'SQL'
BEGIN;

CREATE TEMP TABLE _realm AS
SELECT id, registration_flow
FROM realm
WHERE name = :'realm_name';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM _realm;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one realm, found %', n;
  END IF;
END $$;

UPDATE realm
SET registration_allowed = true,
    verify_email = true,
    duplicate_emails_allowed = false,
    login_with_email_allowed = true
WHERE id IN (SELECT id FROM _realm);

CREATE TEMP TABLE _top_flow AS
SELECT id, alias
FROM (
  SELECT f.id, f.alias, 0 AS ord
  FROM authentication_flow f
  JOIN _realm r ON r.id = f.realm_id
  WHERE f.id = r.registration_flow
     OR f.alias = r.registration_flow
  UNION ALL
  SELECT f.id, f.alias, 1 AS ord
  FROM authentication_flow f
  JOIN _realm r ON r.id = f.realm_id
  WHERE f.alias = :'flow_alias'
) candidates
ORDER BY ord
LIMIT 1;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM _top_flow;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Could not find top-level registration flow';
  END IF;
END $$;

CREATE TEMP TABLE _form_flow AS
SELECT id, alias
FROM (
  SELECT child.id, child.alias, 0 AS ord
  FROM authentication_execution auth_exec
  JOIN _top_flow top_flow ON auth_exec.flow_id = top_flow.id
  JOIN authentication_flow child ON child.id = auth_exec.auth_flow_id
  WHERE auth_exec.authenticator = 'registration-page-form'
    AND auth_exec.authenticator_flow = true
  UNION ALL
  SELECT f.id, f.alias, 1 AS ord
  FROM authentication_flow f
  JOIN _realm r ON r.id = f.realm_id
  WHERE f.alias = :'form_flow_alias'
) candidates
ORDER BY ord
LIMIT 1;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM _form_flow;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Could not find registration form flow';
  END IF;
END $$;

DELETE FROM authentication_execution
WHERE flow_id IN (SELECT id FROM _top_flow)
  AND authenticator = :'provider_id';

UPDATE authentication_execution
SET requirement = 0
WHERE flow_id IN (SELECT id FROM _form_flow)
  AND authenticator = :'provider_id';

INSERT INTO authentication_execution (
  id,
  realm_id,
  flow_id,
  authenticator,
  auth_config,
  auth_flow_id,
  requirement,
  priority,
  authenticator_flow
)
SELECT
  :'execution_id',
  r.id,
  f.id,
  :'provider_id',
  NULL,
  NULL,
  0,
  COALESCE((SELECT max(priority) + 10 FROM authentication_execution WHERE flow_id = f.id), 10),
  false
FROM _realm r, _form_flow f
WHERE NOT EXISTS (
  SELECT 1
  FROM authentication_execution existing
  WHERE existing.flow_id = f.id
    AND existing.authenticator = :'provider_id'
);

COMMIT;

SELECT r.name AS realm,
       r.registration_allowed,
       r.verify_email,
       r.duplicate_emails_allowed,
       top_flow.alias AS registration_flow,
       form_flow.alias AS registration_form_flow,
       e.authenticator,
       e.requirement,
       e.priority
FROM realm r
JOIN _top_flow top_flow ON true
JOIN _form_flow form_flow ON true
LEFT JOIN authentication_execution e ON e.flow_id = form_flow.id AND e.authenticator = :'provider_id'
WHERE r.name = :'realm_name';
SQL

sudo docker compose "${COMPOSE_ARGS[@]}" restart keycloak

echo "Configured Keycloak registration via database fallback for realm '$KEYCLOAK_REALM'."
