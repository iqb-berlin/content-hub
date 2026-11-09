import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { randomUUID } from "crypto";
import * as request from "supertest";
import {
  AccessModel,
  Ap,
  ApAccessConfig,
  ApCredential,
  ApRole,
  ApUserRole,
  User,
} from "../src/database/entities";
import { AdminService } from "../src/admin/admin.service";
import { hashServerApiToken } from "../src/api/server-api-token.util";

describe("AP API and legacy integration compatibility", () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let managerToken: string;
  let integrationToken: string;
  let adminToken: string;
  const apId = randomUUID();
  const otherId = randomUUID();
  const managerId = randomUUID();
  const index = {
    packageId: `ap-transition-${apId}`,
    assessmentParts: [],
    custom: { acpId: "opaque", role: "ACP_MANAGER" },
  };

  jest.setTimeout(60000);
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== "test" ||
      !process.env.DB_DATABASE?.includes("e2e")
    ) {
      throw new Error("An isolated E2E database is required");
    }
    const { AppModule } = await import("../src/app.module");
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const aps = app.get<Repository<Ap>>(getRepositoryToken(Ap));
    await users.save({
      id: managerId,
      username: `ap-manager-${managerId}`,
      isAppAdmin: false,
    });
    const admin = await users.save({
      username: `ap-admin-${apId}`,
      isAppAdmin: true,
    });
    await aps.save({
      id: apId,
      packageId: index.packageId,
      name: "AP transition",
      apIndex: index,
    });
    await aps.save({
      id: otherId,
      packageId: `other-${apId}`,
      name: "Other package",
    });
    await app
      .get<Repository<ApUserRole>>(getRepositoryToken(ApUserRole))
      .save({ userId: managerId, apId, role: ApRole.AP_MANAGER });
    managerToken = jwt.sign({
      sub: managerId,
      username: `ap-manager-${managerId}`,
      type: "oidc",
      authType: "oidc",
    });
    adminToken = jwt.sign({
      sub: admin.id,
      username: admin.username,
      type: "oidc",
      authType: "oidc",
    });
    // A genuinely pre-transition token row, without an entity transformer on write.
    integrationToken = `legacy-${randomUUID()}`;
    await db.query(
      `INSERT INTO application_tokens (name,token_hash,token_prefix,scopes,allowed_acp_ids)
      VALUES ($1,$2,'legacy',$3::jsonb,$4::jsonb)`,
      [
        `legacy-${apId}`,
        hashServerApiToken(integrationToken),
        JSON.stringify([
          "acp.read",
          "transfer.read",
          "index.read",
          "index.write",
        ]),
        JSON.stringify([apId]),
      ],
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it("exposes canonical fields and retains the old management response", async () => {
    const current = await request(app.getHttpServer())
      .get(`/api/ap/${apId}`)
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(current.body.apIndex).toEqual(index);
    expect(current.body.acpIndex).toBeUndefined();
    const legacy = await request(app.getHttpServer())
      .get(`/api/acp/${apId}`)
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(legacy.body.acpIndex).toEqual(index);
    expect(legacy.body.apIndex).toBeUndefined();
  });

  it("updates the same package using either URL", async () => {
    await request(app.getHttpServer())
      .patch(`/api/acp/${apId}`)
      .auth(managerToken, { type: "bearer" })
      .send({ name: "Legacy rename" })
      .expect(200);
    const result = await request(app.getHttpServer())
      .get(`/api/ap/${apId}`)
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(result.body.name).toBe("Legacy rename");
  });

  it("keeps legacy role requests and failure messages compatible without granting access", async () => {
    for (const [prefix, role] of [
      ["ap", "AP_MANAGER"],
      ["acp", "ACP_MANAGER"],
    ]) {
      const result = await request(app.getHttpServer())
        .post(`/api/${prefix}/${apId}/roles`)
        .auth(managerToken, { type: "bearer" })
        .send({ userId: managerId, role })
        .expect(403);
      expect(result.body.message).toBe(
        `Only Application Admins can assign ${role} role`,
      );
    }
  });

  it("returns old profiles by default and canonical profiles on explicit request", async () => {
    const old = await request(app.getHttpServer())
      .get("/api/auth/profile")
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(old.body.acpRoles).toEqual([
      { acpId: apId, acpName: "Legacy rename", role: "ACP_MANAGER" },
    ]);
    const current = await request(app.getHttpServer())
      .get("/api/auth/profile")
      .set("X-Content-Hub-Terminology", "ap")
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(current.body.apRoles[0]).toEqual({
      apId,
      apName: "Legacy rename",
      role: "AP_MANAGER",
    });
    expect(
      (
        await db.query("SELECT role FROM acp_user_roles WHERE user_id=$1", [
          managerId,
        ])
      )[0].role,
    ).toBe("ACP_MANAGER");
  });

  it("accepts persisted acp.read scope without widening package restrictions", async () => {
    const old = await request(app.getHttpServer())
      .get("/api/server/acp")
      .set("X-Server-Token", integrationToken)
      .expect(200);
    const current = await request(app.getHttpServer())
      .get("/api/server/ap")
      .set("X-Server-Token", integrationToken)
      .expect(200);
    expect(old.body.map((ap: { id: string }) => ap.id)).toEqual([apId]);
    expect(current.body.map((ap: { id: string }) => ap.id)).toEqual([apId]);
    for (const prefix of ["ap", "acp"]) {
      await request(app.getHttpServer())
        .get(`/api/server/${prefix}/${otherId}`)
        .set("X-Server-Token", integrationToken)
        .expect(403);
    }
  });

  it("keeps capabilities usable by both generations of clients", async () => {
    const old = await request(app.getHttpServer())
      .get("/api/server/capabilities")
      .set("X-Server-Token", integrationToken)
      .expect(200);
    expect(old.body.capabilities["acp.read"]).toBe(true);
    expect(old.body.allowedAcpIds).toEqual([apId]);
    const current = await request(app.getHttpServer())
      .get("/api/server/capabilities")
      .set("X-Server-Token", integrationToken)
      .set("X-Content-Hub-Terminology", "ap")
      .expect(200);
    expect(current.body.capabilities["ap.read"]).toBe(true);
    expect(current.body.allowedApIds).toEqual([apId]);
  });

  it("normalizes old transfer payload fields before strict validation", async () => {
    const old = await request(app.getHttpServer())
      .put(`/api/server/acp/${apId}/index`)
      .set("X-Server-Token", integrationToken)
      .send({ acpIndex: index })
      .expect(200);
    expect(old.body.acpId).toBe(apId);
    const current = await request(app.getHttpServer())
      .get(`/api/server/ap/${apId}/index`)
      .set("X-Server-Token", integrationToken)
      .expect(200);
    expect(current.body.apIndex).toEqual(index);
    await request(app.getHttpServer())
      .put(`/api/server/ap/${apId}/index`)
      .set("X-Server-Token", integrationToken)
      .send({ acpIndex: index, apIndex: { different: true } })
      .expect(400);
  });

  it("leaves raw index content untouched, including ACP-like user fields", async () => {
    const raw = {
      ...index,
      acpId: "user-owned",
      scopes: ["acp.read"],
      role: "ACP_MANAGER",
    };
    await request(app.getHttpServer())
      .put(`/api/ap/${apId}/index`)
      .auth(managerToken, { type: "bearer" })
      .send(raw)
      .expect(200);
    const old = await request(app.getHttpServer())
      .get(`/api/acp/${apId}/index`)
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(old.body.acpId).toBe("user-owned");
    expect(old.body.role).toBe("ACP_MANAGER");
    expect(old.body.scopes).toEqual(["acp.read"]);
    const exported = await request(app.getHttpServer())
      .get(`/api/acp/${apId}/index/export`)
      .auth(managerToken, { type: "bearer" })
      .expect(200);
    expect(exported.headers["content-disposition"]).toContain(
      `acp-index-${apId}.json`,
    );
  });

  it("accepts legacy token creation fields and keeps old stored scopes", async () => {
    const result = await request(app.getHttpServer())
      .post("/api/admin/application-tokens")
      .auth(adminToken, { type: "bearer" })
      .send({
        name: `old-client-${apId}`,
        scopes: ["acp.read"],
        allowedAcpIds: [apId],
      })
      .expect(201);
    expect(result.body.scopes).toEqual(["acp.read"]);
    expect(result.body.allowedAcpIds).toEqual([apId]);
    const stored = await db.query(
      "SELECT scopes,allowed_acp_ids FROM application_tokens WHERE name=$1",
      [`old-client-${apId}`],
    );
    expect(stored[0].scopes).toEqual(["acp.read"]);
    expect(stored[0].allowed_acp_ids).toEqual([apId]);
    await request(app.getHttpServer())
      .post("/api/admin/application-tokens")
      .auth(adminToken, { type: "bearer" })
      .send({
        name: `conflicting-${apId}`,
        scopes: ["ap.read"],
        allowedAcpIds: null,
        allowedApIds: [apId],
      })
      .expect(400);
  });

  it("accepts legacy query filters and rejects conflicting aliases", async () => {
    const result = await request(app.getHttpServer())
      .get(`/api/admin/application-tokens?allowedAcpId=${apId}`)
      .auth(adminToken, { type: "bearer" })
      .expect(200);
    expect(result.body.items.length).toBeGreaterThan(0);
    expect(
      result.body.items.every((token: { allowedAcpIds: string[] }) =>
        token.allowedAcpIds.includes(apId),
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .get(
        `/api/admin/application-tokens?allowedAcpId=${apId}&allowedApId=${otherId}`,
      )
      .auth(adminToken, { type: "bearer" })
      .expect(400);
  });

  it("keeps old credential sessions package-bound and rejects conflicting claims", async () => {
    const config = await db
      .getRepository(ApAccessConfig)
      .save({ apId, accessModel: AccessModel.CREDENTIALS_LIST });
    const credential = await db.getRepository(ApCredential).save({
      accessConfigId: config.id,
      username: "existing-reader",
      passwordHash: "unused-by-token-check",
    });
    const payload = {
      sub: credential.id,
      username: credential.username,
      type: "credential",
      acpId: apId,
    };
    const old = jwt.sign(payload);
    for (const prefix of ["ap", "acp"]) {
      await request(app.getHttpServer())
        .get(`/api/view/${prefix}/${apId}`)
        .auth(old, { type: "bearer" })
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/view/${prefix}/${otherId}`)
        .auth(old, { type: "bearer" })
        .expect(403);
    }
    await request(app.getHttpServer())
      .get(`/api/view/ap/${apId}`)
      .auth(jwt.sign({ ...payload, apId: otherId }), { type: "bearer" })
      .expect(403);
  });

  it("retains the existing physical package schema and stored manager enum", async () => {
    const schema = await db.driver.createSchemaBuilder().log();
    expect(
      schema.upQueries
        .map((query) => query.query)
        .filter((sql) => sql.includes("acp")),
    ).toEqual([]);
    expect(
      await db.getRepository(ApUserRole).findOneByOrFail({ userId: managerId }),
    ).toMatchObject({ role: ApRole.AP_MANAGER });
    expect(app.get(AdminService)).toBeDefined();
  });
});
