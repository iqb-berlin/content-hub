# Deployment Guide (VPS + Keycloak)

This guide describes a **secure** deployment of Content Hub with Keycloak on a VPS.

For this branding release, follow the [Content Hub branding runbook](docs/operations/content-hub-branding.md)
for existing Keycloak display fields and cache refresh. Technical deployment
identifiers and saved application themes remain unchanged.

## 1. Preconditions (must be true)

- Docker Engine + Compose v2 installed (`docker compose version`)
  - Traefik overlay deployments require Compose support for the Compose Spec
    `!reset` tag; validate with `make server-traefik-config` or
    `make prod-traefik-config` before starting the stack.
- Domain setup (recommended):
  - App: `app.example.com`
  - Keycloak: `auth.example.com` (can point to same VPS)
- TLS/HTTPS at the edge (nginx on VPS or upstream reverse proxy/load balancer)
- Firewall:
  - open: `80` (and `443` if terminating TLS on VPS)
  - closed from internet: `8080` (Keycloak stays localhost-bound)
- At least 2 GB RAM (4 GB recommended)

## 2. Choose deployment mode

- `docker-compose.prod.yml`: build locally on VPS
- `docker-compose.server.yml`: pull pre-built images from GHCR (recommended for small VPS)
- `docker-compose.traefik.yml`: optional overlay when an existing Traefik stack
  owns ports `80/443` on the same Docker host

## 3. Prepare configuration

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `POSTGRES_PASSWORD`
- `KEYCLOAK_DB_PASSWORD`
- `KEYCLOAK_ADMIN_PASSWORD`
- `JWT_SECRET` (long random value)
- `CORS_ORIGIN` (for example `https://app.example.com`)
- `KEYCLOAK_HOSTNAME` (for example `auth.example.com`)
- `OIDC_PUBLIC_ISSUER_URL` (for example `https://auth.example.com/realms/iqb`)
- `OIDC_REDIRECT_URI` (for example `https://app.example.com/auth/callback`)
- `OIDC_CLIENT_ID` (default `contentpool`)
- `DB_SYNCHRONIZE=false`
- `DB_RUN_MIGRATIONS=true`

If deploying behind Traefik, also set:

- `CONTENT_POOL_HOST` (for example `content-pool.example.com`)
- `CONTENT_POOL_AUTH_HOST` (for example `auth-content-pool.example.com`)
- `TRAEFIK_DOCKER_NETWORK` (for `iqb-berlin/traefik`: `ingress-net`)
- `TRAEFIK_ENTRYPOINT` (for `iqb-berlin/traefik`: `websecure`)
- `TRAEFIK_TLS_CERTRESOLVER` (`acme` for ACME, empty for manually configured certificates)

Then align the public URLs:

- `CORS_ORIGIN=https://content-pool.example.com`
- `KEYCLOAK_HOSTNAME=auth-content-pool.example.com`
- `OIDC_PUBLIC_ISSUER_URL=https://auth-content-pool.example.com/realms/iqb`
- `OIDC_REDIRECT_URI=https://content-pool.example.com/auth/callback`

### Scripted server install

For a server deployment with pre-built GHCR images, you can let the installer
prepare the runtime files, generate secrets, align OIDC URLs, adjust the
Keycloak realm export, and validate the Compose config:

```bash
# plain server deployment
./scripts/install.sh --mode server --environment production --release vX.Y.Z

# deployment behind an existing Traefik stack
./scripts/install.sh --mode traefik --environment production --release vX.Y.Z
```

The installer does not install Traefik. For Traefik mode, start the Traefik
stack separately and expose the configured Docker network, usually `ingress-net`.
To install into a separate deployment directory from a GitHub release/tag:

```bash
./scripts/install.sh --mode traefik --environment production \
  --release vX.Y.Z --dir /opt/content-pool
```

## 3a. Migration strategy (required for production)

Use migrations as the only schema-change mechanism in production.

- Fresh deployment:
  - `DB_SYNCHRONIZE=false`
  - `DB_RUN_MIGRATIONS=true`
  - start stack and let backend run migrations on boot
- Upgrade deployment:
  - keep the same values (`false` / `true`)
  - deploy new image and verify logs for successful migration run

Optional reviewed forward-migration command (inside API container):

```bash
docker compose -f docker-compose.server.yml exec content-pool-api npm run migration:run:dist
```

Do not use `migration:revert` during an application rollback. Use the complete
downtime restore runbook when database recovery is required.

## 4. Adjust Keycloak client redirect/web origins

Update `keycloak/realm-export.json` to your real hostnames:

- `redirectUris`: include your exact callback URL
- `webOrigins`: include your frontend origin

Current defaults are placeholders (`app.example.com`, `YOUR_SERVER_IP`) and should be replaced before first deploy.
If you use TLS on an IP-based setup, use `https://YOUR_SERVER_IP/...` entries.
The scheme must match exactly (`https` vs `http`), otherwise Keycloak rejects
login with `Invalid parameter: redirect_uri`.

## 4a. Configure Keycloak email delivery

Production Keycloak sends verification and password-reset mails through a local
MTA on the Docker host. The local MTA should relay outbound mail to the HU relay
with the CMS function account:

```text
mailhost.cms.hu-berlin.de:587
```

The production Compose files make the Docker host reachable from Keycloak as:

```text
host.docker.internal
```

For a fresh realm import, `keycloak/realm-export.json` already contains the
matching SMTP defaults. If you changed any `KEYCLOAK_SMTP_*` values in `.env`,
or if the realm already existed before this deployment, update the running realm
after Keycloak is up:

```bash
make keycloak-smtp
```

Detailed Postfix setup and verification steps are in
[`docs/operations/keycloak-email.md`](docs/operations/keycloak-email.md).

## 4b. Build and configure registration bot protection

Before starting Keycloak, build the self-hosted ALTCHA provider:

```bash
make keycloak-altcha-provider
```

Set a strong random secret in `.env`:

```bash
ALTCHA_HMAC_SECRET=<output of openssl rand -hex 32>
```

After the stack is up, configure existing realms for self-registration, email
verification, and the required ALTCHA registration action:

```bash
make keycloak-registration
```

Fresh realm imports already enable registration and email verification, but the
script should still be run after Keycloak has loaded the provider JAR so the
ALTCHA execution is present and required.

## 5. Validate config before start

```bash
docker compose -f docker-compose.server.yml config >/tmp/compose.server.resolved.yml
# or:
docker compose -f docker-compose.prod.yml config >/tmp/compose.prod.resolved.yml
```

If this fails, required env vars are missing or malformed.

For Traefik-backed deployments:

```bash
make server-traefik-config
# or:
make prod-traefik-config
```

## 6. Start services

### Option A: pre-built images

```bash
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
```

### Option B: build on VPS

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Option C: pre-built images behind Traefik

Run the Traefik stack separately first. It may live in another directory; it
only needs to provide the external Docker network configured as
`TRAEFIK_DOCKER_NETWORK`. For `iqb-berlin/traefik`, use `ingress-net`; avoid
`app-net`, because Traefik's own monitoring Keycloak also lives there.

```bash
make server-traefik-up
```

### Option D: build on VPS behind Traefik

```bash
make prod-traefik-build
```

The Traefik overlay removes Content Hub's direct public nginx port. Public HTTP
and HTTPS traffic goes through Traefik, then to the internal `content-pool-nginx`
container. Content Hub's own nginx config still handles `/`, `/api/`,
`/assets/GeoGebra/`, `/realms/`, and `/resources/`.

## 7. Verify health

```bash
docker compose -f docker-compose.server.yml ps
./scripts/check-health.sh server "https://auth.example.com/realms/iqb" "http://localhost/api" "http://localhost"
```

Expected:

- `content-pool-nginx`, `content-pool-api`, `content-pool-db`, `keycloak`, `keycloak-db` are `Up`
- `GET /api/auth/oidc-config` returns `"enabled": true`
- `GET /api/health/live` and `GET /api/health/ready` return `200`

For Traefik-backed deployments, verify through the public hosts:

```bash
curl -fsS https://content-pool.example.com/api/health/live
curl -fsS https://auth-content-pool.example.com/realms/iqb/.well-known/openid-configuration
```

## 7a. Monitoring baseline

Monitoring for the prototype release is based on health probes and log observation:

- Compose health checks:
  - `content-pool-api` via `/api/health/live`
  - nginx/frontend via `/health`
  - databases via `pg_isready`
  - Keycloak via local TCP probe
- Runtime checks:
  - `./scripts/check-health.sh ...` for full stack status and exit code
- Error observation:
  - `docker compose ... logs --since 15m content-pool-api keycloak`
  - alerting can be attached by scheduling `check-health.sh` and notifying on non-zero exit

## 8. Access Keycloak Admin securely

Keycloak is bound to `127.0.0.1:8080` by default.

Use an SSH tunnel from your local machine:

```bash
ssh -L 8080:127.0.0.1:8080 USER@YOUR_SERVER
```

Then open:

- `http://localhost:8080/admin`

Login with `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD`.

## 9. First login bootstrap

1. In Keycloak realm `iqb`, create your real admin user.
2. Assign realm role `admin` to that user.
3. Login to Content Hub via OIDC.
4. Verify that the user becomes `isAppAdmin=true` automatically.

## 10. Updates

```bash
# tested candidate on staging
make staging-update RELEASE=vX.Y.Z-rc.N MODE=traefik

# promoted stable release on production
make production-update RELEASE=vX.Y.Z MODE=traefik
```

For pre-built server deployments, prefer the safe updater because it backs up
both databases, the upload directory, and the runtime config before restarting:

```bash
./scripts/update.sh --mode traefik --environment production --release vX.Y.Z
```

The updater runs TypeORM migrations through the normal backend startup
configuration (`DB_RUN_MIGRATIONS=true`). It does not use the Coding-Box
Liquibase workflow. By default it aborts if a database or upload backup source
is not running; use `--no-backup` or `--allow-incomplete-backup` only for an
intentional maintenance exception.

## 11. Backups (recommended)

Create the complete recovery point with the scripted helper. It captures both
databases as PostgreSQL custom dumps, uploads, runtime files, and release
metadata together:

```bash
./scripts/update.sh --mode traefik --backup-only
```

## 12. Go/No-Go release checklist

Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before tagging or deploying a release candidate.
The complete promotion and recovery process is documented in
[`docs/operations/releases.md`](docs/operations/releases.md).
