# Changelog

All notable changes to Content Hub are documented in this file. Releases use
[Semantic Versioning](https://semver.org/); release candidates add an
`-rc.N` suffix without changing the canonical version in `VERSION`.

## [Unreleased]

### Changes

- Rename the visible product to Content Hub and use the approved violet network
  logo across the application and Keycloak login theme. Replace legacy image
  files with SVG, PNG, multi-size ICO and mobile icons.
- Rename the repository, package/deployment identifiers, images and browser keys
  to Content Hub. Keep iqb-contentpool.de and neutral API/callback paths.
- Apply the violet palette once to saved themes and retain their original values
  for guarded rollback. Transfer legacy browser data without losing pending work.
- Shorten booklet task links with structure-bound occurrence IDs. Preserve
  existing links and report stale short links after booklet structure changes.
- Add direct links to individual booklet task occurrences, with reload and
  browser history support in the review workspace. Refs #245.
- Add configurable ACP comment categories with optional assignments, archival,
  category filters and CSV/XLSX export columns. Refs #239.

### Breaking changes

- None.

### Configuration

- Existing Keycloak display names and mail sender labels need a separate, scoped
  update; see `docs/operations/content-hub-branding.md`. Use the new updater for
  the service-name transition. Old environment variables remain aliases;
  existing database/volume assignments and custom content are retained.

### Database migrations

- Classification: `backward-compatible`
- `1789700000000-CommentCategories` adds categories and optional comment assignments.
- `1793318400000-ContentHubTheme` backs up saved palettes and resets them to violet
  once. Later edits are preserved; rollback checks for intervening changes.

### Rollback

- Restore the previous application images and runtime theme files to revert
  branding. Restore separately edited display fields from their saved values.
  Restore old palettes through the guarded Content Hub theme migration rollback.
- The category migration refuses rollback while configured categories or
  assignments exist, preserving review data.

## [0.6.0] - 2026-09-20

### Changes

- Detect uploaded Booklet XML files automatically, register them in the ACP
  index, validate nested testlets and repeated Unit occurrences, and use one
  manifest for navigation and ZIP downloads.
- Add an integrated Booklet Review workspace with embedded Verona Player,
  task navigation, fullscreen mode, resizable comments, metadata and coding
  panels, searchable booklet switching, and readiness checks before activation.
- Separate Review and Item Explorer permissions for credentials and signed-in
  users, import credential lists with permission profiles, and streamline role
  and Review management for delegated managers.
- Introduce stable comment targets for booklets, Units, Items and coding,
  including edit and soft-delete support, optimistic conflict handling, deep
  links, and migration of uniquely resolvable legacy comments.
- Add private, shared and group-based comment visibility, automatic updates,
  personal and authorized CSV/XLSX exports, and Up-/Downvotes in shared Review.
- Enforce published reviewer-column visibility on the server across Explorer,
  Review, API responses and exports while retaining compatible existing layouts.
- Keep Item Explorer search local to each user, make the position column
  configurable, and normalize VOMD task, Item and stimulus time columns.
- Add fullscreen and a guarded solution mode to the Item Explorer Player
  preview without persisting or inventing ambiguous responses.
- Add package-level visibility controls for start-page entries and simplify the
  combined access and feature settings without changing their authorization.
- Improve large booklet selections, Review navigation and coding focus, and
  import competence levels as filterable, sortable and exportable Item data.
- Preserve existing commenting, Explorer settings, metadata visibility,
  published labels and capability grants when upgrading from 0.5.0 or using
  development schema synchronization.
- Preserve comment drafts across Review navigation, safely project metadata
  names that collide with JavaScript properties, and avoid requiring Review
  management rights for unrelated package settings.
- Build the architecture-independent frontend bundle on the native BuildKit
  platform so multi-architecture release images do not depend on Node.js under
  QEMU emulation.

### Breaking changes

- New credentials and role assignments start without Review or Explorer grants.
  Assign the required capabilities explicitly; general ACP management roles
  remain unchanged.

### Configuration

- Activate the new Review entry point explicitly for existing ACPs.
- See `docs/review-capabilities.md` for capability assignment and migration
  defaults. Start-page entries and reviewer-visible columns can be configured
  independently from access permissions.

### Database migrations

- Classification: `backward-compatible`
- `1789200000000-AcpCapabilityGrants` adds capability arrays to ACP roles and
  credentials, migrates existing access and disables the new Review entry point
  until explicitly activated.
- `1789300000000-CompleteCommentLifecycle` migrates uniquely resolvable legacy
  comments to stable Review targets and keeps unresolved comments read-only.
- `1789400000000-ReviewVisibilityGroups` adds Review groups, membership and
  versioned visibility configuration while preserving existing comments.
- `1789500000000-CommentVotes` adds one active vote per visible comment and
  stable user or credential identity.
- `1789600000000-ReviewReadinessSnapshots` stores readiness results and their
  source state without changing existing content.

### Rollback

- Back up the database and rehearse the migration before deployment. Routine
  application rollback keeps the additive data, but 0.5.0 ignores capability
  grants and therefore uses its broader role model.
- Do not use migration reverts as an access-control rollback. Some migrations
  intentionally refuse destructive reversal once Review groups, comments or
  votes exist; use the matching database backup for a complete restore.

## [0.5.0] - 2026-09-10

### Changes

- Consolidate ACP content and management into a role-aware overview, improve
  navigation back from content views, and support inline ACP role editing.
- Use the Item Explorer as the central task list and streamline collection
  management, sharing, exports, and visible task labels.
- Add participant CSV exports scoped to accessible item collections.
- Add scoped comment visibility controls and exports, accurate thread counts,
  and automatic comment refresh with session-safe response handling.
- Support BiSta item parameters and booklet imports without position values.
- Improve sticky selection columns, complete-row highlighting, column resizing,
  headings, table counts, active button states, and reversible manual sorting.
- Expand player previews and the resizable metadata drawer, improve keyboard
  handling and accessible help, and keep collection menus inside narrow panels.
- Make backend development watch restarts reliable and reap child processes.
- Apply security patch updates for Angular, DOMPurify, qs, and Multer.
- Update Multer to 2.3.0 to resolve the upload denial-of-service findings
  CVE-2026-77037, CVE-2026-77078, and CVE-2026-82333 in the release image scan.
- Update the frontend runtime Expat and util-linux libraries to the Alpine
  security releases required by the release image scan.
- Document the current product concepts and comparison with the legacy system.

### Breaking changes

- The standalone item-list view is removed; use the Item Explorer instead.

### Configuration

- None.

### Database migrations

- Classification: `none`

### Rollback

- No special instructions.

## [0.4.1] - 2026-08-27

### Changes

- Resolve Item Explorer and item-detail preview targets by their VOUD alias
  before falling back to generated element IDs, preventing cross-namespace
  collisions from opening the wrong player page.
- Recognize stored legacy element IDs as equivalent alias options and use the
  coding-scheme labels to make preview targets identifiable.
- Update the backend and frontend runtime OpenSSL packages to the Alpine
  security release that fixes CVE-2026-14456.

### Breaking changes

- None.

### Configuration

- None.

### Database migrations

- Classification: `none`

### Rollback

- No special instructions.

## [0.4.0] - 2026-08-26

### Changes

- Preserve the fachliche Item-ID, visible variable alias, source variable, and
  internal variable ID separately, resolve derived variables through their
  source targets, and show the correct Item-ID in print views.
- Apply manual, variable-specific, code-specific, and general coding
  instructions at their intended levels without suppressing automatic rules
  when no matching manual instruction exists.
- Sort Item Explorer rows by their complete Item-ID and use VOMD item and
  stimulus times when no explicit Explorer or CSV value overrides them.
- Make all visible Item Explorer columns configurable by visibility, order,
  and width while retaining compatible saved layouts.
- Add text complexity imports and display, and allow item parameters to be
  imported without complete booklet-position data after explicit confirmation.
- Serialize Item Explorer draft updates so rapid search and filter changes no
  longer create self-inflicted version conflicts.
- Add ACP-scoped item comment threads to the Item Explorer, including shared
  visibility, replies, author labels, timestamps, author-only editing and
  deletion, and thread-aware exports.
- Remove an invalid start-page comment entry that could be shown without an
  associated item.

### Breaking changes

- None.

### Configuration

- ACP managers can enable item comments through `enableCommenting` and
  `commentTargets`, and choose `PRIVATE` or `SHARED` comment visibility through
  `commentVisibilityMode`.

### Database migrations

- Classification: `backward-compatible`
- Extend existing comments with stable item identity, credential ownership,
  thread relationships, author labels, update timestamps, optimistic versions,
  and soft deletion. Existing comments keep their content and receive safe
  timestamp and display-label backfills without inferring credential ownership
  from mutable usernames.

### Rollback

- Application rollback does not require reverting the additive comment
  migration. Previous backends ignore the new columns; comments created by the
  new thread interface remain stored but their thread metadata is unavailable
  until the new application version is restored.

## [0.3.0] - 2026-07-31

### Changes

- Add BiStaTest-oriented Item Explorer configuration for displaying general
  coding instructions and preferring manually authored instructions.
- Persist custom metadata column definitions and widths, and improve column
  selection, sticky table layout, row selection, and row-state feedback.
- Allow users to share item collections, activate shared collections, and copy
  them into their own collections.
- Expand responsive, interaction, and cross-browser coverage for Item Explorer
  workflows and install all required browser dependencies in CI.
- Update transitive `brace-expansion` dependencies to patched releases and
  document the scanner exception for fixed 1.x and 2.x backports.
- Make release-candidate image publication retry-safe and add an explicit,
  protected production-only exception path that does not claim staging evidence.

### Breaking changes

- None.

### Configuration

- None.

### Database migrations

- Classification: `none`

### Rollback

- No special instructions.

## [0.2.0] - 2026-07-22

### Changes

- Add a gated release-candidate and promotion process.
- Pin deployable application images by digest and expose build metadata.
- Add manifest-driven, auditable staging and production updates.
- Refresh pinned runtime bases and remove package-manager tooling from the
  backend runtime image.
- Preserve adopted legacy Compose project names so managed updates continue to
  use the existing database and upload volumes.
- Add checksum-validated local legacy baselines, exact-digest rollback, and
  structural validation for database backups.
- Wait for both restored PostgreSQL services to become healthy before invoking
  `pg_restore`.
- Wait for the complete restored application stack to become healthy before
  running release identity and endpoint checks.
- Wait for stack health during normal updates, legacy rollback, and automatic
  application recovery before evaluating deployment health.
- Persist Item Explorer reference and selection settings and add scalable,
  paginated collection-detail editing.
- Route all application-user authentication through Keycloak OIDC while
  retaining ACP-specific credential-list access for restricted viewers.
- Return OIDC logout to the installer-approved `/login` URL so existing
  Keycloak client settings accept the post-logout redirect.

### Breaking changes

- Server deployments no longer default to the mutable `latest` image tag.
- Managed deployments require a release manifest and explicit environment.
- Local ContentPool username/password login for application users is removed;
  every application user must have a working Keycloak identity.

### Configuration

- Add `DEPLOYMENT_ENV`, `COMPOSE_PROJECT_NAME`, `RELEASE_VERSION`, `APPLICATION_VERSION`, `RELEASE_COMMIT`,
  `RELEASE_BUILT_AT`, `CONTENT_POOL_BACKEND_IMAGE`, and
  `CONTENT_POOL_FRONTEND_IMAGE`.
- Deployment tools accept `--compose-override` and `--base-url` for isolated
  rehearsals on a shared Docker host.
- Remove the obsolete `SEED_DEFAULT_ADMIN` setting. Fresh and existing
  application users are provisioned through Keycloak OIDC.

### Database migrations

- Classification: `backward-compatible`
- A compatibility trigger derives response-state row keys for writes from the
  previous stable backend. It remains in place until a later contract release.
- The legacy `users.password_hash` column remains present with an empty default
  so Keycloak-only user creation and rollback to the previous backend both
  remain possible. Its removal is deferred to a later contract release.

### Rollback

- Adopt the currently running image digests before the first managed update.
- Application rollback never automatically reverts database migrations.
- Adopted legacy releases can be restored from their checksum-validated local
  baseline without relying on a historical GitHub release manifest.
- After an application rollback, users created by 0.2.0 continue to sign in
  through Keycloak; no local password is synthesized for them.

[Unreleased]: https://github.com/iqb-berlin/content-pool-next/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/iqb-berlin/content-pool-next/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/iqb-berlin/content-pool-next/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/iqb-berlin/content-pool-next/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/iqb-berlin/content-pool-next/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/iqb-berlin/content-pool-next/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/iqb-berlin/content-pool-next/compare/v0.1.3...v0.2.0
