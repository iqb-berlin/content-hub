# Deployment

## Deployment Modes

The repository supports three practical ways to run the application.

### 1. Local development stack

File:

- `docker-compose.yml`

Use this for:

- local onboarding,
- daily development,
- quick feature verification.

### 2. Build-on-host production deployment

File:

- `docker-compose.prod.yml`

Use this when:

- the server can build Docker images locally,
- you deploy directly from the repository source.

### 3. Prebuilt-image server deployment

File:

- `docker-compose.server.yml`

Use this when:

- you want the server to pull images from GHCR,
- you prefer faster deploys on small VPS instances,
- the build pipeline publishes backend and frontend images ahead of time.

### 4. Traefik edge deployment

File:

- `docker-compose.traefik.yml` combined with either production file

Use this when:

- an existing Traefik stack terminates HTTPS on the same Docker host,
- Traefik owns ports `80` and `443`,
- Content Hub should stay internal and be routed through Docker labels.

The Traefik stack can live outside this repository. It only needs to expose the
Docker network configured through `TRAEFIK_DOCKER_NETWORK` (`ingress-net` for
`iqb-berlin/traefik`). Do not use Traefik's `app-net` for Content Hub routing,
because Traefik's own monitoring Keycloak also lives there.

The overlay uses the Compose Spec `!reset` tag to remove Content Hub's direct
public nginx port binding. Validate the merged configuration before deployment.

## Development Deployment

Start:

```bash
make dev
```

Stop:

```bash
make dev-stop
```

Logs:

```bash
make dev-logs
make dev-logs-backend
make dev-logs-frontend
make dev-logs-keycloak
```

## Production Deployment From Source

1. Copy `.env.example` to `.env`
2. Fill in secure secrets and correct hostnames
3. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Or through the Makefile:

```bash
make prod-build
```

## Production Deployment Using Prebuilt Images

1. Copy `.env.example` to `.env`
2. Fill in secure secrets and correct hostnames
3. Pull and start

```bash
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
```

Or through the Makefile:

```bash
make server-up
```

The scripted installer can do the first-time setup work for this mode:

```bash
./scripts/install.sh --mode server --environment production --release vX.Y.Z
```

It creates `.env` when needed, generates production secrets, validates the
Compose config, and patches the imported Keycloak realm client URLs when
`python3` is available.

## Production Deployment Behind Traefik

1. Start the Traefik stack separately.
2. Make sure its ingress Docker network exists, for example `ingress-net`.
3. Copy `.env.example` to `.env`.
4. Fill in the normal production values and these Traefik values:

```bash
CONTENT_POOL_HOST=content-pool.example.com
CONTENT_POOL_AUTH_HOST=auth-content-pool.example.com
TRAEFIK_DOCKER_NETWORK=ingress-net
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_TLS_CERTRESOLVER=
```

For Content Hub OIDC, align the public URLs with those hosts:

```bash
CORS_ORIGIN=https://content-pool.example.com
KEYCLOAK_HOSTNAME=auth-content-pool.example.com
OIDC_PUBLIC_ISSUER_URL=https://auth-content-pool.example.com/realms/iqb
OIDC_REDIRECT_URI=https://content-pool.example.com/auth/callback
OIDC_ISSUER_URL=http://keycloak:8080/realms/iqb
```

Start with prebuilt images:

```bash
make server-traefik-up
```

Or build on the server:

```bash
make prod-traefik-build
```

The overlay removes Content Hub's public nginx port binding. Traefik routes to
the internal `content-pool-nginx` facade and Content Hub keeps its existing
internal nginx routing for SPA, API, GeoGebra assets, and Keycloak browser
endpoints.

The matching scripted installer is:

```bash
./scripts/install.sh --mode traefik --environment production --release vX.Y.Z
```

For a release-style deployment directory without cloning the whole repository:

```bash
./scripts/install.sh --mode traefik --environment production \
  --release vX.Y.Z --dir /opt/content-pool
```

This installs only the runtime artifacts needed for the server deployment:
Compose files, nginx config, Keycloak realm/theme files, helper scripts, and a
small server Makefile. It intentionally checks for Traefik's Docker network but
does not install or modify the Traefik stack.

## Single-Domain Traefik Runbook

This runbook documents a first-time release deployment where the Content Hub app
and Keycloak browser endpoints share one public hostname. Traefik routes the app
and API normally, while Keycloak uses the reserved `/realms` and `/resources`
paths on the same host.

The example commands below use placeholders for hostnames, users, ports, and
directories. Keep concrete production values in a private operations note or
password manager, not in public repository documentation.

Set the deployment values once before running the commands:

```bash
export SSH_PORT="22"
export SSH_USER="deploy"
export APP_HOST="content-pool.example.org"
export CONTENT_POOL_VERSION="vX.Y.Z"
export CONTENT_POOL_DIR="/opt/content-pool"
export TRAEFIK_ACME_DIR="/opt/traefik-contentpool/letsencrypt"
export ACME_EMAIL="ops@example.org"
```

For example, `CONTENT_POOL_VERSION` could be `v0.1.3`,
while the other values should match the target host and operating model.

Use a separate auth subdomain instead if you do not want Keycloak paths on the
main app hostname.

### 1. Connect and inspect the server

Connect with the account that is allowed to log in, then check Docker, Compose,
the Traefik network, and currently running containers:

```bash
ssh -p "${SSH_PORT}" "${SSH_USER}@${APP_HOST}"

docker compose version
docker network inspect ingress-net
docker ps
```

If the login user cannot access `/var/run/docker.sock`, run Docker commands
through `sudo` or with the operational user that has Docker access. The installer
can still prepare files without starting containers, but `pull`, `up`, logs, and
network creation need Docker privileges.

### 2. Pick the release and deployment directory

Use the latest released tag that has published backend and frontend images. To
check tags from a local checkout:

```bash
git ls-remote --tags --sort='v:refname' origin | tail -20
```

For a deployment directory owned by the Docker operator, use:

```bash
mkdir -p "${CONTENT_POOL_DIR}"
```

Before installing, download the release assets and verify their checksums:

```bash
gh release download "${CONTENT_POOL_VERSION}" --pattern 'release-manifest.json' --pattern 'SHA256SUMS'
sha256sum --check --ignore-missing SHA256SUMS
```

For long-term operations, prefer a directory owned by the Docker operator, for
example `/srv/content-pool` or `/opt/content-pool`.

### 3. Run the Content Hub installer

Download and run the release installer in Traefik mode. Do not pass `--start`
until Traefik and Docker permissions are ready.

```bash
mkdir -p "${CONTENT_POOL_DIR}-bootstrap"
curl -fsSL \
  "https://raw.githubusercontent.com/iqb-berlin/content-pool-next/${CONTENT_POOL_VERSION}/scripts/install.sh" \
  -o "${CONTENT_POOL_DIR}-bootstrap/install.sh"
chmod +x "${CONTENT_POOL_DIR}-bootstrap/install.sh"

CONTENT_POOL_HOST="${APP_HOST}" \
CONTENT_POOL_AUTH_HOST="${APP_HOST}" \
TRAEFIK_DOCKER_NETWORK=ingress-net \
TRAEFIK_ENTRYPOINT=websecure \
TRAEFIK_TLS_CERTRESOLVER=acme \
"${CONTENT_POOL_DIR}-bootstrap/install.sh" \
  --mode traefik \
  --environment production \
  --release "${CONTENT_POOL_VERSION}" \
  --dir "${CONTENT_POOL_DIR}" \
  --non-interactive
```

For the single-hostname setup, the generated `.env` should contain:

```bash
RELEASE_VERSION=vX.Y.Z
APPLICATION_VERSION=X.Y.Z
CONTENT_POOL_BACKEND_IMAGE=ghcr.io/iqb-berlin/content-pool-backend@sha256:...
CONTENT_POOL_FRONTEND_IMAGE=ghcr.io/iqb-berlin/content-pool-frontend@sha256:...
CONTENT_POOL_HOST=content-pool.example.org
CONTENT_POOL_AUTH_HOST=content-pool.example.org
TRAEFIK_DOCKER_NETWORK=ingress-net
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_TLS_CERTRESOLVER=acme
CORS_ORIGIN=https://content-pool.example.org
KEYCLOAK_HOSTNAME=content-pool.example.org
OIDC_PUBLIC_ISSUER_URL=https://content-pool.example.org/realms/iqb
OIDC_REDIRECT_URI=https://content-pool.example.org/auth/callback
OIDC_ISSUER_URL=http://keycloak:8080/realms/iqb
DB_SYNCHRONIZE=false
DB_RUN_MIGRATIONS=true
```

The installer generates the database, Keycloak, and JWT secrets when `.env` does
not exist yet. Do not paste those secrets into tickets, logs, or documentation.

Validate the merged Compose configuration:

```bash
cd "${CONTENT_POOL_DIR}"
make server-traefik-config
```

### 4. Start or provide Traefik

If the full `iqb-berlin/traefik` stack is already used, start it separately and
make sure it creates the public `ingress-net` network. Content Hub must attach to
that network, not to Traefik's internal `app-net`.

For a minimal single-app edge, create the network and run Traefik directly.
Prefix these commands with `sudo` if the login user cannot access Docker.

```bash
docker network inspect ingress-net >/dev/null 2>&1 || docker network create ingress-net

mkdir -p "${TRAEFIK_ACME_DIR}"
touch "${TRAEFIK_ACME_DIR}/acme.json"
chmod 600 "${TRAEFIK_ACME_DIR}/acme.json"

docker rm -f content-pool-traefik 2>/dev/null || true
docker run -d --name content-pool-traefik --restart unless-stopped \
  --network ingress-net \
  -p 80:80 -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v "${TRAEFIK_ACME_DIR}:/letsencrypt" \
  traefik:v3.6 \
  --global.checknewversion=false \
  --providers.docker=true \
  --providers.docker.exposedbydefault=false \
  --providers.docker.network=ingress-net \
  --entrypoints.web.address=:80 \
  --entrypoints.web.http.redirections.entrypoint.to=websecure \
  --entrypoints.web.http.redirections.entrypoint.scheme=https \
  --entrypoints.websecure.address=:443 \
  --certificatesresolvers.acme.acme.tlschallenge=true \
  --certificatesresolvers.acme.acme.email="${ACME_EMAIL}" \
  --certificatesresolvers.acme.acme.storage=/letsencrypt/acme.json
```

Use an operational email address for ACME. Ports `80` and `443` must be reachable
from the internet before Let's Encrypt can issue the certificate.

The minimal Traefik command mounts `/var/run/docker.sock` into the Traefik
container so Docker labels can be discovered. Treat that as a sensitive host
capability even with the read-only mount, and use it only for a trusted Traefik
container on a controlled host. Prefer the managed `iqb-berlin/traefik` stack
when it is already available.

### 5. Start Content Hub

Start the stack from the deployment directory:

```bash
cd "${CONTENT_POOL_DIR}"
docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml pull
docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml up -d
docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml ps
```

Prefix the Docker Compose commands with `sudo` if the login user cannot access
Docker directly.

All five application containers should become healthy:

- `content-pool-api`,
- `content-pool-db`,
- `content-pool-nginx`,
- `keycloak`,
- `keycloak-db`.

If the deployment directory is below a private home directory, make sure the
user running Docker can read the Compose files, `.env`, nginx config, and
Keycloak files. A better long-term fix is to move the deployment directory to
the operational user's home or `/opt/content-pool`.

### 6. Verify from outside

Check the public app, API, Keycloak discovery, ports, and certificate:

```bash
curl -fsSI "https://${APP_HOST}/"
curl -fsS "https://${APP_HOST}/api/health/live"
curl -fsS "https://${APP_HOST}/realms/iqb/.well-known/openid-configuration"

nc -vz -w 3 "${APP_HOST}" 80
nc -vz -w 3 "${APP_HOST}" 443

openssl s_client -connect "${APP_HOST}:443" -servername "${APP_HOST}" </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

The OIDC discovery document must report this issuer for the single-domain setup:

```json
{"issuer":"https://content-pool.example.org/realms/iqb"}
```

Inspect logs when any check fails:

```bash
docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml logs --since 15m content-pool-api keycloak nginx
docker logs --since 15m content-pool-traefik
```

## Required Production Concerns

Before any real deployment, make sure these are in place:

- secure database passwords,
- secure Keycloak admin password,
- strong `JWT_SECRET`,
- correct `CORS_ORIGIN`,
- correct `OIDC_PUBLIC_ISSUER_URL`,
- correct `OIDC_REDIRECT_URI`,
- `DB_SYNCHRONIZE=false`,
- `DB_RUN_MIGRATIONS=true`.
- local MTA/Postfix for Keycloak email delivery, relaying with the CMS function
  account to `mailhost.cms.hu-berlin.de:587`.
- `ALTCHA_HMAC_SECRET` set and the Keycloak ALTCHA provider built with
  `make keycloak-altcha-provider`.

## Recommended Production Topology

The default production layout is:

- nginx exposed publicly,
- frontend served behind nginx,
- backend internal-only,
- Keycloak public for browser auth flows but admin console localhost-bound,
- Keycloak SMTP delivery through a local host MTA,
- PostgreSQL internal-only,
- uploads persisted in a volume.

Behind Traefik, nginx is no longer exposed directly. Traefik is the public edge,
and nginx stays as the internal facade that knows Content Hub's path routing.

## Health Verification

After deployment, verify:

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS http://localhost/api/health/live
curl -fsS http://localhost/api/health/ready
```

Behind Traefik, validate the merged Compose configuration first:

```bash
make server-traefik-config
# or:
make prod-traefik-config
```

Then verify via the public hosts:

```bash
curl -fsS https://content-pool.example.com/api/health/live
curl -fsS https://auth-content-pool.example.com/realms/iqb/.well-known/openid-configuration
```

Or use the helper script:

```bash
./scripts/check-health.sh
```

The exact invocation depends on the deployment mode and target URLs.

## Migration Strategy

Production schema changes should happen through TypeORM migrations only.

Recommended values:

- `DB_SYNCHRONIZE=false`
- `DB_RUN_MIGRATIONS=true`

Reviewed forward migration when needed:

```bash
docker compose -f docker-compose.prod.yml exec content-pool-api npm run migration:run:dist
```

Application rollback never invokes `migration:revert`. Use the complete
downtime restore described in [Releases and Promotion](releases.md) for an
incompatible emergency.

The `CompleteCommentLifecycle1789300000000` migration resolves legacy comment
targets against both the ACP index and uploaded Unit/VOMD files. For ACPs with
comments, unreadable or invalid item sources abort the transactional migration;
restore or repair those sources before retrying. Ambiguous targets remain
read-only. Its `down()` migration is allowed only when the comment table is
empty, because the previous schema cannot preserve coding targets and legacy
protection. Do not delete comments to bypass this guard.

## Backup Basics

Create one consistent operational backup containing custom-format dumps of
both databases, uploads, and runtime configuration:

```bash
./scripts/update.sh --mode traefik --backup-only
```

## Common Operational Commands

### Logs

```bash
make prod-logs
make prod-logs-api
make prod-logs-nginx
make prod-logs-keycloak
```

### Restart

```bash
make prod-restart
```

### Status

```bash
make status
```

### Update

Use the managed release commands; generic mutable-tag updates are disabled.

For prebuilt-image server deployments, prefer the safe update wrapper:

```bash
# staging candidate
make staging-update RELEASE=vX.Y.Z-rc.N MODE=traefik

# promoted production release
make production-update RELEASE=vX.Y.Z MODE=traefik
```

Only a promoted stable GitHub Release may be deployed to production.

The wrapper backs up `.env`, Compose/runtime files, both PostgreSQL databases,
and the API upload directory before pulling images and restarting. It relies on
the backend startup migration setting (`DB_RUN_MIGRATIONS=true`) instead of the
Coding-Box Liquibase update pattern. By default it aborts if a database or
upload backup source is not running; use `--no-backup` or
`--allow-incomplete-backup` only for an intentional maintenance exception.

The wrapper also counts users in the Keycloak `iqb` realm before and after the
update, stores the count in `backups/update_*/manifest.txt`, and refuses to
accept the release if the count decreases. Use `--keycloak-realm REALM` only if
the production realm name is different. Avoid `docker compose down -v`,
`server-clean`, `prod-clean`, and Docker volume pruning during release work;
those commands remove the volumes that hold PostgreSQL data, Keycloak users, and
uploads.

If the post-update Keycloak user check fails, the script attempts to redeploy the
previous digest-pinned application release, stops the public `nginx` facade, and exits
with the backup directory in the error message. Verify or restore the Keycloak
database before starting `nginx` again.

If the health check fails after the new stack starts, the same previous-version
redeploy and `nginx` stop happens, but the failure message points to general
inspection with the backup rather than a Keycloak-specific restore.

For a dry run without changing containers:

```bash
./scripts/update.sh --mode traefik --environment production --release vX.Y.Z --dry-run
```

Runtime artifacts always come from the checksummed GitHub Release bundle; they
cannot be refreshed from `master` or an arbitrary source ref.

## Security Notes

- Keep `8080` closed to the public internet unless you intentionally run an insecure mode.
- Prefer public DNS hostnames and HTTPS for app and auth endpoints.
- Do not enable Swagger publicly unless you actually want it exposed.
- Avoid production deployments with schema synchronization enabled.

## Related Existing Runbooks

For more detailed operator guidance, also read:

- [DEPLOY.md](../../DEPLOY.md)
- [KEYCLOAK_SETUP.md](../../KEYCLOAK_SETUP.md)
- [RELEASE_CHECKLIST.md](../../RELEASE_CHECKLIST.md)
- [Releases and Promotion](releases.md)
- [Keycloak Email](keycloak-email.md)

## Related Documents

- [Monitoring and Maintenance](monitoring-and-maintenance.md)
- [Configuration](../development/configuration.md)
