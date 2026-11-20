import { MigrationInterface, QueryRunner } from "typeorm";

export class AcpIndex05Compliance1785000000000 implements MigrationInterface {
  name = "AcpIndex05Compliance1785000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "acp" ADD COLUMN IF NOT EXISTS "acp_index_schema_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp" ADD COLUMN IF NOT EXISTS "acp_index_validation_status" character varying NOT NULL DEFAULT 'UNKNOWN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp" ADD COLUMN IF NOT EXISTS "acp_index_validation_report" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp_files" ADD COLUMN IF NOT EXISTS "relative_path" character varying`,
    );
    await queryRunner.query(
      `UPDATE "acp_files" SET "relative_path" = "original_name" WHERE "relative_path" IS NULL`,
    );
    await queryRunner.query(`WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY acp_id, lower(relative_path) ORDER BY uploaded_at, id) AS rn
      FROM acp_files
    ) UPDATE acp_files f SET relative_path = 'legacy-duplicates/' || f.id || '/' || f.original_name
      FROM ranked r WHERE f.id = r.id AND r.rn > 1`);
    await queryRunner.query(
      `ALTER TABLE "acp_files" ALTER COLUMN "relative_path" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_acp_files_acp_relative_path" ON "acp_files" ("acp_id", lower("relative_path"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp_snapshot_files" ADD COLUMN IF NOT EXISTS "relative_path" character varying`,
    );
    await queryRunner.query(
      `UPDATE "acp_snapshot_files" SET "relative_path" = "original_name" WHERE "relative_path" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp_snapshot_files" ALTER COLUMN "relative_path" SET NOT NULL`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "acp_external_resource_cache" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "url" character varying NOT NULL,
      "etag" character varying, "last_modified" character varying, "payload" jsonb,
      "status" character varying NOT NULL DEFAULT 'unavailable', "last_success_at" TIMESTAMPTZ,
      "last_error" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_acp_external_resource_cache_url" UNIQUE ("url"),
      CONSTRAINT "PK_acp_external_resource_cache" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `UPDATE "acp" SET "acp_index_schema_id" = 'acp-index@0.6', "acp_index_validation_status" = 'LEGACY_NONCONFORMANT' WHERE "acp_index_schema_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "acp_external_resource_cache"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_acp_files_acp_relative_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp_snapshot_files" DROP COLUMN IF EXISTS "relative_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp_files" DROP COLUMN IF EXISTS "relative_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp" DROP COLUMN IF EXISTS "acp_index_validation_report"`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp" DROP COLUMN IF EXISTS "acp_index_validation_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "acp" DROP COLUMN IF EXISTS "acp_index_schema_id"`,
    );
  }
}
