import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AcpCapabilitiesService } from "../auth/capabilities/acp-capabilities.service";
import { AcpAccessGuard } from "../auth/guards/acp-access.guard";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AcpController } from "./acp.controller";
import { AcpService } from "./acp.service";
import { AdminService } from "../admin/admin.service";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  CreateAcpDto,
  UpdateAcpDto,
  AssignRoleDto,
  UpdateAccessConfigDto,
  CredentialEntryDto,
  CredentialUploadMode,
} from "./dto/acp.dto";

const acpId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const acp = {
  id: acpId,
  packageId: "contract-package",
  name: "Contract package",
  description: null,
  acpIndex: {},
  settings: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const accessConfig = {
  id: "33333333-3333-4333-8333-333333333333",
  acpId,
  accessModel: "PRIVATE",
  allowRegistered: false,
  featureConfig: {},
  validFrom: null,
  validUntil: null,
};

// Exercise real HTTP routing, DTO validation, serialization and RolesGuard.
// Authentication, ACP access resolution, capability resolution and persistence
// are isolated here; their own suites cover them. RolesGuard remains real.
describe("ACP HTTP contracts", () => {
  let app: INestApplication;
  const capabilities = { assert: jest.fn().mockResolvedValue(undefined) };
  const service = {
    create: jest.fn(async (dto: CreateAcpDto) => ({ ...acp, ...dto })),
    update: jest.fn(async (_id: string, dto: UpdateAcpDto) => ({
      ...acp,
      ...dto,
    })),
    getRoles: jest.fn(async () => [
      {
        id: "role-id",
        acpId,
        userId,
        role: "READ_ONLY",
        user: { id: userId, username: "reader", displayName: null },
      },
    ]),
    assignRole: jest.fn(async (_id: string, dto: AssignRoleDto) => ({
      id: "role-id",
      acpId,
      ...dto,
    })),
    getAssignableUsers: jest.fn(async () => [
      { id: userId, username: "reader", displayName: null },
    ]),
    getAccessConfig: jest.fn(async () => accessConfig),
    updateAccessConfig: jest.fn(
      async (_id: string, dto: UpdateAccessConfigDto) => ({
        ...accessConfig,
        ...dto,
      }),
    ),
    uploadCredentials: jest.fn(
      async (
        _id: string,
        _credentials: CredentialEntryDto[],
        _mode: `${CredentialUploadMode}`,
      ) => ({ added: 1, updated: 0, skipped: 0, duplicates: [] }),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AcpController],
      providers: [
        RolesGuard,
        { provide: AcpCapabilitiesService, useValue: capabilities },
        {
          provide: AcpAccessGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: AcpService, useValue: service },
        { provide: AdminService, useValue: {} },
        { provide: ItemExplorerStateService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            headers: Record<string, string | undefined>;
            user?: {
              sub: string;
              isAppAdmin: boolean;
              acpRoles: { acpId: string; role: string }[];
            };
          }>();
          const identity = req.headers["x-test-identity"];
          if (!identity) throw new UnauthorizedException();
          req.user = {
            sub: userId,
            isAppAdmin: identity === "admin",
            acpRoles: [
              {
                acpId,
                role: identity === "manager" ? "ACP_MANAGER" : "READ_ONLY",
              },
            ],
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it("documents nullable validity dates as date-time strings", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const schema = document.components?.schemas?.UpdateAccessConfigDto;
    expect(schema).toMatchObject({
      properties: {
        validFrom: { type: "string", format: "date-time", nullable: true },
        validUntil: { type: "string", format: "date-time", nullable: true },
      },
    });
  });

  it("preserves capability grants when assigning a role", async () => {
    const body = {
      userId,
      role: "READ_ONLY",
      capabilities: ["review:participate", "item-explorer:view"],
    };
    const response = await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/roles`)
      .set("x-test-identity", "manager")
      .send(body)
      .expect(201);
    expect(response.body).toMatchObject(body);
    expect(service.assignRole).toHaveBeenCalledWith(acpId, body);
  });

  it("rejects unknown capability grants before role assignment", async () => {
    await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/roles`)
      .set("x-test-identity", "manager")
      .send({ userId, role: "READ_ONLY", capabilities: ["invalid"] })
      .expect(400);
    expect(service.assignRole).not.toHaveBeenCalled();
  });

  it("requires review management permission when review settings change", async () => {
    capabilities.assert.mockRejectedValueOnce(
      new ForbiddenException("Review permission required"),
    );
    await request(app.getHttpServer())
      .put(`/api/acp/${acpId}/access`)
      .set("x-test-identity", "manager")
      .send({ accessModel: "PRIVATE", featureConfig: { enableReview: true } })
      .expect(403);
    expect(capabilities.assert).toHaveBeenCalledWith(
      expect.anything(),
      "review:manage",
    );
    expect(service.updateAccessConfig).not.toHaveBeenCalled();
  });

  it("does not require review management for an unrelated feature change", async () => {
    await request(app.getHttpServer())
      .put(`/api/acp/${acpId}/access`)
      .set("x-test-identity", "manager")
      .send({ accessModel: "PRIVATE", featureConfig: { enableItemList: true } })
      .expect(200);
    expect(capabilities.assert).not.toHaveBeenCalled();
  });

  it("creates an ACP with the existing response shape and ISO dates", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/acp")
      .set("x-test-identity", "admin")
      .send({ packageId: acp.packageId, name: acp.name })
      .expect(201);
    expect(response.body).toEqual({
      ...acp,
      createdAt: acp.createdAt.toISOString(),
      updatedAt: acp.updatedAt.toISOString(),
    });
  });

  it.each([
    {},
    { packageId: "pkg", name: 42 },
    { packageId: "", name: "Name" },
    { packageId: "pkg", name: "Name", isAppAdmin: true },
  ])("rejects invalid ACP creation before persistence: %j", async (body) => {
    await request(app.getHttpServer())
      .post("/api/acp")
      .set("x-test-identity", "admin")
      .send(body)
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("allows a manager to patch a name without replacing other fields", async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/acp/${acpId}`)
      .set("x-test-identity", "manager")
      .send({ name: "Renamed" })
      .expect(200);
    expect(response.body).toMatchObject({
      id: acpId,
      packageId: acp.packageId,
      name: "Renamed",
    });
    expect(service.update).toHaveBeenCalledWith(acpId, { name: "Renamed" });
  });

  it("rejects changes to the immutable package ID", async () => {
    await request(app.getHttpServer())
      .patch(`/api/acp/${acpId}`)
      .set("x-test-identity", "manager")
      .send({ packageId: "replacement" })
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it("lists assignments and assignable users with distinct response shapes", async () => {
    const roles = await request(app.getHttpServer())
      .get(`/api/acp/${acpId}/roles`)
      .set("x-test-identity", "manager")
      .expect(200);
    expect(roles.body).toEqual([
      {
        id: "role-id",
        acpId,
        userId,
        role: "READ_ONLY",
        user: { id: userId, username: "reader", displayName: null },
      },
    ]);
    const users = await request(app.getHttpServer())
      .get(`/api/acp/${acpId}/assignable-users`)
      .set("x-test-identity", "manager")
      .expect(200);
    expect(users.body).toEqual([
      { id: userId, username: "reader", displayName: null },
    ]);
  });

  it.each(["ACP_MANAGER", "READ_ONLY"])(
    "accepts the supported role %s for admins",
    async (role) => {
      const response = await request(app.getHttpServer())
        .post(`/api/acp/${acpId}/roles`)
        .set("x-test-identity", "admin")
        .send({ userId, role })
        .expect(201);
      expect(response.body).toEqual({ id: "role-id", acpId, userId, role });
    },
  );

  it.each(["APP_ADMIN", "OWNER", "read_only", "", null, 1])(
    "rejects invalid role %j before persistence",
    async (role) => {
      await request(app.getHttpServer())
        .post(`/api/acp/${acpId}/roles`)
        .set("x-test-identity", "admin")
        .send({ userId, role })
        .expect(400);
      expect(service.assignRole).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid target user ID", async () => {
    await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/roles`)
      .set("x-test-identity", "admin")
      .send({ userId: "invalid", role: "READ_ONLY" })
      .expect(400);
    expect(service.assignRole).not.toHaveBeenCalled();
  });

  it("lets managers grant read access but not manager rights", async () => {
    await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/roles`)
      .set("x-test-identity", "manager")
      .send({ userId, role: "READ_ONLY" })
      .expect(201);
    service.assignRole.mockClear();
    await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/roles`)
      .set("x-test-identity", "manager")
      .send({ userId, role: "ACP_MANAGER" })
      .expect(403);
    expect(service.assignRole).not.toHaveBeenCalled();
  });

  it("returns nullable validity dates", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/acp/${acpId}/access`)
      .set("x-test-identity", "manager")
      .expect(200);
    expect(response.body).toEqual(accessConfig);
  });

  it.each(["PRIVATE", "PUBLIC", "REGISTERED", "CREDENTIALS_LIST"])(
    "preserves supported access model %s",
    async (accessModel) => {
      const body = {
        accessModel,
        allowRegistered: false,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2026-02-01T00:00:00Z",
        featureConfig: { enableItemList: true, extension: { version: 1 } },
      };
      const response = await request(app.getHttpServer())
        .put(`/api/acp/${acpId}/access`)
        .set("x-test-identity", "manager")
        .send(body)
        .expect(200);
      expect(response.body).toEqual({ ...accessConfig, ...body });
      expect(service.updateAccessConfig).toHaveBeenCalledWith(acpId, body);
    },
  );

  it.each([
    { accessModel: "TYPO" },
    { accessModel: 1 },
    { accessModel: null },
    { accessModel: "PRIVATE", allowRegistered: "false" },
    { accessModel: "PRIVATE", allowRegistered: 0 },
    { accessModel: "PRIVATE", allowRegistered: null },
    { accessModel: "PRIVATE", featureConfig: [] },
    { accessModel: "PRIVATE", validFrom: "yesterday" },
    { accessModel: "PRIVATE", extra: true },
  ])("rejects malformed access data before persistence: %j", async (body) => {
    await request(app.getHttpServer())
      .put(`/api/acp/${acpId}/access`)
      .set("x-test-identity", "manager")
      .send(body)
      .expect(400);
    expect(service.updateAccessConfig).not.toHaveBeenCalled();
  });

  it("accepts an omitted boolean and nullable dates for existing clients", async () => {
    await request(app.getHttpServer())
      .put(`/api/acp/${acpId}/access`)
      .set("x-test-identity", "manager")
      .send({ accessModel: "PRIVATE", validFrom: null, validUntil: null })
      .expect(200);
    expect(service.updateAccessConfig).toHaveBeenCalledWith(acpId, {
      accessModel: "PRIVATE",
      validFrom: null,
      validUntil: null,
    });
  });

  it.each(["", "?mode=replace", "?mode=append", "?mode=upsert"])(
    "keeps credential upload mode %s and response counters",
    async (query) => {
      const response = await request(app.getHttpServer())
        .post(`/api/acp/${acpId}/access/credentials${query}`)
        .set("x-test-identity", "manager")
        .send({
          credentials: [{ username: "reader", password: "StrongPassword1!" }],
        })
        .expect(201);
      expect(response.body).toEqual({
        message: "Credentials processed: 1 added, 0 updated, 0 skipped",
        added: 1,
        updated: 0,
        skipped: 0,
        duplicates: [],
      });
      expect(service.uploadCredentials.mock.calls[0]?.[2]).toBe(
        query ? query.split("=")[1] : "replace",
      );
    },
  );

  it.each([
    { credentials: "invalid" },
    { credentials: [{ username: "reader", password: "weak" }] },
    {
      credentials: [
        { username: "reader", password: "StrongPassword1!", extra: true },
      ],
    },
  ])("rejects malformed credential entries before upload: %j", async (body) => {
    await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/access/credentials`)
      .set("x-test-identity", "manager")
      .send(body)
      .expect(400);
    expect(service.uploadCredentials).not.toHaveBeenCalled();
  });

  it("rejects an unknown credential mode before any upload", async () => {
    await request(app.getHttpServer())
      .post(`/api/acp/${acpId}/access/credentials?mode=typo`)
      .set("x-test-identity", "manager")
      .send({ credentials: [] })
      .expect(400);
    expect(service.uploadCredentials).not.toHaveBeenCalled();
  });

  it.each(["manager", "reader"])(
    "does not allow %s to create an ACP",
    async (identity) => {
      await request(app.getHttpServer())
        .post("/api/acp")
        .set("x-test-identity", identity)
        .send({ packageId: "pkg", name: "Name" })
        .expect(403);
      expect(service.create).not.toHaveBeenCalled();
    },
  );

  it.each(["roles", "access"])(
    "protects %s writes from unauthenticated and read-only callers",
    async (path) => {
      const send = () =>
        path === "roles"
          ? request(app.getHttpServer()).post(`/api/acp/${acpId}/roles`)
          : request(app.getHttpServer()).put(`/api/acp/${acpId}/access`);
      const body =
        path === "roles"
          ? { userId, role: "READ_ONLY" }
          : { accessModel: "PUBLIC" };
      await send().send(body).expect(401);
      await send().set("x-test-identity", "reader").send(body).expect(403);
      expect(service.assignRole).not.toHaveBeenCalled();
      expect(service.updateAccessConfig).not.toHaveBeenCalled();
    },
  );
});
