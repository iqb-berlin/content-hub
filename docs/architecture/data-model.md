# Data Model

## Overview

The Content Hub data model mixes relational structure with JSONB payloads. That balance
fits the domain well because ACPs contain a combination of:

- strongly structured access and identity data,
- loosely structured ACP index payloads,
- item-level annotations that evolve over time,
- uploaded files that live on disk rather than in the database.

## Core Entities

### `Acp`

The `acp` table is the central aggregate.

Key fields:

- `id`
- `packageId`
- `name`
- `description`
- `acpIndex` as JSONB
- `itemProperties` as JSONB
- `settings` as JSONB
- timestamps

An ACP is linked to files, snapshots, access configurations, comments, and user roles.

### `User`

The `users` table stores application profiles linked to OIDC identities.

Key fields:

- `username`
- `displayName`
- `isAppAdmin`
- `oidcSub`

OIDC-backed users exist in the local database so ACP roles, comments, and app-admin
state can be resolved consistently. Authentication itself remains in Keycloak.

### `AcpUserRole`

This table is the ACP-level authorization join table.

Supported roles:

- `ACP_MANAGER`
- `READ_ONLY`

One user can hold different roles across different ACPs.

### `AcpAccessConfig`

This table defines how an ACP is exposed to viewers.

Key fields:

- `accessModel`
- `allowRegistered`
- `featureConfig` as JSONB
- `validFrom`
- `validUntil`

New ACPs receive a default access-config row with `accessModel = PRIVATE`. The table also
owns the credential list entries for `CREDENTIALS_LIST` access.

### `AcpCredential`

This table stores ACP-specific credentials for restricted read-only access.

Key fields:

- `accessConfigId`
- `username`
- `passwordHash`

These credentials are not normal application users and are not stored in the `users` table.
The pair of `accessConfigId` and `username` is unique. Legacy duplicate rows are reconciled before
the constraint is created, retaining one stable credential ID and the newest personal preference
per view.

### `AcpFile`

This table stores metadata for uploaded ACP files.

Key fields:

- `filePath`
- `originalName`
- `fileType`
- `fileSize`
- `checksum`
- `validationResult` as JSONB

The actual file content is stored on the filesystem at `filePath`.

### `AcpSnapshot` and `AcpSnapshotFile`

Snapshots preserve historical ACP state.

`AcpSnapshot` stores:

- ACP linkage,
- version number,
- index snapshot JSON,
- optional changelog.

`AcpSnapshotFile` stores metadata for the files included in the snapshot.

### `Comment`

Comments belong to an ACP and target one of three domain object types:

- `UNIT`
- `ITEM`
- `TASK_SEQUENCE`

A comment may be linked to a normal user or to a credential-login username.

### `AppSettings`

Global application settings are stored in a single table with fields for:

- theme JSON,
- language,
- logo URL,
- landing page HTML,
- imprint HTML,
- privacy HTML,
- accessibility HTML,
- default ACP index JSON.

### `ItemResponseState`

This table stores per-item response state, mainly for manager and viewer workflows that
need to persist answer-like data while browsing.

### `AcpItemPreference`

This table stores persisted viewer preferences for item-oriented pages. It supports both:

- authenticated user IDs,
- stable credential IDs (with the username retained for legacy compatibility and diagnostics).

The payload is JSONB and can hold UI state, item tags, and personal row data per view. Personal row
data is restricted to a category, a string-array of tags, and a plain-text note. Partial-credit item
rows use their full stable row key, including the Sub-ID component.

Personal rows are updated atomically inside the JSONB document. Credential-list replacement keeps
the IDs of credentials whose usernames remain present, preserving their personal preferences while
still deleting preferences for credentials that are actually removed.

### `AcpItemExplorerState`

This table powers the shared draft/published item explorer model.

Key fields:

- `publishedState` JSONB,
- `draftState` JSONB,
- `status`,
- `version`,
- `publishedVersion`,
- actor metadata for the last update.

### `AcpItemExplorerChangeLog`

This is the audit trail for explorer state changes.

It stores:

- change type,
- before and after state,
- top-level diff JSON,
- draft and published version counters,
- actor metadata.

### `ServerApiAuditLog`

Every server API request can be recorded here with:

- client ID,
- action,
- HTTP method and path,
- ACP/resource identifiers,
- success flag,
- status code,
- details JSON.

## Relationship Summary

The most important relationships are:

- one `Acp` to many `AcpFile`
- one `Acp` to many `AcpSnapshot`
- one `AcpSnapshot` to many `AcpSnapshotFile`
- one `Acp` to many `Comment`
- one `Acp` to many `AcpUserRole`
- one `User` to many `AcpUserRole`
- one `Acp` to one effective `AcpAccessConfig` record used by the application
- one `AcpAccessConfig` to many `AcpCredential`
- one `Acp` to one `AcpItemExplorerState`

## JSONB Usage

JSONB is used heavily for data that varies per ACP or is likely to evolve:

### `acp.acpIndex`

The complete ACP index payload. This avoids forcing a brittle relational model on a
domain object that is naturally hierarchical.

### `acp.itemProperties`

Per-item annotations such as empirical difficulty and explorer-managed state.

### `acp_access_configs.featureConfig`

Per-ACP feature flags controlling read-only functionality.

### `acp_files.validationResult`

Validation issues and timestamps attached to uploaded files.

### `app_settings.theme` and `app_settings.defaultAcpIndex`

Global theming and default content templates.

### Item explorer state payloads

Draft and published explorer state are stored as JSONB so the frontend can evolve
without a schema migration for every UI-level change.

## Data Ownership Rules

The practical ownership model is:

- ACP metadata belongs to `Acp`.
- Viewer exposure rules belong to `AcpAccessConfig`.
- Uploaded binaries belong to the filesystem, with `AcpFile` as the metadata index.
- Historical rollbacks belong to snapshots.
- Long-lived collaborative item-list state belongs to the explorer state tables.
- User-specific lightweight view preferences belong to `AcpItemPreference`.

## Migration Strategy

The repository already includes multiple TypeORM migrations under
`backend/src/database/migrations`.

Recommended strategy:

- allow synchronization only in development,
- create explicit migrations for production changes,
- keep JSONB shape changes backward-compatible when possible,
- avoid hard-coding assumptions about optional keys inside JSONB payloads.

## Related Documents

- [Architecture Overview](overview.md)
- [Backend Architecture](backend.md)
- [Item Explorer](../features/item-explorer.md)
