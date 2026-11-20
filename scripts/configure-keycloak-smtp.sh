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

KEYCLOAK_URL="${1:-$(read_env_value KEYCLOAK_URL http://localhost:8080)}"
KEYCLOAK_REALM="$(read_env_value KEYCLOAK_REALM iqb)"
KEYCLOAK_ADMIN_USER="$(read_env_value KEYCLOAK_ADMIN_USER admin)"
KEYCLOAK_ADMIN_PASSWORD="$(read_env_value KEYCLOAK_ADMIN_PASSWORD admin)"

SMTP_HOST="$(read_env_value KEYCLOAK_SMTP_HOST host.docker.internal)"
SMTP_PORT="$(read_env_value KEYCLOAK_SMTP_PORT 25)"
SMTP_FROM="$(read_env_value KEYCLOAK_SMTP_FROM iqb-noreply@hu-berlin.de)"
SMTP_FROM_DISPLAY_NAME="$(read_env_value KEYCLOAK_SMTP_FROM_DISPLAY_NAME 'Content Hub')"
SMTP_SSL="$(read_env_value KEYCLOAK_SMTP_SSL false)"
SMTP_STARTTLS="$(read_env_value KEYCLOAK_SMTP_STARTTLS false)"
SMTP_AUTH="$(read_env_value KEYCLOAK_SMTP_AUTH false)"
SMTP_USER="$(read_env_value KEYCLOAK_SMTP_USER '')"
SMTP_PASSWORD="$(read_env_value KEYCLOAK_SMTP_PASSWORD '')"

if [[ "$SMTP_AUTH" == "true" && ( -z "$SMTP_USER" || -z "$SMTP_PASSWORD" ) ]]; then
  echo "KEYCLOAK_SMTP_AUTH=true requires KEYCLOAK_SMTP_USER and KEYCLOAK_SMTP_PASSWORD." >&2
  exit 1
fi

TMP_PARENT="${TMPDIR:-/tmp}"
TMP_DIR="$(mktemp -d "${TMP_PARENT%/}/keycloak-smtp.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
chmod 700 "$TMP_DIR"

KEYCLOAK_ADMIN_PASSWORD_FILE="$TMP_DIR/keycloak-admin-password"
SMTP_PASSWORD_FILE="$TMP_DIR/smtp-password"
AUTH_HEADER_FILE="$TMP_DIR/keycloak-auth-header"
UPDATED_REALM_FILE="$TMP_DIR/updated-realm.json"

printf '%s' "$KEYCLOAK_ADMIN_PASSWORD" > "$KEYCLOAK_ADMIN_PASSWORD_FILE"
printf '%s' "$SMTP_PASSWORD" > "$SMTP_PASSWORD_FILE"
chmod 600 "$KEYCLOAK_ADMIN_PASSWORD_FILE" "$SMTP_PASSWORD_FILE"

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

REALM_JSON="$(
  curl -fsS "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM" \
    -H "@$AUTH_HEADER_FILE"
)"

printf '%s' "$REALM_JSON" | jq \
  --arg host "$SMTP_HOST" \
  --arg port "$SMTP_PORT" \
  --arg from "$SMTP_FROM" \
  --arg fromDisplayName "$SMTP_FROM_DISPLAY_NAME" \
  --arg ssl "$SMTP_SSL" \
  --arg starttls "$SMTP_STARTTLS" \
  --arg auth "$SMTP_AUTH" \
  --arg user "$SMTP_USER" \
  --rawfile password "$SMTP_PASSWORD_FILE" \
  '
    .smtpServer = {
      from: $from,
      fromDisplayName: $fromDisplayName,
      host: $host,
      port: $port,
      ssl: $ssl,
      starttls: $starttls,
      auth: $auth
    }
    | if $auth == "true" then
        .smtpServer.user = $user
        | .smtpServer.password = $password
      else
        .
      end
  ' > "$UPDATED_REALM_FILE"

curl -fsS -X PUT "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM" \
  -H "@$AUTH_HEADER_FILE" \
  -H "Content-Type: application/json" \
  --data-binary "@$UPDATED_REALM_FILE" >/dev/null

echo "Updated SMTP settings for Keycloak realm '$KEYCLOAK_REALM'."
echo "SMTP host: $SMTP_HOST"
echo "SMTP port: $SMTP_PORT"
echo "SMTP from: $SMTP_FROM"
