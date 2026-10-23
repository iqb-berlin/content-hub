import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as request from "supertest";
import {
  Acp,
  AcpFile,
  AcpUserRole,
  AcpItemPreference,
  AcpItemRowNumber,
  User,
} from "../src/database/entities";
import { buildPatchPersonalItemPreferenceRowQuery } from "../src/views/personal-item-preferences.query";
import { ItemRowNumberingService } from "../src/files/item-row-numbering.service";
import { ReviewReadinessService } from "../src/review/review-readiness.service";

if (!process.env.DB_HOST) process.env.DB_HOST = "localhost";
if (!process.env.DB_PORT) process.env.DB_PORT = "5433";
if (!process.env.DB_USERNAME) process.env.DB_USERNAME = "contentpool";
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = "contentpool_dev";
if (!process.env.DB_DATABASE) process.env.DB_DATABASE = "contentpool";
if (!process.env.NODE_ENV) process.env.NODE_ENV = "test";
if (!process.env.DB_SYNCHRONIZE) process.env.DB_SYNCHRONIZE = "true";
if (!process.env.DB_RUN_MIGRATIONS) process.env.DB_RUN_MIGRATIONS = "false";

/**
 * E2E test for critical API scenarios.
 *
 * Prerequisites: a running PostgreSQL instance with the database configured
 * as per .env or environment variables.
 *
 * Run with: npm run test:e2e
 */
describe("ContentPool API (e2e)", () => {
  let app: INestApplication;
  let server: any;
  let authToken: string;
  let credentialToken: string;
  let credentialId: string;
  let acpRepository: Repository<Acp>;
  let acpFileRepository: Repository<AcpFile>;
  let itemPreferenceRepository: Repository<AcpItemPreference>;
  let itemRowNumberRepository: Repository<AcpItemRowNumber>;
  let itemRowNumberingService: ItemRowNumberingService;

  let acpId: string;
  let snapshotId: string;

  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const adminUsername = `e2e_admin_${uniqueSuffix}`;
  const testPackageId = `e2e-test-${uniqueSuffix}`;
  const credentialUsername = `cred_${uniqueSuffix}`;
  const credentialPassword = "StrongPass123!";

  const baseIndex = {
    packageId: testPackageId,
    version: "0.5.0",
    name: [{ lang: "de", value: "E2E ACP" }],
    description: [{ lang: "de", value: "E2E Description" }],
    status: "IN_DEVELOPMENT",
    assessmentParts: [
      {
        id: "part-1",
        name: [{ lang: "de", value: "Teil 1" }],
        units: [
          {
            id: "U1",
            name: "Unit 1",
            dependencies: [
              {
                id: "unit.xml",
                type: "UNIT_INDEX",
              },
            ],
            items: [
              {
                id: "I1",
                name: "Item 1",
                sourceVariable: "var1",
              },
            ],
          },
        ],
        bookletModules: [
          {
            id: "M1",
            name: "Module 1",
            units: [{ id: "U1", order: 1 }],
          },
        ],
        instruments: [
          {
            id: "INST-1",
            name: [{ lang: "de", value: "Instrument 1" }],
            testcenterBooklet: [
              {
                definitionId: "booklet.xml",
                modules: [{ moduleId: "M1" }],
              },
            ],
          },
        ],
      },
    ],
  };

  const featureConfig = {
    enableItemList: true,
    enableItemCollections: true,
    persistUserPreferences: true,
    enableUnitView: true,
    enableSequenceNavigation: true,
    enableCommenting: true,
    commentTargets: ["UNIT", "ITEM", "TASK_SEQUENCE"],
    commentVisibilityMode: "SHARED",
  };

  jest.setTimeout(60000);

  beforeAll(async () => {
    const { AppModule } = await import("../src/app.module");
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ReviewReadinessService)
      .useValue({
        check: async () => ({
          status: "READY",
          checkedAt: new Date().toISOString(),
          blockers: [],
          warnings: [],
          summary: {
            totalFiles: 0,
            validFiles: 0,
            invalidFiles: 0,
            bookletCount: 1,
            unitCount: 1,
          },
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix("api");
    await app.init();
    server = app.getHttpServer();

    // Create an app-admin test user directly, then issue a valid JWT for stable e2e auth.
    const userRepo = moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    );
    itemPreferenceRepository = moduleFixture.get<Repository<AcpItemPreference>>(
      getRepositoryToken(AcpItemPreference),
    );
    acpFileRepository = moduleFixture.get<Repository<AcpFile>>(
      getRepositoryToken(AcpFile),
    );
    acpRepository = moduleFixture.get<Repository<Acp>>(getRepositoryToken(Acp));
    itemRowNumberRepository = moduleFixture.get<Repository<AcpItemRowNumber>>(
      getRepositoryToken(AcpItemRowNumber),
    );
    itemRowNumberingService = moduleFixture.get<ItemRowNumberingService>(
      ItemRowNumberingService,
    );
    const jwtService = moduleFixture.get<JwtService>(JwtService);

    const adminUser = await userRepo.save(
      userRepo.create({
        username: adminUsername,
        isAppAdmin: true,
      }),
    );

    authToken = jwtService.sign({
      sub: adminUser.id,
      username: adminUser.username,
      isAppAdmin: true,
      type: "oidc",
      authType: "oidc",
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("does not expose the removed local user login endpoint", async () => {
    await request(server)
      .post("/api/auth/login")
      .send({ username: "legacy-user", password: "LegacyPassword123!" })
      .expect(404);
  });

  it("does not expose the removed authentication context endpoint", async () => {
    await request(server).get("/api/auth/context").expect(404);
  });

  it("creates ACP and baseline index", async () => {
    const createRes = await request(server)
      .post("/api/acp")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        packageId: testPackageId,
        name: "E2E ACP",
        description: "E2E Description",
      })
      .expect(201);

    acpId = createRes.body.id;
    const adminId = app.get(JwtService).decode(authToken).sub;
    await app
      .get<Repository<AcpUserRole>>(getRepositoryToken(AcpUserRole))
      .save({
        acpId,
        userId: adminId,
        role: "ACP_MANAGER" as any,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      });
    expect(createRes.body.packageId).toBe(testPackageId);

    const accessConfigRes = await request(server)
      .get(`/api/acp/${acpId}/access`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(accessConfigRes.body.accessModel).toBe("PRIVATE");

    await request(server)
      .put(`/api/acp/${acpId}/index`)
      .query({ expectedUpdatedAt: createRes.body.updatedAt })
      .set("Authorization", `Bearer ${authToken}`)
      .send(baseIndex)
      .expect(200);
  });

  it("serializes concurrent stable row-number assignments", async () => {
    await itemRowNumberRepository.delete({ acpId });
    const rowA = `${uniqueSuffix}-row-a`;
    const rowB = `${uniqueSuffix}-row-b`;

    await Promise.all([
      itemRowNumberingService.assignNumbers(acpId, [
        {
          rowKey: rowA,
          itemId: "UNIT_1_ITEM_2",
          unitId: "UNIT_1",
        },
      ]),
      itemRowNumberingService.assignNumbers(acpId, [
        {
          rowKey: rowB,
          itemId: "UNIT_1_ITEM_1",
          unitId: "UNIT_1",
        },
      ]),
    ]);

    const persisted = await itemRowNumberRepository.find({
      where: { acpId },
      order: { rowNumber: "ASC" },
    });
    expect(persisted.map((entry) => entry.rowKey).sort()).toEqual(
      [rowA, rowB].sort(),
    );
    expect(new Set(persisted.map((entry) => entry.rowNumber)).size).toBe(2);
    expect(persisted.map((entry) => entry.rowNumber)).toEqual([1, 2]);
  });

  it("enforces row-key and row-number uniqueness in PostgreSQL", async () => {
    const [existing] = await itemRowNumberRepository.find({
      where: { acpId },
      order: { rowNumber: "ASC" },
      take: 1,
    });

    await expect(
      itemRowNumberRepository.insert({
        acpId,
        rowKey: `${uniqueSuffix}-duplicate-hash`,
        rowKeyHash: existing.rowKeyHash,
        rowNumber: 100,
      }),
    ).rejects.toThrow();
    await expect(
      itemRowNumberRepository.insert({
        acpId,
        rowKey: `${uniqueSuffix}-duplicate-number`,
        rowKeyHash: "f".repeat(64),
        rowNumber: existing.rowNumber,
      }),
    ).rejects.toThrow();
  });

  it("rolls back recalculation when the caller transaction fails", async () => {
    const before = await itemRowNumberRepository.find({
      where: { acpId },
      order: { rowNumber: "ASC" },
    });

    await expect(
      itemRowNumberRepository.manager.transaction(async (manager) => {
        await itemRowNumberingService.recalculateNumbers(
          acpId,
          [
            {
              rowKey: `${uniqueSuffix}-replacement`,
              itemId: "UNIT_1_ITEM_3",
              unitId: "UNIT_1",
            },
          ],
          manager,
        );
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const after = await itemRowNumberRepository.find({
      where: { acpId },
      order: { rowNumber: "ASC" },
    });
    expect(
      after.map(({ rowKey, rowNumber }) => ({ rowKey, rowNumber })),
    ).toEqual(before.map(({ rowKey, rowNumber }) => ({ rowKey, rowNumber })));
  });

  it("holds ACP file rows against concurrent deletion during recalculation", async () => {
    const sourceFile = await acpFileRepository.save(
      acpFileRepository.create({
        acpId,
        filePath: `/tmp/${uniqueSuffix}-source.xml`,
        originalName: `${uniqueSuffix}-source.xml`,
        relativePath: `${uniqueSuffix}-source.xml`,
        fileType: "application/xml",
        fileSize: 1,
        checksum: "a".repeat(64),
      }),
    );

    let signalFileLockAcquired!: () => void;
    const fileLockAcquired = new Promise<void>((resolve) => {
      signalFileLockAcquired = resolve;
    });
    let releaseFileLock!: () => void;
    const holdFileLock = new Promise<void>((resolve) => {
      releaseFileLock = resolve;
    });

    const recalculation = itemRowNumberingService.recalculateNumbers(
      acpId,
      [
        {
          rowKey: `${uniqueSuffix}-locked-recalculation`,
          itemId: "UNIT_1_ITEM_4",
          unitId: "UNIT_1",
        },
      ],
      undefined,
      async (manager) => {
        await manager
          .getRepository(AcpFile)
          .createQueryBuilder("file")
          .setLock("pessimistic_read")
          .where("file.acpId = :acpId", { acpId })
          .getMany();
        signalFileLockAcquired();
        await holdFileLock;
      },
    );

    await fileLockAcquired;
    try {
      await expect(
        acpFileRepository.manager.transaction(async (manager) => {
          await manager.query("SET LOCAL lock_timeout = '200ms'");
          await manager.getRepository(AcpFile).delete({ id: sourceFile.id });
        }),
      ).rejects.toThrow(/lock timeout/i);
    } finally {
      releaseFileLock();
      await recalculation;
    }

    await expect(
      acpFileRepository.delete({ id: sourceFile.id }),
    ).resolves.toEqual(expect.objectContaining({ affected: 1 }));
  });

  it("covers public access and core read-only views", async () => {
    await request(server)
      .put(`/api/acp/${acpId}/access`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        accessModel: "PUBLIC",
        featureConfig,
      })
      .expect(200);

    const publicList = await request(server).get("/api/view/acp").expect(200);
    expect(Array.isArray(publicList.body)).toBe(true);
    expect(publicList.body.some((entry: any) => entry.id === acpId)).toBe(true);

    const startRes = await request(server)
      .get(`/api/view/acp/${acpId}`)
      .expect(200);
    expect(startRes.body.id).toBe(acpId);

    const unitsRes = await request(server)
      .get(`/api/view/acp/${acpId}/units`)
      .expect(200);
    expect(unitsRes.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "U1" })]),
    );

    const itemsRes = await request(server)
      .get(`/api/view/acp/${acpId}/items`)
      .expect(200);
    expect(itemsRes.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ itemId: "U1_I1" })]),
    );

    const sequencesRes = await request(server)
      .get(`/api/view/acp/${acpId}/sequences`)
      .expect(200);
    expect(sequencesRes.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "M1" })]),
    );

    const sequenceRes = await request(server)
      .get(`/api/view/acp/${acpId}/sequences/M1`)
      .expect(200);
    expect(sequenceRes.body.units).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "U1" })]),
    );
  });

  it("covers credential access flow", async () => {
    const now = new Date();
    const validFrom = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const validUntil = new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    await request(server)
      .put(`/api/acp/${acpId}/access`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        accessModel: "CREDENTIALS_LIST",
        validFrom,
        validUntil,
        featureConfig,
      })
      .expect(200);

    const reviewConfig = await request(server)
      .get(`/api/view/acp/${acpId}/review/config`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    await request(server)
      .put(`/api/view/acp/${acpId}/review/config`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        enableReview: true,
        visibilityMode: "SHARED",
        configVersion: reviewConfig.body.configVersion,
        confirmExistingComments: true,
      })
      .expect(200);

    const credentialRes = await request(server)
      .post(`/api/acp/${acpId}/access/credentials/single`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        username: credentialUsername,
        password: credentialPassword,
        capabilities: ["review:participate", "item-explorer:view"],
      })
      .expect(201);
    credentialId = credentialRes.body.id;

    const loginRes = await request(server)
      .post("/api/auth/credential-login")
      .send({
        acpId,
        username: credentialUsername,
        password: credentialPassword,
      })
      .expect(201);

    credentialToken = loginRes.body.accessToken;
    expect(credentialToken).toBeDefined();

    await request(server)
      .get(`/api/view/acp/${acpId}`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);

    await request(server)
      .get(`/api/view/acp/${acpId}/items`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);
  });

  it("executes personal row insert, conflict update, and delete in PostgreSQL", async () => {
    const rowKey = "e2e-row-1";
    const query = buildPatchPersonalItemPreferenceRowQuery("credential_id");
    const executePatch = async (rowData: Record<string, unknown> | null) =>
      itemPreferenceRepository.query(query, [
        acpId,
        "item-explorer",
        null,
        credentialId,
        credentialUsername,
        JSON.stringify({
          ui: {},
          tags: {},
          rowData: rowData ? { [rowKey]: rowData } : {},
        }),
        rowData ? JSON.stringify(rowData) : null,
        rowKey,
        10_000,
      ]);

    const insertedRow = { category: "Offen", note: "erste Fassung" };
    await executePatch(insertedRow);

    let record = await itemPreferenceRepository.findOneByOrFail({
      acpId,
      viewId: "item-explorer",
      credentialId,
    });
    expect(record.preferences).toEqual({
      ui: {},
      tags: {},
      rowData: { [rowKey]: insertedRow },
    });

    const updatedRow = { category: "Erledigt", note: "zweite Fassung" };
    await executePatch(updatedRow);

    record = await itemPreferenceRepository.findOneByOrFail({
      acpId,
      viewId: "item-explorer",
      credentialId,
    });
    expect(record.preferences).toEqual({
      ui: {},
      tags: {},
      rowData: { [rowKey]: updatedRow },
    });

    await executePatch(null);

    record = await itemPreferenceRepository.findOneByOrFail({
      acpId,
      viewId: "item-explorer",
      credentialId,
    });
    expect(record.preferences).toEqual({ ui: {}, tags: {}, rowData: {} });
  });

  it("serializes collection updates without overwriting personal JSONB fields", async () => {
    const rowKey = "collection-concurrency-row";
    await itemPreferenceRepository.query(
      buildPatchPersonalItemPreferenceRowQuery("credential_id"),
      [
        acpId,
        "item-explorer",
        null,
        credentialId,
        credentialUsername,
        JSON.stringify({
          ui: {},
          tags: {},
          rowData: { [rowKey]: { note: "must survive" } },
        }),
        JSON.stringify({ note: "must survive" }),
        rowKey,
        10_000,
      ],
    );

    const created = await request(server)
      .post(`/api/view/acp/${acpId}/items/collections`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .send({ name: "Concurrency" })
      .expect(201);
    const collectionId = created.body.activeCollectionId;

    const updates = await Promise.all([
      request(server)
        .patch(`/api/view/acp/${acpId}/items/collections/${collectionId}`)
        .set("Authorization", `Bearer ${credentialToken}`)
        .send({ baseVersion: 1, name: "First" }),
      request(server)
        .patch(`/api/view/acp/${acpId}/items/collections/${collectionId}`)
        .set("Authorization", `Bearer ${credentialToken}`)
        .send({ baseVersion: 1, name: "Second" }),
    ]);

    expect(updates.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const record = await itemPreferenceRepository.findOneByOrFail({
      acpId,
      viewId: "item-explorer",
      credentialId,
    });
    expect(record.preferences.rowData).toEqual({
      [rowKey]: { note: "must survive" },
    });
    expect((record.preferences.collections as any[])[0]).toEqual(
      expect.objectContaining({ id: collectionId, version: 2 }),
    );

    const userCollections = await request(server)
      .get(`/api/view/acp/${acpId}/items/collections`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(userCollections.body.collections).toEqual([]);
  });

  it("repairs a non-object preference root when creating a collection", async () => {
    await itemPreferenceRepository.query(
      `
        UPDATE "acp_item_preferences"
        SET "preferences" = '[]'::jsonb
        WHERE "acp_id" = $1
          AND "view_id" = 'item-explorer'
          AND "credential_id" = $2
      `,
      [acpId, credentialId],
    );

    const created = await request(server)
      .post(`/api/view/acp/${acpId}/items/collections`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .send({ name: "Repaired" })
      .expect(201);

    const record = await itemPreferenceRepository.findOneByOrFail({
      acpId,
      viewId: "item-explorer",
      credentialId,
    });
    expect(Array.isArray(record.preferences)).toBe(false);
    expect(record.preferences.collections).toEqual([
      expect.objectContaining({
        id: created.body.activeCollectionId,
        name: "Repaired",
      }),
    ]);
  });

  it("repairs a non-object preference root when saving view preferences", async () => {
    const viewId = "item-list-root-repair";
    await itemPreferenceRepository.query(
      `
        INSERT INTO "acp_item_preferences" (
          "id", "acp_id", "view_id", "user_id", "credential_id",
          "credential_username", "preferences", "created_at", "updated_at"
        )
        VALUES (
          uuid_generate_v4(), $1, $2, null, $3, $4,
          '[]'::jsonb, now(), now()
        )
        ON CONFLICT ("acp_id", "view_id", "credential_id")
          WHERE "credential_id" IS NOT NULL
        DO UPDATE SET "preferences" = '[]'::jsonb
      `,
      [acpId, viewId, credentialId, credentialUsername],
    );

    await request(server)
      .put(`/api/view/acp/${acpId}/items/preferences`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .send({ viewId, ui: { filterText: "persisted" } })
      .expect(200);

    const loaded = await request(server)
      .get(`/api/view/acp/${acpId}/items/preferences`)
      .query({ viewId })
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);
    expect(loaded.body).toEqual({
      ui: { filterText: "persisted" },
      tags: {},
      rowData: {},
    });

    const record = await itemPreferenceRepository.findOneByOrFail({
      acpId,
      viewId,
      credentialId,
    });
    expect(Array.isArray(record.preferences)).toBe(false);
  });

  it("covers comment export", async () => {
    await request(server)
      .post(`/api/acp/${acpId}/comments`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .send({
        targetType: "ITEM",
        targetId: "U1_I1",
        commentText: "E2E comment",
      })
      .expect(201);

    const mineRes = await request(server)
      .get(`/api/acp/${acpId}/comments/mine`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);
    expect(mineRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commentText: "E2E comment" }),
      ]),
    );
    expect(JSON.stringify(mineRes.body)).not.toContain("passwordHash");
    expect(mineRes.body.every((comment: any) => !comment.credential)).toBe(
      true,
    );

    const exportJsonRes = await request(server)
      .get(`/api/acp/${acpId}/comments/export`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);

    expect(Array.isArray(exportJsonRes.body)).toBe(true);
    expect(exportJsonRes.body.length).toBeGreaterThanOrEqual(1);

    const exportXlsxRes = await request(server)
      .get(`/api/acp/${acpId}/comments/export.xlsx`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);

    expect(exportXlsxRes.header["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("shares an item thread while keeping edits author-only", async () => {
    const rootRes = await request(server)
      .post(`/api/acp/${acpId}/review/comments`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .send({
        unitId: "U1",
        itemId: "U1_I1",
        commentText: "Shared root",
      })
      .expect(201);

    expect(rootRes.body).toMatchObject({
      parentCommentId: null,
      commentText: "Shared root",
      authorLabel: credentialUsername,
      unitId: "U1",
      itemId: "I1",
      isOwn: true,
      version: 1,
    });

    const managerThreadRes = await request(server)
      .get(`/api/acp/${acpId}/review/comments`)
      .query({ unitId: "U1", itemId: "U1_I1" })
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(managerThreadRes.body).toMatchObject({ visibilityMode: "SHARED" });
    expect(managerThreadRes.body.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rootRes.body.id, isOwn: false }),
      ]),
    );

    await request(server)
      .patch(`/api/acp/${acpId}/review/comments/${rootRes.body.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ commentText: "Manager overwrite", version: 1 })
      .expect(403);

    const updatedRootRes = await request(server)
      .patch(`/api/acp/${acpId}/review/comments/${rootRes.body.id}`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .send({ commentText: "Shared root updated", version: 1 })
      .expect(200);
    expect(updatedRootRes.body).toMatchObject({
      commentText: "Shared root updated",
      version: 2,
    });

    const replyRes = await request(server)
      .post(`/api/acp/${acpId}/review/comments`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        unitId: "U1",
        itemId: "U1_I1",
        commentText: "Manager reply",
        parentCommentId: rootRes.body.id,
      })
      .expect(201);
    expect(replyRes.body.parentCommentId).toBe(rootRes.body.id);

    const participantThreadRes = await request(server)
      .get(`/api/acp/${acpId}/review/comments`)
      .query({ unitId: "U1", itemId: "U1_I1" })
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);
    expect(participantThreadRes.body.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rootRes.body.id, isOwn: true }),
        expect.objectContaining({
          id: replyRes.body.id,
          parentCommentId: rootRes.body.id,
          isOwn: false,
        }),
      ]),
    );

    const countsRes = await request(server)
      .get(`/api/acp/${acpId}/review/comments/counts`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);
    expect(countsRes.body.counts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitId: "U1", itemId: "I1", count: 3 }),
      ]),
    );

    const managerMineCsv = await request(server)
      .get(`/api/acp/${acpId}/review/comments/export/mine.csv`)
      .set("Authorization", `Bearer ${authToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const managerMineText = Buffer.from(managerMineCsv.body).toString("utf8");
    expect(managerMineText).toContain("Manager reply");
    expect(managerMineText).not.toContain("Shared root updated");

    await request(server)
      .get(`/api/acp/${acpId}/review/comments/export/all.xlsx`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    await request(server)
      .get(`/api/acp/${acpId}/review/comments/export/all.xlsx`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(403);

    const personalExportRes = await request(server)
      .get(`/api/acp/${acpId}/comments/export`)
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);
    expect(personalExportRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comment: "Shared root updated",
          threadId: rootRes.body.id,
        }),
      ]),
    );
    expect(personalExportRes.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ comment: "Manager reply" }),
      ]),
    );

    const exportRes = await request(server)
      .get(`/api/acp/${acpId}/comments/export`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(exportRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unitId: "U1",
          itemId: "I1",
          threadId: rootRes.body.id,
          parentCommentId: "",
          updatedAt: expect.any(String),
        }),
        expect.objectContaining({
          threadId: rootRes.body.id,
          parentCommentId: rootRes.body.id,
        }),
      ]),
    );

    const legacyDeleteRes = await request(server)
      .delete(`/api/acp/${acpId}/comments`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(legacyDeleteRes.body).toEqual(
      expect.objectContaining({
        deletedCount: 0,
        retainedCount: expect.any(Number),
        scope: "UNRESOLVED_LEGACY_TASK_SEQUENCE",
      }),
    );
    expect(legacyDeleteRes.body.retainedCount).toBeGreaterThanOrEqual(3);

    const threadAfterLegacyDelete = await request(server)
      .get(`/api/acp/${acpId}/review/comments`)
      .query({ unitId: "U1", itemId: "I1" })
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(threadAfterLegacyDelete.body.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rootRes.body.id }),
        expect.objectContaining({ id: replyRes.body.id }),
      ]),
    );

    await request(server)
      .delete(`/api/acp/${acpId}/review/comments/${rootRes.body.id}`)
      .query({ version: 2 })
      .set("Authorization", `Bearer ${credentialToken}`)
      .expect(200);

    const tombstoneThreadRes = await request(server)
      .get(`/api/acp/${acpId}/review/comments`)
      .query({ unitId: "U1", itemId: "U1_I1" })
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(tombstoneThreadRes.body.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: rootRes.body.id,
          commentText: "",
          authorLabel: "Gelöscht",
          isDeleted: true,
        }),
        expect.objectContaining({
          id: replyRes.body.id,
          parentCommentId: rootRes.body.id,
          parentVisible: true,
          isDeleted: false,
        }),
      ]),
    );
  });

  it("covers snapshot restore scenario", async () => {
    const snapshotRes = await request(server)
      .post(`/api/acp/${acpId}/snapshots`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ changelog: "baseline" })
      .expect(201);

    snapshotId = snapshotRes.body.id;

    const modifiedIndex = {
      ...baseIndex,
      assessmentParts: [
        {
          ...baseIndex.assessmentParts[0],
          units: [
            {
              ...baseIndex.assessmentParts[0].units[0],
              name: "Unit 1 changed",
            },
          ],
        },
      ],
    };

    const currentAcp = await acpRepository.findOneByOrFail({ id: acpId });
    await request(server)
      .put(`/api/acp/${acpId}/index`)
      .query({ expectedUpdatedAt: currentAcp.updatedAt.toISOString() })
      .set("Authorization", `Bearer ${authToken}`)
      .send(modifiedIndex)
      .expect(200);

    const changedIndexRes = await request(server)
      .get(`/api/acp/${acpId}/index`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(changedIndexRes.body.assessmentParts[0].units[0].name).toBe(
      "Unit 1 changed",
    );

    await request(server)
      .post(`/api/acp/${acpId}/snapshots/${snapshotId}/restore`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(201);

    const restoredIndexRes = await request(server)
      .get(`/api/acp/${acpId}/index`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(restoredIndexRes.body.assessmentParts[0].units[0].name).toBe(
      "Unit 1",
    );
  });
});
