# Data Model

## Overview

The Content Hub data model mixes relational structure with JSONB payloads. That balance
fits the domain well because APs contain a combination of:

- strongly structured access and identity data,
- loosely structured AP-Index payloads,
- item-level annotations that evolve over time,
- uploaded files that live on disk rather than in the database.

## Core Entities

Application entities and properties use AP names. The `Ap` entity maps to the
existing `acp` table; physical table/column names remain unchanged for compatibility.
See [terminology and technical identifiers](../README.md#terminology-and-technical-identifiers).

### `Ap`

The `acp` table is the central aggregate.

Key fields:

- `id`
- `packageId`
- `name`
- `description`
- `apIndex` as JSONB
- `itemProperties` as JSONB
- `settings` as JSONB
- timestamps

An AP is linked to files, snapshots, access configurations, comments, and user roles.

### `User`

The `users` table stores application profiles linked to OIDC identities.

Key fields:

- `username`
- `displayName`
- `isAppAdmin`
- `oidcSub`

OIDC-backed users exist in the local database so AP roles, comments, and app-admin
state can be resolved consistently. Authentication itself remains in Keycloak.

### `ApUserRole`

This table is the AP-level authorization join table.

Supported roles:

- `AP_MANAGER` (stored as `ACP_MANAGER`)
- `READ_ONLY`

One user can hold different roles across different APs.

### `ApAccessConfig`

This table defines how an AP is exposed to viewers.

Key fields:

- `accessModel`
- `allowRegistered`
- `featureConfig` as JSONB
- `validFrom`
- `validUntil`

New APs receive a default access-config row with `accessModel = PRIVATE`. The table also
owns the credential list entries for `CREDENTIALS_LIST` access.

### `ApCredential`

This table stores AP-specific credentials for restricted read-only access.

Key fields:

- `accessConfigId`
- `username`
- `passwordHash`

These credentials are not normal application users and are not stored in the `users` table.
The pair of `accessConfigId` and `username` is unique. Legacy duplicate rows are reconciled before
the constraint is created, retaining one stable credential ID and the newest personal preference
per view.

### `ApFile`

This table stores metadata for uploaded AP files.

Key fields:

- `filePath`
- `originalName`
- `fileType`
- `fileSize`
- `checksum`
- `validationResult` as JSONB

The actual file content is stored on the filesystem at `filePath`.

### `ApSnapshot` and `ApSnapshotFile`

Snapshots preserve historical AP state.

`ApSnapshot` stores:

- AP linkage,
- version number,
- index snapshot JSON,
- optional changelog.

`ApSnapshotFile` stores metadata for the files included in the snapshot.

### `Comment`

Comments belong to an AP and target one of three domain object types:

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
- default AP-Index JSON.

### `ItemResponseState`

This table stores per-item response state, mainly for manager and viewer workflows that
need to persist answer-like data while browsing.

### `ApItemPreference`

This table stores persisted viewer preferences for item-oriented pages. It supports both:

- authenticated user IDs,
- stable credential IDs (with the username retained for legacy compatibility and diagnostics).

The payload is JSONB and can hold UI state, item tags, and personal row data per view. Personal row
data is restricted to a category, a string-array of tags, and a plain-text note. Partial-credit item
rows use their full stable row key, including the Sub-ID component.

Personal rows are updated atomically inside the JSONB document. Credential-list replacement keeps
the IDs of credentials whose usernames remain present, preserving their personal preferences while
still deleting preferences for credentials that are actually removed.

### `ApItemExplorerState`

This table powers the shared draft/published item explorer model.

Key fields:

- `publishedState` JSONB,
- `draftState` JSONB,
- `status`,
- `version`,
- `publishedVersion`,
- actor metadata for the last update.

### `ApItemExplorerChangeLog`

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
- AP/resource identifiers,
- success flag,
- status code,
- details JSON.

## Relationship Summary

The most important relationships are:

- one `Ap` to many `ApFile`
- one `Ap` to many `ApSnapshot`
- one `ApSnapshot` to many `ApSnapshotFile`
- one `Ap` to many `Comment`
- one `Ap` to many `ApUserRole`
- one `User` to many `ApUserRole`
- one `Ap` to one effective `ApAccessConfig` record used by the application
- one `ApAccessConfig` to many `ApCredential`
- one `Ap` to one `ApItemExplorerState`

## JSONB Usage

JSONB is used heavily for data that varies per AP or is likely to evolve:

### `Ap.apIndex` (stored as `acp.acp_index`)

The complete AP-Index payload. This avoids forcing a brittle relational model on a
domain object that is naturally hierarchical.

### `acp.itemProperties`

Per-item annotations such as empirical difficulty and explorer-managed state.

### `acp_access_configs.featureConfig`

Per-AP feature flags controlling read-only functionality.

### `acp_files.validationResult`

Validation issues and timestamps attached to uploaded files.

### `app_settings.theme` and `app_settings.defaultApIndex`

Global theming and default content templates.

### Item explorer state payloads

Draft and published explorer state are stored as JSONB so the frontend can evolve
without a schema migration for every UI-level change.

## Data Ownership Rules

The practical ownership model is:

- AP metadata belongs to `Ap`.
- Viewer exposure rules belong to `ApAccessConfig`.
- Uploaded binaries belong to the filesystem, with `ApFile` as the metadata index.
- Historical rollbacks belong to snapshots.
- Long-lived collaborative item-list state belongs to the explorer state tables.
- User-specific lightweight view preferences belong to `ApItemPreference`.

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
