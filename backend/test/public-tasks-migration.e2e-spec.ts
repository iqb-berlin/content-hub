import { randomUUID } from "crypto";
import { DataSource } from "typeorm";
import { PublicTask } from "../src/database/entities/public-task.entity";
import { PublicTasks1793836800000 } from "../src/database/migrations/1793836800000-PublicTasks";
import { PublicTasksService } from "../src/public-tasks/public-tasks.service";

describe("Public task migration and retention", () => {
  let admin: DataSource;
  let db: DataSource;
  const database = `public_tasks_e2e_${randomUUID().replace(/-/g, "")}`;

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
      username: process.env.DB_USERNAME || "contenthub",
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    };
    admin = await new DataSource(connection).initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    db = await new DataSource({
      ...connection,
      database,
      entities: [PublicTask],
      migrations: [PublicTasks1793836800000],
    }).initialize();
    await db.runMigrations();
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.destroy();
    }
  });

  it("matches the synchronized schema and survives restart without its source AP", async () => {
    const schemaDiff = await db.driver.createSchemaBuilder().log();
    expect(schemaDiff.upQueries).toEqual([]);
    const sourceApId = randomUUID();
    const repository = db.getRepository(PublicTask);
    const task = await repository.save(
      repository.create({
        sourceApId,
        unitId: "u1",
        title: "Persisted task",
        published: true,
        snapshot: {
          version: 1,
          unitId: "u1",
          title: "Persisted task",
          description: "",
          copyrightNotice: "© Rights",
          publicComments: "",
          playerHtml: "<html>Player</html>",
          definition: "{}",
          codingScheme: { variableCodings: [] },
          metadata: [],
        },
      }),
    );
    // No source AP row or files are required to serve a frozen publication.
    await db.destroy();
    await db.initialize();
    const service = new PublicTasksService(db.getRepository(PublicTask));
    expect((await service.getPublic(task.id)).snapshot.title).toBe(
      "Persisted task",
    );
    expect((await service.list(sourceApId))[0]).not.toHaveProperty("snapshot");
    await service.setPublished(sourceApId, task.id, false);
    await expect(service.getPublic(task.id)).rejects.toThrow(
      "nicht öffentlich verfügbar",
    );
    await service.setPublished(sourceApId, task.id, true);
    expect((await service.getPublic(task.id)).id).toBe(task.id);
    await expect(db.undoLastMigration()).rejects.toThrow("Public tasks exist");
    expect((await service.getPublic(task.id)).id).toBe(task.id);
  });
});
