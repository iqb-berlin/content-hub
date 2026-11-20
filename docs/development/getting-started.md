# Getting Started

## Goal

This guide helps you boot the project locally and understand the quickest developer loops.

## Prerequisites

The easiest way to work with the project is Docker-based development.

Recommended tools:

- Docker Engine with Compose v2
- GNU Make
- a recent Node.js LTS if you want to run frontend or backend directly without Docker

If you only want to explore the product locally, Docker is enough.

## Fastest Local Start

From the repository root:

```bash
make dev
```

This starts the development stack defined in `docker-compose.yml`:

- PostgreSQL
- NestJS backend
- Angular frontend
- Keycloak

### Default Docker Development Ports

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:4201` |
| Backend API | `http://localhost:3000/api` |
| Swagger | `http://localhost:3000/api/docs` |
| Keycloak | `http://localhost:8080` |
| PostgreSQL | `localhost:5433` |

## Manual Start Without Docker

You can also run the frontend and backend directly.

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```

Default direct-run backend URL:

- `http://localhost:3000/api`

### Frontend

```bash
cd frontend
npm install
npm start
```

Default direct-run frontend URL:

- `http://localhost:4200`

When running this way, make sure the backend `OIDC_REDIRECT_URI` and `CORS_ORIGIN`
match the frontend port you actually use.

## Useful Make Targets

The repository `Makefile` is the main operator entry point.

Common development targets:

```bash
make help
make dev
make dev-build
make dev-stop
make dev-restart
make dev-logs
make dev-logs-backend
make health
```

Useful database and shell targets:

```bash
make db-shell
make db-backup
make shell-backend
```

## Recommended First-Time Checks

After booting the stack, verify:

1. the frontend loads,
2. `/api/health/live` returns `200`,
3. `/api/auth/oidc-config` returns a sensible configuration payload,
4. Swagger loads when enabled,
5. Keycloak is reachable if OIDC login is part of your task.

## Day-to-Day Development Workflow

### Working on frontend-only changes

- run the Angular app locally or with Docker,
- use the browser against `/api`,
- confirm access flow behavior with `/access`, `/login`, and `/view/:apId`.

### Working on backend-only changes

- use Swagger or curl against the NestJS API,
- tail backend logs with `make dev-logs-backend`,
- validate schema-related changes with migration commands when needed.

### Working on content workflows

The usual happy path is:

1. create or reuse an AP,
2. configure access,
3. upload files,
4. inspect validation results,
5. browse the AP through `/view/:apId`,
6. create snapshots before risky changes.

## Local Identity and Login Notes

The application supports two login paths:

- OIDC login via Keycloak,
- AP credential login for restricted viewers.

In Docker development, Keycloak is part of the stack. In direct local runs, you need a
reachable Keycloak instance if you are testing OIDC behavior.

## Data and File Storage in Development

Docker development persists data in named volumes:

- `pgdata`
- `uploads`
- `keycloak-data`

If you need a clean reset:

```bash
make dev-clean
```

Be careful: this removes development containers, images, and volumes.

## Common Troubleshooting

### Frontend loads but API calls fail

Check:

- backend container is healthy,
- `CORS_ORIGIN` matches the frontend URL,
- the frontend is calling the correct backend port.

### OIDC login redirects to the wrong URL

Check:

- `OIDC_PUBLIC_ISSUER_URL`
- `OIDC_REDIRECT_URI`
- Keycloak client redirect URIs and web origins

### Database-related startup failures

Check:

- PostgreSQL health,
- database credentials,
- whether the backend is pointing at the Docker hostname or localhost appropriately.

## Related Documents

- [Configuration](configuration.md)
- [Testing and Quality](testing-and-quality.md)
- [Deployment](../operations/deployment.md)
