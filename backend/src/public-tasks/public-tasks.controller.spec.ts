import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  PublicTaskManagementController,
  PublicTasksController,
} from "./public-tasks.controller";
import { PublicTasksService } from "./public-tasks.service";

const apId = "11111111-1111-4111-8111-111111111111";
const publicationId = "22222222-2222-4222-8222-222222222222";
const base = `/api/ap/${apId}/publications`;

describe("Public task HTTP contracts", () => {
  let app: INestApplication;
  const tasks = {
    list: jest.fn(async () => []),
    units: jest.fn(async () => []),
    preview: jest.fn(async () => ({ sourceRevision: "a".repeat(64) })),
    create: jest.fn(async () => ({ id: publicationId })),
    setPublished: jest.fn(async () => ({ id: publicationId })),
    getPublic: jest.fn(async () => ({ id: publicationId, snapshot: {} })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicTaskManagementController, PublicTasksController],
      providers: [RolesGuard, { provide: PublicTasksService, useValue: tasks }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          const identity = req.headers["x-test-identity"];
          if (!identity) throw new UnauthorizedException();
          req.user = {
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
  afterAll(async () => app.close());

  it("permits anonymous snapshot reads without opening management", async () => {
    await request(app.getHttpServer())
      .get(`/api/public-tasks/${publicationId}`)
      .expect(200)
      .expect("Cache-Control", "no-store");
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .get(base)
      .set("x-test-identity", "reader")
      .expect(403);
    expect(tasks.list).not.toHaveBeenCalled();
  });

  it.each(["manager", "admin"])(
    "lets %s explicitly create and withdraw a snapshot",
    async (identity) => {
      const payload = {
        unitId: "u1",
        copyrightNotice: "© Rights",
        publicComments: "",
        sourceRevision: "a".repeat(64),
      };
      await request(app.getHttpServer())
        .post(base)
        .set("x-test-identity", identity)
        .send(payload)
        .expect(201);
      expect(tasks.create).toHaveBeenCalledWith(apId, payload);
      await request(app.getHttpServer())
        .put(`${base}/${publicationId}`)
        .set("x-test-identity", identity)
        .send({ published: false })
        .expect(200);
      expect(tasks.setPublished).toHaveBeenCalledWith(
        apId,
        publicationId,
        false,
      );
    },
  );

  it("does not let managers publish to a different AP", async () => {
    await request(app.getHttpServer())
      .post(`/api/ap/${publicationId}/publications`)
      .set("x-test-identity", "manager")
      .send({})
      .expect(403);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it.each([
    { copyrightNotice: "  " },
    { sourceRevision: undefined },
    { sourceRevision: "invalid" },
    { snapshot: { playerHtml: "injected" } },
    { publicComments: 42 },
  ])(
    "rejects unreviewed, invalid or injected publication data: %j",
    async (patch) => {
      await request(app.getHttpServer())
        .post(base)
        .set("x-test-identity", "manager")
        .send({
          unitId: "u1",
          copyrightNotice: "© Rights",
          publicComments: "",
          sourceRevision: "a".repeat(64),
          ...patch,
        })
        .expect(400);
      expect(tasks.create).not.toHaveBeenCalled();
    },
  );

  it("validates public IDs before accessing persistence", async () => {
    await request(app.getHttpServer())
      .get("/api/public-tasks/invalid")
      .expect(400);
    expect(tasks.getPublic).not.toHaveBeenCalled();
  });
});
