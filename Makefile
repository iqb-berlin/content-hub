# Content Hub - Makefile
# Usage: make [target]

.PHONY: help dev prod stop logs status clean db-backup db-restore keycloak-admin keycloak-smtp keycloak-registration keycloak-registration-db keycloak-altcha-provider \
	server-install server-install-traefik server-update-safe server-backup \
	server-update-release server-traefik-update-release \
	server-traefik-up server-traefik-update server-traefik-update-safe server-traefik-backup \
	server-traefik-stop server-traefik-logs server-traefik-config \
	prod-traefik prod-traefik-build prod-traefik-stop prod-traefik-logs prod-traefik-config \
	staging-update production-update staging-rollback production-rollback adopt-current restore-backup

# Default target
help: ## Show this help message
	@echo "Content Hub - Available Commands"
	@echo "===================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================
# Development Commands
# ============================================

dev: ## Start development environment (docker compose up -d)
	@echo "Starting development environment..."
	docker compose up -d
	@echo "Development environment started!"
	@echo "  Frontend: http://localhost:4201"
	@echo "  Backend API: http://localhost:3000"
	@echo "  Keycloak: http://localhost:8080"

dev-build: ## Build and start development environment
	@echo "Building development environment..."
	docker compose up -d --build

dev-stop: ## Stop development environment
	@echo "Stopping development environment..."
	docker compose down

dev-logs: ## View development logs (all services)
	docker compose logs -f

dev-logs-backend: ## View backend logs only
	docker compose logs -f backend

dev-logs-frontend: ## View frontend logs only
	docker compose logs -f frontend

dev-logs-keycloak: ## View Keycloak logs only
	docker compose logs -f keycloak

dev-restart: ## Restart development environment
	@echo "Restarting development environment..."
	docker compose restart

dev-clean: ## Stop and remove development containers, volumes, and images
	@echo "Cleaning development environment..."
	docker compose down -v --rmi local

# ============================================
# Production Commands
# ============================================

prod: ## Start production environment (requires .env file)
	@echo "Starting production environment..."
	@if [ ! -f .env ]; then echo "Error: .env file not found. Copy .env.example to .env and configure it."; exit 1; fi
	docker compose -f docker-compose.prod.yml up -d
	@echo "Production environment started!"
	@echo "  Application: http://YOUR_SERVER_IP (or configured domain)"
	@echo "  Keycloak (localhost only): http://127.0.0.1:8080"

prod-build: ## Build and start production environment
	@echo "Building production environment..."
	@if [ ! -f .env ]; then echo "Error: .env file not found. Copy .env.example to .env and configure it."; exit 1; fi
	docker compose -f docker-compose.prod.yml up -d --build

prod-stop: ## Stop production environment
	@echo "Stopping production environment..."
	docker compose -f docker-compose.prod.yml down

prod-logs: ## View production logs (all services)
	docker compose -f docker-compose.prod.yml logs -f

prod-logs-api: ## View API logs only
	docker compose -f docker-compose.prod.yml logs -f content-pool-api

prod-logs-nginx: ## View nginx logs only
	docker compose -f docker-compose.prod.yml logs -f nginx

prod-logs-keycloak: ## View Keycloak logs only
	docker compose -f docker-compose.prod.yml logs -f keycloak

prod-restart: ## Restart production environment
	@echo "Restarting production environment..."
	docker compose -f docker-compose.prod.yml restart

prod-clean: ## Stop and remove production containers, volumes, and images
	@echo "Cleaning production environment..."
	docker compose -f docker-compose.prod.yml down -v --rmi local

# ============================================
# Server Deployment Commands (Pre-built Images)
# ============================================

server-install: ## Install a release: make server-install RELEASE=vX.Y.Z ENVIRONMENT=production
	@if [ -z "$(RELEASE)" ] || [ -z "$(ENVIRONMENT)" ]; then echo "Error: RELEASE and ENVIRONMENT are required"; exit 1; fi
	@./scripts/install.sh --mode server --environment "$(ENVIRONMENT)" --release "$(RELEASE)"

server-up: ## Deploy on server using pre-built images (requires .env file)
	@echo "Deploying using pre-built images from GHCR..."
	@if [ ! -f .env ]; then echo "Error: .env file not found. Copy .env.example to .env and configure it."; exit 1; fi
	docker compose -f docker-compose.server.yml pull
	docker compose -f docker-compose.server.yml up -d
	@echo "Server deployment complete!"
	@echo "  Application: http://YOUR_SERVER_IP (or configured domain)"

server-stop: ## Stop server deployment
	@echo "Stopping server deployment..."
	docker compose -f docker-compose.server.yml down

server-logs: ## View server deployment logs
	docker compose -f docker-compose.server.yml logs -f

server-update: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-update-safe: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-update-release: ## Safely update server deployment to VERSION=vX.Y.Z
	@if [ -z "$(VERSION)" ]; then echo "Error: VERSION not set. Usage: make server-update-release VERSION=vX.Y.Z"; exit 1; fi
	@./scripts/update.sh --mode server --environment production --release "$(VERSION)"

staging-update: ## Deploy tested candidate: make staging-update RELEASE=vX.Y.Z-rc.N [MODE=traefik]
	@if [ -z "$(RELEASE)" ]; then echo "Error: RELEASE is required"; exit 1; fi
	@./scripts/update.sh $(if $(MODE),--mode "$(MODE)",) --environment staging --release "$(RELEASE)"

production-update: ## Deploy stable release: make production-update RELEASE=vX.Y.Z [MODE=traefik]
	@if [ -z "$(RELEASE)" ]; then echo "Error: RELEASE is required"; exit 1; fi
	@./scripts/update.sh $(if $(MODE),--mode "$(MODE)",) --environment production --release "$(RELEASE)"

staging-rollback: ## Explicit staging rollback: make staging-rollback RELEASE=vX.Y.Z
	@if [ -z "$(RELEASE)" ]; then echo "Error: RELEASE is required"; exit 1; fi
	@./scripts/update.sh $(if $(MODE),--mode "$(MODE)",) --environment staging --rollback-to "$(RELEASE)"

production-rollback: ## Explicit production rollback: make production-rollback RELEASE=vX.Y.Z
	@if [ -z "$(RELEASE)" ]; then echo "Error: RELEASE is required"; exit 1; fi
	@./scripts/update.sh $(if $(MODE),--mode "$(MODE)",) --environment production --rollback-to "$(RELEASE)"

adopt-current: ## Pin running legacy images: make adopt-current RELEASE=v0.1.3 ENVIRONMENT=production
	@if [ -z "$(RELEASE)" ] || [ -z "$(ENVIRONMENT)" ]; then echo "Error: RELEASE and ENVIRONMENT are required"; exit 1; fi
	@./scripts/update.sh $(if $(MODE),--mode "$(MODE)",) --environment "$(ENVIRONMENT)" --adopt-current "$(RELEASE)"

restore-backup: ## Downtime restore: make restore-backup BACKUP=backups/update_... [MODE=traefik]
	@if [ -z "$(BACKUP)" ]; then echo "Error: BACKUP is required"; exit 1; fi
	@./scripts/restore.sh $(if $(MODE),--mode "$(MODE)",) --from-backup "$(BACKUP)"

server-backup: ## Backup server deployment config, databases, and uploads
	@./scripts/update.sh --mode server --backup-only

server-clean: ## Stop and remove server deployment
	@echo "Cleaning server deployment..."
	docker compose -f docker-compose.server.yml down -v

# ============================================
# Traefik Edge Deployment Commands
# ============================================

server-install-traefik: ## Install release behind Traefik: RELEASE=vX.Y.Z ENVIRONMENT=production
	@if [ -z "$(RELEASE)" ] || [ -z "$(ENVIRONMENT)" ]; then echo "Error: RELEASE and ENVIRONMENT are required"; exit 1; fi
	@./scripts/install.sh --mode traefik --environment "$(ENVIRONMENT)" --release "$(RELEASE)"

server-traefik-up: ## Deploy pre-built images behind an existing Traefik edge
	@echo "Deploying using pre-built images behind Traefik..."
	@if [ ! -f .env ]; then echo "Error: .env file not found. Copy .env.example to .env and configure it."; exit 1; fi
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml pull
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml up -d
	@echo "Traefik-backed server deployment complete!"
	@echo "  Configure CONTENT_POOL_HOST, CONTENT_POOL_AUTH_HOST, and TRAEFIK_DOCKER_NETWORK in .env"

server-traefik-update: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-traefik-update-safe: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-traefik-update-release: ## Safely update Traefik deployment to VERSION=vX.Y.Z
	@if [ -z "$(VERSION)" ]; then echo "Error: VERSION not set. Usage: make server-traefik-update-release VERSION=v0.1.1"; exit 1; fi
	@./scripts/update.sh --mode traefik --environment production --release "$(VERSION)"

server-traefik-backup: ## Backup Traefik deployment config, databases, and uploads
	@./scripts/update.sh --mode traefik --backup-only

server-traefik-stop: ## Stop pre-built image deployment behind Traefik
	@echo "Stopping Traefik-backed server deployment..."
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml down

server-traefik-logs: ## View logs for pre-built image deployment behind Traefik
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml logs -f

server-traefik-config: ## Validate/render pre-built image deployment behind Traefik
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml config

prod-traefik: ## Start build-on-host production deployment behind Traefik
	@echo "Starting production environment behind Traefik..."
	@if [ ! -f .env ]; then echo "Error: .env file not found. Copy .env.example to .env and configure it."; exit 1; fi
	docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml up -d

prod-traefik-build: ## Build and start production deployment behind Traefik
	@echo "Building production environment behind Traefik..."
	@if [ ! -f .env ]; then echo "Error: .env file not found. Copy .env.example to .env and configure it."; exit 1; fi
	docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml up -d --build

prod-traefik-stop: ## Stop build-on-host production deployment behind Traefik
	@echo "Stopping Traefik-backed production deployment..."
	docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml down

prod-traefik-logs: ## View logs for build-on-host production deployment behind Traefik
	docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml logs -f

prod-traefik-config: ## Validate/render build-on-host production deployment behind Traefik
	docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml config

# ============================================
# Build & Push Commands (for GHCR)
# ============================================

build-push: ## Build and push images to GitHub Container Registry
	@echo "Error: GitHub Actions is the only release image publisher"; exit 1

# ============================================
# Database Commands
# ============================================

db-backup: ## Backup both databases, uploads, and runtime configuration
	@./scripts/update.sh --backup-only

db-restore: ## Restore a complete update backup: make db-restore BACKUP=backups/update_...
	@if [ -z "$(BACKUP)" ]; then echo "Error: BACKUP is required"; exit 1; fi
	@./scripts/restore.sh --from-backup "$(BACKUP)"

db-shell: ## Open PostgreSQL shell
	docker exec -it content-pool-db psql -U $${POSTGRES_USER:-content_pool} $${POSTGRES_DB:-content_pool}

db-migrate: ## Run database migrations (TypeORM)
	@echo "Running database migrations..."
	cd backend && npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts

db-migrate-generate: ## Generate new migration (usage: make db-migrate-generate NAME=MigrationName)
	@if [ -z "$(NAME)" ]; then echo "Error: NAME not specified. Usage: make db-migrate-generate NAME=AddNewFeature"; exit 1; fi
	@echo "Generating migration: $(NAME)..."
	cd backend && npx typeorm-ts-node-commonjs migration:generate -d src/database/data-source.ts src/database/migrations/$(NAME)

# ============================================
# Keycloak Commands
# ============================================

keycloak-admin: ## Open Keycloak admin console URL info
	@echo "Keycloak Admin Console:"
	@echo "  Development: http://localhost:8080/admin"
	@echo "  Production (recommended via SSH tunnel):"
	@echo "    ssh -L 8080:127.0.0.1:8080 USER@YOUR_SERVER"
	@echo "    then open http://localhost:8080/admin"
	@echo ""
	@echo "Default credentials:"
	@echo "  Username: admin"
	@echo "  Password: (from .env file or 'admin' for dev)"

keycloak-logs: ## View Keycloak logs
	docker compose logs -f keycloak

keycloak-export: ## Export Keycloak realm to JSON file
	@echo "Exporting Keycloak realm..."
	mkdir -p keycloak-exports
	docker exec keycloak /opt/keycloak/bin/kc.sh export --realm iqb --file /tmp/realm-export.json
	docker cp keycloak:/tmp/realm-export.json keycloak-exports/realm-export-$$(date +%Y%m%d-%H%M%S).json
	@echo "Realm exported to keycloak-exports/"

keycloak-smtp: ## Configure Keycloak SMTP from .env (run via SSH tunnel or on server)
	@./scripts/configure-keycloak-smtp.sh

keycloak-registration: ## Enable Keycloak self-registration with email verification and ALTCHA
	@./scripts/configure-keycloak-registration.sh

keycloak-registration-db: ## Enable Keycloak registration through DB fallback when admin API credentials are unavailable
	@./scripts/configure-keycloak-registration-db.sh

keycloak-altcha-provider: ## Build the Keycloak ALTCHA provider JAR
	@./scripts/build-keycloak-altcha.sh

# ============================================
# Utility Commands
# ============================================

status: ## Show running containers status
	@echo "=== Development Containers ==="
	docker compose ps
	@echo ""
	@echo "=== Production Containers ==="
	docker compose -f docker-compose.prod.yml ps 2>/dev/null || echo "Production not running"

logs: ## View logs for all running services
	@echo "Use 'make dev-logs' or 'make prod-logs' for specific environment"

shell-backend: ## Open shell in backend container (dev)
	docker compose exec backend sh

shell-api: ## Open shell in API container (prod)
	docker compose -f docker-compose.prod.yml exec content-pool-api sh

clean: ## Remove all stopped containers, unused images, and volumes
	@echo "Cleaning Docker resources..."
	docker system prune -f
	docker volume prune -f

update: ## Deprecated mutable-tag update
	@echo "Error: use staging-update or production-update with RELEASE=vX.Y.Z"; exit 1

# ============================================
# Build Commands
# ============================================

build-backend: ## Build backend Docker image
	docker build -t content-pool-backend ./backend

build-frontend: ## Build frontend Docker image
	docker build -t content-pool-frontend ./frontend

build-prod: ## Build production images
	docker compose -f docker-compose.prod.yml build

# ============================================
# Helper Scripts
# ============================================

init-keycloak: ## Initialize Keycloak realm (check and verify setup)
	@./scripts/init-keycloak.sh \
		"$(shell grep OIDC_PUBLIC_ISSUER_URL .env 2>/dev/null | cut -d= -f2 | sed 's|/realms/.*||' || echo http://localhost:8080)" \
		"$(shell grep KEYCLOAK_ADMIN_USER .env 2>/dev/null | cut -d= -f2 || echo admin)" \
		"$(shell grep KEYCLOAK_ADMIN_PASSWORD .env 2>/dev/null | cut -d= -f2 || echo admin)"

health: ## Check health of all services
	@echo "Checking development environment..."
	@./scripts/check-health.sh dev \
		"http://localhost:8080" \
		"http://localhost:3000/api" \
		"http://localhost:4201"

health-prod: ## Check health of production services
	@echo "Checking production environment..."
	@source .env && ./scripts/check-health.sh prod \
		"$$OIDC_PUBLIC_ISSUER_URL" \
		"http://localhost/api" \
		"http://localhost"

# ============================================
# Testing & Development
# ============================================

test-backend: ## Run backend tests
	cd backend && npm test

test-frontend: ## Run frontend tests
	cd frontend && npm test

lint-backend: ## Run backend linter
	cd backend && npm run lint

lint-frontend: ## Run frontend linter
	cd frontend && npm run lint

dev-setup: ## Initial development setup (install dependencies)
	@echo "Setting up development environment..."
	cd backend && npm install --legacy-peer-deps
	cd frontend && npm install --legacy-peer-deps
	@echo "Setup complete! Run 'make dev' to start."
