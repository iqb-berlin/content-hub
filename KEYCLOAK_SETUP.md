# Keycloak Setup (Content Hub)

Content Hub uses Keycloak via OpenID Connect with **Authorization Code Flow + PKCE**.

## Dev vs Production Realm

- Development (`docker-compose.yml`) imports `keycloak/realm-export.dev.json`:
  - `sslRequired: none`
  - `verifyEmail: false` (dev convenience; no email verification step)
  - localhost redirect URIs / web origins
  - preconfigured Identity Provider alias `kodierbox` (realm `coding-box`)
- Production (`docker-compose.prod.yml`, `docker-compose.server.yml`) imports `keycloak/realm-export.json`:
  - `sslRequired: external`
  - secure domain-based baseline

## Dev brokering with external Keycloak (`kodierbox`)

The development realm export now includes a brokered OIDC provider:

- alias: `kodierbox`
- external issuer: `https://keycloak.kodierbox.iqb.hu-berlin.de/realms/coding-box`
- external client id: `coding-box`
- `trustEmail=true` (no local email verification required for brokered users)
- dev realm has `verifyEmail=false` to avoid blocking broker logins on local setups

For the external client (`coding-box`) ensure these redirect URIs are allowed:

- `http://localhost:8080/realms/iqb/broker/kodierbox/endpoint`
- `http://127.0.0.1:8080/realms/iqb/broker/kodierbox/endpoint`

Important for local dev: realm import is applied only when realm `iqb` is created.
If you already started Keycloak before, recreate the dev Keycloak data volume:

```bash
docker compose down
docker volume rm content-hub_keycloak-data
docker compose up -d
```

## Secure baseline

- Keycloak runs in production mode (`start`)
- Reverse proxy mode: `KC_PROXY=edge`
- Internal HTTP only: `KC_HTTP_ENABLED=true`
- Public HTTPS required (`sslRequired: external` in realm export)
- Keycloak port bound to localhost by default: `127.0.0.1:8080:8080`
- Frontend callback path: `/auth/callback`

## Required env variables

```bash
KEYCLOAK_HOSTNAME=auth.example.com
KC_PROXY=edge
KC_HTTP_ENABLED=true
KC_HOSTNAME_STRICT=true
KC_HOSTNAME_STRICT_HTTPS=true
KEYCLOAK_HOSTNAME_STRICT_BACKCHANNEL=false
KEYCLOAK_PORT_EXPOSE=127.0.0.1:8080:8080

OIDC_ISSUER_URL=http://keycloak:8080/realms/iqb
OIDC_PUBLIC_ISSUER_URL=https://auth.example.com/realms/iqb
OIDC_REDIRECT_URI=https://app.example.com/auth/callback
OIDC_CLIENT_ID=contenthub
OIDC_SCOPE="openid profile email"
```

## Nginx routing requirements

The reverse proxy must forward these Keycloak paths to the Keycloak container:

- `/realms/*`
- `/resources/*`

Important:

- Do **not** proxy `/auth/*` to Keycloak, because Content Hub needs `/auth/callback` for the frontend callback route.

## Realm export defaults

`keycloak/realm-export.json` already contains a secure client baseline:

- `standardFlowEnabled: true`
- `implicitFlowEnabled: false`
- `directAccessGrantsEnabled: false`
- `publicClient: true`
- `pkce.code.challenge.method: S256`
- `sslRequired: external`
- `registrationAllowed: true`
- SMTP delivery through the Docker host at `host.docker.internal:25`
- self-hosted ALTCHA bot protection in the registration flow

You still must replace placeholder domains/IPs in:

- `redirectUris`
- `webOrigins`

The default SMTP sender is `iqb-noreply@hu-berlin.de`. For production, Postfix
should authenticate to the HU relay with the CMS function account.

For IP-based deployments with TLS, use `https://YOUR_SERVER_IP/...` values
(not only `http://...`).

## Troubleshooting: `Ungültiger Parameter: redirect_uri`

If Keycloak shows this error on login, the requested `redirect_uri` does not
exactly match the client configuration.

For client `contenthub`, verify in Keycloak Admin Console:

- **Valid redirect URIs** contains your exact callback URL
  (for example `https://187.127.71.69/auth/callback`)
- **Web origins** contains your exact frontend origin
  (for example `https://187.127.71.69`)
- `OIDC_REDIRECT_URI` in `.env` matches the same callback URL exactly

Important: realm JSON import is typically only applied when a realm is created.
If realm `iqb` already exists, update the client in the Keycloak UI (or delete
and recreate the realm) instead of only editing `realm-export.json`.

## SMTP / transactional email

For HU-related deployments, Keycloak should send to a local MTA on the Docker
host, and that MTA should relay to `mailhost.cms.hu-berlin.de:587` with the CMS
function account.

For existing realms, or fresh deployments where `.env` SMTP values differ from
the defaults in `keycloak/realm-export.json`, update SMTP settings from `.env`
after Keycloak is up:

```bash
make keycloak-smtp
```

For setup details, see
[`docs/operations/keycloak-email.md`](docs/operations/keycloak-email.md).

## Self-registration and bot protection

Content Hub allows direct Keycloak self-registration. New users must verify
their email address before they can sign in. The registration form is not
restricted to HU/IQB email domains.

Registrations are protected by a self-hosted ALTCHA Keycloak provider. Build the
provider before starting Keycloak:

```bash
make keycloak-altcha-provider
```

Set `ALTCHA_HMAC_SECRET` in `.env`, restart Keycloak, then apply the registration
flow settings for existing realms:

```bash
make keycloak-registration
```

For details, see
[`keycloak/docs/REGISTRATION_AND_ALTCHA.md`](keycloak/docs/REGISTRATION_AND_ALTCHA.md).

## Troubleshooting: `Ungültige Redirect Uri` on logout

If logout fails with a redirect error, configure **Valid post logout redirect URIs**
for client `contenthub`.

Example values:

- `https://187.127.71.69/`
- `https://app.example.com/`

In exported JSON this is stored under:

- `attributes["post.logout.redirect.uris"]`

Multiple values are separated by `##`.

## Admin access (recommended)

Use SSH tunneling instead of exposing Keycloak admin publicly:

```bash
ssh -L 8080:127.0.0.1:8080 USER@YOUR_SERVER
```

Then open `http://localhost:8080/admin`.

## Role mapping

Content Hub maps Keycloak roles automatically:

- realm/client role `admin` -> `isAppAdmin=true`
- otherwise regular user

No manual linking is required for new OIDC users.

## Quick verification

```bash
curl -s https://app.example.com/api/auth/oidc-config
curl -s https://auth.example.com/realms/iqb/.well-known/openid-configuration
```

Expected:

- OIDC config reports `"enabled": true`
- discovery document returns HTTP 200
