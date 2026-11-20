#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/deploy-common.sh"

POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777}"
suffix="$$-${RANDOM}"
app_container="content-hub-restore-app-${suffix}"
keycloak_container="content-hub-restore-keycloak-${suffix}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/content-hub-restore-test.XXXXXX")"

cleanup() {
  docker rm -f "$app_container" "$keycloak_container" >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
}
trap cleanup EXIT

wait_for_postgres() {
  local container="$1" database="$2"
  for attempt in {1..60}; do
    if docker logs "$container" 2>&1 | grep -q \
      'PostgreSQL init process complete; ready for start up.' &&
      [[ "$(docker exec "$container" psql -qAt -U postgres -d "$database" \
        -c 'select 1' 2>/dev/null)" == "1" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL in ${container} did not become ready" >&2
  return 1
}

docker run -d --name "$app_container" \
  -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_DB=content_hub \
  "$POSTGRES_IMAGE" >/dev/null
docker run -d --name "$keycloak_container" \
  -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_DB=keycloak \
  "$POSTGRES_IMAGE" >/dev/null

wait_for_postgres "$app_container" content_hub
wait_for_postgres "$keycloak_container" keycloak

docker exec -i "$app_container" psql -v ON_ERROR_STOP=1 -U postgres -d content_hub <<'SQL'
create table restore_probe (id integer primary key, value text not null);
insert into restore_probe values (1, 'content-hub-ready');
SQL
docker exec -i "$keycloak_container" psql -v ON_ERROR_STOP=1 -U postgres -d keycloak <<'SQL'
create table realm (id text primary key, name text not null);
create table user_entity (id text primary key, realm_id text not null references realm(id));
insert into realm values ('iqb-id', 'iqb');
insert into user_entity values ('user-1', 'iqb-id'), ('user-2', 'iqb-id');
SQL

docker exec "$app_container" pg_dump --format=custom -U postgres content_hub \
  >"${temp_dir}/content-hub-db.dump"
docker exec "$keycloak_container" pg_dump --format=custom -U postgres keycloak \
  >"${temp_dir}/keycloak-db.dump"
docker exec -i "$app_container" pg_restore --list <"${temp_dir}/content-hub-db.dump" >/dev/null
docker exec -i "$keycloak_container" pg_restore --list <"${temp_dir}/keycloak-db.dump" >/dev/null

docker exec -i "$app_container" psql -v ON_ERROR_STOP=1 -U postgres -d content_hub <<'SQL'
update restore_probe set value = 'changed after backup';
create table added_after_backup (id integer references restore_probe(id));
insert into added_after_backup values (1);
create schema added_after_backup_schema;
create table added_after_backup_schema.extra_data (id integer);
SQL
docker exec -i "$keycloak_container" psql -v ON_ERROR_STOP=1 -U postgres -d keycloak <<'SQL'
insert into user_entity values ('user-after-backup', 'iqb-id');
create table added_after_backup (id text references user_entity(id));
insert into added_after_backup values ('user-after-backup');
SQL

# An invalid archive must not remove the existing database.
printf 'not a PostgreSQL archive\n' >"${temp_dir}/invalid.dump"
if (ch_restore_database "$app_container" postgres content_hub "${temp_dir}/invalid.dump") >/dev/null 2>&1; then
  echo "Invalid restore archive was accepted" >&2
  exit 1
fi
[[ "$(docker exec "$app_container" psql -qAt -U postgres -d content_hub \
  -c 'select value from restore_probe where id = 1')" == 'changed after backup' ]]

# Ownership permits DROP DATABASE even without CREATEDB. Reject that role before
# dropping anything, rather than discovering the missing privilege afterward.
docker exec "$app_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'create role restore_without_createdb login; alter database content_hub owner to restore_without_createdb'
if (ch_restore_database "$app_container" restore_without_createdb content_hub "${temp_dir}/content-hub-db.dump") >/dev/null 2>&1; then
  echo "Restore accepted a user without database creation privileges" >&2
  exit 1
fi
[[ "$(docker exec "$app_container" psql -qAt -U postgres -d content_hub \
  -c 'select value from restore_probe where id = 1')" == 'changed after backup' ]]
docker exec "$app_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'alter database content_hub owner to postgres'

ch_restore_database "$app_container" postgres content_hub "${temp_dir}/content-hub-db.dump"
ch_restore_database "$keycloak_container" postgres keycloak "${temp_dir}/keycloak-db.dump"

for container in "$app_container" "$keycloak_container"; do
  database=content_hub
  [[ "$container" != "$keycloak_container" ]] || database=keycloak
  [[ "$(docker exec "$container" psql -qAt -U postgres -d "$database" \
    -c "select to_regclass('public.added_after_backup') is null")" == t ]] || {
    echo "Restore retained a table introduced after the backup" >&2
    exit 1
  }
done
[[ "$(docker exec "$app_container" psql -qAt -U postgres -d content_hub \
  -c "select count(*) from pg_namespace where nspname = 'added_after_backup_schema'")" == 0 ]]

app_value="$(docker exec "$app_container" psql -qAt -U postgres -d content_hub \
  -c 'select value from restore_probe where id = 1')"
keycloak_users="$(docker exec "$keycloak_container" psql -qAt -U postgres -d keycloak \
  -c "select count(*) from user_entity u join realm r on r.id = u.realm_id where r.name = 'iqb'")"
[[ "$app_value" == "content-hub-ready" ]] || { echo "Application database restore failed" >&2; exit 1; }
[[ "$keycloak_users" == "2" ]] || { echo "Keycloak user-count restore failed" >&2; exit 1; }

mkdir -p "${temp_dir}/uploads-source/uploads/nested" "${temp_dir}/uploads-restored"
printf 'restore fixture\n' >"${temp_dir}/uploads-source/uploads/nested/probe.txt"
tar -C "${temp_dir}/uploads-source" -czf "${temp_dir}/uploads.tgz" uploads
tar -C "${temp_dir}/uploads-restored" -xzf "${temp_dir}/uploads.tgz"
cmp "${temp_dir}/uploads-source/uploads/nested/probe.txt" \
  "${temp_dir}/uploads-restored/uploads/nested/probe.txt"

echo "Backup/restore drill passed (both databases ready, ${keycloak_users} Keycloak users, uploads intact)"
