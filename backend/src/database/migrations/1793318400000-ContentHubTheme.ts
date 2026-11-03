import { MigrationInterface, QueryRunner } from "typeorm";

/** One-time, reversible switch of existing installations to the Content Hub palette. */
export class ContentHubTheme1793318400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable("app_settings"))) return;
    await q.query(`CREATE TABLE IF NOT EXISTS content_hub_theme_backup (
      id boolean PRIMARY KEY CHECK (id),
      previous_themes jsonb NOT NULL,
      palette jsonb NOT NULL
    )`);
    await q.query(`WITH snapshot AS (
      INSERT INTO content_hub_theme_backup (id, previous_themes, palette)
      SELECT true, COALESCE(jsonb_object_agg(id::text, theme), '{}'::jsonb),
        '{"--color-primary":"#5B21B6","--color-primary-light":"#6D28D9",
          "--color-accent":"#e67e22","--color-success":"#27ae60",
          "--color-danger":"#e74c3c","--color-warning":"#f39c12",
          "--color-bg":"#f5f7fa","--color-surface":"#ffffff",
          "--color-text":"#2c3e50","--color-text-secondary":"#566573",
          "--color-border":"#dfe6e9"}'::jsonb
      FROM app_settings
      ON CONFLICT (id) DO NOTHING
      RETURNING palette
    ) UPDATE app_settings SET theme = COALESCE(theme, '{}'::jsonb) || snapshot.palette
      FROM snapshot`);
  }

  async down(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable("content_hub_theme_backup"))) return;
    const modified = await q.query(`SELECT 1 FROM app_settings s
      CROSS JOIN content_hub_theme_backup b
      WHERE b.previous_themes ? s.id::text
        AND s.theme IS DISTINCT FROM
          (COALESCE(b.previous_themes->s.id::text, '{}'::jsonb) || b.palette)
      LIMIT 1`);
    if (modified.length) {
      throw new Error(
        "Theme was edited after migration; restore saved colors explicitly before rollback",
      );
    }
    await q.query(`UPDATE app_settings s
      SET theme = b.previous_themes->s.id::text
      FROM content_hub_theme_backup b WHERE b.previous_themes ? s.id::text`);
    await q.query(`DROP TABLE content_hub_theme_backup`);
  }
}
