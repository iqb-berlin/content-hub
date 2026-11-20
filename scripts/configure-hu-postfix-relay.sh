#!/usr/bin/env bash
set -euo pipefail

SMTP_RELAY_HOST="${SMTP_RELAY_HOST:-mailhost.cms.hu-berlin.de}"
SMTP_RELAY_PORT="${SMTP_RELAY_PORT:-587}"
SMTP_SASL_USER="${SMTP_SASL_USER:-iqbitnor}"
KEYCLOAK_SMTP_FROM="${KEYCLOAK_SMTP_FROM:-iqb-noreply@hu-berlin.de}"
KEYCLOAK_SMTP_FROM_DISPLAY_NAME="${KEYCLOAK_SMTP_FROM_DISPLAY_NAME:-Content Hub}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.server.yml -f docker-compose.traefik.yml}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command sudo
require_command postconf
require_command postmap
require_command systemctl

cd "${CONTENT_HUB_DIR:-/home/julian/content-hub}"

sudo -v

printf 'CMS function account user [%s]: ' "$SMTP_SASL_USER"
read -r smtp_user_input
if [[ -n "$smtp_user_input" ]]; then
  SMTP_SASL_USER="$smtp_user_input"
fi

printf 'CMS function account password: '
read -r -s SMTP_SASL_PASSWORD
printf '\n'

if [[ -z "$SMTP_SASL_PASSWORD" ]]; then
  echo "Password must not be empty." >&2
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
sudo cp /etc/postfix/main.cf "/etc/postfix/main.cf.bak.hu-relay-$timestamp"
if sudo test -f /etc/postfix/sasl_passwd; then
  sudo cp /etc/postfix/sasl_passwd "/etc/postfix/sasl_passwd.bak.hu-relay-$timestamp"
fi

sudo postconf -X dc_local_interfaces 2>/dev/null || true
sudo postconf -e "relayhost = [${SMTP_RELAY_HOST}]:${SMTP_RELAY_PORT}"
sudo postconf -e 'smtp_sasl_auth_enable = yes'
sudo postconf -e 'smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd'
sudo postconf -e 'smtp_sasl_security_options = noanonymous'
sudo postconf -e 'smtp_tls_security_level = encrypt'
sudo postconf -e 'smtp_tls_loglevel = 1'
sudo postconf -e 'smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination'

tmp_sasl="$(mktemp)"
chmod 600 "$tmp_sasl"
printf '[%s]:%s %s:%s\n' "$SMTP_RELAY_HOST" "$SMTP_RELAY_PORT" "$SMTP_SASL_USER" "$SMTP_SASL_PASSWORD" > "$tmp_sasl"
sudo install -o root -g root -m 600 "$tmp_sasl" /etc/postfix/sasl_passwd
rm -f "$tmp_sasl"
unset SMTP_SASL_PASSWORD

sudo postmap /etc/postfix/sasl_passwd
sudo chmod 600 /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
sudo systemctl restart postfix

if sudo docker ps --format '{{.Names}}' | grep -qx keycloak-db; then
  sudo docker exec -i keycloak-db psql -v ON_ERROR_STOP=1 -U keycloak -d keycloak <<SQL
BEGIN;

CREATE TEMP TABLE _realm AS
SELECT id FROM realm WHERE name = 'iqb';

DO \$\$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM _realm;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one iqb realm, found %', n;
  END IF;
END \$\$;

DELETE FROM realm_smtp_config
WHERE realm_id IN (SELECT id FROM _realm)
  AND name IN ('host', 'port', 'from', 'fromDisplayName', 'ssl', 'starttls', 'auth');

INSERT INTO realm_smtp_config (realm_id, name, value)
SELECT id, 'host', 'host.docker.internal' FROM _realm
UNION ALL SELECT id, 'port', '25' FROM _realm
UNION ALL SELECT id, 'from', '${KEYCLOAK_SMTP_FROM}' FROM _realm
UNION ALL SELECT id, 'fromDisplayName', '${KEYCLOAK_SMTP_FROM_DISPLAY_NAME}' FROM _realm
UNION ALL SELECT id, 'ssl', 'false' FROM _realm
UNION ALL SELECT id, 'starttls', 'false' FROM _realm
UNION ALL SELECT id, 'auth', 'false' FROM _realm;

COMMIT;
SQL

  # shellcheck disable=SC2086
  sudo docker compose $COMPOSE_FILES restart keycloak
fi

echo "Postfix relay and Keycloak SMTP sender configured."
echo "Relay: [${SMTP_RELAY_HOST}]:${SMTP_RELAY_PORT}"
echo "SMTP user: ${SMTP_SASL_USER}"
echo "Keycloak sender: ${KEYCLOAK_SMTP_FROM}"
echo
echo "Verify with:"
echo "  sudo journalctl -u postfix -f"
echo "  sudo postqueue -p"
