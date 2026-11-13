import { INestApplication, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";
import { ServerApiController } from "./server-api.controller";
import { ServerApiService } from "./server-api.service";
import { ServerApiAuthGuard } from "./server-api-auth.guard";
import { ServerApiAuthService } from "./server-api-auth.service";
import { ServerApiAuditInterceptor } from "./server-api-audit.interceptor";
import { ServerApiAuditService } from "./server-api-audit.service";

describe("Server API UUID request lifecycle", () => {
  let app: INestApplication;
  let serverApiService: { listFiles: jest.Mock };
  let authService: {
    validateToken: jest.Mock;
    hasScopes: jest.Mock;
  };

  const version5Uuid = "21f7f8de-8051-5b89-8680-0195ef798b6a";

  beforeAll(async () => {
    serverApiService = {
      listFiles: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException(`AP with ID ${version5Uuid} not found`),
        ),
    };
    authService = {
      validateToken: jest.fn().mockResolvedValue({
        id: "test-client",
        scopes: ["files.read"],
        allowedApIds: null,
      }),
      hasScopes: jest
        .fn()
        .mockImplementation((scopes: string[], required: string[]) =>
          required.every((scope) => scopes.includes(scope)),
        ),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ServerApiController],
      providers: [
        ServerApiAuthGuard,
        ServerApiAuditInterceptor,
        {
          provide: ServerApiService,
          useValue: serverApiService,
        },
        {
          provide: ServerApiAuthService,
          useValue: authService,
        },
        {
          provide: ServerApiAuditService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  beforeEach(() => {
    serverApiService.listFiles.mockClear();
    authService.validateToken.mockClear();
    authService.hasScopes.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 before UUID parsing when authentication is missing", async () => {
    await request(app.getHttpServer())
      .get("/api/server/ap/not-a-uuid/files")
      .expect(401);

    expect(authService.validateToken).not.toHaveBeenCalled();
    expect(serverApiService.listFiles).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed UUID after successful authentication", async () => {
    await request(app.getHttpServer())
      .get("/api/server/ap/not-a-uuid/files")
      .set("x-server-token", "valid-token")
      .expect(400);

    expect(authService.validateToken).toHaveBeenCalledWith("valid-token");
    expect(serverApiService.listFiles).not.toHaveBeenCalled();
  });

  it("accepts a non-v4 UUID and lets the service return 404", async () => {
    await request(app.getHttpServer())
      .get(`/api/server/ap/${version5Uuid}/files`)
      .set("x-server-token", "valid-token")
      .expect(404);

    expect(serverApiService.listFiles).toHaveBeenCalledWith(version5Uuid, null);
  });
});
