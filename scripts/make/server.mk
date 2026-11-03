# IQB ContentPool server deployment Makefile

.PHONY: help server-up server-update server-update-safe server-backup server-stop server-logs server-config \
	server-update-release server-traefik-update-release \
	server-traefik-up server-traefik-update server-traefik-update-safe server-traefik-backup \
	server-traefik-stop server-traefik-logs server-traefik-config health-server health-traefik keycloak-smtp keycloak-registration keycloak-registration-db keycloak-altcha-provider \
	staging-update production-update staging-rollback production-rollback adopt-current restore-backup

help: ## Show this help message
	@echo "IQB ContentPool - Server Commands"
	@echo "================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'

server-up: ## Start server deployment with pre-built GHCR images
	@if [ ! -f .env ]; then echo "Error: .env file not found. Run ./scripts/install.sh first."; exit 1; fi
	docker compose -f docker-compose.server.yml pull
	docker compose -f docker-compose.server.yml up -d

server-update: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-update-safe: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-update-release: ## Safely update server deployment to VERSION=vX.Y.Z
	@if [ -z "$(VERSION)" ]; then echo "Error: VERSION not set. Usage: make server-update-release VERSION=vX.Y.Z"; exit 1; fi
	@./scripts/update.sh --mode server --environment production --release "$(VERSION)"

server-backup: ## Backup config, databases, and uploads without updating
	@./scripts/update.sh --mode server --backup-only

server-stop: ## Stop server deployment
	docker compose -f docker-compose.server.yml down

server-logs: ## Follow server deployment logs
	docker compose -f docker-compose.server.yml logs -f

server-config: ## Validate/render server Compose configuration
	docker compose -f docker-compose.server.yml config

server-traefik-up: ## Start server deployment behind existing Traefik
	@if [ ! -f .env ]; then echo "Error: .env file not found. Run ./scripts/install.sh --mode traefik first."; exit 1; fi
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml pull
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml up -d

server-traefik-update: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-traefik-update-safe: ## Deprecated: use staging-update or production-update with RELEASE=vX.Y.Z
	@echo "Error: choose staging-update or production-update and set RELEASE"; exit 1

server-traefik-update-release: ## Safely update Traefik deployment to VERSION=vX.Y.Z
	@if [ -z "$(VERSION)" ]; then echo "Error: VERSION not set. Usage: make server-traefik-update-release VERSION=v0.1.1"; exit 1; fi
	@./scripts/update.sh --mode traefik --environment production --release "$(VERSION)"

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

server-traefik-backup: ## Backup Traefik deployment config, databases, and uploads without updating
	@./scripts/update.sh --mode traefik --backup-only

server-traefik-stop: ## Stop server deployment behind Traefik
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml down

server-traefik-logs: ## Follow Traefik-backed server deployment logs
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml logs -f

server-traefik-config: ## Validate/render Traefik-backed server Compose configuration
	docker compose -f docker-compose.server.yml -f docker-compose.traefik.yml config

health-server: ## Run server health checks against localhost/public auth URL
	@./scripts/check-health.sh server "$$(grep -E '^OIDC_PUBLIC_ISSUER_URL=' .env | cut -d= -f2-)" http://localhost/api http://localhost

health-traefik: ## Run health checks against public Traefik hosts
	@./scripts/check-health.sh server-traefik "$$(grep -E '^OIDC_PUBLIC_ISSUER_URL=' .env | cut -d= -f2-)" "https://$$(grep -E '^CONTENT_HUB_HOST=' .env | cut -d= -f2-)/api" "https://$$(grep -E '^CONTENT_HUB_HOST=' .env | cut -d= -f2-)"

keycloak-smtp: ## Apply Keycloak SMTP settings from .env to the running realm
	@./scripts/configure-keycloak-smtp.sh

keycloak-registration: ## Enable Keycloak self-registration with email verification and ALTCHA
	@./scripts/configure-keycloak-registration.sh

keycloak-registration-db: ## Enable Keycloak registration through DB fallback when admin API credentials are unavailable
	@./scripts/configure-keycloak-registration-db.sh

keycloak-altcha-provider: ## Build the Keycloak ALTCHA provider JAR
	@./scripts/build-keycloak-altcha.sh
