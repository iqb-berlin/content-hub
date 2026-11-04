# Integrations and API

This guide uses AP and AP-Index as product terms. API paths, payload fields, scopes and
role values retain their existing `acp` identifiers; see
[terminology and technical identifiers](../README.md#terminology-and-technical-identifiers).

## API Surfaces

The backend exposes three broad API surfaces:

### 1. Browser-facing management API

Main prefix:

```text
/api
```

Examples:

- `/api/auth/...`
- `/api/users/...`
- `/api/admin/...`
- `/api/acp/...`

### 2. Read-only view API

Main prefix:

```text
/api/view
```

This surface supports public and restricted viewers and is used heavily by the Angular read-only pages.

### 3. Server-to-server API

Main prefix:

```text
/api/server
```

This surface is token-scoped and meant for system integration rather than browser use.

## Swagger

When Swagger is enabled, API documentation is exposed at:

```text
/api/docs
```

In production this is disabled by default unless `SWAGGER_ENABLED=true`.

## Management API Areas

The main authenticated API groups are:

- `/api/auth`
- `/api/users`
- `/api/admin`
- `/api/acp`
- `/api/acp/:acpId/files`
- `/api/acp/:acpId/snapshots`
- `/api/acp/:acpId/comments`
- `/api/acp/:acpId/items`

These endpoints expect the application JWT, not a server API token.

## Read-Only View API Areas

The `/api/view` surface covers:

- public settings,
- public AP listing,
- AP start page,
- units and sequences,
- items and item preferences,
- AP-Index,
- item explorer state for viewers.

These endpoints rely on AP-level access logic and can work for:

- anonymous viewers,
- authenticated users,
- credential viewers.

## Server API Authentication

The server API uses either:

- `X-Server-Token: <token>`
- `X-Integration-Token: <token>`
- `Authorization: Bearer <token>`

The token is first validated against database-backed application tokens managed
through the admin API. For compatibility and bootstrap setups, the backend can
also validate configured clients from `SERVER_API_TOKENS` or the legacy
`SERVER_API_KEY`.

Application token secrets are only returned once when they are created. The
backend stores a hash and a short display prefix, not the clear-text token.

### Manage application tokens

Admins can manage application tokens in the UI under **Token**
(`/admin/application-tokens`) or through the admin API.

Admin-only endpoints:

```text
GET   /api/admin/application-tokens?limit=50&offset=0
POST  /api/admin/application-tokens
PATCH /api/admin/application-tokens/:id/revoke
```

Example create payload:

```json
{
  "name": "studio",
  "scopes": ["acp.read", "transfer.read", "files.read"],
  "expiresAt": "2099-01-01T00:00:00.000Z",
  "allowedAcpIds": ["2d41b6f7-9c25-4c7c-8d35-d9314cc4d3b7"]
}
```

`allowedAcpIds` is optional for admins. If it is omitted, `null`, or an empty
array, the token is global and can access every AP permitted by its scopes.
If AP IDs are provided, the server API limits list, read, transfer, index and
file operations to those APs.

For audit access, AP-limited tokens can only read audit entries whose `acp_id`
is one of their `allowedAcpIds`. Global audit events without an `acp_id` are
visible only to global tokens with `audit.read`.

AP managers can manage AP-limited application tokens from the AP management
area. These endpoints always bind the token to the current AP:

```text
GET   /api/acp/:acpId/application-tokens?limit=50&offset=0
POST  /api/acp/:acpId/application-tokens
PATCH /api/acp/:acpId/application-tokens/:tokenId/revoke
```

AP managers cannot create global tokens. They can revoke only tokens that are
exclusively limited to the AP they manage.

The create response includes the one-time `token` field. Store it immediately in
the external application.

Create and revoke actions are written to the audit log as admin security events.
The audit details include the token ID, name and display prefix, but never the
clear-text token. Events triggered through the AP manager endpoints are assigned
to that AP and are therefore visible to AP-limited tokens with `audit.read`.

## Server API Scopes

Supported scopes:

- `acp.read`
- `transfer.read`
- `transfer.write`
- `index.read`
- `index.write`
- `files.read`
- `files.write`
- `audit.read`

Each endpoint declares the required scope through the `ServerApiScopes` decorator.
Scopes are necessary but not sufficient for AP-limited tokens: the target AP
must also be part of the token's `allowedAcpIds`.

## Main Server API Workflows

### Inspect token capabilities

Endpoint:

```text
GET /api/server/capabilities
```

This endpoint requires a valid server API token but no particular scope and no
AP ID. It is intended for integration connection tests and returns:

```json
{
  "clientId": "coding-box",
  "scopes": ["acp.read", "files.read", "files.write"],
  "capabilities": {
    "acp.read": true,
    "transfer.read": false,
    "transfer.write": false,
    "index.read": false,
    "index.write": false,
    "files.read": true,
    "files.write": true,
    "audit.read": false
  },
  "allowedAcpIds": null
}
```

Clients should use this endpoint instead of probing an AP resource with a
synthetic or malformed AP ID.

### List APs

Endpoint:

```text
GET /api/server/acp
```

Scope:

- `acp.read`

Use case:

- discover transferable APs and their latest update timestamp.
- AP-limited tokens only see their allowed APs.

### Export full AP transfer payload

Endpoints:

```text
GET /api/server/acp/:acpId
GET /api/server/acp/:acpId/export
```

Scope:

- `transfer.read`

Returned payload includes:

- AP metadata,
- current index,
- file metadata list.

### Read AP-Index only

Endpoint:

```text
GET /api/server/acp/:acpId/index
```

Scope:

- `index.read`

### Update AP-Index

Endpoint:

```text
PUT /api/server/acp/:acpId/index?strategy=overwrite|merge
```

Scope:

- `index.write`

Supports:

- overwrite behavior,
- deep merge behavior,
- optimistic concurrency using `expectedUpdatedAt`.

### List or download files

Endpoints:

```text
GET /api/server/acp/:acpId/files
GET /api/server/acp/:acpId/files/:fileId
GET /api/server/acp/:acpId/files/:fileId/download
```

Scope:

- `files.read`

### Upload files

Endpoint:

```text
POST /api/server/acp/:acpId/files/upload?conflictStrategy=reject|overwrite|keep-both
```

Scope:

- `files.write`

### Replace coding schemes

Endpoint:

```text
POST /api/server/acp/:acpId/coding-schemes/replace
```

Scope:

- `files.write`

This workflow is more specialized than a normal upload because it:

- targets `.vocs` replacement by filename,
- can create a new snapshot,
- supports optimistic concurrency and changelog metadata.

### Import or update an AP

Endpoints:

```text
POST /api/server/acp/import
POST /api/server/acp
```

Scope:

- `transfer.write`

The second endpoint is kept as a legacy alias.

### Read server API audit logs

Endpoint:

```text
GET /api/server/audit
```

Scope:

- `audit.read`

Supports filtering by:

- limit,
- action,
- client ID.

Global tokens with `audit.read` can read all server API audit logs. AP-limited
tokens with `audit.read` only receive logs explicitly tied to their allowed APs.
Audit entries without `acp_id` are intentionally hidden from AP-limited tokens.

## Example Token Configuration

```bash
SERVER_API_TOKENS=[{"id":"studio","token":"change-me","scopes":["transfer.read","files.read","index.read"]}]
```

## Example Request

```bash
curl -H "X-Server-Token: change-me" \
  http://localhost:3000/api/server/acp
```

## Concurrency and Conflict Notes

Some integration endpoints support `expectedUpdatedAt` so connected systems can reject stale updates.

This is especially useful for:

- AP import,
- index writes,
- coding-scheme replacement.

If your integration reads, transforms, and writes AP data, prefer this optimistic
concurrency pattern over blind overwrite.

## Auditability

Server API calls are audited through a dedicated interceptor and audit service. This is
helpful for tracing:

- which client changed which AP,
- whether a transfer failed,
- what action type occurred,
- which API scopes were exercised in practice.

## Related Documents

- [Access Control](access-control.md)
- [AP Workflows](acp-workflows.md)
- [Backend Architecture](../architecture/backend.md)
