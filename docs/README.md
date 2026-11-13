# Content Hub Documentation

This folder contains the main project documentation for the Content Hub application.
The repository is a split Angular frontend and NestJS backend that manages Assessment
Packages (APs), their files, access rules, review workflows, and external transfer APIs.

## Terminology and Technical Identifiers

The current product terms are **Assessment Package (AP)** and **AP-Index**. They follow
the [IQB specifications overview](https://iqb-specifications.github.io/) and the
[StarS Assessment Package documentation](https://iqb-berlin.github.io/rising-stars/content-package/).
The [StarS application documentation](https://iqb-berlin.github.io/rising-stars/content-hub/index.html)
uses the name ContentHub.

Earlier documentation used Assessment Content Package (ACP) and ACP-Index. These names
refer to the same package and index. The terminology change does not migrate data or
change the supported index format.

Code and new API contracts use AP identifiers. Existing integrations can continue
using their ACP contracts during the transition:

| Product term | Canonical identifier | Legacy integration alias |
| --- | --- | --- |
| AP | `Ap`, `apId`, `/aps`, `/api/ap`, `/api/server/ap` | `acpId`, `/acps`, `/api/acp`, `/api/server/acp` |
| AP-Index | `apIndex`, `defaultApIndex` | `acpIndex`, `defaultAcpIndex` |
| AP-Manager | `AP_MANAGER` | `ACP_MANAGER` |
| AP read permission | `ap.read` | `acp.read` |

See [AP API compatibility](features/ap-api-compatibility.md) for request/response
selection, shared endpoints and migration examples. Physical database identifiers,
stored role/scope values, migration history and external AP-Index schema URLs are
preserved. Existing rows, snapshots, tokens and files need no data migration.
The [external schema URL](https://iqb-specifications.github.io/acp-index/) and
historical documentation filenames remain valid. Historical release notes and
test evidence retain the names used when they were written.

## Concepts

- [Current high-level concept](concepts/GROBKONZEPT.md) (German)
- [Detailed concept: documentation map](concepts/FEINKONZEPT.md) (German)
- [Comparison with the original concept and open decisions](concepts/KONZEPTABGLEICH.md) (German)
- [Historical concept and provenance](concepts/legacy/README.md)

The historical concept is retained for traceability, not as the current target
architecture. The comparison distinguishes implemented capabilities, changed
approaches, and requirements that still need a decision.

## Reading Order

If you are new to the project, read the documentation in this order:

1. [Architecture Overview](architecture/overview.md)
2. [Getting Started](development/getting-started.md)
3. [Access Control](features/access-control.md)
4. [AP Workflows](features/acp-workflows.md)
5. [Deployment](operations/deployment.md)

For AP managers who need a task-oriented user guide, see:

- [AP-Manager-Handbuch](manuals/acp-manager-manual.md)

## Documentation Map

### Architecture

- [Architecture Overview](architecture/overview.md)
  High-level system layout, request flows, deployment shape, and repository structure.
- [Backend Architecture](architecture/backend.md)
  NestJS bootstrap, modules, guards, persistence boundaries, and backend conventions.
- [Frontend Architecture](architecture/frontend.md)
  Angular routing, application shell, authentication flow, and client-side service model.
- [Data Model](architecture/data-model.md)
  Core entities, relationships, JSONB usage, and what lives in the database versus the filesystem.

### Development

- [Getting Started](development/getting-started.md)
  Local setup, Docker and manual startup, ports, and common development commands.
- [Configuration](development/configuration.md)
  Environment variables, safe defaults, OIDC setup, migration toggles, and configuration boundaries.
- [Testing and Quality](development/testing-and-quality.md)
  Automated test commands, manual verification flows, and release-quality checks.

### Features

- [Access Control](features/access-control.md)
  Authentication methods, access models, roles, feature flags, and route/guard behavior.
- [AP Workflows](features/acp-workflows.md)
  How APs are created, populated, configured, versioned, and reviewed.
- [Item Explorer](features/item-explorer.md)
  Shared draft state, publish/discard flow, metadata columns, tags, and empirical difficulty workflows.
- [Musterlösung und Kodierinformation im Booklet-Review](review-solutions.md)
  Reversible Musterlösungsanzeige und lesbare Anweisungen für offene Antwortformate.
- [Integrations and API](features/integrations-and-api.md)
  Public view endpoints, management endpoints, server-to-server API tokens, scopes, and transfer workflows.

### Manuals

- [AP-Manager-Handbuch](manuals/acp-manager-manual.md)
  Task-oriented guide for day-to-day AP management in the current UI.

### Operations

- [Releases and Promotion](operations/releases.md)
  SemVer, release candidates, staging evidence, digest promotion, rollback, and restore.
- [Deployment](operations/deployment.md)
  Development, production, server-image, and single-domain Traefik deployment modes.
- [Monitoring and Maintenance](operations/monitoring-and-maintenance.md)
  Health checks, backups, upgrades, observability, and routine operator tasks.
- [Keycloak Email Delivery](operations/keycloak-email.md)
  Local Postfix relay and HU authenticated SMTP setup for transactional Keycloak mail.
- [Content Hub Branding](operations/content-hub-branding.md)
  Approved assets, technical-name transition, palette migration and rollback.

## Existing Root-Level Runbooks

Several operational documents already exist at the repository root and remain useful:

- [DEPLOY.md](../DEPLOY.md)
- [KEYCLOAK_SETUP.md](../KEYCLOAK_SETUP.md)
- [Keycloak Registration and ALTCHA](../keycloak/docs/REGISTRATION_AND_ALTCHA.md)
- [GITLAB_SETUP.md](../GITLAB_SETUP.md)
- [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md)

The files in `docs/` are intended to be the main navigable knowledge base for the
application. The root-level documents are still helpful as focused runbooks for
deployment, identity provider setup, and release readiness.
