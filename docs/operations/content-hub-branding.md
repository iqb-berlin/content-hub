# Content Hub naming and migration

The product and repository are **Content Hub** (`iqb-berlin/content-hub`).
The approved four-module network mark uses `#5B21B6` on a white circle.
The existing public domain remains **iqb-contentpool.de**. `/api/...`,
`/auth/callback`, the realm identifier `iqb` and application data IDs do not change.

## Canonical technical names

| Area | New name |
| --- | --- |
| Repository / deployment bootstrap | `iqb-berlin/content-hub` |
| Backend npm package | `iqb-content-hub-backend` |
| Services and containers | `content-hub-api`, `content-hub-db`, `content-hub-web`, `content-hub-nginx` |
| Release images | `ghcr.io/iqb-berlin/content-hub-backend`, `ghcr.io/iqb-berlin/content-hub-frontend` |
| Deployment variables | `CONTENT_HUB_*` |
| OIDC client ID | `contenthub` |
| New application database defaults | `content_hub` (managed), `contenthub` (development) |
| Browser keys / channel | `ch_*`, `ch_auth` |
| ALTCHA Java package / provider | `de.iqb.contenthub`, `content-hub-keycloak-altcha.jar` |

Old environment variable names remain transition aliases. Existing database
credentials and physical volume names are read from the deployment configuration;
they are not guessed from the new service name. Historical migrations, backup
archives and external specification links retain their original names.

## Source and generated files

`branding/content-hub/master.svg` is the unchanged approved vector master.
Its SHA-256 is
`9f8001e7786be3a2cdd5715f740e1f3ddc7cd152607b97b74492e4fd39d3b2df`.
Generated SVGs use the product name in their accessible title; their geometry
and colors are unchanged.

The committed exports live under `frontend/public/branding/content-hub-v1/`.
They include SVG, real PNG files, a 16/32/48/256-pixel ICO, a 180-pixel opaque
Apple icon and 192/512-pixel Android icons. Android icons use `purpose: any`;
they are not maskable variants. `frontend/public/favicon.ico` is the conventional
fallback, and `frontend/public/site.webmanifest` describes the application.
The manifest does not add offline support or a service worker.

The Keycloak theme receives the same generated mark and favicon files under
`keycloak/themes/iqb-theme/login/resources/img/content-hub-v1/`.
There is no second editable vector master.

To regenerate from the repository root, install the frontend dependencies with
the lockfile, then use the Chromium version supplied by that Playwright version:

```bash
npm --prefix frontend ci
(cd frontend && npx playwright install chromium)
node scripts/build-brand-assets.mjs
node scripts/build-brand-assets.mjs --check
```

Regeneration is a maintainer action. Normal application builds use the committed
assets and need no browser installation. For a future visual change, use a new
versioned asset directory and Keycloak CSS filename, update the generator and
consumers together, and retain assets needed by supported rollback releases.
The nginx configurations revalidate the stable HTML, manifest and fallback ICO;
versioned image URLs retain the existing static asset cache policy.

## Stored colors

The one-time `ContentHubTheme1793318400000` database migration replaces the saved
color palette with the violet Content Hub defaults, including explicitly
customized palettes. This is intentional. It saves every previous palette in
`content_hub_theme_backup`, leaves legal/landing content and all ACP data intact,
and does not run the reset again on subsequent starts. Later admin color changes
remain possible. Development schema synchronization applies the same one-time
transition after creating the schema.

Migration rollback restores the saved palettes. If an operator has edited colors
since the migration, rollback refuses to overwrite that newer work. Review the
saved values and restore them explicitly before retrying the migration rollback.
Do not drop the backup table to bypass this check.

## Upgrade an existing managed deployment

Use a maintenance window and keep the previous release, configuration, image
digests and complete database/upload backups. Do not rename or delete populated
volumes, and do not delete/re-import a Keycloak realm.

Before accepting the first release with the renamed GHCR images, set both new
packages to public in their package settings and verify that their manifest
digests can be pulled without registry credentials. GitHub creates newly
published packages as private by default; a successful authenticated release
workflow alone does not establish public installation access. See the
[GitHub Container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

For the first upgrade across the naming change, use the **new** update script
and its matching `deploy-common.sh` from an extracted, verified runtime archive.
Keep these tools outside the existing deployment directory until the update has
created its backup. Example after downloading and verifying the selected release:

```bash
mkdir migration-tools
tar -xzf content-hub-vX.Y.Z-runtime.tar.gz -C migration-tools
cd /path/to/existing/deployment
/path/to/migration-tools/scripts/update.sh --release vX.Y.Z --environment production
```

Replace the example version and paths with the reviewed release and deployment.
Do not overwrite the old Compose files using the installer before the first
backup. Old bootstrap repository URLs redirect to the renamed repository, but
an old updater is not the tool for this service-name transition.

The new updater backs up the running deployment, resolves legacy service names
for its backup commands, copies `CONTENT_POOL_*` values to the canonical keys,
and retains the existing Compose project. Before replacing the Compose files it
pins `CONTENT_HUB_DB_VOLUME` to the mounted database volume and stops the old API
and database services. This prevents starting another PostgreSQL instance on the
same data. The renamed services then use the same data and explicitly configured
`POSTGRES_DB`/`POSTGRES_USER`, even when those still use legacy names. Other neutral
volumes (`uploads`, Keycloak data) retain their existing project association.
A conflicting volume/project or conflicting old/new variable stops the upgrade.

Do not change `CONTENT_HUB_HOST`, `CONTENT_HUB_AUTH_HOST`, `CORS_ORIGIN`,
`KEYCLOAK_HOSTNAME`, OIDC issuer/redirect/logout URLs or TLS/DNS as part of this
migration. The public deployment stays on `iqb-contentpool.de`. Keep explicit
local-development database credentials when reusing an older development volume.

Retain old GHCR images, stopped legacy containers and backup volumes until the
new release is accepted. Their old physical names are compatibility references,
not the canonical names for new installations. Rename/copy persistent resources
only in a separate, verified data-maintenance step; changing a label alone must
never select an empty database.

## Rename the existing Keycloak client

Fresh imports use `contenthub`. An existing realm retains its stored client ID
until the operator changes it; the application keeps using the explicit
`OIDC_CLIENT_ID` in that deployment's `.env` throughout this transition.
The bundled helper updates the existing client through the Keycloak Admin API,
retaining its internal UUID, roles, protocol configuration and redirect URLs.
It refuses to overwrite another client already named `contenthub`.

During maintenance, stop application traffic, back up Keycloak and preview:

```bash
python3 scripts/migrate-keycloak-client.py --backup-dir backups/client-name-preview
python3 scripts/migrate-keycloak-client.py --backup-dir backups/client-name-change --apply
```

Use `--url` for a different existing Keycloak endpoint and `--realm` if needed.
The helper reads the administrator credentials from `.env` or the environment;
it does not print them. The preview changes no client/configuration. Applying it
creates a private backup of the client representation and deployment environment,
then updates the client ID and `OIDC_CLIENT_ID` together. Restart/recreate the
backend with the updated environment, reload old browser tabs and sign in again.
The browser startup migration transfers old `cp_*` session and pending-work keys
to `ch_*`, preserves newer keys and does not delete originals if storage is full.
Existing server integration tokens remain valid; newly issued tokens use `ch_`.

For rollback, use a new backup directory with `--from-client contenthub
--to-client contentpool --apply`, then restore the previous deployment environment
and images. Keep the same internal client UUID. If the remote client update
succeeds but writing `.env` fails, rerun with another backup directory: an already
renamed client is detected and its environment entry is completed without
creating another client.

Keep independently maintained Keycloak themes in their own directories. The
technical built-in login theme remains `iqb-theme`. Deploy its versioned files
and refresh Keycloak's theme cache in the maintenance window. If the realm is
shared, scope product display changes to this client/theme; preserve other
applications' realm and mail sender configuration. For a dedicated installation,
set realm/client/mail display labels to Content Hub as appropriate.

## Acceptance and rollback

Verify existing users, roles, ACPs, uploads and saved personal work after upgrade.
Check the API, login, callback, logout, mail sender and existing integration tokens
on the unchanged domain. Confirm the initial violet palette and a later admin
color edit surviving a restart. Asset responses must contain real image/manifest
bytes with appropriate content types and caching.

Use the existing release rollback/restore procedure to restore image digests and
runtime configuration. The updater stops the current API/database before
restarting a prior configuration, so two database services do not share a volume
concurrently. Restore accepts both old and new application dump filenames.
Revert the Keycloak client ID if changed, and restore palettes through the data
migration's guarded rollback. Check the old release's migration compatibility
before choosing image-only rollback. No data volume is deleted automatically.
