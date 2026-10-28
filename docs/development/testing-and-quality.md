# Testing and Quality

## Overview

The project combines automated tests with a few important manual verification flows.
Because the product mixes UI, files, identity, and persistence, a small manual smoke
check is often worth more than a single isolated unit test.

## Automated Test Commands

### Backend

From `backend/`:

```bash
npm test
npm run test:e2e
```

What these cover:

- controller and service unit tests,
- guards and auth behavior,
- ACP utility logic,
- validation helpers,
- server API helpers,
- end-to-end API flows in the E2E suite.

### Frontend

From `frontend/`:

```bash
npm test
npm run lint
```

The frontend uses Vitest for tests and Angular ESLint tooling for lint checks.

### Lint and formatting gates

Run these commands from either `backend/` or `frontend/` before submitting changes:

```bash
npm run lint
npm run format:check
```

Both commands only check files; they do not rewrite them. Lint fails on any error
or warning (`--max-warnings=0`), and the format check fails on formatting differences.
CI runs the same commands for both projects and requires both jobs in the release gate.

To apply automatic fixes locally, use the separate write commands:

```bash
npm run lint:fix
npm run format
```

Review the resulting diff and rerun the checks. `lint:fix` still fails if any
errors or warnings remain after automatic fixes.

### Strict types and handled promises

The backend enables the complete TypeScript `strict` option. The production
build and Jest compilation enforce it; caught errors must be narrowed before
accessing their properties.

Type-aware ESLint rules `no-floating-promises` and `no-misused-promises`
are errors across backend production source. Tests and test fixtures retain
their existing lint configuration. Bare `void promise` does not bypass the
rule: await the result or handle rejection. The stream bootstrap has one local,
documented exception because its implementation forwards failures to the stream.

The frontend starts these same rules in `src/app/core/guards/*.ts`,
`acp-navigation.service.ts`, and `pending-personal-session-storage.service.ts`
(excluding specs). Legacy frontend modules remain a subsequent migration;
the rules are not yet repository-wide there.

Explicit `any` is forbidden in these frontend modules and in the backend
ACP service, credentials service, and ACP DTO directory. Extend the protected
paths as modules are cleaned up. Do not add broad disable directives to admit
new violations; any necessary exception must be local and explain the reason.
The existing required CI lint jobs enforce these scopes without additional jobs.

ACP credential persistence and import belong to `AcpCredentialsService`.
`AcpService` delegates its existing public methods, preserving callers while
separating credential transactions and password hashing from package management.

### Coverage and behavior regression gates

Run `npm run test:cov -- --runInBand` from `backend/` or `npm run test:cov` from
`frontend/`. CI runs these complete suites with coverage in its required unit-test
jobs. Protected modules have separate minimums for statements, branches, functions,
and lines; results from other files cannot compensate for a regression.

See [the measured baseline, protected modules, and update policy](coverage-baseline.md).
The HTML and JSON reports are available in each project's `coverage/` directory
and as CI artifacts. The baseline includes untested application files; it does
not replace browser, database, or migration checks.

### ACP API contracts

`backend/src/acp/acp-http-contract.spec.ts` exercises actual HTTP routing, the
validation pipe, response serialization, and the role guard for ACP management.
Authentication, ACP access and capability resolution, and persistence are mocked
in this suite; service, authentication,
and database E2E tests remain responsible for those layers. The suite also checks
the generated OpenAPI date schemas and permission checks when review settings change.

`frontend/src/app/core/services/api-acp-contract.spec.ts` uses Angular's HTTP test
backend to check request methods and payloads, nullable fields, role response
shapes, credential import counters, and propagation of HTTP 400/403 responses.

### Full-stack browser tests

The Playwright suite uses the real Angular frontend, NestJS backend, and an isolated PostgreSQL
database. Chromium runs every spec; Firefox and WebKit run the shared `crossBrowserSpecs` list in
`frontend/playwright.config.ts`. Keep that list shared so adding a journey preserves the existing
browser coverage.

```bash
(cd frontend && npm run e2e)
```

The wrapper starts a disposable PostgreSQL container, seeds it, and uses dedicated ports for both
application servers. The seed and Playwright configuration refuse non-E2E database settings, and
existing application servers are never reused. Every run stores fixtures, uploads, and snapshots
in its own temporary directory, which is removed on exit. Stateful critical journeys use separate
ACPs; Explorer publishing additionally uses one ACP per browser. Trace, screenshot, and video
diagnostics are kept only for failed tests.

The required CI Browser E2E job runs the suite on pull requests and remains part of the release
gate. `browser-e2e-weekly.yml` repeats the same suite against the default branch every Tuesday at
04:17 UTC and supports manual dispatch. It installs all three browsers and supplies its own
isolated PostgreSQL service. The weekly run detects drift after merge; it does not replace PR CI.

The critical journeys complement the existing regressions:

| Spec                                                                   | User-visible result                                                                                                                                                                                                                                                                                                                   | Browsers                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `critical-journeys-cross-browser.spec.ts`                              | Invalid/valid ACP login and reload; unit list → real ASPECT task, answer entry, page navigation, scrolling mode and reload; coding dialog → draft → publication → independent reader receives the changed target after a new load                                                                                                     | Chromium, Firefox, WebKit            |
| `critical-journeys-chromium.spec.ts`                                   | Credential access isolation; valid/unknown item deep links; snapshot diff → cancel/restore; complete six-file task import into an empty ACP → byte-identical download → real task → review group and activation → independent participant enters answers and posts a group comment that survives reload and is visible to the manager | Chromium                             |
| `review-navigation-metadata.spec.ts`                                   | Booklet navigation, readable coding/partial solutions, and persisted metadata visibility using a deterministic Verona contract player                                                                                                                                                                                                 | Chromium, Firefox, WebKit            |
| Existing Explorer, reduced-view, comment, access, and preference specs | Focused interaction, permissions, sticky columns, comment refresh, reduced reviewer controls and persistence regressions                                                                                                                                                                                                              | As configured in `crossBrowserSpecs` |

The critical task journeys use the unchanged ASPECT 3.0.1 player and one two-page synthetic task.
The player and content API are not mocked. See the [fixture source and checksum](../../test-fixtures/synthetic-aspect/browser-journeys.md).
The import journey starts with an ACP that has no units or files: upload processing must build the
unit dependencies and Booklet link. It reuses the same task files as the cross-browser navigation
check. Display mode is session-local; reload explicitly checks the default button navigation.

Publication is exercised once per browser in the critical journeys; the former duplicate in
`item-explorer-performance-regression.spec.ts` has been consolidated into that test. A separate
reader session checks that the draft target remains unpublished and receives `FAHRT` and displays its answer field only after
publication, including a new page load.

Login journeys use disposable ACP credentials and the local OIDC test session; a real Keycloak
staging login remains a separate integration check.

The permanent [synthetic ASPECT pool](synthetic-aspect-pool.md) adds real-player
Booklet review checks in Chromium, Firefox and WebKit and produces a portable
screenshot/video gallery on every run and in CI.

## What to Test for Common Change Types

### Authentication or access changes

Verify:

- direct Keycloak redirect and OIDC login callback,
- credential login for ACPs,
- route-guard redirects,
- feature-disabled and insufficient-rights access flows.

### ACP or file-management changes

Verify:

- ACP creation and update,
- file upload,
- index synchronization,
- validation summaries,
- file download or ZIP export,
- snapshot creation and diff.

### Public-view changes

Verify:

- anonymous access to public ACPs,
- redirected access to restricted ACPs,
- unit, item, and sequence views,
- comment availability based on feature flags.

### Item Explorer changes

Verify:

- draft patching,
- optimistic version handling,
- save and discard actions,
- history export,
- manual item order and metadata column persistence.

### Integration API changes

Verify:

- token authentication,
- scope enforcement,
- ACP transfer export/import,
- file upload conflict behavior,
- audit log creation and retrieval.

## Manual Smoke Test Checklist

For a reasonably complete pre-merge check, walk through this short sequence:

1. open the frontend,
2. confirm public settings load,
3. log in with the expected auth path,
4. open an ACP manager page,
5. upload or inspect ACP files,
6. create a snapshot,
7. open the ACP read-only view,
8. confirm the intended feature flags behave correctly,
9. check `/api/health/live` and `/api/health/ready`.

## Health and Runtime Checks

Useful commands and URLs:

```bash
make health
curl -fsS http://localhost:3000/api/health/live
curl -fsS http://localhost:3000/api/health/ready
```

In deployed environments, use the production or server compose variants with the same health endpoints.

## Quality Expectations by Layer

### Backend

- add or update unit tests when business rules change,
- prefer deterministic tests around guards, services, and DTO validation,
- keep migration changes explicit.

### Frontend

- test guard and service behavior for auth-sensitive changes,
- smoke-test route flows in a browser,
- verify download helpers and redirect behavior when touching auth or access code.

### Documentation

When behavior changes, update:

- the relevant `docs/` file,
- any root runbook that now disagrees,
- README links if the entry points changed.

## Release-Oriented Verification

Before a release or deployment candidate:

1. run the relevant automated tests,
2. check health endpoints,
3. validate login,
4. confirm migrations are ready if the schema changed,
5. walk through the release checklist in [`RELEASE_CHECKLIST.md`](../../RELEASE_CHECKLIST.md).

## Related Documents

- [Getting Started](getting-started.md)
- [Deployment](../operations/deployment.md)
- [Monitoring and Maintenance](../operations/monitoring-and-maintenance.md)
