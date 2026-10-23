import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import * as request from "supertest";
import {
  Acp,
  AcpFile,
  AcpItemRowNumber,
  CommentTargetType,
  AcpAccessConfig,
  AcpUserRole,
  AcpCredential,
  User,
  Comment,
} from "../src/database/entities";
import { CommentCategories1789700000000 } from "../src/database/migrations/1789700000000-CommentCategories";
import { CommentVotes1789500000000 } from "../src/database/migrations/1789500000000-CommentVotes";
import { ReviewVisibilityGroups1789400000000 } from "../src/database/migrations/1789400000000-ReviewVisibilityGroups";
import { ReviewManifestService } from "../src/review/review-manifest.service";
import { ReviewReadinessService } from "../src/review/review-readiness.service";
import { UnitParserService } from "../src/files/unit-parser.service";

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { CommentsService } from "../src/comments/comments.service";
import { ReviewPolicyService } from "../src/comments/review-policy.service";
import { FileCatalogCache } from "../src/files/file-catalog.cache";
import { ItemRowNumberingService } from "../src/files/item-row-numbering.service";
import { ItemListParser } from "../src/files/item-list.parser";
import { NumberedItemListCache } from "../src/files/numbered-item-list.cache";
import { UnitViewResolver } from "../src/files/unit-view.resolver";
import { ItemExplorerStateService } from "../src/item-explorer/item-explorer-state.service";

describe("Review visibility, groups and synchronization API", () => {
  jest.setTimeout(60000);
  let app: INestApplication, db: DataSource, server: any;
  let acpId: string, configId: string, config: any;
  let manager: string;
  const actors: { token: string; id: string; kind: "user" | "credential" }[] =
    [];
  const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
  const api = () => `/api/acp/${acpId}/review/comments`;
  const configApi = () => `/api/view/acp/${acpId}/review/config`;
  const item = { targetType: "ITEM", unitId: "U", itemId: "I" };
  async function saveConfig(changes: any = {}) {
    const response = await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({ ...config, ...changes })
      .expect(200);
    config = response.body;
    return config;
  }
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== "test" ||
      !process.env.DB_DATABASE?.includes("e2e")
    )
      throw new Error("Isolated e2e database required");
    const { AppModule } = await import("../src/app.module");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ReviewManifestService)
      .useValue({
        getManifest: async () => ({
          booklets: [{ id: "B", name: "Booklet", units: [] }],
          units: [{ id: "U", items: [{ id: "I" }] }],
          issues: [],
        }),
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
      .overrideProvider(UnitParserService)
      .useValue({
        getItemListFromFiles: async () => ({
          items: [{ unitId: "U", itemId: "I" }],
          codingSchemes: { U: {} },
        }),
      })
      .compile();
    app = module.createNestApplication();
    app.useLogger(["error"]);
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();
    db = app.get(DataSource);
    // Exercise the actual migration in a separate schema, including pre-existing rows.
    const runner = db.createQueryRunner();
    await runner.connect();
    const schema = `review_migration_${Date.now()}`;
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}"`);
      await runner.query(
        `CREATE TABLE acp_access_configs (acp_id uuid PRIMARY KEY, feature_config jsonb NOT NULL DEFAULT '{}')`,
      );
      await runner.query(
        `CREATE TABLE comments (id uuid PRIMARY KEY, acp_id uuid, comment_text text)`,
      );
      await runner.query(
        `INSERT INTO acp_access_configs VALUES ('10000000-0000-4000-8000-000000000001', '{"enableReview":false,"commentVisibilityMode":"PRIVATE"}')`,
      );
      await runner.query(
        `INSERT INTO comments VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Preserved')`,
      );
      const migration = new ReviewVisibilityGroups1789400000000();
      await migration.up(runner);
      expect(
        (await runner.query(`SELECT comment_text, group_id FROM comments`))[0],
      ).toEqual({ comment_text: "Preserved", group_id: null });
      expect(
        (
          await runner.query(
            `SELECT review_groups, review_config_version, review_revision, feature_config FROM acp_access_configs`,
          )
        )[0],
      ).toMatchObject({
        review_groups: [],
        review_config_version: 1,
        review_revision: "0",
        feature_config: {
          enableReview: false,
          commentVisibilityMode: "PRIVATE",
        },
      });
      await runner.startTransaction();
      await runner.query(`UPDATE comments SET comment_text = 'Rolled back'`);
      expect(
        (
          await runner.query(`SELECT review_revision FROM acp_access_configs`)
        )[0].review_revision,
      ).toBe("1");
      await runner.rollbackTransaction();
      expect(
        (
          await runner.query(`SELECT review_revision FROM acp_access_configs`)
        )[0].review_revision,
      ).toBe("0");
      await migration.down(runner);
      expect(
        (await runner.query(`SELECT comment_text FROM comments`))[0]
          .comment_text,
      ).toBe("Preserved");
    } finally {
      await runner.query(`SET search_path TO public`);
      await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await runner.release();
    }
    const triggerRunner = db.createQueryRunner();
    try {
      await new CommentVotes1789500000000().installTriggers(triggerRunner);
      await new ReviewVisibilityGroups1789400000000().installRevisionTrigger(
        triggerRunner,
      );
    } finally {
      await triggerRunner.release();
    }
    const acp = await db.getRepository(Acp).save({
      packageId: `review-${Date.now()}`,
      name: "Review groups",
      acpIndex: { units: [{ id: "U", items: [{ id: "I" }] }] },
    });
    acpId = acp.id;
    const row = await db.getRepository(AcpAccessConfig).save({
      acpId,
      accessModel: "CREDENTIALS_LIST" as any,
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["BOOKLET", "UNIT", "ITEM", "CODING"],
        commentVisibilityMode: "PRIVATE",
      },
    });
    configId = row.id;
    const jwt = app.get(JwtService);
    for (let i = 0; i < 5; i++) {
      const isCredential = i === 2 || i === 3;
      if (isCredential) {
        const credential = await db.getRepository(AcpCredential).save({
          accessConfigId: configId,
          username: `review-${i}`,
          passwordHash: "unused",
          capabilities: ["review:participate"],
        });
        actors.push({
          id: credential.id,
          kind: "credential",
          token: jwt.sign({
            sub: credential.id,
            username: credential.username,
            type: "credential",
            acpId,
          }),
        });
      } else {
        const user = await db
          .getRepository(User)
          .save({ username: `review-${i}-${Date.now()}`, isAppAdmin: i === 4 });
        await db.getRepository(AcpUserRole).save({
          acpId,
          userId: user.id,
          role: i === 4 ? ("ACP_MANAGER" as any) : ("READ_ONLY" as any),
          capabilities:
            i === 4
              ? ["review:manage", "review:participate"]
              : ["review:participate"],
        });
        actors.push({
          id: user.id,
          kind: "user",
          token: jwt.sign({
            sub: user.id,
            username: user.username,
            type: "oidc",
            authType: "oidc",
          }),
        });
      }
    }
    manager = actors[4].token;
    config = (
      await request(server).get(configApi()).set(headers(manager)).expect(200)
    ).body;
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it("persists developer-name visibility with validation, manager grants and version checks", async () => {
    expect(config.hideReviewDeveloperNames).toBe(false);
    await saveConfig({ hideReviewDeveloperNames: true });
    expect(config.hideReviewDeveloperNames).toBe(true);
    const saved = { ...config };
    for (const actor of actors.slice(0, 4)) {
      await request(server)
        .put(configApi())
        .set(headers(actor.token))
        .send({ ...config, hideReviewDeveloperNames: false })
        .expect(403);
    }
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({ ...config, hideReviewDeveloperNames: "false" })
      .expect(400);
    const { hideReviewDeveloperNames: _hidden, ...legacyConfig } = config;
    await saveConfig({ ...legacyConfig, hideReviewDeveloperNames: undefined });
    expect(config.hideReviewDeveloperNames).toBe(true);
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({ ...saved, hideReviewDeveloperNames: false })
      .expect(409);
    expect(
      (await db.getRepository(AcpAccessConfig).findOneByOrFail({ acpId }))
        .featureConfig.hideReviewDeveloperNames,
    ).toBe(true);
    const start = await request(server)
      .get(`/api/view/acp/${acpId}`)
      .set(headers(manager))
      .expect(200);
    expect(start.body.featureConfig.hideReviewDeveloperNames).toBe(true);
    await saveConfig({ hideReviewDeveloperNames: false });
    expect(config.hideReviewDeveloperNames).toBe(false);
  });

  it("requires confirmation, preserves comments and rejects stale configuration", async () => {
    for (const actor of actors.slice(0, 4))
      await request(server)
        .post(api())
        .set(headers(actor.token))
        .send({ ...item, commentText: `private-${actor.kind}-${actor.id}` })
        .expect(201);
    for (const actor of actors.slice(0, 4)) {
      const snapshot = await request(server)
        .get(api())
        .query(item)
        .set(headers(actor.token))
        .expect(200);
      expect(snapshot.body.comments).toHaveLength(1);
    }
    const before = await db.getRepository(Comment).find({ where: { acpId } });
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({ ...config, visibilityMode: "SHARED" })
      .expect(400);
    const stale = { ...config };
    await saveConfig({
      visibilityMode: "SHARED",
      confirmExistingComments: true,
    });
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send(stale)
      .expect(409);
    for (const actor of actors.slice(0, 4))
      expect(
        (
          await request(server)
            .get(api())
            .query(item)
            .set(headers(actor.token))
            .expect(200)
        ).body.comments,
      ).toHaveLength(4);
    expect(await db.getRepository(Comment).find({ where: { acpId } })).toEqual(
      before,
    );
    await saveConfig({ visibilityMode: "PRIVATE" });
  });

  it("creates ACP-specific groups independently of grants", async () => {
    await saveConfig({
      visibilityMode: "GROUP",
      groups: [
        {
          name: "A",
          archived: false,
          members: [actors[0], actors[2]].map(({ id, kind }) => ({ id, kind })),
        },
        {
          name: "B",
          archived: false,
          members: [actors[1], actors[3]].map(({ id, kind }) => ({ id, kind })),
        },
      ],
    });
    for (const actor of actors.slice(0, 4)) {
      await request(server)
        .get(configApi())
        .set(headers(actor.token))
        .expect(403);
      await request(server)
        .put(configApi())
        .set(headers(actor.token))
        .send(config)
        .expect(403);
    }
  });

  it("cannot bypass sharing confirmation through general ACP feature settings", async () => {
    const current = await request(server)
      .get(`/api/acp/${acpId}/access`)
      .set(headers(manager))
      .expect(200);
    expect(current.body).not.toHaveProperty("reviewRevision");
    expect(current.body).not.toHaveProperty("reviewGroups");
    const result = await request(server)
      .put(`/api/acp/${acpId}/access`)
      .set(headers(manager))
      .send({
        accessModel: "CREDENTIALS_LIST",
        allowRegistered: false,
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        featureConfig: {
          ...current.body.featureConfig,
          commentVisibilityMode: "SHARED",
          enableReview: false,
          ungroupedVisibilityMode: "SHARED",
        },
      })
      .expect(200);
    expect(result.body.featureConfig).toMatchObject({
      commentVisibilityMode: "GROUP",
      enableReview: true,
      ungroupedVisibilityMode: "PRIVATE",
    });
    const memberList = await request(server)
      .get(`/api/view/acp/${acpId}/review/members`)
      .set(headers(manager))
      .expect(200);
    expect(memberList.body).toHaveLength(5);
    expect(JSON.stringify(memberList.body)).not.toContain("passwordHash");
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        request(server).put(configApi()).set(headers(manager)).send(config),
      ),
    );
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    config = concurrent.find((response) => response.status === 200)!.body;
  });

  for (const target of [
    item,
    { targetType: "UNIT", unitId: "U" },
    { targetType: "BOOKLET", bookletId: "B" },
    { targetType: "CODING", unitId: "U", itemId: "I" },
  ]) {
    it(`isolates ${target.targetType} contents, mutations, replies, counts and revisions for users and credentials`, async () => {
      const root = (
        await request(server)
          .post(api())
          .set(headers(actors[0].token))
          .send({ ...target, commentText: `A-${target.targetType}` })
          .expect(201)
      ).body;
      expect(root.groupId).toBe(config.groups[0].id);
      const aSnapshot = await request(server)
        .get(api())
        .query(target)
        .set(headers(actors[2].token))
        .expect(200);
      expect(
        aSnapshot.body.comments.some((entry: any) => entry.id === root.id),
      ).toBe(true);
      const counts = await request(server)
        .get(`${api()}/counts`)
        .set(headers(actors[0].token))
        .expect(200);
      const foreign = (
        await request(server)
          .post(api())
          .set(headers(actors[1].token))
          .send({ ...target, commentText: `B-secret-${target.targetType}` })
          .expect(201)
      ).body;
      await request(server)
        .get(api())
        .query(target)
        .set(headers(actors[2].token))
        .set("If-None-Match", aSnapshot.headers.etag)
        .expect(304);
      expect(
        (
          await request(server)
            .get(`${api()}/counts`)
            .set(headers(actors[0].token))
            .expect(200)
        ).body,
      ).toEqual(counts.body);
      for (const actor of [actors[0], actors[2]]) {
        const snapshot = await request(server)
          .get(api())
          .query(target)
          .set(headers(actor.token))
          .expect(200);
        expect(JSON.stringify(snapshot.body)).not.toContain(foreign.id);
        expect(JSON.stringify(snapshot.body)).not.toContain("B-secret");
        expect(JSON.stringify(snapshot.body)).not.toContain(
          config.groups[1].id,
        );
        await request(server)
          .post(api())
          .set(headers(actor.token))
          .send({
            ...target,
            parentCommentId: foreign.id,
            commentText: "hidden",
          })
          .expect(404);
        await request(server)
          .patch(`${api()}/${foreign.id}`)
          .set(headers(actor.token))
          .send({ commentText: "hidden", version: 1 })
          .expect(404);
        await request(server)
          .delete(`${api()}/${foreign.id}?version=1`)
          .set(headers(actor.token))
          .expect(404);
      }
      const reply = (
        await request(server)
          .post(api())
          .set(headers(actors[2].token))
          .send({ ...target, parentCommentId: root.id, commentText: "A reply" })
          .expect(201)
      ).body;
      expect(reply.groupId).toBe(root.groupId);
      await request(server)
        .post(api())
        .set(headers(manager))
        .send({
          ...target,
          parentCommentId: root.id,
          groupId: foreign.groupId,
          commentText: "wrong scope",
        })
        .expect(400);
      await request(server)
        .patch(`${api()}/${root.id}`)
        .set(headers(actors[2].token))
        .send({ commentText: "foreign edit", version: 1 })
        .expect(403);
      await request(server)
        .patch(`${api()}/${root.id}`)
        .set(headers(actors[0].token))
        .send({ commentText: "A changed", version: 1 })
        .expect(200);
      await request(server)
        .patch(`${api()}/${root.id}`)
        .set(headers(actors[0].token))
        .send({ commentText: "stale", version: 1 })
        .expect(409);
      await request(server)
        .delete(`${api()}/${reply.id}?version=1`)
        .set(headers(actors[2].token))
        .expect(200);
      expect(
        (
          await request(server)
            .get(api())
            .query(target)
            .set(headers(manager))
            .expect(200)
        ).body.comments.some((entry: any) => entry.id === foreign.id),
      ).toBe(true);
    });
  }

  it("filters visible exports and old own endpoints after membership changes", async () => {
    const ExcelJS = await import("exceljs");
    const readExport = async (token: string, path: string) => {
      const result = await request(server)
        .get(path)
        .set(headers(token))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(result.body);
      return JSON.stringify(workbook.worksheets[0].getSheetValues());
    };
    const participant = await readExport(
      actors[0].token,
      `${api()}/export/visible.xlsx`,
    );
    expect(participant).toContain(config.groups[0].id);
    expect(participant).not.toContain("B-secret");
    const all = await readExport(manager, `${api()}/export/all.xlsx`);
    expect(all).toContain(config.groups[0].id);
    expect(all).toContain(config.groups[1].id);
    expect(all).toContain("B-secret");
    const before = await db.getRepository(Comment).find({ where: { acpId } });
    await saveConfig({
      groups: config.groups.map((group: any, index: number) => ({
        ...group,
        members:
          index === 0 ? [] : [...group.members, ...config.groups[0].members],
      })),
    });
    for (const actor of [actors[0], actors[2]]) {
      const own = (
        await request(server)
          .get(`/api/acp/${acpId}/comments/mine`)
          .set(headers(actor.token))
          .expect(200)
      ).body;
      expect(
        own.every(
          (comment: any) =>
            !comment.groupId || comment.groupId === config.groups[1].id,
        ),
      ).toBe(true);
      for (const old of before.filter(
        (comment) => comment.groupId === config.groups[0].id,
      ))
        await request(server)
          .patch(`${api()}/${old.id}`)
          .set(headers(actor.token))
          .send({ commentText: "old", version: old.version })
          .expect(404);
      expect(
        await readExport(actor.token, `${api()}/export/mine.xlsx`),
      ).not.toContain(config.groups[0].id);
    }
    expect(await db.getRepository(Comment).find({ where: { acpId } })).toEqual(
      before,
    );
    const runner = db.createQueryRunner();
    try {
      await expect(
        new ReviewVisibilityGroups1789400000000().down(runner),
      ).rejects.toThrow("rollback would lose visibility boundaries");
    } finally {
      await runner.release();
    }
  });

  it("requires an explicit manager group and handles multiple memberships and archive", async () => {
    await request(server)
      .post(api())
      .set(headers(manager))
      .send({ ...item, commentText: "ambiguous" })
      .expect(400);
    await saveConfig({
      groups: config.groups.map((group: any) => ({
        ...group,
        members: [...group.members, { kind: actors[0].kind, id: actors[0].id }],
      })),
    });
    await request(server)
      .post(api())
      .set(headers(actors[0].token))
      .send({ ...item, commentText: "ambiguous" })
      .expect(400);
    await request(server)
      .post(api())
      .set(headers(actors[0].token))
      .send({ ...item, groupId: config.groups[0].id, commentText: "selected" })
      .expect(201);
    await saveConfig({
      groups: config.groups.map((group: any, index: number) => ({
        ...group,
        archived: index === 0,
      })),
    });
    await request(server)
      .post(api())
      .set(headers(actors[0].token))
      .send({ ...item, groupId: config.groups[0].id, commentText: "archived" })
      .expect(400);
    const visible = (
      await request(server)
        .get(api())
        .query(item)
        .set(headers(actors[0].token))
        .expect(200)
    ).body;
    expect(
      visible.comments.every(
        (comment: any) => comment.groupId !== config.groups[0].id,
      ),
    ).toBe(true);
    expect(visible.groups).toHaveLength(1);
  });

  it("retains item comments when the booklet review is disabled and persists revisions", async () => {
    expect(
      Number(
        (
          await db
            .getRepository(AcpAccessConfig)
            .findOneByOrFail({ id: configId })
        ).reviewRevision,
      ),
    ).toBeGreaterThan(10);
    await saveConfig({ enableReview: false });
    for (const actor of actors.slice(0, 4)) {
      await request(server)
        .get(api())
        .query(item)
        .set(headers(actor.token))
        .expect(200);
      await request(server)
        .get(`${api()}/visible`)
        .set(headers(actor.token))
        .expect(200);
      await request(server)
        .get(`${api()}/export/mine.csv`)
        .set(headers(actor.token))
        .expect(200);
    }
    await request(server)
      .get(`/api/view/acp/${acpId}/review`)
      .set(headers(actors[0].token))
      .expect(403);
    await request(server)
      .get(api())
      .query(item)
      .set(headers(manager))
      .expect(200);
    await request(server)
      .get(`/api/view/acp/${acpId}/review`)
      .set(headers(manager))
      .expect(200);
  });
  it("supports concurrent votes, stable identities, ETags and mode boundaries", async () => {
    await saveConfig({
      enableReview: true,
      visibilityMode: "SHARED",
      confirmExistingComments: true,
    });
    const owner = actors[0],
      voter = actors[1],
      credential = actors[2];
    const created = await request(server)
      .post(api())
      .set(headers(owner.token))
      .send({ ...item, commentText: "Vote target" })
      .expect(201);
    const id = created.body.id;
    const voteApi = `${api()}/${id}/vote`;
    const thread = (token: string) =>
      request(server).get(api()).query(item).set(headers(token));
    const before = await thread(voter.token).expect(200);
    await request(server)
      .put(voteApi)
      .set(headers(owner.token))
      .send({ value: "UP" })
      .expect(403);
    await request(server)
      .put(voteApi)
      .set(headers(voter.token))
      .send({ value: "INVALID" })
      .expect(400);
    await request(server)
      .put(`${api()}/10000000-0000-4000-8000-000000000001/vote`)
      .set(headers(voter.token))
      .send({ value: "UP" })
      .expect(404);
    const otherAcp = await db
      .getRepository(Acp)
      .save({ packageId: `vote-other-${Date.now()}`, name: "Other" });
    const foreign = await db.getRepository(Comment).save({
      acpId: otherAcp.id,
      targetType: "ITEM" as any,
      targetId: "I",
      commentText: "Other ACP",
    });
    await request(server)
      .put(`${api()}/${foreign.id}/vote`)
      .set(headers(voter.token))
      .send({ value: "UP" })
      .expect(404);
    const revisions = async () =>
      (
        await db.query(
          `SELECT review_revision FROM acp_access_configs WHERE acp_id = $1`,
          [acpId],
        )
      )[0].review_revision;
    const revisionBefore = await revisions();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        request(server)
          .put(voteApi)
          .set(headers(voter.token))
          .send({ value: "UP" })
          .expect(200),
      ),
    );
    expect(Number(await revisions()) - Number(revisionBefore)).toBe(1);
    await request(server)
      .put(voteApi)
      .set(headers(credential.token))
      .send({ value: "DOWN" })
      .expect(200);
    const after = await thread(voter.token)
      .set("If-None-Match", before.headers.etag)
      .expect(200);
    expect(after.body.comments.find((c: any) => c.id === id)).toMatchObject({
      upvotes: 1,
      downvotes: 1,
      myVote: "UP",
      canVote: true,
    });
    await thread(voter.token)
      .set("If-None-Match", after.headers.etag)
      .expect(304);
    expect(
      (await thread(owner.token)).body.comments.find((c: any) => c.id === id),
    ).toMatchObject({ canVote: false, upvotes: 1 });
    await request(server)
      .put(voteApi)
      .set(headers(voter.token))
      .send({ value: "DOWN" })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          upvotes: 0,
          downvotes: 2,
          myVote: "DOWN",
        }),
      );
    await request(server).delete(voteApi).set(headers(voter.token)).expect(200);
    const removedRevision = await revisions();
    await request(server).delete(voteApi).set(headers(voter.token)).expect(200);
    expect(await revisions()).toBe(removedRevision);
    expect(
      (await thread(credential.token)).body.comments.find(
        (c: any) => c.id === id,
      ),
    ).toMatchObject({ upvotes: 0, downvotes: 1, myVote: "DOWN" });
    await db
      .getRepository(AcpCredential)
      .update(credential.id, { username: "renamed-voter" });
    expect(
      (await thread(credential.token)).body.comments.find(
        (c: any) => c.id === id,
      ).myVote,
    ).toBe("DOWN");
    await db
      .getRepository(AcpUserRole)
      .update({ acpId, userId: voter.id }, { capabilities: ["review:manage"] });
    await request(server)
      .put(voteApi)
      .set(headers(voter.token))
      .send({ value: "UP" })
      .expect(403);
    expect(
      (await thread(voter.token)).body.comments.find((c: any) => c.id === id)
        .canVote,
    ).toBe(false);
    await db
      .getRepository(AcpUserRole)
      .update(
        { acpId, userId: voter.id },
        { capabilities: ["review:participate"] },
      );
    await saveConfig({ visibilityMode: "PRIVATE" });
    await request(server)
      .put(voteApi)
      .set(headers(voter.token))
      .send({ value: "UP" })
      .expect(404);
    expect(
      (await thread(voter.token)).body.comments.some((c: any) => c.id === id),
    ).toBe(false);
    expect(
      (await thread(owner.token)).body.comments.find((c: any) => c.id === id),
    ).toMatchObject({ upvotes: 0, downvotes: 0, myVote: null, canVote: false });
    await saveConfig({
      visibilityMode: "SHARED",
      confirmExistingComments: true,
    });
    await saveConfig({ visibilityMode: "GROUP" });
    await request(server)
      .put(voteApi)
      .set(headers(voter.token))
      .send({ value: "UP" })
      .expect(403);
    await request(server)
      .delete(voteApi)
      .set(headers(credential.token))
      .expect(403);
    expect(
      (await thread(credential.token)).body.comments.find(
        (c: any) => c.id === id,
      ),
    ).toMatchObject({ downvotes: 0, myVote: null, canVote: false });
    await saveConfig({
      visibilityMode: "SHARED",
      confirmExistingComments: true,
      enableReview: false,
    });
    await request(server)
      .put(voteApi)
      .set(headers(manager))
      .send({ value: "UP" })
      .expect(403);
    await saveConfig({ enableReview: true });
    expect(
      (await thread(credential.token)).body.comments.find(
        (c: any) => c.id === id,
      ).downvotes,
    ).toBe(1);
    await request(server)
      .delete(`${api()}/${id}`)
      .query({ version: 1 })
      .set(headers(owner.token))
      .expect(200);
    expect(
      await db.query(`SELECT * FROM comment_votes WHERE comment_id = $1`, [id]),
    ).toHaveLength(0);
    await request(server)
      .put(voteApi)
      .set(headers(voter.token))
      .send({ value: "UP" })
      .expect(404);
  });

  it.each([
    { targetType: "ITEM", unitId: "U", itemId: "I" },
    { targetType: "CODING", unitId: "U", itemId: "I" },
    { targetType: "UNIT", unitId: "U" },
    { targetType: "BOOKLET", bookletId: "B" },
  ])(
    "applies voting to $targetType roots and replies with target feature checks",
    async (target) => {
      await saveConfig({
        enableReview: true,
        visibilityMode: "SHARED",
        confirmExistingComments: true,
      });
      const root = (
        await request(server)
          .post(api())
          .set(headers(actors[0].token))
          .send({ ...target, commentText: "Root" })
          .expect(201)
      ).body;
      const reply = (
        await request(server)
          .post(api())
          .set(headers(actors[0].token))
          .send({ ...target, parentCommentId: root.id, commentText: "Reply" })
          .expect(201)
      ).body;
      for (const comment of [root, reply]) {
        await Promise.all(
          [actors[1], actors[2]].map((actor) =>
            request(server)
              .put(`${api()}/${comment.id}/vote`)
              .set(headers(actor.token))
              .send({ value: "UP" })
              .expect(200),
          ),
        );
      }
      const snapshot = (
        await request(server)
          .get(api())
          .query(target)
          .set(headers(actors[1].token))
          .expect(200)
      ).body;
      for (const comment of [root, reply]) {
        expect(
          snapshot.comments.find((c: any) => c.id === comment.id),
        ).toMatchObject({
          upvotes: 2,
          downvotes: 0,
          myVote: "UP",
          canVote: true,
        });
      }
      const overview = (
        await request(server)
          .get(`${api()}/visible`)
          .set(headers(actors[1].token))
          .expect(200)
      ).body;
      expect(overview.find((c: any) => c.id === root.id)).toMatchObject({
        upvotes: 2,
        myVote: "UP",
        canVote: true,
      });
      await request(server)
        .patch(`${api()}/${root.id}`)
        .set(headers(actors[0].token))
        .send({ commentText: "Edited root", version: 1 })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({ upvotes: 2, canVote: false }),
        );
      await request(server)
        .patch(`${api()}/${root.id}`)
        .set(headers(actors[0].token))
        .send({ commentText: "Stale edit", version: 1 })
        .expect(409)
        .expect(({ body }) =>
          expect(body.current).toMatchObject({ upvotes: 2, canVote: false }),
        );
      const row = await db
        .getRepository(AcpAccessConfig)
        .findOneByOrFail({ acpId });
      await db.getRepository(AcpAccessConfig).update(
        { acpId },
        {
          featureConfig: {
            ...row.featureConfig,
            commentTargets: ["ITEM", "UNIT", "BOOKLET", "CODING"].filter(
              (t) => t !== target.targetType,
            ),
          },
        },
      );
      await request(server)
        .put(`${api()}/${root.id}/vote`)
        .set(headers(manager))
        .send({ value: "UP" })
        .expect(403);
      await db.getRepository(AcpAccessConfig).save(row);
    },
  );

  it.each([1, 2, 10])(
    "completes concurrent real catalog reads and votes with a pool of %i",
    async (poolSize) => {
      if (db.options.type !== "postgres")
        throw new Error("PostgreSQL required");
      const limited = new DataSource({
        ...db.options,
        synchronize: false,
        migrationsRun: false,
        poolSize,
        extra: { max: poolSize, connectionTimeoutMillis: 1500 },
      });
      await limited.initialize();
      const directory = await mkdtemp(join(tmpdir(), "review-pool-"));
      try {
        const acp = await limited.getRepository(Acp).save({
          packageId: `pool-${poolSize}-${Date.now()}`,
          name: "Real catalog",
          acpIndex: { units: [{ id: "U", items: [{ id: "I" }] }] },
        });
        await limited.getRepository(AcpAccessConfig).save({
          acpId: acp.id,
          accessModel: "REGISTERED" as any,
          featureConfig: {
            enableReview: true,
            enableCommenting: true,
            commentVisibilityMode: "SHARED",
            commentTargets: ["UNIT", "ITEM", "CODING"],
          },
        });
        const files = {
          "U.xml":
            "<Unit><Id>U</Id><Reference>U.vomd</Reference><CodingSchemeRef>U.vocs</CodingSchemeRef></Unit>",
          "U.vomd": JSON.stringify({
            profiles: [],
            items: [{ id: "I", variableId: "I", profiles: [] }],
          }),
          "U.vocs": "{}",
        };
        for (const [originalName, content] of Object.entries(files)) {
          const filePath = join(directory, originalName);
          await writeFile(filePath, content);
          await limited.getRepository(AcpFile).save({
            acpId: acp.id,
            originalName,
            filePath,
            fileSize: content.length,
          });
        }
        // All sources are real services. Their default repositories use the same
        // constrained pool, so any escaped transaction query fails this test.
        const catalog = new FileCatalogCache(limited.getRepository(AcpFile));
        const parser = new UnitParserService(
          limited.getRepository(AcpFile),
          limited.getRepository(Acp),
          limited.getRepository(AcpAccessConfig),
          new ItemRowNumberingService(limited.getRepository(AcpItemRowNumber)),
          app.get(ItemExplorerStateService),
          catalog,
          new ItemListParser(),
          new NumberedItemListCache(),
          app.get(UnitViewResolver),
        );
        const service = new CommentsService(
          limited.getRepository(Comment),
          new ReviewPolicyService(limited.getRepository(AcpAccessConfig)),
          parser,
          catalog,
          limited.getRepository(Acp),
          new ReviewManifestService(
            limited.getRepository(Acp),
            limited.getRepository(AcpFile),
          ),
        );
        const actor = () => ({
          userId: actors[1].id,
          authorLabel: "Voter",
          isManager: false,
          canParticipate: true,
        });
        for (const targetType of [
          CommentTargetType.UNIT,
          CommentTargetType.ITEM,
          CommentTargetType.CODING,
        ]) {
          const target = {
            targetType,
            unitId: "U",
            ...(targetType !== CommentTargetType.UNIT ? { itemId: "I" } : {}),
          };
          const results = await Promise.all(
            Array.from({ length: Math.max(2, poolSize) }, () =>
              service.getReviewThread(acp.id, target, actor()),
            ),
          );
          expect(
            results.every((result) => result.target.targetType === targetType),
          ).toBe(true);
          const comment = await service.createReviewComment(
            acp.id,
            { ...target, commentText: "Root" },
            {
              userId: actors[0].id,
              authorLabel: "Owner",
              isManager: false,
              canParticipate: true,
            },
          );
          const states = await Promise.all(
            Array.from({ length: Math.max(2, poolSize) }, () =>
              service.setVote(acp.id, comment.id, "UP", actor()),
            ),
          );
          expect(
            states.every(
              (state) => state.upvotes === 1 && state.myVote === "UP",
            ),
          ).toBe(true);
        }
        // Review reads and votes must never create persistent row numbers.
        expect(
          await limited
            .getRepository(AcpItemRowNumber)
            .count({ where: { acpId: acp.id } }),
        ).toBe(0);
        if (poolSize === 2) {
          // Hold the ACP lock taken by Explorer publication. A review must still
          // finish while holding its configuration lock, even with no row numbers.
          const publishing = limited.createQueryRunner();
          await publishing.connect();
          await publishing.startTransaction();
          let reading: Promise<unknown> | undefined;
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try {
            await publishing.manager.findOne(Acp, {
              where: { id: acp.id },
              lock: { mode: "pessimistic_write" },
            });
            reading = service.getReviewThread(
              acp.id,
              { targetType: CommentTargetType.ITEM, unitId: "U", itemId: "I" },
              actor(),
            );
            await Promise.race([
              reading,
              new Promise((_, reject) => {
                deadline = setTimeout(
                  () => reject(new Error("Review waits for Explorer ACP lock")),
                  2000,
                );
              }),
            ]);
            await (
              app.get(ItemExplorerStateService) as any
            ).applyPublishedStateToDomain(
              acp.id,
              {
                itemProperties: { I: { note: "Published concurrently" } },
                metadataColumns: {
                  configured: true,
                  visible: ["note"],
                  order: ["note"],
                  widths: {},
                },
              },
              {
                acpRepository: publishing.manager.getRepository(Acp),
                accessConfigRepository:
                  publishing.manager.getRepository(AcpAccessConfig),
              },
            );
            await publishing.commitTransaction();
            expect(
              (await limited.getRepository(Acp).findOneByOrFail({ id: acp.id }))
                .itemProperties,
            ).toEqual({ I: { note: "Published concurrently" } });
          } finally {
            if (deadline) clearTimeout(deadline);
            if (publishing.isTransactionActive)
              await publishing.rollbackTransaction();
            await publishing.release();
            await reading?.catch(() => undefined);
          }
        }
        // The normal Explorer parser still persists missing numbers. Review
        // queries then reuse those numbers without changing them.
        await parser.getItemListFromFiles(acp.id);
        const persisted = await limited
          .getRepository(AcpItemRowNumber)
          .find({ where: { acpId: acp.id } });
        expect(persisted.length).toBeGreaterThan(0);
        await service.getReviewThread(
          acp.id,
          { targetType: CommentTargetType.ITEM, unitId: "U", itemId: "I" },
          actor(),
        );
        expect(
          await limited
            .getRepository(AcpItemRowNumber)
            .find({ where: { acpId: acp.id } }),
        ).toEqual(persisted);
      } finally {
        await limited.destroy();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("migrates votes with constraints, transactional revisions and loss-safe rollback", async () => {
    const q = db.createQueryRunner();
    await q.connect();
    const schema = `vote_migration_${Date.now()}`;
    const acp = "10000000-0000-4000-8000-000000000001",
      comment = "10000000-0000-4000-8000-000000000002";
    try {
      await q.query(`CREATE SCHEMA "${schema}"`);
      await q.query(`SET search_path TO "${schema}"`);
      await q.query(
        `CREATE TABLE acp_access_configs (acp_id uuid PRIMARY KEY, review_revision bigint NOT NULL DEFAULT 0)`,
      );
      await q.query(
        `CREATE TABLE comments (id uuid PRIMARY KEY, acp_id uuid, deleted_at timestamptz)`,
      );
      await q.query(`INSERT INTO acp_access_configs(acp_id) VALUES ($1)`, [
        acp,
      ]);
      await q.query(`INSERT INTO comments(id, acp_id) VALUES ($1, $2)`, [
        comment,
        acp,
      ]);
      const migration = new CommentVotes1789500000000();
      await migration.up(q);
      const insert = `INSERT INTO comment_votes(comment_id, user_id, value) VALUES ($1, $2, 'UP')`;
      await q.startTransaction();
      await q.query(insert, [comment, acp]);
      expect(
        (await q.query(`SELECT review_revision FROM acp_access_configs`))[0]
          .review_revision,
      ).toBe("1");
      await q.rollbackTransaction();
      expect(await q.query(`SELECT * FROM comment_votes`)).toHaveLength(0);
      expect(
        (await q.query(`SELECT review_revision FROM acp_access_configs`))[0]
          .review_revision,
      ).toBe("0");
      await expect(q.query(insert, [comment, null])).rejects.toThrow();
      await q.query(insert, [comment, acp]);
      await expect(q.query(insert, [comment, acp])).rejects.toThrow();
      await expect(
        q.query(`UPDATE comment_votes SET credential_id = $1`, [acp]),
      ).rejects.toThrow();
      await expect(
        q.query(`UPDATE comment_votes SET value = 'INVALID'`),
      ).rejects.toThrow();
      await expect(migration.down(q)).rejects.toThrow("Votes exist");
      await q.query(`DELETE FROM comments`);
      expect(await q.query(`SELECT * FROM comment_votes`)).toHaveLength(0);
      await migration.down(q);
    } finally {
      await q.query(`SET search_path TO public`);
      await q.query(`DROP SCHEMA "${schema}" CASCADE`);
      await q.release();
    }
  });
  it("persists categories across rename, archival, filtering and all export formats", async () => {
    await saveConfig({
      enableReview: true,
      visibilityMode: "SHARED",
      confirmExistingComments: true,
      categories: [
        { name: " Fachlich ", archived: false },
        { name: "Redaktion", archived: false },
      ],
    });
    const category = config.categories[0];
    expect(category).toMatchObject({ name: "Fachlich", archived: false });
    expect(category.id).toEqual(expect.any(String));
    for (const actor of actors.slice(0, 4)) {
      await request(server)
        .put(configApi())
        .set(headers(actor.token))
        .send({ ...config, categories: [] })
        .expect(403);
    }
    const badCategory = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    for (const categoryId of [badCategory, "", 23]) {
      await request(server)
        .post(api())
        .set(headers(manager))
        .send({ ...item, commentText: "Invalid", categoryId })
        .expect(400);
    }
    const roots = [];
    for (const target of [
      item,
      { targetType: "UNIT", unitId: "U" },
      { targetType: "BOOKLET", bookletId: "B" },
      { ...item, targetType: "CODING" },
    ]) {
      const root = await request(server)
        .post(api())
        .set(headers(manager))
        .send({
          ...target,
          commentText: `Categorized ${target.targetType}`,
          categoryId: category.id,
        })
        .expect(201);
      expect(root.body).toMatchObject({
        categoryId: category.id,
        categoryName: "Fachlich",
      });
      roots.push(root.body);
    }
    const root = roots[0];
    const reply = await request(server)
      .post(api())
      .set(headers(actors[2].token))
      .send({
        ...item,
        parentCommentId: root.id,
        commentText: "Independent reply",
        categoryId: config.categories[1].id,
      })
      .expect(201);
    expect(reply.body.categoryId).toBe(config.categories[1].id);
    const uncategorized = await request(server)
      .post(api())
      .set(headers(manager))
      .send({ ...item, commentText: "No category" })
      .expect(201);
    expect(uncategorized.body.categoryId).toBeNull();
    const before = await request(server)
      .get(api())
      .query(item)
      .set(headers(manager))
      .expect(200);
    const staleConfig = { ...config };
    const renamed = '=SUM(A1;A2) "Fachlich"';
    await saveConfig({
      categories: config.categories.map((entry: any) =>
        entry.id === category.id
          ? { ...entry, name: renamed, archived: true }
          : entry,
      ),
    });
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send(staleConfig)
      .expect(409);
    const after = await request(server)
      .get(api())
      .query(item)
      .set(headers(manager))
      .set("If-None-Match", before.headers.etag)
      .expect(200);
    expect(after.body.revision).not.toBe(before.body.revision);
    expect(
      after.body.comments.find((entry: any) => entry.id === root.id),
    ).toMatchObject({ categoryId: category.id, categoryName: renamed });
    expect(after.body.categories).toContainEqual({
      ...category,
      name: renamed,
      archived: true,
    });
    await request(server)
      .post(api())
      .set(headers(manager))
      .send({ ...item, commentText: "Archived", categoryId: category.id })
      .expect(400);
    await request(server)
      .patch(`${api()}/${uncategorized.body.id}`)
      .set(headers(manager))
      .send({
        commentText: "New assignment",
        version: 1,
        categoryId: category.id,
      })
      .expect(400);
    await request(server)
      .patch(`${api()}/${root.id}`)
      .set(headers(actors[2].token))
      .send({ commentText: "Not mine", version: 1, categoryId: null })
      .expect(403);
    await request(server)
      .patch(`${api()}/${root.id}`)
      .set(headers(manager))
      .send({
        commentText: "Retain archived",
        version: 1,
        categoryId: category.id,
      })
      .expect(200);
    await request(server)
      .patch(`${api()}/${root.id}`)
      .set(headers(manager))
      .send({ commentText: "Legacy client retains category", version: 2 })
      .expect(200)
      .expect(({ body }) => expect(body.categoryId).toBe(category.id));
    const csv = await request(server)
      .get(`${api()}/export/mine.csv`)
      .query({ categoryId: category.id })
      .set(headers(manager))
      .expect(200);
    expect(csv.text).toContain('"Kategorie"');
    expect(csv.text).toContain("'=SUM(A1;A2)");
    expect(csv.text).not.toContain("No category");
    const ExcelJS = await import("exceljs");
    for (const scope of ["mine", "visible", "all"]) {
      const xlsx = await request(server)
        .get(`${api()}/export/${scope}.xlsx`)
        .set(headers(manager))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(xlsx.body);
      const sheet = workbook.worksheets[0];
      const exportHeaders = sheet.getRow(1).values as string[];
      const column = exportHeaders.indexOf("Kategorie");
      expect(column).toBeGreaterThan(0);
      expect(sheet.getColumn(column).values).toContain(renamed);
    }
    const uncategorizedCsv = await request(server)
      .get(`${api()}/export/mine.csv`)
      .query({ categoryId: "uncategorized" })
      .set(headers(manager))
      .expect(200);
    expect(uncategorizedCsv.text).toContain("No category");
    expect(uncategorizedCsv.text).not.toContain("Categorized");
    await request(server)
      .patch(`${api()}/${root.id}`)
      .set(headers(manager))
      .send({ commentText: "Clear category", version: 3, categoryId: null })
      .expect(200)
      .expect(({ body }) => expect(body.categoryId).toBeNull());
    await request(server)
      .patch(`${api()}/${root.id}`)
      .set(headers(manager))
      .send({ commentText: "Stale clear", version: 3, categoryId: null })
      .expect(409);
    // Include deleted comments when checking whether a category is in use.
    await request(server)
      .delete(`${api()}/${reply.body.id}`)
      .query({ version: 1 })
      .set(headers(actors[2].token))
      .expect(200);
    for (const id of config.categories.map((entry: any) => entry.id)) {
      await request(server)
        .put(configApi())
        .set(headers(manager))
        .send({
          ...config,
          categories: config.categories.filter((entry: any) => entry.id !== id),
          deletedCategoryIds: [id],
        })
        .expect(400);
    }
    await saveConfig({
      categories: [...config.categories, { name: "Unused", archived: false }],
    });
    const unused = config.categories.at(-1).id;
    await saveConfig({
      categories: config.categories.filter((entry: any) => entry.id !== unused),
      deletedCategoryIds: [unused],
    });
    const legacy = { ...config };
    delete legacy.categories;
    await saveConfig({ ...legacy, categories: undefined });
    expect(config.categories).toHaveLength(2);
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({
        ...config,
        categories: [
          ...config.categories,
          { name: "redaktion", archived: false },
        ],
      })
      .expect(400);
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({
        ...config,
        categories: [{ id: badCategory, name: "Foreign", archived: false }],
      })
      .expect(400);
    await request(server)
      .put(configApi())
      .set(headers(manager))
      .send({ ...config, categories: [{ name: " ", archived: false }] })
      .expect(400);
  });

  it("migrates existing comments without category assignment and protects rollback", async () => {
    const q = db.createQueryRunner();
    const schema = `category_migration_${Date.now()}`;
    try {
      await q.query(`CREATE SCHEMA "${schema}"`);
      await q.query(`SET search_path TO "${schema}"`);
      await q.query(`CREATE TABLE acp_access_configs (id uuid PRIMARY KEY)`);
      await q.query(`CREATE TABLE comments (comment_text text)`);
      await q.query(`INSERT INTO comments VALUES ('Preserved')`);
      const migration = new CommentCategories1789700000000();
      await migration.up(q);
      expect(await q.query(`SELECT * FROM comments`)).toEqual([
        { comment_text: "Preserved", category_id: null },
      ]);
      await q.query(
        `INSERT INTO acp_access_configs VALUES (gen_random_uuid(), '[{"id":"category","name":"Existing","archived":false}]')`,
      );
      await expect(migration.down(q)).rejects.toThrow(
        "rollback would lose review data",
      );
      await q.query(`UPDATE acp_access_configs SET comment_categories = '[]'`);
      await migration.down(q);
      expect(await q.query(`SELECT * FROM comments`)).toEqual([
        { comment_text: "Preserved" },
      ]);
    } finally {
      await q.query(`SET search_path TO public`);
      await q.query(`DROP SCHEMA "${schema}" CASCADE`);
      await q.release();
    }
  });
});
