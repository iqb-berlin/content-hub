import { MigrationInterface, QueryRunner } from "typeorm";

export class PreserveAcpSnapshotMetadata1795200000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE acp_snapshots ADD COLUMN package_metadata_snapshot jsonb",
    );
    await runner.query(
      "ALTER TABLE acp_snapshot_files ADD COLUMN file_type varchar, ADD COLUMN validation_result jsonb",
    );
    // The earlier backfill used the basename for every file in old snapshots.
    await runner.query(`WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY snapshot_id, lower(relative_path) ORDER BY id) AS rn
      FROM acp_snapshot_files
    ) UPDATE acp_snapshot_files f SET relative_path = 'legacy-duplicates/' || f.id || '/' || f.original_name
      FROM ranked r WHERE f.id = r.id AND r.rn > 1`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE acp_snapshot_files DROP COLUMN file_type, DROP COLUMN validation_result",
    );
    await runner.query(
      "ALTER TABLE acp_snapshots DROP COLUMN package_metadata_snapshot",
    );
  }
}
