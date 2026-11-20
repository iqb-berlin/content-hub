import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ApCapabilitiesService } from "../auth/capabilities/ap-capabilities.service";
import { ApAccessGuard } from "../auth/guards/ap-access.guard";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { ApController } from "./ap.controller";
import { ApService } from "./ap.service";
import { AdminService } from "../admin/admin.service";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  CreateApDto,
  UpdateApDto,
  AssignRoleDto,
  UpdateAccessConfigDto,
  CredentialEntryDto,
  CredentialUploadMode,
} from "./dto/ap.dto";

const apId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const ap = {
  id: apId,
  packageId: "contract-package",
  name: "Contract package",
  description: null,
  apIndex: {},
  settings: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const accessConfig = {
  id: "33333333-3333-4333-8333-333333333333",
  apId,
  accessModel: "PRIVATE",
  allowRegistered: false,
  featureConfig: {},
  validFrom: null,
  validUntil: null,
};

// Exercise real HTTP routing, DTO validation, serialization and RolesGuard.
// Authentication, AP access resolution, capability resolution and persistence
// are isolated here; their own suites cover them. RolesGuard remains real.
describe("AP HTTP contracts", () => {
  let app: INestApplication;
  const capabilities = { assert: jest.fn().mockResolvedValue(undefined) };
  const service = {
    create: jest.fn(async (dto: CreateApDto) => ({ ...ap, ...dto })),
    update: jest.fn(async (_id: string, dto: UpdateApDto) => ({
      ...ap,
      ...dto,
    })),
    getRoles: jest.fn(async () => [
      {
        id: "role-id",
        apId,
        userId,
        role: "READ_ONLY",
        user: { id: userId, username: "reader", displayName: null },
      },
    ]),
    assignRole: jest.fn(async (_id: string, dto: AssignRoleDto) => ({
      id: "role-id",
      apId,
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
      controllers: [ApController],
      providers: [
        RolesGuard,
        { provide: ApCapabilitiesService, useValue: capabilities },
        {
          provide: ApAccessGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: ApService, useValue: service },
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
              apRoles: { apId: string; role: string }[];
            };
          }>();
          const identity = req.headers["x-test-identity"];
          if (!identity) throw new UnauthorizedException();
          req.user = {
            sub: userId,
            isAppAdmin: identity === "admin",
            apRoles: [
              {
                apId,
                role: identity === "manager" ? "AP_MANAGER" : "READ_ONLY",
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
      .post(`/api/ap/${apId}/roles`)
      .set("x-test-identity", "manager")
      .send(body)
      .expect(201);
    expect(response.body).toMatchObject(body);
    expect(service.assignRole).toHaveBeenCalledWith(apId, body);
  });

  it("rejects unknown capability grants before role assignment", async () => {
    await request(app.getHttpServer())
      .post(`/api/ap/${apId}/roles`)
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
      .put(`/api/ap/${apId}/access`)
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
      .put(`/api/ap/${apId}/access`)
      .set("x-test-identity", "manager")
      .send({ accessModel: "PRIVATE", featureConfig: { enableItemList: true } })
      .expect(200);
    expect(capabilities.assert).not.toHaveBeenCalled();
  });

  it("creates an AP with the existing response shape and ISO dates", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/ap")
      .set("x-test-identity", "admin")
      .send({ packageId: ap.packageId, name: ap.name })
      .expect(201);
    expect(response.body).toEqual({
      ...ap,
      createdAt: ap.createdAt.toISOString(),
      updatedAt: ap.updatedAt.toISOString(),
    });
  });

  it.each([
    {},
    { packageId: "pkg", name: 42 },
    { packageId: "", name: "Name" },
    { packageId: "pkg", name: "Name", isAppAdmin: true },
  ])("rejects invalid AP creation before persistence: %j", async (body) => {
    await request(app.getHttpServer())
      .post("/api/ap")
      .set("x-test-identity", "admin")
      .send(body)
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("allows a manager to patch a name without replacing other fields", async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/ap/${apId}`)
      .set("x-test-identity", "manager")
      .send({ name: "Renamed" })
      .expect(200);
    expect(response.body).toMatchObject({
      id: apId,
      packageId: ap.packageId,
      name: "Renamed",
    });
    expect(service.update).toHaveBeenCalledWith(apId, { name: "Renamed" });
  });

  it("rejects changes to the immutable package ID", async () => {
    await request(app.getHttpServer())
      .patch(`/api/ap/${apId}`)
      .set("x-test-identity", "manager")
      .send({ packageId: "replacement" })
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it("lists assignments and assignable users with distinct response shapes", async () => {
    const roles = await request(app.getHttpServer())
      .get(`/api/ap/${apId}/roles`)
      .set("x-test-identity", "manager")
      .expect(200);
    expect(roles.body).toEqual([
      {
        id: "role-id",
        apId,
        userId,
        role: "READ_ONLY",
        user: { id: userId, username: "reader", displayName: null },
      },
    ]);
    const users = await request(app.getHttpServer())
      .get(`/api/ap/${apId}/assignable-users`)
      .set("x-test-identity", "manager")
      .expect(200);
    expect(users.body).toEqual([
      { id: userId, username: "reader", displayName: null },
    ]);
  });

  it.each(["AP_MANAGER", "READ_ONLY"])(
    "accepts the supported role %s for admins",
    async (role) => {
      const response = await request(app.getHttpServer())
        .post(`/api/ap/${apId}/roles`)
        .set("x-test-identity", "admin")
        .send({ userId, role })
        .expect(201);
      expect(response.body).toEqual({ id: "role-id", apId, userId, role });
    },
  );

  it.each(["APP_ADMIN", "OWNER", "read_only", "", null, 1])(
    "rejects invalid role %j before persistence",
    async (role) => {
      await request(app.getHttpServer())
        .post(`/api/ap/${apId}/roles`)
        .set("x-test-identity", "admin")
        .send({ userId, role })
        .expect(400);
      expect(service.assignRole).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid target user ID", async () => {
    await request(app.getHttpServer())
      .post(`/api/ap/${apId}/roles`)
      .set("x-test-identity", "admin")
      .send({ userId: "invalid", role: "READ_ONLY" })
      .expect(400);
    expect(service.assignRole).not.toHaveBeenCalled();
  });

  it("lets managers grant read access but not manager rights", async () => {
    await request(app.getHttpServer())
      .post(`/api/ap/${apId}/roles`)
      .set("x-test-identity", "manager")
      .send({ userId, role: "READ_ONLY" })
      .expect(201);
    service.assignRole.mockClear();
    await request(app.getHttpServer())
      .post(`/api/ap/${apId}/roles`)
      .set("x-test-identity", "manager")
      .send({ userId, role: "AP_MANAGER" })
      .expect(403);
    expect(service.assignRole).not.toHaveBeenCalled();
  });

  it("returns nullable validity dates", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/ap/${apId}/access`)
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
        .put(`/api/ap/${apId}/access`)
        .set("x-test-identity", "manager")
        .send(body)
        .expect(200);
      expect(response.body).toEqual({ ...accessConfig, ...body });
      expect(service.updateAccessConfig).toHaveBeenCalledWith(apId, body);
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
      .put(`/api/ap/${apId}/access`)
      .set("x-test-identity", "manager")
      .send(body)
      .expect(400);
    expect(service.updateAccessConfig).not.toHaveBeenCalled();
  });

  it("accepts an omitted boolean and nullable dates for existing clients", async () => {
    await request(app.getHttpServer())
      .put(`/api/ap/${apId}/access`)
      .set("x-test-identity", "manager")
      .send({ accessModel: "PRIVATE", validFrom: null, validUntil: null })
      .expect(200);
    expect(service.updateAccessConfig).toHaveBeenCalledWith(apId, {
      accessModel: "PRIVATE",
      validFrom: null,
      validUntil: null,
    });
  });

  it.each(["", "?mode=replace", "?mode=append", "?mode=upsert"])(
    "keeps credential upload mode %s and response counters",
    async (query) => {
      const response = await request(app.getHttpServer())
        .post(`/api/ap/${apId}/access/credentials${query}`)
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
      .post(`/api/ap/${apId}/access/credentials`)
      .set("x-test-identity", "manager")
      .send(body)
      .expect(400);
    expect(service.uploadCredentials).not.toHaveBeenCalled();
  });

  it("rejects an unknown credential mode before any upload", async () => {
    await request(app.getHttpServer())
      .post(`/api/ap/${apId}/access/credentials?mode=typo`)
      .set("x-test-identity", "manager")
      .send({ credentials: [] })
      .expect(400);
    expect(service.uploadCredentials).not.toHaveBeenCalled();
  });

  it.each(["manager", "reader"])(
    "does not allow %s to create an AP",
    async (identity) => {
      await request(app.getHttpServer())
        .post("/api/ap")
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
          ? request(app.getHttpServer()).post(`/api/ap/${apId}/roles`)
          : request(app.getHttpServer()).put(`/api/ap/${apId}/access`);
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
