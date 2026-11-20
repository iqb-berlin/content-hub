# Public task publications

Implements [content-hub#250](https://github.com/iqb-berlin/content-hub/issues/250).

AP managers and application admins can open **Öffentliche Aufgaben** on the management overview.
They select one Unit, enter the stimulus copyright notice and optional public comments, inspect
the complete public preview, and explicitly publish that version. A Unit includes its stimulus
and all its items. The source AP can remain private.

The preview includes the source VOMD metadata and VOCS coding instructions. Managers must check
that these are suitable for public release. Review comments, group assignments, Studio comments,
user identities, file paths and download links are not copied. The public comments are separately
authored text; existing private comments are never automatically made public.

## Stable links and retention

- `/public/task/:publicationId` opens without login or AP access. The UUID is independent of Unit
  names, source file IDs, package IDs, Review settings and access periods.
- Each publication freezes its player HTML, Unit definition (including embedded stimulus), coding
  scheme, metadata, copyright notice and public comments in the `public_tasks.snapshot` JSONB column.
- There is no automatic expiration, content update or deletion endpoint. A new content version
  receives a new link. Source updates, restores, file deletion and AP deletion cannot change or
  cascade-delete an existing publication.
- A manager can withdraw a publication (public reads then return 404), and later restore it under
  the same link. Management updates are scoped to the original AP. After source AP deletion, an
  application admin can still use that AP ID with the management API.
- The public endpoint sends `Cache-Control: no-store` so normal browser/API caching does not keep
  serving withdrawn content. Previously copied content cannot be recalled.
- Previewing does not persist or publish anything. Publication rebuilds the snapshot and checks a
  SHA-256 digest against the reviewed preview, returning 409 if the content or release text changed.

Ten-year availability also requires retaining the database and its backups, maintaining the public
hostname and SPA route, and supporting snapshot version 1 in future releases. Include `public_tasks`
in all database backups and restore checks. Source-package exports are not publication backups.
The migration refuses to drop a populated publication table during rollback.

Players that rely on external resources or the shared GeoGebra bundle still require those resources
to remain available. Embed stimulus/media in the Unit definition and verify the public preview before
release; storing the task does not archive third-party services or pin shared runtime assets.

## Presentation and download behavior

The public page displays the stimulus copyright notice prominently above the player, followed by
coding instructions, metadata and public comments. It offers no package/file/index download or
editing/comment submission actions. Its player iframe uses `sandbox="allow-scripts"`, without
download, popup, top-navigation or parent-origin permission. Coding HTML uses Angular sanitization.
Player messages are accepted only from the page's own iframe; response collection/logging is disabled.
The public shared GeoGebra resources allow credential-free cross-origin reads so sandboxed players
can fetch JSON, use XHR and import JavaScript modules. This resource policy does not extend to private
AP APIs. Optional profile or OIDC role restoration failures keep visitors on the public task page;
temporary failures preserve the stored session, while rejected credentials are cleared locally.

A displayed web task must be transferred to the visitor's browser. Visitors can therefore still save
responses, inspect browser traffic, copy text or take screenshots. This is a presentation-only
publication workflow, not technical copy protection. Ordinary AP download permissions are independent:
publishing a task does not grant access to any private source AP endpoints.

## API

Management endpoints require an OIDC application session and the `AP_MANAGER` role for that AP
(or application-admin status):

- `GET /api/ap/:apId/publications`: summaries and stable paths, excluding stored payloads.
- `GET /api/ap/:apId/publications/units`: source Unit choices.
- `POST /api/ap/:apId/publications/preview`: `unitId`, `copyrightNotice`, `publicComments`; returns
  `snapshot` and `sourceRevision`. Missing player, definition, coding or metadata blocks publication.
- `POST /api/ap/:apId/publications`: the same fields plus `sourceRevision`; stores the exact
  reviewed stand. Clients cannot submit their own snapshot HTML/payload.
- `PUT /api/ap/:apId/publications/:publicationId`: `{ "published": false }` withdraws the stand;
  `true` restores it. The stored content remains immutable.
- `GET /api/public-tasks/:publicationId`: anonymous read of an active snapshot. It does not enumerate
  other publications or return source AP IDs or authorization credentials.

The maximum serialized snapshot size is 64 MiB. Snapshots live in PostgreSQL, so no additional
publication-files directory needs to be retained alongside the database backup.
