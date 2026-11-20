# Access Control

## Overview

Content Hub has a layered access model. Access is not decided by one flag alone. The
effective permissions for a request depend on:

1. authentication method,
2. global app-admin status,
3. AP-specific roles,
4. AP access model,
5. AP feature flags.

This gives the application a lot of flexibility without requiring completely separate
codepaths for public, managed, and restricted content.

## Supported Authentication Methods

### OIDC login

Endpoints:

- `/api/auth/oidc-config`
- `/api/auth/oidc-callback`
- `/api/auth/sync-oidc-roles`

Use case:

- all registered application users managed through Keycloak.

Important behavior:

- the frontend performs PKCE-based authorization code flow,
- the backend validates the returned ID token,
- the backend then issues its own JWT for application use.

### AP credential login

Endpoint:

- `/api/auth/credential-login`

Use case:

- AP-specific viewer access when the access model is `CREDENTIALS_LIST`.

Important behavior:

- credentials are stored per AP access config,
- credential users are not normal application users,
- their access token is only valid for the associated AP.

## Role Model

### Global role

- `APP_ADMIN`

App admins can:

- access admin settings,
- manage users,
- create and delete APs,
- manage any AP,
- bypass most AP-level restrictions.

### AP-level roles

- `AP_MANAGER`
- `READ_ONLY`

`AP_MANAGER` allows write access to manager functionality for a specific AP.
`READ_ONLY` grants authenticated access to that AP without management rights.

### Management API validation

Role assignment accepts only `AP_MANAGER` and `READ_ONLY`, with a UUID target
user ID. Access updates accept `PRIVATE`, `PUBLIC`, `CREDENTIALS_LIST`, and the
legacy `REGISTERED` model. If supplied, `allowRegistered` must be a JSON boolean:
strings, numbers, and `null` are rejected with HTTP 400 before persistence.
Omitting the field preserves the existing update behavior.

Validity dates can be omitted or `null`; supplied non-null dates must be ISO date
strings. The service continues to enforce the credential validity window and
retains existing dates when updating an existing credential-based configuration
without replacement dates. Feature configuration remains an extensible object.

Credential imports accept `mode=replace`, `mode=append`, or `mode=upsert` and
default to `replace` when omitted. Unknown modes return HTTP 400. Successful
imports return `message`, `added`, `updated`, `skipped`, and `duplicates`.

The frontend models role assignments separately from user profiles: listing roles
includes user details, while assigning a role can return just the assignment.
Assignable users contain `id`, `username`, and an optional nullable `displayName`.
Access responses can contain `null` validity dates.

## AP Access Models

Each AP also has an access configuration.

### `PRIVATE`

This is the default for newly created APs. The AP is not listed on the public landing
page and is not reachable anonymously. Access is limited to app admins and users with an
explicit AP role.

### `PUBLIC`

The AP is viewable without login. Feature flags still determine what anonymous viewers
can do inside the read-only UI.

### `REGISTERED`

`REGISTERED` is an effective access state for authenticated users with an AP role. It is
used in frontend presentation logic, but newly created access configurations are stored
with `PRIVATE`, `PUBLIC`, or `CREDENTIALS_LIST` as the base model.

### `CREDENTIALS_LIST`

The AP requires AP-specific viewer credentials. Managers configure and maintain the
username/password list through the AP access settings.

## Who Decides Access?

### Backend authority

The backend is the final authority. `ApAccessGuard` can grant access when:

1. the current user is an app admin,
2. the current user holds an AP role,
3. the current token is a credential token for the AP,
4. the AP is public.

If none of those conditions apply, the request is rejected.

### Frontend guidance

Angular guards guide the user into the right flow:

- `adminGuard`
- `authGuard`
- `apManagerGuard`
- `apViewGuard`

They improve UX, but they do not replace backend authorization.

## Feature Flags

Feature flags are stored in `ApAccessConfig.featureConfig` and mainly affect non-manager viewers.

Important supported flags include:

- `allowIndexDownload`
- `allowUnitDownload`
- `allowFileDownload`
- `enableUnitView`
- `enableSequenceNavigation`
- `enableItemList`
- `enableItemClick`
- `enableItemListFilter`
- `enableItemListSort`
- `enableItemListTags`
- `enableCommenting`
- `commentTargets`
- `showMetadata`
- `showRichText`
- `showCodingScheme`
- `metadataColumns`
- `availableTags`
- `persistUserPreferences`
- `showAudioVideoCodingVariables`
- `enablePlayerFocusHighlight`

Managers and app admins generally bypass these restrictions so they can inspect and
maintain AP content even when public-facing features are disabled.

## Metadata Columns and Legacy Compatibility

The backend normalizes metadata-column configuration so newer `metadataColumns` values
and legacy `itemListMetadataColumns` data can coexist safely.

That matters for:

- item list column visibility,
- item explorer column order and widths across system, metadata, tag, and personal columns,
- backward compatibility with older AP configuration payloads.

The unified table layout is stored alongside the legacy metadata-only fields. Older saved
configurations therefore retain their visibility, order, and widths until a manager explicitly
creates a full table layout.

## Credential Security Rules

AP credential passwords have strong validation:

- minimum 12 characters,
- at least one uppercase letter,
- at least one lowercase letter,
- at least one digit,
- at least one special character.

Credential login is also rate limited through environment variables.

## Admin-Specific OIDC Enforcement

The admin controller is protected by:

- `JwtAuthGuard`
- `OidcAuthGuard`
- `RolesGuard`

All normal application sessions are OIDC-backed. The additional guard ensures that AP
credential tokens can never be used for admin-only configuration areas.

## Access Outcome Matrix

| User type | Can open public AP | Can open registered AP | Can manage AP | Can use admin UI |
| --- | --- | --- | --- | --- |
| Anonymous visitor | Yes | No | No | No |
| Credential viewer | Only linked AP | No | No | No |
| OIDC user with `READ_ONLY` | Yes | Yes for assigned AP | No | No |
| OIDC user with `AP_MANAGER` | Yes | Yes for assigned AP | Yes for assigned AP | No |
| OIDC app admin | Yes | Yes | Yes | Yes |

## Access UX on the Frontend

When access is missing or expired, the frontend redirects users to `/access` with a
reason code. The UI can distinguish between:

- login required,
- insufficient rights,
- feature disabled,
- session expired.

That makes access failures more understandable than a raw 401 or 403.

## Related Documents

- [AP Workflows](acp-workflows.md)
- [Item Explorer](item-explorer.md)
- [Backend Architecture](../architecture/backend.md)
