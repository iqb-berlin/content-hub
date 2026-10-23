import { DataSource, DataSourceOptions } from "typeorm";
import { readdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { createApplicationDataSource } from "../src/database/database-compatibility";

describe("0.5.0 upgrade through synchronize", () => {
  jest.setTimeout(60000);
  let admin: DataSource;
  let db: DataSource | undefined;
  let options: DataSourceOptions;
  const database = `synchronize_e2e_${randomUUID().replace(/-/g, "")}`;
  const acpId = randomUUID();
  const userId = randomUUID();
  let commentId: string;

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== "test" ||
      !process.env.DB_DATABASE?.includes("e2e")
    )
      throw new Error("Isolated e2e database required");
    const connection = {
      type: "postgres" as const,
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USERNAME || "contentpool",
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    };
    admin = await new DataSource(connection).initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    options = {
      ...connection,
      database,
      entities: [join(__dirname, "../src/database/entities/**/*.entity.ts")],
    };
    const migrationsDir = join(__dirname, "../src/database/migrations");
    const legacyMigrations = (await readdir(migrationsDir))
      .filter(
        (name) =>
          /^\d+.*\.ts$/.test(name) &&
          Number(name.split("-")[0]) <= 1787600000000,
      )
      .map((name) => join(migrationsDir, name));
    db = await new DataSource({
      ...options,
      migrations: legacyMigrations,
    }).initialize();
    await db.runMigrations();
    await db.query(
      `INSERT INTO acp(id, package_id, name, acp_index) VALUES ($1,'upgrade-test','Upgrade test',$2)`,
      [acpId, { units: [{ id: "U", items: [{ id: "I" }] }] }],
    );
    await db.query(
      `INSERT INTO users(id, username) VALUES ($1,'existing-manager')`,
      [userId],
    );
    await db.query(
      `INSERT INTO acp_user_roles(user_id, acp_id, role) VALUES ($1,$2,'ACP_MANAGER')`,
      [userId, acpId],
    );
    const [config] = await db.query(
      `INSERT INTO acp_access_configs(acp_id, access_model, feature_config) VALUES ($1,'PRIVATE',$2) RETURNING id`,
      [
        acpId,
        {
          enableCommenting: true,
          enableItemList: true,
          commentTargets: ["ITEM", "TASK_SEQUENCE"],
        },
      ],
    );
    await db.query(
      `INSERT INTO acp_credentials(access_config_id, username, password_hash) VALUES ($1,'existing-reviewer','unchanged-hash')`,
      [config.id],
    );
    const [comment] = await db.query(
      `INSERT INTO comments(acp_id,user_id,target_type,target_id,comment_text) VALUES ($1,$2,'ITEM','U_I','Existing comment') RETURNING id`,
      [acpId, userId],
    );
    commentId = comment.id;
    await db.destroy();
    db = undefined;
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.destroy();
    }
  });

  it("preserves legacy grants and comment targets, tracks revisions and respects later grant removal", async () => {
    // A failed legacy comment conversion must not leave freshly added grant
    // columns behind, otherwise a retry would skip the grant backfill.
    db = await new DataSource(options).initialize();
    await db.query(
      `CREATE FUNCTION reject_upgrade_comment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'upgrade test failure'; END $$`,
    );
    await db.query(
      `CREATE TRIGGER reject_upgrade BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION reject_upgrade_comment()`,
    );
    await expect(
      createApplicationDataSource({
        ...options,
        synchronize: true,
        migrationsRun: false,
      }),
    ).rejects.toThrow("upgrade test failure");
    const runner = db.createQueryRunner();
    expect(await runner.hasColumn("acp_user_roles", "capabilities")).toBe(
      false,
    );
    expect(await runner.hasColumn("comments", "legacy_read_only")).toBe(false);
    await runner.release();
    await db.query(`DROP TRIGGER reject_upgrade ON comments`);
    await db.query(`DROP FUNCTION reject_upgrade_comment()`);
    await db.destroy();
    db = await createApplicationDataSource({
      ...options,
      synchronize: true,
      migrationsRun: false,
    });
    expect(
      (await db.query(`SELECT capabilities FROM acp_user_roles`))[0]
        .capabilities,
    ).toEqual([
      "review:participate",
      "review:manage",
      "item-explorer:view",
      "item-explorer:edit",
    ]);
    expect(
      (
        await db.query(
          `SELECT capabilities, password_hash FROM acp_credentials`,
        )
      )[0],
    ).toEqual({
      capabilities: ["review:participate", "item-explorer:view"],
      password_hash: "unchanged-hash",
    });
    expect(
      (
        await db.query(
          `SELECT comment_text, unit_id, item_id, legacy_read_only FROM comments WHERE id=$1`,
          [commentId],
        )
      )[0],
    ).toEqual({
      comment_text: "Existing comment",
      unit_id: "U",
      item_id: "I",
      legacy_read_only: false,
    });
    expect(
      (await db.query(`SELECT feature_config FROM acp_access_configs`))[0]
        .feature_config,
    ).toEqual({
      enableCommenting: true,
      enableItemList: true,
      enableReview: false,
      commentTargets: ["ITEM", "TASK_SEQUENCE", "BOOKLET"],
    });
    await db.query(`UPDATE acp_user_roles SET capabilities='[]'`);
    await db.query(`UPDATE acp_credentials SET capabilities='[]'`);
    await db.query(
      `UPDATE acp_access_configs SET feature_config=feature_config || '{"enableReview":true}'`,
    );
    await db.destroy();
    db = await createApplicationDataSource({
      ...options,
      synchronize: true,
      migrationsRun: false,
    });
    expect(
      (await db.query(`SELECT capabilities FROM acp_user_roles`))[0]
        .capabilities,
    ).toEqual([]);
    expect(
      (await db.query(`SELECT capabilities FROM acp_credentials`))[0]
        .capabilities,
    ).toEqual([]);
    expect(
      (await db.query(`SELECT feature_config FROM acp_access_configs`))[0]
        .feature_config.enableReview,
    ).toBe(true);
    const revision = async () =>
      Number(
        (await db!.query(`SELECT review_revision FROM acp_access_configs`))[0]
          .review_revision,
      );
    const before = await revision();
    await db.query(
      `INSERT INTO comment_votes(comment_id,user_id,value) VALUES ($1,$2,'UP')`,
      [commentId, userId],
    );
    expect(await revision()).toBeGreaterThan(before);
    const afterVote = await revision();
    await db.query(`UPDATE comments SET deleted_at=now() WHERE id=$1`, [
      commentId,
    ]);
    expect(await db.query(`SELECT id FROM comment_votes`)).toEqual([]);
    expect(await revision()).toBeGreaterThan(afterVote);
  });
});
