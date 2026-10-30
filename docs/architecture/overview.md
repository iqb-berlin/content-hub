# Architecture Overview

## Purpose

Content Hub is a web application for working with Assessment Content Packages
(ACPs). An ACP combines structured index data, referenced media and runtime files,
access rules, comments, snapshots, and item-level metadata into one manageable unit.

The application supports four broad use cases:

1. public or restricted read-only browsing of ACPs,
2. manager workflows for importing files and maintaining package content,
3. application administration for users and global settings,
4. server-to-server transfer workflows for connected systems.

## System Shape

The repository currently contains a split frontend/backend application plus
deployment infrastructure:

| Layer | Main technology | Responsibility |
| --- | --- | --- |
| Frontend | Angular 21 standalone app | Browser UI, navigation, auth flow, ACP manager UI, read-only views |
| Backend | NestJS 11 + TypeORM | REST API, authorization, file handling, validation, snapshots, integrations |
| Database | PostgreSQL 16 | Users, ACP metadata, access config, comments, snapshots, explorer state, audit data |
| File storage | Local filesystem volume | Uploaded ACP files and generated ZIP exports |
| Identity | Keycloak / OIDC | Admin login and optional OIDC-backed user accounts |
| Reverse proxy | nginx | Production routing for frontend, API, and Keycloak exposure |

## Core Domain Object: ACP

An ACP is the center of the system. It has:

- a stable `packageId` and display metadata,
- an `acpIndex` JSON payload,
- uploaded files stored on disk with metadata in the database,
- access configuration and optional credential lists,
- snapshots for rollback and comparison,
- optional comments and item annotations,
- item explorer draft and published state.

That design lets the application mix structured metadata and file-based assessment assets
without forcing everything into relational tables.

## High-Level Runtime Flow

### 1. Public or restricted viewing

1. A user opens the Angular app.
2. The frontend fetches public settings from `/api/view/settings`.
3. The user navigates to `/view/:acpId`.
4. The backend `AcpAccessGuard` decides whether access is allowed based on:
   public visibility, ACP role, app-admin rights, or credential token.
5. Feature flags in the ACP access configuration determine which read-only features
   are available to non-managers.

### 2. Management workflow

1. A manager or admin authenticates.
2. Angular route guards protect `/acps`, `/admin/*`, and `/manage/:acpId/*`.
3. The backend exposes manager-only endpoints under `/api/acp/:id/...`.
4. Managers upload files, sync the ACP index, configure access, edit explorer drafts,
   create snapshots, and export comments or index data.

### 3. OIDC admin login

1. The frontend asks `/api/auth/oidc-config` for runtime OIDC settings.
2. The browser performs an authorization-code-with-PKCE flow against Keycloak.
3. The frontend exchanges the authorization code for tokens at the issuer token endpoint.
4. The frontend sends the ID token to `/api/auth/oidc-callback`.
5. The backend validates the token and issues the Content Hub JWT used by the app.

### 4. Server-to-server transfer

1. An integration client calls `/api/server/...` with `X-Server-Token` or bearer auth.
2. The `ServerApiAuthGuard` validates the token and required scopes.
3. The server API returns ACP metadata, files, index payloads, or audit logs.
4. Write operations can import ACPs, update ACP indexes, upload files, or replace coding schemes.

## Runtime Boundaries

The application separates concerns clearly:

- Angular owns page routing, local UI state, and browser login redirects.
- NestJS owns authorization decisions, business rules, and persistence.
- PostgreSQL stores metadata and state, but not the file binary payloads.
- The filesystem stores ACP files under the configured upload directory.
- Keycloak is external to the application domain and only provides identity.

## Deployment Topology

The repository supports three main runtime modes:

| Mode | Main entry point | Typical use |
| --- | --- | --- |
| Local Docker development | `docker-compose.yml` | Fast local onboarding with DB, backend, frontend, and Keycloak |
| Built-on-host production | `docker-compose.prod.yml` | Deploy from source on a VPS |
| Prebuilt-image server deployment | `docker-compose.server.yml` | Deploy from GHCR images without building on the server |

In production, the frontend and API are typically hidden behind nginx. Keycloak is
usually exposed through a public auth hostname while keeping the admin console
localhost-bound on the server.

## Repository Structure

```text
content-hub/
|- backend/                 NestJS API and TypeORM entities
|- frontend/                Angular standalone SPA
|- keycloak/                Realm export and theme assets
|- nginx/                   Reverse proxy config fragments
|- scripts/                 Health checks and helper scripts
|- docs/                    Main project documentation
|- docker-compose.yml       Local development stack
|- docker-compose.prod.yml  Production build-on-host stack
|- docker-compose.server.yml Production stack using prebuilt images
```

## Architectural Characteristics

A few design choices show up repeatedly throughout the codebase:

- Feature gating is per ACP rather than global.
- Managers and app admins can bypass many read-only feature restrictions.
- The backend favors JSONB for ACP-specific configuration and item-level annotations.
- File uploads automatically trigger index synchronization and validation workflows.
- Item Explorer state is versioned separately from the main ACP record to enable draft workflows.
- Integration APIs use a separate token model and do not depend on browser login.

## Related Documents

- [Backend Architecture](backend.md)
- [Frontend Architecture](frontend.md)
- [Data Model](data-model.md)
- [ACP Workflows](../features/acp-workflows.md)
