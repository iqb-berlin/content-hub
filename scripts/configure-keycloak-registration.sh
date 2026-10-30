#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

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

require_command curl
require_command jq

url_encode() {
  jq -nr --arg value "$1" '$value | @uri'
}

KEYCLOAK_URL="${1:-$(read_env_value KEYCLOAK_URL http://localhost:8080)}"
KEYCLOAK_REALM="$(read_env_value KEYCLOAK_REALM iqb)"
KEYCLOAK_ADMIN_USER="$(read_env_value KEYCLOAK_ADMIN_USER admin)"
KEYCLOAK_ADMIN_PASSWORD="$(read_env_value KEYCLOAK_ADMIN_PASSWORD admin)"
ALTCHA_HMAC_SECRET="$(read_env_value ALTCHA_HMAC_SECRET '')"
ALTCHA_PROVIDER_ID="registration-altcha-action"
SOURCE_REGISTRATION_FLOW_ALIAS="$(read_env_value KEYCLOAK_SOURCE_REGISTRATION_FLOW_ALIAS registration)"
TARGET_REGISTRATION_FLOW_ALIAS="$(read_env_value KEYCLOAK_REGISTRATION_FLOW_ALIAS "contenthub registration")"
REGISTRATION_FORM_FLOW_ALIAS="$(read_env_value KEYCLOAK_REGISTRATION_FORM_FLOW_ALIAS '')"

if [[ -z "$ALTCHA_HMAC_SECRET" ]]; then
  echo "ALTCHA_HMAC_SECRET must be set in the environment or .env." >&2
  exit 1
fi

TMP_PARENT="${TMPDIR:-/tmp}"
TMP_DIR="$(mktemp -d "${TMP_PARENT%/}/keycloak-registration.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
chmod 700 "$TMP_DIR"

KEYCLOAK_ADMIN_PASSWORD_FILE="$TMP_DIR/keycloak-admin-password"
AUTH_HEADER_FILE="$TMP_DIR/keycloak-auth-header"
REALM_FILE="$TMP_DIR/realm.json"
UPDATED_REALM_FILE="$TMP_DIR/realm-updated.json"
EXECUTIONS_FILE="$TMP_DIR/executions.json"
FORM_EXECUTIONS_FILE="$TMP_DIR/form-executions.json"
FLOWS_FILE="$TMP_DIR/flows.json"
UPDATE_EXECUTION_FILE="$TMP_DIR/update-execution.json"

printf '%s' "$KEYCLOAK_ADMIN_PASSWORD" > "$KEYCLOAK_ADMIN_PASSWORD_FILE"
chmod 600 "$KEYCLOAK_ADMIN_PASSWORD_FILE"

TOKEN_RESPONSE="$(
  curl -fsS -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "client_id=admin-cli" \
    --data-urlencode "username=$KEYCLOAK_ADMIN_USER" \
    --data-urlencode "password@$KEYCLOAK_ADMIN_PASSWORD_FILE"
)"

ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.access_token // empty')"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Could not obtain a Keycloak admin token from $KEYCLOAK_URL." >&2
  exit 1
fi

printf 'Authorization: Bearer %s\n' "$ACCESS_TOKEN" > "$AUTH_HEADER_FILE"
chmod 600 "$AUTH_HEADER_FILE"

curl -fsS "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows" \
  -H "@$AUTH_HEADER_FILE" \
  > "$FLOWS_FILE"

target_flow_exists="$(jq -r --arg alias "$TARGET_REGISTRATION_FLOW_ALIAS" '
  any(.[]; .alias == $alias)
  ' "$FLOWS_FILE")"

if [[ "$target_flow_exists" != "true" ]]; then
  SOURCE_REGISTRATION_FLOW_PATH="$(url_encode "$SOURCE_REGISTRATION_FLOW_ALIAS")"
  jq -n --arg newName "$TARGET_REGISTRATION_FLOW_ALIAS" '{newName: $newName}' > "$TMP_DIR/copy-flow.json"
  curl -fsS -X POST "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows/$SOURCE_REGISTRATION_FLOW_PATH/copy" \
    -H "@$AUTH_HEADER_FILE" \
    -H "Content-Type: application/json" \
    --data-binary "@$TMP_DIR/copy-flow.json" >/dev/null
fi

curl -fsS "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM" \
  -H "@$AUTH_HEADER_FILE" \
  > "$REALM_FILE"

jq --arg registrationFlow "$TARGET_REGISTRATION_FLOW_ALIAS" '
  .registrationAllowed = true
  | .verifyEmail = true
  | .duplicateEmailsAllowed = false
  | .loginWithEmailAllowed = true
  | .registrationFlow = $registrationFlow
' "$REALM_FILE" > "$UPDATED_REALM_FILE"

curl -fsS -X PUT "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM" \
  -H "@$AUTH_HEADER_FILE" \
  -H "Content-Type: application/json" \
  --data-binary "@$UPDATED_REALM_FILE" >/dev/null

REGISTRATION_FLOW_PATH="$(url_encode "$TARGET_REGISTRATION_FLOW_ALIAS")"

curl -fsS "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows/$REGISTRATION_FLOW_PATH/executions" \
  -H "@$AUTH_HEADER_FILE" \
  > "$EXECUTIONS_FILE"

if [[ -z "$REGISTRATION_FORM_FLOW_ALIAS" ]]; then
  REGISTRATION_FORM_FLOW_ALIAS="$(jq -r '
    .[]
    | select(.providerId == "registration-page-form" and .authenticationFlow == true)
    | .displayName // empty
    ' "$EXECUTIONS_FILE" | head -n 1)"
fi

if [[ -z "$REGISTRATION_FORM_FLOW_ALIAS" ]]; then
  echo "Could not find registration-page-form subflow in '$TARGET_REGISTRATION_FLOW_ALIAS'." >&2
  echo "The target registration flow may be incomplete or corrupted." >&2
  exit 1
fi

wrong_execution_ids="$(jq -r --arg provider "$ALTCHA_PROVIDER_ID" '
  .[]
  | select((.providerId == $provider or .authenticator == $provider) and (.level // 0) == 0)
  | .id
  ' "$EXECUTIONS_FILE")"

while IFS= read -r wrong_execution_id; do
  [[ -z "$wrong_execution_id" ]] && continue
  curl -fsS -X DELETE "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/executions/$wrong_execution_id" \
    -H "@$AUTH_HEADER_FILE" >/dev/null
done <<< "$wrong_execution_ids"

REGISTRATION_FORM_FLOW_PATH="$(url_encode "$REGISTRATION_FORM_FLOW_ALIAS")"

curl -fsS "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows/$REGISTRATION_FORM_FLOW_PATH/executions" \
  -H "@$AUTH_HEADER_FILE" \
  > "$FORM_EXECUTIONS_FILE"

execution_id="$(jq -r --arg provider "$ALTCHA_PROVIDER_ID" '
  .[]
  | select(.providerId == $provider or .authenticator == $provider)
  | .id
  ' "$FORM_EXECUTIONS_FILE" | head -n 1)"

if [[ -z "$execution_id" ]]; then
  curl -fsS -X POST "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows/$REGISTRATION_FORM_FLOW_PATH/executions/execution" \
    -H "@$AUTH_HEADER_FILE" \
    -H "Content-Type: application/json" \
    --data-binary "{\"provider\":\"$ALTCHA_PROVIDER_ID\"}" >/dev/null

  curl -fsS "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows/$REGISTRATION_FORM_FLOW_PATH/executions" \
    -H "@$AUTH_HEADER_FILE" \
    > "$FORM_EXECUTIONS_FILE"

  execution_id="$(jq -r --arg provider "$ALTCHA_PROVIDER_ID" '
    .[]
    | select(.providerId == $provider or .authenticator == $provider)
    | .id
    ' "$FORM_EXECUTIONS_FILE" | head -n 1)"
fi

if [[ -z "$execution_id" ]]; then
  echo "Could not find or add $ALTCHA_PROVIDER_ID in flow '$REGISTRATION_FORM_FLOW_ALIAS'." >&2
  echo "Make sure the provider JAR is mounted and Keycloak was restarted." >&2
  exit 1
fi

jq -n --arg id "$execution_id" '{id: $id, requirement: "REQUIRED"}' > "$UPDATE_EXECUTION_FILE"

curl -fsS -X PUT "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/authentication/flows/$REGISTRATION_FORM_FLOW_PATH/executions" \
  -H "@$AUTH_HEADER_FILE" \
  -H "Content-Type: application/json" \
  --data-binary "@$UPDATE_EXECUTION_FILE" >/dev/null

echo "Configured Keycloak registration for realm '$KEYCLOAK_REALM'."
echo "Self-registration: enabled"
echo "Email verification: enabled"
echo "Registration form flow: $REGISTRATION_FORM_FLOW_ALIAS"
echo "ALTCHA execution: $execution_id REQUIRED"
