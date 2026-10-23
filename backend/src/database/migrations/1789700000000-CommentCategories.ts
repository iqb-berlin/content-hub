import { MigrationInterface, QueryRunner } from "typeorm";

export class CommentCategories1789700000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE acp_access_configs ADD COLUMN comment_categories jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await q.query(`ALTER TABLE comments ADD COLUMN category_id uuid`);
  }

  async down(q: QueryRunner): Promise<void> {
    if (
      (
        await q.query(
          `SELECT 1 FROM comments WHERE category_id IS NOT NULL LIMIT 1`,
        )
      ).length ||
      (
        await q.query(
          `SELECT 1 FROM acp_access_configs WHERE comment_categories <> '[]'::jsonb LIMIT 1`,
        )
      ).length
    ) {
      throw new Error(
        "Comment categories exist; rollback would lose review data",
      );
    }
    await q.query(`ALTER TABLE comments DROP COLUMN category_id`);
    await q.query(
      `ALTER TABLE acp_access_configs DROP COLUMN comment_categories`,
    );
  }
}
