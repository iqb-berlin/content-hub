# AP API compatibility

Code, type names, DTOs, services and current browser routes use **AP**. The backend
accepts existing ACP integrations through an explicit application-boundary adapter.
Availability of the new contract depends on the deployed release; deploy both
components together before switching clients to AP.

## Paths and response selection

| Current path | Compatible existing path |
| --- | --- |
| `/api/ap` and `/api/ap/:apId/...` | `/api/acp` and `/api/acp/:acpId/...` |
| `/api/view/ap` and `/api/view/ap/:apId/...` | `/api/view/acp` and `/api/view/acp/:acpId/...` |
| `/api/server/ap` and `/api/server/ap/:apId/...` | `/api/server/acp` and `/api/server/acp/:acpId/...` |
| `/aps` | `/acps` redirects to `/aps` |
| `/admin/ap` | `/admin/acp` redirects to `/admin/ap` |

API aliases execute the same handlers, validation and access checks, without an HTTP
redirect. They support the existing methods and subresources, including files,
snapshots, comments and review. Old URLs return the old ACP response fields by
default; new AP URLs return AP fields. No removal date is imposed on the aliases.

Existing `/access` links retain `acpId` as an alias for `apId` and accept
`context=acp` as `context=ap`. The package sign-in link and return destination are
preserved. If both package ID parameters are present, `apId` takes precedence.

Shared endpoints whose URLs contain neither `ap` nor `acp`, including
`/api/auth/profile`, `/api/auth/credential-login`, `/api/admin/settings`,
`/api/admin/application-tokens` and `/api/server/capabilities`, retain their legacy
response format by default. New consumers send **`X-Content-Hub-Terminology: ap`**.
The current frontend sends that header only to its own `/api/` requests. Responses
identify their selected terminology in the same header and include it in `Vary`.

## Fields, roles and scopes

| Canonical contract | Accepted existing alias |
| --- | --- |
| `ap`, `aps`, `apId`, `apIds`, `apName`, `apRoles` | `acp`, `acps`, `acpId`, `acpIds`, `acpName`, `acpRoles` |
| `apIndex`, `apIndexSnapshot`, `defaultApIndex` | `acpIndex`, `acpIndexSnapshot`, `defaultAcpIndex` |
| `allowedApId`, `allowedApIds` | `allowedAcpId`, `allowedAcpIds` |
| `AP_MANAGER` | `ACP_MANAGER` |
| `ap.read` | `acp.read` |

Old request envelopes are normalized before strict DTO validation. Both generations
of names are accepted on either path. Conflicting aliases return HTTP 400: in
particular, `allowedAcpIds: null` cannot override a restricted `allowedApIds` list.
Package restrictions, authentication, scope checks and revocation remain enforced
for both API families. Existing database and environment integration tokens keep
working with `acp.read`; no token reissue is required for this naming transition.

Only known application envelope fields are translated. AP-Index JSON, settings,
definitions, response data, metadata and original file bytes are not recursively
renamed. Raw management/view index endpoints preserve the submitted index content.
The external `acp-index` schema identifier and URL remain valid. Schema validation
continues recognizing both `ap-index` and legacy `acp-index` filenames, including
malformed payloads that have no identifying package fields.

Dictionary responses (such as item tags) preserve every caller-owned key. Unit
item content stays opaque. Structured envelopes for token pages, response states
and server-sent job events are declared on their handlers so that nested contract
fields are translated without traversing arbitrary content. Legacy dependency
and transfer download links retain their existing paths and original file bytes.
The aliases retain the case-insensitive path behavior of the existing router.

### Migrating a transfer client

An existing client may continue using:

```http
PUT /api/server/acp/<uuid>/index
X-Server-Token: <existing-token>
Content-Type: application/json

{"acpIndex":{"packageId":"example","assessmentParts":[]}}
```

The canonical request is:

```http
PUT /api/server/ap/<uuid>/index
X-Server-Token: <same-existing-token>
Content-Type: application/json

{"apIndex":{"packageId":"example","assessmentParts":[]}}
```

For capability discovery and other shared endpoints, additionally send
`X-Content-Hub-Terminology: ap`. New capability responses use `ap.read` and
`allowedApIds`. Existing clients continue receiving `acp.read` and `allowedAcpIds`
when they omit the header. Clients can migrate individually; both names describe
the same package and permission.

## Persistence, sessions and rollback

TypeORM maps the new AP properties to the existing physical tables and columns,
including `acp`, `acp_id`, `acp_index` and `allowed_acp_ids`. Role and scope
transformers expose canonical values to application code while retaining
`ACP_MANAGER` and `acp.read` in storage. Previously applied migrations are unchanged.
There is no destructive schema rename, JSON rewrite or file move.

Existing credential JWTs with the `acpId` claim are accepted. New credential tokens
include both `apId` and the legacy claim for older consumers. Tokens containing
conflicting claims are rejected. Pending personal edits retain their storage keys
and identity across the transition. No session reset is required solely because
of this naming change.

Deploy frontend and backend from the same release. The old frontend can use the
compatibility paths on the new backend; the new frontend requires the new backend.
Rolling back both components keeps the existing physical storage representation.

## Technical verification

The focused PostgreSQL HTTP suite covers old/new paths and fields, persisted roles
and tokens, scope restrictions, conflicting aliases, raw JSON preservation and
physical schema compatibility:

```bash
cd backend
# Set NODE_ENV=test and DB_* to a dedicated database with "e2e" in its name.
npm run test:e2e -- --runInBand ap-compatibility.e2e-spec.ts
```

Unit tests additionally cover envelope translation and role/scope storage. The
browser suite exercises the canonical frontend against the real backend.
