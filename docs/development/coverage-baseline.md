# Coverage baseline and regression gates

Measured on 2026-09-22, starting from commit `2e88274`. Both measurements use
identical coverage scopes and tool versions (Jest 29 / ts-jest, Vitest 4 / V8).
The second measurement includes the work-package-4 behavior tests. These are unit
and isolated integration results, not database or browser E2E coverage.

## Overall measured coverage

| Project / measurement | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| backend / initial | 86.61% | 71.11% | 86.78% | 87.37% |
| backend / final | 86.7% | 71.11% | 86.98% | 87.47% |
| frontend / initial | 67.56% | 57.45% | 68.66% | 69.96% |
| frontend / final | 67.69% | 57.66% | 68.66% | 70.07% |

## Enforced module minimums

Each row is enforced independently for all four metrics. A failure in one module
cannot be compensated by higher coverage in another. Values are the measured
percentages truncated to two decimal places by the coverage reporter; they are
regression floors, not claims of sufficient correctness or aspirational targets.

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `backend/src/acp/acp.service.ts` | 96.2% | 83.59% | 100% | 96.09% |
| `backend/src/acp/acp-credentials.service.ts` | 91.8% | 74% | 100% | 92.3% |
| `backend/src/api/server-api-auth.guard.ts` | 100% | 93.33% | 100% | 100% |
| `backend/src/api/server-api-auth.service.ts` | 93.63% | 77.27% | 100% | 93.33% |
| `backend/src/auth/capabilities/acp-capabilities.service.ts` | 100% | 89.18% | 100% | 100% |
| `backend/src/auth/capabilities/explorer-access.guard.ts` | 100% | 100% | 100% | 100% |
| `backend/src/auth/guards/roles.guard.ts` | 100% | 100% | 100% | 100% |
| `backend/src/files/async-lru-cache.ts` | 91.66% | 83.33% | 90.9% | 94.28% |
| `backend/src/files/item-row-numbering.service.ts` | 94.39% | 66.66% | 96.29% | 94.17% |
| `backend/src/files/unit-parser.service.ts` | 83.37% | 63.44% | 98.18% | 84.43% |
| `backend/src/item-explorer/item-explorer-state.service.ts` | 89.88% | 68.29% | 94.54% | 91.09% |
| `frontend/src/app/core/guards/auth.guard.ts` | 87.5% | 64.28% | 90.9% | 86.84% |
| `frontend/src/app/core/services/auth.service.ts` | 89.1% | 70.52% | 89.53% | 88.68% |
| `frontend/src/app/core/services/pending-personal-session-storage.service.ts` | 100% | 94.11% | 100% | 100% |
| `frontend/src/app/views/item-explorer/item-explorer-preview-coordinator.service.ts` | 89.28% | 81.81% | 94.44% | 89.09% |
| `frontend/src/app/views/item-explorer/item-explorer-preview-loader.service.ts` | 98.93% | 89.13% | 100% | 100% |
| `frontend/src/app/views/item-explorer/item-explorer.facade.ts` | 72.41% | 64.28% | 77.91% | 75.53% |

The executable source of truth is `jest.coverageThreshold` in
`backend/package.json` and `coverage.thresholds` in `frontend/vitest.config.ts`.
These committed floors prevent regressions below this baseline; subsequent
improvements must raise the matching floors in their PR to retain that protection.
There is no automatic comparison against the previous CI run and no automatic
rewriting of thresholds. Do not lower a floor to make a failing change pass.

## Measurement scope

- Backend: executable code in `src`, including the formerly excluded unit parser.
  Nest module wiring, the bootstrap entry point, configuration, TypeORM data source,
  migrations, and test fixture helpers are excluded. Database migration and E2E
  checks remain separate required CI jobs.
- Frontend: all `src/app/**/*.ts`, including files not imported by any test;
  `*.spec.ts` is excluded. The bootstrap entry point and test setup are outside
  this scope. TypeScript instrumentation does not measure HTML/CSS coverage.
- No overall percentage is used as a substitute for the per-module floors.

## Running and maintaining the gates

From `backend/`, run `npm run test:cov -- --runInBand`. From `frontend/`, run
`npm run test:cov`. Both commands execute the complete test suite, generate
`coverage/coverage-summary.json`, `coverage/coverage-final.json` and HTML reports,
and exit unsuccessfully if a protected module falls below its floor.
CI uses these commands in its existing required unit-test jobs and uploads both
coverage directories as artifacts for 14 days, including on test failures when
reports are available. Generated reports stay untracked.

When changing a protected module, inspect its uncovered branches and add tests
for behavior that matters. When coverage improves, raise the executable thresholds
and update this table. If a module is moved or split, transfer its protection to
the new paths and justify any denominator changes in the PR. Measure again when
upgrading a coverage provider; percentages from different instrumentation versions
are not directly comparable.

## Behavior evidence added

- Parallel personal saves retain the newest edit even when an older response
  arrives first; a failed save blocks navigation and retry persists that edit.
- A save success or failure from a previous user identity cannot clear the new
  user's changes or alter their save state.
- Storage failures are injected into the actual sessionStorage object used by the
  test environment, with assertions that the failure paths are exercised. Removal
  failure cannot resurrect stale snapshots; identity changes and corrupt data are
  covered as well.
- Explorer read/edit guards reject denied ACP access and missing capabilities.
- Production templates are rendered to verify one instance of each feature,
  breadcrumb/fullscreen updates through toolbar clicks, and permission-dependent
  editing controls. The redundant raw-template substring tests are removed.

Existing data-loss, permission, and database transaction tests remain in place.


## Work package 5: ACP service split

Credential import, hashing, and CRUD now live in `AcpCredentialsService`.
The existing ACP service suite exercises the real injected credentials service,
including transaction locks, duplicate handling, and capability preservation.
Both resulting files have independent floors measured after the split. The
credentials file's branch percentage reflects the moved credential branches;
it does not represent lost tests. The remaining ACP service has higher floors,
with additional tests for capability updates and missing assignments.
The historical overall measurements above remain the work-package-4 baseline.
