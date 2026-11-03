import { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { ContentHubTheme1793318400000 } from "../src/database/migrations/1793318400000-ContentHubTheme";

describe("Content Hub palette migration", () => {
  let db: DataSource;
  const schema = `branding_e2e_${randomUUID().replace(/-/g, "")}`;
  const id = randomUUID();
  const previous = {
    "--color-primary": "#123456",
    "--color-accent": "#abcdef",
  };
  const migration = new ContentHubTheme1793318400000();

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== "test" ||
      !process.env.DB_DATABASE?.includes("e2e")
    ) {
      throw new Error("Dedicated e2e database required");
    }
    db = await new DataSource({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USERNAME || "contenthub",
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      schema,
      extra: { options: `-c search_path=${schema}` },
    }).initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(
      `CREATE TABLE app_settings (id uuid PRIMARY KEY, theme jsonb NOT NULL, imprint_html text)`,
    );
    await db.query(
      `INSERT INTO app_settings VALUES ($1, $2, 'operator content')`,
      [id, previous],
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it("resets existing colors once, preserves later edits and restores the original palette", async () => {
    const q = db.createQueryRunner();
    await q.connect();
    try {
      await migration.up(q);
      let [settings] = await q.query(`SELECT * FROM app_settings`);
      expect(settings.theme["--color-primary"]).toBe("#5B21B6");
      expect(settings.theme["--color-accent"]).toBe("#e67e22");
      expect(settings.imprint_html).toBe("operator content");
      const applied = settings.theme;
      await q.query(
        `UPDATE app_settings SET theme = '{"--color-primary":"#fedcba"}'`,
      );
      await migration.up(q);
      [settings] = await q.query(`SELECT * FROM app_settings`);
      expect(settings.theme["--color-primary"]).toBe("#fedcba");
      await expect(migration.down(q)).rejects.toThrow(
        "Theme was edited after migration",
      );
      await q.query(`UPDATE app_settings SET theme = $1`, [applied]);
      await migration.down(q);
      [settings] = await q.query(`SELECT * FROM app_settings`);
      expect(settings.theme).toEqual(previous);
      expect(settings.imprint_html).toBe("operator content");
    } finally {
      await q.release();
    }
  });
});
