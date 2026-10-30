# Monitoring and Maintenance

## Operational Priorities

For this application, the most important routine operator concerns are:

- service health,
- login flow health,
- database availability,
- upload-volume persistence,
- migration safety,
- auditability of server integrations.

## Health Endpoints

The backend exposes:

- `/api/health/live`
- `/api/health/ready`

What they mean:

- `live` confirms the process is up,
- `ready` confirms the API can still reach the database.

These endpoints are also used by the Docker health checks in production.

## Container Health

The compose files already define health checks for:

- Content Hub API,
- nginx or frontend container,
- PostgreSQL containers,
- Keycloak.

A simple first check after any incident is:

```bash
docker compose -f docker-compose.prod.yml ps
```

## Logs

Use targeted logs instead of tailing everything when possible.

Examples:

```bash
docker compose -f docker-compose.prod.yml logs --since 15m content-pool-api
docker compose -f docker-compose.prod.yml logs --since 15m keycloak
docker compose -f docker-compose.prod.yml logs --since 15m nginx
```

Good times to inspect logs:

- right after deploy,
- after reported login failures,
- after failed uploads,
- after server API integration issues,
- after readiness probe failures.

## Server API Audit Logs

The application records server API activity in a dedicated audit table. Use that data when:

- an external system claims it updated an ACP,
- a transfer appears incomplete,
- you need to identify which client used which endpoint,
- you want a record of failures and HTTP status outcomes.

## Backups

At minimum, backup:

- the Content Hub PostgreSQL database,
- the Keycloak PostgreSQL database,
- the uploads volume.

Suggested cadence depends on traffic, but the key rule is simple: backing up only the
database is not enough because ACP files are stored separately.

## Upgrade Routine

A safe upgrade flow is:

1. create fresh backups,
2. inspect the release and migration impact,
3. pull new code or images,
4. deploy,
5. watch health and logs,
6. test login,
7. test one ACP manager workflow,
8. test one read-only ACP workflow.

## Incident Triage Guide

### Login problems

Check:

- Keycloak health,
- `OIDC_PUBLIC_ISSUER_URL`,
- redirect URI configuration,
- browser console/network responses,
- backend auth logs.

### API ready check failing

Check:

- database container health,
- database credentials,
- network connectivity between API and database,
- recent migration failures.

### Files appear missing

Check:

- uploads volume still mounted,
- `FILE_STORAGE_PATH`,
- whether files were overwritten or cleaned up during a recent upload conflict strategy,
- validation errors and file metadata in the database.

### Viewer cannot access an ACP

Check:

- ACP access model,
- assigned roles,
- credential token or user session,
- feature flags,
- whether the ACP is public or restricted.

## Release Readiness

Before a release:

1. verify automated tests,
2. run health checks,
3. confirm database migration posture,
4. validate login and at least one ACP workflow,
5. use the root release checklist.

## Documentation Maintenance

Operators should update the documentation when:

- new environment variables are introduced,
- deployment steps change,
- new health checks or audit signals are added,
- auth or integration behavior changes.

## Related Documents

- [Deployment](deployment.md)
- [Testing and Quality](../development/testing-and-quality.md)
- [Integrations and API](../features/integrations-and-api.md)
