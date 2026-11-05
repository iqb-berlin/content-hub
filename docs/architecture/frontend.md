# Frontend Architecture

## Stack

The frontend is an Angular 21 standalone application. It uses:

- Angular router with lazy `loadComponent` routes,
- Angular `HttpClient`,
- an auth interceptor that injects the Content Hub JWT,
- small service-based state management instead of a global store,
- route guards for access flow orchestration.

The frontend is intentionally thin. Most business decisions happen on the backend.

## Application Shell

The root component lives in [`frontend/src/app/app.ts`](../../frontend/src/app/app.ts).
It provides the global header, router outlet, and runtime theme/language initialization.

At startup the app:

1. initializes auth state from browser storage,
2. fetches public settings from `/api/view/settings`,
3. applies theme CSS variables,
4. applies the configured document language.

This means even anonymous users immediately see the configured branding and legal content.

## Routing Model

Routes are defined in [`frontend/src/app/app.routes.ts`](../../frontend/src/app/app.routes.ts).
The route tree is organized by user journey:

### Public entry and auth routes

- `/`
  public landing page
- `/access`
  access explanation and redirect page
- `/login`
  login choice and sign-in entry
- `/auth/callback`
  OIDC callback handling
- `/credential-login/:acpId`
  AP credential login page

### Manager and admin routes

- `/acps`
  list of accessible APs for authenticated managers/admins
- `/admin/users`
  user administration
- `/admin/settings`
  global settings administration
- `/admin/acp`
  AP administration view
- `/manage/:acpId`
  AP manager dashboard
- `/manage/:acpId/files`
  file manager
- `/manage/:acpId/snapshots`
  snapshot manager
- `/manage/:acpId/access`
  AP access configuration

### Read-only view routes

- `/view/:acpId`
  AP start page
- `/view/:acpId/units`
  unit list
- `/view/:acpId/unit/:unitId`
  single unit view
- `/view/:acpId/sequence/:sequenceId`
  task sequence view
- `/view/:acpId/items`
  item list
- `/view/:acpId/item-explorer`
  item explorer
- `/view/:acpId/item/:itemId`
  item detail view
- `/view/:acpId/index`
  AP-Index browser

## Guards and Access UX

The frontend does not try to reproduce all backend authorization rules. Instead, it
uses lightweight guards to guide the user into the correct flow:

- `authGuard`
  requires login for generic authenticated pages.
- `adminGuard`
  requires login and app-admin status.
- `acpManagerGuard`
  checks that the user can access manager APIs for the AP.
- `acpViewGuard`
  lets public APs through and redirects restricted APs to the access page.
- `itemExplorerPendingChangesGuard`
  prevents accidental navigation away from unsaved explorer changes.

The shared `AccessService` builds redirect URLs to `/access` with a reason such as:

- `login_required`,
- `insufficient_rights`,
- `feature_disabled`,
- `session_expired`.

## Authentication Flow on the Client

The central service is [`frontend/src/app/core/services/auth.service.ts`](../../frontend/src/app/core/services/auth.service.ts).

It handles:

- app-issued JWT storage,
- OIDC PKCE redirect setup,
- OIDC code exchange,
- storing both the app JWT and OIDC tokens,
- logout broadcast across tabs,
- profile bootstrap.

A few implementation details matter operationally:

- browser storage is the source of truth for the current session,
- logout is synchronized across tabs with `BroadcastChannel`,
- downloads can append the token as `auth_token` when a regular header-based browser
  download is not practical.

## HTTP and API Layer

All HTTP access goes through [`frontend/src/app/core/services/api.service.ts`](../../frontend/src/app/core/services/api.service.ts).
The service is a thin typed wrapper around backend endpoints.

Major API groups in the client service:

- users and admin settings,
- AP CRUD and access configuration,
- file upload and download helpers,
- snapshots,
- comments,
- public view endpoints,
- item explorer draft endpoints,
- item tags and response state.

The auth interceptor:

- adds `Authorization: Bearer <token>` when a token exists,
- redirects to `/access` on 401/403,
- clears invalid sessions when necessary,
- ignores inline auth errors for login endpoints so forms can show proper feedback.

## State Strategy

The frontend uses a pragmatic service-and-component state model.

Patterns used in the codebase:

- server state is fetched directly in pages and feature components,
- route parameters decide the current AP context,
- local component state handles filters, selected items, dialogs, and temporary UI state,
- shared AP explorer state is loaded from the backend and updated through versioned draft APIs.

The Item Explorer uses a route-scoped feature facade because it combines several independent UI
areas with draft state, personal working data, collections, and a player preview. The route
component only owns route and host integration. Child components consume typed, read-only view
model slices and send feature actions back through the facade; table and preview components retain
their own DOM references. Small registered DOM ports keep fullscreen, focus and scrolling, iframe
messaging, player-document focus, and resize observation inside the owning UI component.

Shared Explorer row projection, identifier precedence and tag normalization live in pure functions
in `item-explorer-shared-state.ts`. The facade applies their results to existing row objects so
selection and pending player operations retain their identity. Explicit empty tag arrays remain
deletion markers when shared state is applied or an optimistic tag change is rolled back.

`ItemExplorerResponseStateService` owns response save/delete requests, confirmation dialogs and the
saved-response list. It reads the current route/selection context through a narrow callback and
uses the player session token to reject stale completions. Answer data stays in
`ItemExplorerPlayerService`; the facade handles focus restoration and UI notifications. Like the
other Explorer services, the response-state service is provided by the route component and cancels
its work when that scope is destroyed.

`ItemExplorerHistoryService` owns history entries, filters, loading/error state and CSV downloads.
Its pure filtering and CSV functions live in `item-explorer-history.ts`; downloads use the shared
`ItemExplorerBrowser`. Refreshing cancels the previous history request, and destroying the route
scope cancels pending work. The facade retains dialog focus handling and delegates history actions.

There is no central client-side store such as NgRx at the moment.

## Feature-Specific UI Areas

### Admin area

The admin UI covers:

- user CRUD,
- toggling app-admin status,
- linking OIDC identities,
- editing theme, logo, language, and legal content.

### AP manager area

The manager UI covers:

- AP overview and dashboard,
- file lifecycle operations,
- snapshot creation and restore,
- access model and credential management, including the default private state for new APs.

### Read-only area

The read-only side adapts its UI based on AP feature flags. Depending on AP settings,
users may see or hide:

- unit navigation,
- sequence navigation,
- item list and explorer functions,
- index export,
- file download,
- commenting,
- metadata display.

## Frontend Conventions Worth Knowing

- The app uses standalone components rather than Angular NgModules.
- Download URLs are generated in the API service so components do not need to know about auth-token rules.
- Public settings are applied centrally in the root component.
- Auth and access behavior is intentionally centralized to reduce duplicated redirect logic.
- Most screens are route-driven and fetch fresh data rather than keeping long-lived cached stores.

## Related Documents

- [Architecture Overview](overview.md)
- [Backend Architecture](backend.md)
- [Access Control](../features/access-control.md)
- [Item Explorer](../features/item-explorer.md)
