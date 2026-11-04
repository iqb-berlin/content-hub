# Configuration

## Configuration Layers

The project has three main configuration contexts:

1. backend runtime variables,
2. compose-level deployment variables,
3. Keycloak realm and client configuration.

The backend always reads environment variables. Compose files provide most of them in
Dockerized environments.

## Main Files

| File | Purpose |
| --- | --- |
| `.env.example` | Root deployment template for production and server compose files |
| `backend/.env.example` | Direct backend local-run template |
| `docker-compose.yml` | Local development defaults |
| `docker-compose.prod.yml` | Source-build production deployment |
| `docker-compose.server.yml` | Prebuilt-image production deployment |

## Backend Runtime Variables

### Core runtime

| Variable | Meaning | Typical value |
| --- | --- | --- |
| `PORT` | NestJS listen port | `3000` |
| `NODE_ENV` | runtime mode | `development` or `production` |
| `CORS_ORIGIN` | allowed frontend origin(s) | `http://localhost:4200` or production app URL |

### Database

| Variable | Meaning |
| --- | --- |
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port |
| `DB_USERNAME` | database user |
| `DB_PASSWORD` | database password |
| `DB_DATABASE` | database name |
| `DB_SYNCHRONIZE` | whether TypeORM should sync schema automatically |
| `DB_RUN_MIGRATIONS` | whether migrations should run on startup |

### JWT and application auth

| Variable | Meaning |
| --- | --- |
| `JWT_SECRET` | signing secret for the app JWT |
| `JWT_EXPIRATION` | JWT lifetime |
| `CREDENTIAL_LOGIN_MAX_ATTEMPTS` | AP credential login rate-limit threshold |
| `CREDENTIAL_LOGIN_WINDOW_MS` | rate-limit observation window |
| `CREDENTIAL_LOGIN_BLOCK_MS` | temporary block duration |

### File handling

| Variable | Meaning |
| --- | --- |
| `FILE_STORAGE_PATH` | upload directory inside the backend runtime |

### Swagger and startup helpers

| Variable | Meaning |
| --- | --- |
| `SWAGGER_ENABLED` | explicit Swagger toggle |

### OIDC / Keycloak

| Variable | Meaning |
| --- | --- |
| `OIDC_ISSUER_URL` | internal issuer URL used by the backend |
| `OIDC_PUBLIC_ISSUER_URL` | browser-facing issuer URL |
| `OIDC_CLIENT_ID` | client ID for the app |
| `OIDC_REDIRECT_URI` | callback URL used by the frontend |
| `OIDC_SCOPE` | requested OIDC scopes |

### Server API integration

| Variable | Meaning |
| --- | --- |
| `SERVER_API_TOKENS` | JSON array of scoped API clients |
| `SERVER_API_KEY` | legacy single-token fallback |

## OIDC Configuration Pattern

The codebase intentionally separates internal and external OIDC URLs.

### `OIDC_ISSUER_URL`

Used by the backend to talk to Keycloak. In Docker this is often:

```text
http://keycloak:8080/realms/iqb
```

### `OIDC_PUBLIC_ISSUER_URL`

Used by the frontend for discovery and redirect flows. In production this should be a
browser-accessible URL, for example:

```text
https://auth.example.com/realms/iqb
```

This split is important. A backend-internal hostname such as `keycloak` is not usable by a browser.

## Migration and Schema Rules

Recommended settings:

### Development

- `DB_SYNCHRONIZE=true` is acceptable
- `DB_RUN_MIGRATIONS=false` is fine

### Production

- `DB_SYNCHRONIZE=false`
- `DB_RUN_MIGRATIONS=true`

This matches the repository defaults and protects production from accidental schema drift.

## Server API Token Configuration

Preferred format:

```json
[
  {
    "id": "studio",
    "token": "change-me-very-long-token",
    "scopes": ["transfer.read", "files.read"]
  }
]
```

Supported scopes currently include:

- `acp.read`
- `transfer.read`
- `transfer.write`
- `index.read`
- `index.write`
- `files.read`
- `files.write`
- `audit.read`

If `SERVER_API_TOKENS` is not set, the backend can fall back to `SERVER_API_KEY`,
which grants all scopes. That is simpler but less precise.

## Keycloak Variables in Production

The production compose files also use Keycloak-specific variables:

- `KEYCLOAK_HOSTNAME`
- `KC_PROXY`
- `KC_HTTP_ENABLED`
- `KC_HOSTNAME_STRICT`
- `KC_HOSTNAME_STRICT_HTTPS`
- `KEYCLOAK_HOSTNAME_STRICT_BACKCHANNEL`
- `KEYCLOAK_PORT_EXPOSE`
- `KEYCLOAK_DB_NAME`
- `KEYCLOAK_DB_USER`
- `KEYCLOAK_DB_PASSWORD`
- `KEYCLOAK_ADMIN_USER`
- `KEYCLOAK_ADMIN_PASSWORD`

These values control how Keycloak is exposed and how securely the admin console is kept.

## Practical Environment Examples

### Docker development

The development compose file already provides practical defaults:

- backend at `3000`,
- frontend exposed at `4201`,
- backend sees Keycloak on the Docker hostname,
- the browser sees Keycloak on `localhost:8080`.

### Direct local runs

Use `backend/.env.example` as your starting point. For direct frontend runs, remember
that the redirect URI usually needs to be `http://localhost:4200/auth/callback`.

### Production

Copy `.env.example` to `.env`, fill in all required secrets, and validate the resolved
compose config before starting the stack.

## Common Misconfigurations

### Wrong frontend origin

Symptoms:

- browser CORS errors,
- login appears to work but API requests fail.

Fix:

- set `CORS_ORIGIN` to the real frontend origin.

### Using the internal issuer URL in the browser

Symptoms:

- broken OIDC redirects,
- callback flow cannot reach discovery or token endpoints.

Fix:

- set `OIDC_PUBLIC_ISSUER_URL` to a public hostname.

### Production schema synchronization left on

Symptoms:

- unexpected schema changes during deploy,
- migration history becomes unreliable.

Fix:

- keep `DB_SYNCHRONIZE=false` in production.

## Related Documents

- [Getting Started](getting-started.md)
- [Deployment](../operations/deployment.md)
- [Access Control](../features/access-control.md)
