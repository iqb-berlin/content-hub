# IQB ContentPool

Web application for managing **Assessment Content Packages (ACPs)** — bundles of data required to conduct and evaluate educational assessments.

## Documentation

Comprehensive project documentation now lives in [`docs/`](docs/README.md).

Recommended entry points:

- [`docs/README.md`](docs/README.md) for the full documentation map
- [`docs/architecture/overview.md`](docs/architecture/overview.md) for the system overview
- [`docs/development/getting-started.md`](docs/development/getting-started.md) for local setup
- [`docs/features/acp-workflows.md`](docs/features/acp-workflows.md) for product workflows
- [`docs/operations/deployment.md`](docs/operations/deployment.md) for runtime and deployment guidance

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 21, standalone components |
| Backend | NestJS 11, TypeORM, JWT auth |
| Database | PostgreSQL 16 |
| Deployment | Docker Compose, nginx reverse proxy |

## Quick Start (Development)

### Using Makefile (Recommended)

```bash
# Setup and start everything
make dev-setup  # First time only - install dependencies
make dev        # Start all services (PostgreSQL, Keycloak, Backend, Frontend)
# → Frontend at http://localhost:4201
# → Backend API at http://localhost:3000/api
# → Keycloak at http://localhost:8080

# Useful commands
make help              # Show all available commands
make dev-logs          # View logs
make dev-logs-backend  # View backend logs only
make dev-stop          # Stop all services
make health            # Check service health
make keycloak-admin    # Show Keycloak admin info
```

### Manual Start

```bash
# Start PostgreSQL
docker compose up db -d

# Backend
cd backend
npm install --legacy-peer-deps
npm run start:dev
# → API at http://localhost:3000/api
# → Swagger at http://localhost:3000/api/docs
# → User login uses Keycloak OIDC (development user: iqb-admin / Admin1234!)

# Frontend
cd frontend
npm install --legacy-peer-deps
npx ng serve
# → http://localhost:4200
```

## Production Deployment

### Prerequisites

- Docker and Docker Compose installed
- Server with ports 80 and 443 available
- Domain names for app + auth (recommended for secure OIDC)

### Quick Deploy

```bash
# 1. Clone repository
git clone <your-repo-url>
cd content-pool-next

# 2. Setup environment
cp .env.example .env
nano .env  # Edit with your values

# 3. Deploy
docker compose -f docker-compose.prod.yml up -d --build
# → Application at http://your-server-ip
```

### Environment Configuration

Create `.env` file with your production values:

```bash
# Database (REQUIRED - change passwords!)
POSTGRES_DB=content_pool
POSTGRES_USER=content_pool
POSTGRES_PASSWORD=your-secure-password-here

# JWT (REQUIRED - generate random string)
JWT_SECRET=your-random-secret-at-least-32-characters
JWT_EXPIRATION=24h
# Production-safe schema handling
DB_SYNCHRONIZE=false
DB_RUN_MIGRATIONS=true

# CORS (set to your domain)
CORS_ORIGIN=https://app.example.com

# OIDC (required for Application-Admin login)
KEYCLOAK_HOSTNAME=auth.example.com
OIDC_ISSUER_URL=http://keycloak:8080/realms/iqb
OIDC_PUBLIC_ISSUER_URL=https://auth.example.com/realms/iqb
OIDC_CLIENT_ID=contentpool
OIDC_REDIRECT_URI=https://app.example.com/auth/callback
OIDC_SCOPE="openid profile email"

# Keycloak credentials
KEYCLOAK_DB_PASSWORD=your-keycloak-db-password
KEYCLOAK_ADMIN_PASSWORD=your-keycloak-admin-password
```

### HTTPS Setup with Let's Encrypt

```bash
# 1. Install certbot on server
sudo apt update && sudo apt install certbot

# 2. Get certificate (replace your domains)
sudo certbot certonly --standalone -d app.example.com -d auth.example.com

# 3. Configure your reverse proxy/edge to terminate TLS and forward to this stack

# 4. Restart containers
docker compose -f docker-compose.prod.yml restart nginx
```

### Production Architecture

The production setup includes:

- **PostgreSQL**: Database with persistent storage
- **NestJS API**: Backend running on port 3000 (internal only)
- **Angular SPA**: Frontend served by nginx (internal only)
- **nginx Reverse Proxy**: Handles SSL termination and routing
- **Security**: Non-root containers, no exposed internal ports

### Management Commands

```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f

# Update application
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Run migrations manually inside running API container (optional)
docker compose -f docker-compose.prod.yml exec content-pool-api npm run migration:run:dist

# Backup database
docker exec content-pool-db pg_dump -U content_pool content_pool > backup.sql

# Stop services
docker compose -f docker-compose.prod.yml down

# Full reset (removes all data)
docker compose -f docker-compose.prod.yml down -v
```

### Troubleshooting

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check specific service logs
docker compose -f docker-compose.prod.yml logs content-pool-api
docker compose -f docker-compose.prod.yml logs content-pool-db

# Backend health (liveness/readiness)
curl -fsS http://localhost/api/health/live
curl -fsS http://localhost/api/health/ready

# Access database directly
docker exec -it content-pool-db psql -U content_pool -d content_pool

# Test nginx configuration
docker exec content-pool-nginx nginx -t
```

### Release Readiness

- Deployment and migration runbook: [DEPLOY.md](DEPLOY.md)
- Go/No-Go checklist: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
- Health check helper: `./scripts/check-health.sh`
- Generated compliance reports: [docs/compliance.md](docs/compliance.md)

## Project Structure

```
├── backend/                 # NestJS API
│   ├── src/
│   │   ├── auth/           # JWT auth, 3 guards, credential login
│   │   ├── users/          # User CRUD, admin seeding
│   │   ├── acp/            # ACP lifecycle, Index import/export, roles
│   │   ├── files/          # Upload/download, checksums
│   │   ├── snapshots/      # Versioning, restore, diff
│   │   ├── views/          # Public read-only endpoints
│   │   ├── comments/       # CRUD, export
│   │   ├── items/          # Item extraction, filter/sort
│   │   ├── item-explorer/  # Shared draft/published explorer state
│   │   ├── admin/          # App settings
│   │   ├── validation/     # Syntactic + semantic
│   │   ├── api/            # Server-to-server API
│   │   └── database/       # Entities, migrations, data source
│   └── test/               # E2E tests
├── frontend/                # Angular SPA
│   └── src/app/
│       ├── core/           # AuthService, ApiService, guards
│       ├── auth/           # Login pages
│       ├── admin/          # Users, settings, ACP list
│       ├── acp-manager/    # Dashboard, files, snapshots, access
│       └── views/          # Landing, units, sequences, items, index
├── docs/                    # Project documentation
├── nginx/                   # Reverse proxy config
├── docker-compose.yml       # Development
├── docker-compose.prod.yml  # Production (build from source)
└── docker-compose.server.yml # Production (pre-built images)
```

## Testing

```bash
# Backend unit tests
cd backend && npm test

# Backend E2E tests (requires running PostgreSQL)
cd backend && npm run test:e2e

# Frontend unit tests
cd frontend && npm test
```

## Key Features

- **3 Access Models**: Public, Registered Users, Credentials List
- **ACP-Index Management**: JSON import/export, interactive browser
- **File Management**: Multi-file upload, SHA-256 checksums, validation
- **Versioning**: Snapshots with copy-on-write, restore, diff
- **Configurable Feature Flags**: Per-ACP control over read-only features
- **Verona Player Integration**: Unit display via iframe
- **Server-to-Server API**: For Studio, Testcenter, Kodierbox integration

## Server-to-Server API

Authentication is token-based for integrations (`X-Server-Token: <token>` or `Authorization: Bearer <token>`), independent from generic user login. Production integrations should use admin-managed application tokens; `SERVER_API_TOKENS` and `SERVER_API_KEY` remain available for bootstrap and compatibility setups.

Application admins can create, inspect and revoke integration tokens in the UI under **Token** (`/admin/application-tokens`).

### Core Endpoints

- `GET /api/server/capabilities`: Inspect the authenticated token's scopes and ACP restriction without addressing an ACP
- `GET /api/server/acp`: List transferable ACPs
- `GET /api/server/acp/:acpId`: Full transfer payload (index + files metadata)
- `GET /api/server/acp/:acpId/export`: Alias for full transfer payload
- `POST /api/server/acp/import`: Create/update ACP by `packageId`
- `POST /api/server/acp`: Legacy alias for import
- `GET /api/server/acp/:acpId/index`: Transfer only ACP index
- `PUT /api/server/acp/:acpId/index`: Update ACP index only
- `GET /api/server/acp/:acpId/files`: List ACP files for transfer
- `GET /api/server/acp/:acpId/files/:fileId`: File metadata
- `GET /api/server/acp/:acpId/files/:fileId/download`: Download one file
- `POST /api/server/acp/:acpId/files/upload`: Upload one or more files (multipart)
- `POST /api/server/acp/:acpId/coding-schemes/replace`: Replace existing `.vocs` files and automatically create a new snapshot version with changelog
- `GET /api/server/audit`: Read integration audit log entries (scope required)

### Conflict Strategy

- ACP import (`POST /api/server/acp/import`, `POST /api/server/acp`):
  - `conflictStrategy=reject` (default): fail when `packageId` already exists
  - `conflictStrategy=overwrite`: replace existing ACP index
  - `conflictStrategy=merge`: deep-merge incoming index into existing index
- Index update (`PUT /api/server/acp/:acpId/index`):
  - `strategy=overwrite` (default) or `strategy=merge`
- File upload (`POST /api/server/acp/:acpId/files/upload`):
  - `conflictStrategy=keep-both` (default), `overwrite`, or `reject`
- Coding scheme replacement (`POST /api/server/acp/:acpId/coding-schemes/replace`):
  - replaces existing `.vocs` by filename (case-insensitive)
  - rejects unknown/non-existing `.vocs` (strict replace semantics)
  - creates a new snapshot version and stores the provided `changelog` (or auto-generated text)
- Optimistic concurrency is supported via `expectedUpdatedAt` (ISO timestamp) for ACP/index updates and coding-scheme replacement.

### Integration Scopes

Tokens can be scoped per integration client. Supported scopes:

- `acp.read`
- `transfer.read`
- `transfer.write`
- `index.read`
- `index.write`
- `files.read`
- `files.write`
- `audit.read`

`GET /api/server/capabilities` requires a valid integration token but no
particular scope. It returns the token's granted `scopes`, a capability map for
all supported scopes, and its `allowedAcpIds` restriction. Integrations should
use this endpoint for connection and permission checks instead of probing an
ACP route with a synthetic ID.

## OIDC / Keycloak Integration

All application users sign in through Keycloak OIDC. ACP-specific credential-list access remains available independently for restricted viewer access.

Highlights:

- Frontend flow: **Authorization Code + PKCE**
- Realm export is preconfigured for secure defaults (`implicitFlowEnabled=false`, `publicClient=true`, `pkce=S256`)
- Development uses `keycloak/realm-export.dev.json` (localhost redirects, `sslRequired=none`)
- Development realm includes external broker `kodierbox` (external realm `coding-box`)
- Production uses `keycloak/realm-export.json` (secure baseline, `sslRequired=external`)
- Reverse proxy must expose `/realms/*` and `/resources/*`
- `/auth/callback` is reserved for the frontend and must not be proxied to Keycloak

For full setup and secure VPS deployment:

- [KEYCLOAK_SETUP.md](KEYCLOAK_SETUP.md)
- [DEPLOY.md](DEPLOY.md)

## License

ContentPool is open source software licensed under the
[Apache License 2.0](LICENSE). Third-party components remain subject to their
respective licenses; their software bills of materials are generated by the
compliance and release pipelines.

For AI-assisted contributions and provenance review, see
[CONTRIBUTING.md](CONTRIBUTING.md) and [compliance reports](docs/compliance.md).
