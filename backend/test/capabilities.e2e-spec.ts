import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import * as request from "supertest";
import {
  Acp,
  AcpAccessConfig,
  AcpUserRole,
  AcpCredential,
  User,
} from "../src/database/entities";
import { ACP_CAPABILITIES } from "../src/auth/capabilities/acp-capabilities";
import { AcpCapabilityGrants1789200000000 } from "../src/database/migrations/1789200000000-AcpCapabilityGrants";

describe("Capability and import API integration", () => {
  jest.setTimeout(60000);
  let app: INestApplication, db: DataSource, server: any;
  let acpId: string, configId: string, userId: string, credentialId: string;
  let adminToken: string, userToken: string, credentialToken: string;
  const password = "StrongPassword123!";
  beforeAll(async () => {
    const { AppModule } = await import("../src/app.module");
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
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
    const users = db.getRepository(User);
    const admin = await users.save(
      users.create({ username: "cap-admin-" + Date.now(), isAppAdmin: true }),
    );
    const user = await users.save(
      users.create({ username: "cap-user-" + Date.now() }),
    );
    userId = user.id;
    const jwt = app.get(JwtService);
    const token = (u: User) =>
      jwt.sign({
        sub: u.id,
        username: u.username,
        type: "oidc",
        authType: "oidc",
      });
    adminToken = token(admin);
    userToken = token(user);
    const acp = await db.getRepository(Acp).save({
      packageId: "cap-test-" + Date.now(),
      name: "Capability test",
      acpIndex: {
        assessmentParts: [
          {
            id: "p",
            units: [
              { id: "U", name: "Unit", items: [{ id: "I", name: "Item" }] },
            ],
          },
        ],
      },
    });
    acpId = acp.id;
    const config = await db.getRepository(AcpAccessConfig).save({
      acpId,
      accessModel: "CREDENTIALS_LIST" as any,
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        enableItemList: true,
      },
    });
    configId = config.id;
    await db
      .getRepository(AcpUserRole)
      .save({ acpId, userId, role: "READ_ONLY" as any, capabilities: [] });
    const res = await request(server)
      .post(`/api/acp/${acpId}/access/credentials/single`)
      .set("Authorization", "Bearer " + adminToken)
      .send({ username: "reviewer", password, capabilities: [] })
      .expect(201);
    credentialId = res.body.id;
    const login = await request(server)
      .post("/api/auth/credential-login")
      .send({ acpId, username: "reviewer", password })
      .expect(201);
    credentialToken = login.body.accessToken;
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it("blocks participant Explorer access when disabled without removing stored grants", async () => {
    const config = await db
      .getRepository(AcpAccessConfig)
      .findOneByOrFail({ id: configId });
    await db
      .getRepository(AcpUserRole)
      .update({ acpId, userId }, { capabilities: [...ACP_CAPABILITIES] });
    await db
      .getRepository(AcpCredential)
      .update(credentialId, { capabilities: [...ACP_CAPABILITIES] });
    try {
      await db.getRepository(AcpAccessConfig).update(configId, {
        featureConfig: { ...config.featureConfig, enableItemList: false },
      });
      for (const token of [userToken, credentialToken]) {
        const get = (path: string) =>
          request(server)
            .get(path)
            .set("Authorization", "Bearer " + token);
        for (const path of [
          `/api/view/acp/${acpId}/items`,
          `/api/acp/${acpId}/items`,
          `/api/acp/${acpId}/files/item-list`,
          `/api/view/acp/${acpId}/item-explorer/state`,
          `/api/view/acp/${acpId}/items/preferences`,
          `/api/view/acp/${acpId}/items/collections`,
        ])
          await get(path).expect(403);
        const response = await get(
          `/api/view/acp/${acpId}/capabilities`,
        ).expect(200);
        expect(response.body).toMatchObject({
          canViewExplorer: false,
          canEditExplorer: false,
        });
        expect(response.body.capabilities).toEqual([...ACP_CAPABILITIES]);
        await request(server)
          .put(`/api/acp/${acpId}/items/tags`)
          .set("Authorization", "Bearer " + token)
          .send({})
          .expect(403);
      }
      await request(server)
        .get(`/api/view/acp/${acpId}/items`)
        .set("Authorization", "Bearer " + adminToken)
        .expect(200);
    } finally {
      await db
        .getRepository(AcpAccessConfig)
        .save({ id: configId, featureConfig: config.featureConfig });
    }
    await request(server)
      .get(`/api/view/acp/${acpId}/items`)
      .set("Authorization", "Bearer " + userToken)
      .expect(200);
  });

  it("keeps migrated item-only commenting usable without activating booklet review", async () => {
    const config = await db
      .getRepository(AcpAccessConfig)
      .findOneByOrFail({ id: configId });
    await db
      .getRepository(AcpUserRole)
      .update({ acpId, userId }, { capabilities: ["review:participate"] });
    await db
      .getRepository(AcpCredential)
      .update(credentialId, { capabilities: ["review:participate"] });
    try {
      await db.getRepository(AcpAccessConfig).save({
        id: configId,
        featureConfig: { ...config.featureConfig, enableReview: false },
      });
      for (const token of [userToken, credentialToken]) {
        const auth = { Authorization: "Bearer " + token };
        const created = await request(server)
          .post(`/api/acp/${acpId}/comments`)
          .set(auth)
          .send({
            targetType: "ITEM",
            targetId: "U_I",
            commentText: "Existing item-only workflow",
          })
          .expect(201);
        const mine = await request(server)
          .get(`/api/acp/${acpId}/comments/mine`)
          .set(auth)
          .expect(200);
        expect(
          mine.body.some((comment: any) => comment.id === created.body.id),
        ).toBe(true);
        await request(server)
          .get(`/api/acp/${acpId}/review/comments`)
          .query({ targetType: "ITEM", unitId: "U", itemId: "I" })
          .set(auth)
          .expect(200);
        await request(server)
          .get(`/api/view/acp/${acpId}/review`)
          .set(auth)
          .expect(403);
      }
    } finally {
      await db
        .getRepository(AcpAccessConfig)
        .save({ id: configId, featureConfig: config.featureConfig });
    }
  });

  for (const type of ["oidc", "credential"]) {
    for (let mask = 0; mask < 16; mask++) {
      const grants = ACP_CAPABILITIES.filter((_, i) => mask & (1 << i));
      it(`${type} API matrix ${mask}`, async () => {
        const token = type === "oidc" ? userToken : credentialToken;
        if (type === "oidc")
          await db
            .getRepository(AcpUserRole)
            .update({ acpId, userId }, { capabilities: [...grants] });
        else
          await db
            .getRepository(AcpCredential)
            .update(credentialId, { capabilities: [...grants] });
        const get = (path: string) =>
          request(server)
            .get(path)
            .set("Authorization", "Bearer " + token);
        const view =
          grants.includes("item-explorer:view") ||
          grants.includes("item-explorer:edit");
        await get(`/api/view/acp/${acpId}/items`).expect(view ? 200 : 403);
        await get(`/api/acp/${acpId}/items`).expect(view ? 200 : 403);
        await get(`/api/acp/${acpId}/files/item-list`).expect(view ? 200 : 403);
        await get(`/api/view/acp/${acpId}/item-explorer/state`).expect(
          view ? 200 : 403,
        );
        await get(`/api/view/acp/${acpId}/review`).expect(
          grants.includes("review:participate") ||
            grants.includes("review:manage")
            ? 200
            : 403,
        );
        await get(`/api/acp/${acpId}/review/comments/counts`).expect(
          grants.includes("review:participate") ||
            grants.includes("review:manage")
            ? 200
            : 403,
        );
        await request(server)
          .post(`/api/acp/${acpId}/review/comments`)
          .set("Authorization", "Bearer " + token)
          .send({ unitId: "U", itemId: "I", commentText: "matrix" })
          .expect(grants.includes("review:participate") ? 201 : 403);
        await request(server)
          .put(`/api/view/acp/${acpId}/review/config`)
          .set("Authorization", "Bearer " + token)
          .send({
            enableReview: true,
            visibilityMode: "PRIVATE",
            configVersion: (
              await db
                .getRepository(AcpAccessConfig)
                .findOneByOrFail({ id: configId })
            ).reviewConfigVersion,
          })
          .expect(grants.includes("review:manage") ? 200 : 403);
        await request(server)
          .put(`/api/acp/${acpId}/items/tags`)
          .set("Authorization", "Bearer " + token)
          .send({ tags: {} })
          .expect(grants.includes("item-explorer:edit") ? 200 : 403);
        // The read-only changelog is restricted to editors like the draft routes.
        await get(`/api/acp/${acpId}/item-explorer/changes`).expect(
          grants.includes("item-explorer:edit") ? 200 : 403,
        );
        await get(`/api/acp/${acpId}/roles`).expect(403);
      });
    }
  }
  it("allows a credential editor to save a draft without a user-table identity", async () => {
    const res = await request(server)
      .patch(`/api/acp/${acpId}/item-explorer/draft`)
      .set("Authorization", "Bearer " + credentialToken)
      .send({ changeType: "COLUMN_VISIBILITY", patch: { ui: {} } })
      .expect(200);
    expect(res.body.canEdit).toBe(true);
    expect(res.body.version).not.toBe(res.body.publishedVersion);
    for (const token of [userToken, credentialToken]) {
      for (const perspective of ["editor", "read-only"]) {
        const list = await request(server)
          .get(`/api/acp/${acpId}/files/item-list?perspective=${perspective}`)
          .set("Authorization", "Bearer " + token)
          .expect(200);
        expect(list.body.itemExplorerStateVersion).toBe(
          perspective === "editor"
            ? res.body.version
            : res.body.publishedVersion,
        );
      }
    }
  });
  it("does not give app admins participation without explicit grants", async () => {
    await request(server)
      .post(`/api/acp/${acpId}/review/comments`)
      .set("Authorization", "Bearer " + adminToken)
      .send({
        unitId: "U",
        itemId: "I",
        commentText: "no implicit participation",
      })
      .expect(403);
  });
  it("preserves credential IDs and atomically replaces grants on upsert", async () => {
    const upload = (preview: boolean) =>
      request(server)
        .post(
          `/api/acp/${acpId}/access/credentials/file?mode=upsert&preview=${preview}`,
        )
        .set("Authorization", "Bearer " + adminToken)
        .field("profile", "REVIEW_ONLY")
        .attach(
          "file",
          Buffer.from("\uFEFFBenutzername;Kennwort\r\nreviewer;" + password),
          "access.csv",
        );
    const preview = await upload(true).expect(201);
    expect(preview.body.changes[0].after).toEqual(["review:participate"]);
    expect(JSON.stringify(preview.body)).not.toContain(password);
    await upload(false).expect(201);
    const c = await db
      .getRepository(AcpCredential)
      .findOneByOrFail({ id: credentialId });
    expect(c.capabilities).toEqual(["review:participate"]);
    expect(c.passwordHash).not.toBe(password);
    await request(server)
      .get(`/api/view/acp/${acpId}/items`)
      .set("Authorization", "Bearer " + credentialToken)
      .expect(403);
  });
  it("rejects a malformed replace without deleting or changing any credential", async () => {
    const before = await db
      .getRepository(AcpCredential)
      .findBy({ accessConfigId: configId });
    const res = await request(server)
      .post(`/api/acp/${acpId}/access/credentials/file?mode=replace`)
      .set("Authorization", "Bearer " + adminToken)
      .field("profile", "BOTH")
      .attach(
        "file",
        Buffer.from(
          "reviewer;" + password + "\nreviewer;" + password + "\nmissing;\n;",
        ),
        "access.csv",
      )
      .expect(400);
    expect(res.body.errors).toHaveLength(4);
    expect(JSON.stringify(res.body)).not.toContain(password);
    expect(
      await db
        .getRepository(AcpCredential)
        .findBy({ accessConfigId: configId }),
    ).toEqual(before);
  });
  it("keeps append grants unchanged and rejects stale deleted credentials", async () => {
    await request(server)
      .post(`/api/acp/${acpId}/access/credentials/file?mode=append`)
      .set("Authorization", "Bearer " + adminToken)
      .field("profile", "BOTH")
      .attach("file", Buffer.from("reviewer;" + password), "access.csv")
      .expect(201);
    expect(
      (
        await db
          .getRepository(AcpCredential)
          .findOneByOrFail({ id: credentialId })
      ).capabilities,
    ).toEqual(["review:participate"]);
    await request(server)
      .delete(`/api/acp/${acpId}/access/credentials/${credentialId}`)
      .set("Authorization", "Bearer " + adminToken)
      .expect(200);
    await request(server)
      .get(`/api/view/acp/${acpId}/review`)
      .set("Authorization", "Bearer " + credentialToken)
      .expect(403);
    await request(server)
      .get(`/api/view/acp/${acpId}`)
      .set("Authorization", "Bearer " + credentialToken)
      .expect(403);
  });
  it("migrates existing grants and disables review, with no implicit grants on new rows", async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("CREATE SCHEMA capability_migration_test");
      await runner.query("SET LOCAL search_path TO capability_migration_test");
      await runner.query(
        `CREATE TABLE acp_access_configs(id text,acp_id text,feature_config jsonb); CREATE TABLE acp_user_roles(acp_id text,role text); CREATE TABLE acp_credentials(access_config_id text)`,
      );
      await runner.query(
        `INSERT INTO acp_access_configs VALUES ('a','a','{"enableCommenting":true,"enableItemList":false}'),('b','b','{"enableCommenting":false,"enableItemList":true}'); INSERT INTO acp_user_roles VALUES ('a','ACP_MANAGER'),('a','READ_ONLY'),('b','READ_ONLY'); INSERT INTO acp_credentials VALUES ('a'),('b')`,
      );
      await new AcpCapabilityGrants1789200000000().up(runner);
      const roles = await runner.query(
        "SELECT * FROM acp_user_roles ORDER BY acp_id,role",
      );
      expect(roles[0].capabilities).toEqual([...ACP_CAPABILITIES]);
      expect(roles[1].capabilities).toEqual(["review:participate"]);
      expect(roles[2].capabilities).toEqual(["item-explorer:view"]);
      expect(
        (
          await runner.query("SELECT feature_config FROM acp_access_configs")
        ).every((r: any) => r.feature_config.enableReview === false),
      ).toBe(true);
      await runner.query(
        `INSERT INTO acp_credentials(access_config_id) VALUES ('new')`,
      );
      expect(
        (
          await runner.query(
            `SELECT capabilities FROM acp_credentials WHERE access_config_id='new'`,
          )
        )[0].capabilities,
      ).toEqual([]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
