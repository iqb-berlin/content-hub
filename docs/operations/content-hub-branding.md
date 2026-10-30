# Content Hub branding

The product name is **Content Hub**. Its approved mark consists of four violet
content modules connected diagonally to a central circular hub, on a white
circle. The product color is `#5B21B6`.

Repository names, directories, package and Angular project names, Docker images,
Compose services and projects, volumes, database names, environment variable
names, domains, API paths, OIDC client IDs, roles and browser storage keys retain
their existing technical identifiers. This release does not migrate them.

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

## Existing application settings

Unconfigured applications use the violet default palette. Saved values in
`app_settings.theme`, including the old blue palette, remain authoritative and
are not rewritten. The browser's theme-color metadata follows the effective
primary color. `logoUrl` retains its existing API and storage behavior; the
application header displays the fixed Content Hub product mark.

Saved landing, imprint, privacy and accessibility content is not changed.
Review it for old product names and update only the intended prose through the
existing settings interface. Keep a copy of previous values. ACP contents,
historical documentation and published release history are not rewritten.

## Existing Keycloak installations

The technical theme name remains `iqb-theme`. Deploy the runtime bundle containing
its new assets, template, theme properties and versioned CSS. Theme files are
mounted from the deployment directory. Restart the affected Keycloak instance
when needed to invalidate its template/theme cache, and verify the result in a
fresh browser session. Apply this during the normal deployment maintenance window.
Existing custom Keycloak theme selections are not changed. Keep independently
maintained themes in their own directories and retain their current selection.

Updating `realm-export.json` or `realm-export.dev.json` does not update an
existing imported realm. Do not delete/re-import the realm or remove its volumes
to change branding.

Before changing persistent display fields, establish whether the realm, theme
and SMTP sender configuration serve only this application. The repository's
Compose deployment contains its own Keycloak service. An externally shared
Keycloak installation needs client-specific scoping: use a dedicated copy of the
login theme selected for this client, and retain the shared realm's name and
sender configuration for other applications.

For a dedicated installation, record the previous values in the Keycloak Admin
Console and change only the following display fields:

| Location | Standard old value | New value |
| --- | --- | --- |
| Realm Settings → General → Display name | IQB ContentPool | Content Hub |
| Clients → `contentpool` → Name | ContentPool Application | Content Hub |
| Clients → `contentpool` → Description | IQB ContentPool OIDC Client | Content Hub OIDC Client |
| Realm Settings → Email → From display name | IQB ContentPool | Content Hub |

Retain intentionally customized labels unless the operator selects new wording.
Do not change the realm identifier `iqb`, client identifier `contentpool`, client
UUIDs, roles, credentials, redirect URIs, web origins or SMTP addresses/secrets.
The login page title and header already use the theme's `productName` setting,
so they do not depend on rewriting a shared realm's display name.

If the deployment's `.env` explicitly sets `KEYCLOAK_SMTP_FROM_DISPLAY_NAME` to
the old standard label, update that value as well so later SMTP configuration
does not restore the old name. Keep customized sender labels. Changing defaults
in `.env.example` or helper scripts does not edit the deployment's existing `.env`.

## Acceptance and rollback

Verify the application header, public landing page, breadcrumbs, login redirect
page, browser title, icons and installed shortcut. Check the Keycloak login,
registration, reset-password, verification and error pages, and a transactional
mail preview. Confirm logo and focus-state visibility at mobile and desktop
widths, and check an existing custom app theme.

All referenced assets must return actual image/manifest bytes with the expected
content type, never the Angular fallback page. Check `/favicon.ico` and
`/site.webmanifest` in both frontend-image and server deployment modes.

To revert, use the existing release rollback procedure to restore the previous
image digests and runtime files, including the Keycloak theme and nginx config.
Restore manually changed display/content fields from the recorded values and
refresh the Keycloak theme cache. The branding change adds no schema migration
and requires no database or volume rename. A full database restore is not needed
for a branding-only rollback.
