# ContentPool Release Go/No-Go Checklist

Record the owner, timestamps, evidence links, candidate manifest, and final
decision in the release issue or operational change record.

## 1. Release candidate

- [ ] Release PR updates `VERSION`, package versions, and `CHANGELOG.md`
- [ ] Migration classification is `none` or `backward-compatible`
- [ ] Required GitHub `release-gate` succeeded for the candidate commit
- [ ] Complete ScanCode, SCANOSS and dependency reports for the exact source commit (validated local bundle or successful full workflows)
- [ ] Human license review issue completed with the exact evidence checksum or workflow IDs, plus a decision and evidence for every finding
- [ ] Contributor rights, bundled assets and distribution notices checked within the stated scope
- [ ] RC GitHub prerelease contains runtime archive, manifest, compliance evidence, SBOMs and checksums
- [ ] Backend and frontend images passed the release image scan

## 2. Staging deployment

- [ ] Staging uses its own Compose project, data, volumes, domains, and secrets
- [ ] Managed update created complete database/config/upload backups
- [ ] Backup checksums, both tar archives, and both PostgreSQL dump catalogs validate
- [ ] `/api/version` and `/version.json` match the candidate manifest
- [ ] OIDC login and logout work
- [ ] ACP create/update, file upload, public/read view, and Item Explorer smoke tests pass
- [ ] Migration logs contain no failures or schema synchronization
- [ ] Application rollback to the prior digest was rehearsed when migrations changed
- [ ] Staging evidence URL/reference is recorded

## 3. Promotion

- [ ] A release owner confirms staging evidence
- [ ] A separate authorized reviewer approves the protected `production` environment
- [ ] Stable Git and GHCR tags were created without rebuilding
- [ ] Stable manifest contains exactly the candidate backend/frontend digests
- [ ] GitHub Release notes include configuration, migration, and rollback information

## 4. Production deployment

- [ ] `.env` has `DEPLOYMENT_ENV=production`, `DB_SYNCHRONIZE=false`, and `DB_RUN_MIGRATIONS=true`
- [ ] Full backup and deployment JSON record were created
- [ ] Adopted Compose project and exact previous image digests are recorded locally
- [ ] Compose configuration validates and images are pulled by digest
- [ ] Health, readiness, Keycloak discovery, and version identity pass
- [ ] Keycloak user count did not decrease
- [ ] OIDC and critical ACP smoke tests pass
- [ ] Logs show no critical errors after the observation window
- [ ] Go/No-Go decision, owner, and completion timestamp are recorded
