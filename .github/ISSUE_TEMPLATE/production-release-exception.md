---
name: Production-only release exception
about: Approve a release when no isolated staging environment is available
title: "Production-only release exception for vX.Y.Z"
labels: release
assignees: ''
---

<!-- content-hub-production-release-exception -->

## Decision

Document why this release must bypass isolated staging. This record must not
claim that staging validation occurred.

## Release evidence

- Release PR:
- Source commit:
- Successful `release-gate`:
- Release candidate:
- Migration classification:

## Required production preconditions

- [ ] Release owner and authorized production approver recorded
- [ ] Maintenance window defined and communicated
- [ ] Current production version and exact image digests recorded
- [ ] Current deployment adopted by the managed release tooling if required
- [ ] `DEPLOYMENT_ENV=production`, `DB_SYNCHRONIZE=false`, and `DB_RUN_MIGRATIONS=true` verified
- [ ] Database, upload, and runtime-configuration backups created and validated
- [ ] Exact application rollback target and commands confirmed

## Post-deployment verification

- [ ] `/api/version` and `/version.json` report the promoted release identity
- [ ] Keycloak login and logout succeed
- [ ] ACP read, edit, save, and file upload succeed
- [ ] Public/read view succeeds
- [ ] Item Explorer, coding, and collections smoke tests succeed
- [ ] Keycloak user count did not decrease
- [ ] Logs contain no critical errors during the observation window

## Rollback

Record the exact stable release and image digests to restore. Application
rollback must not automatically revert database migrations.
