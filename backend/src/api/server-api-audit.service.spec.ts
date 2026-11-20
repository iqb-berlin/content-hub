import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ServerApiAuditService } from "./server-api-audit.service";
import { ServerApiAuditLog } from "../database/entities";

describe("ServerApiAuditService", () => {
  let service: ServerApiAuditService;
  let auditRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: "log-1" }]),
    };

    auditRepository = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerApiAuditService,
        {
          provide: getRepositoryToken(ServerApiAuditLog),
          useValue: auditRepository,
        },
      ],
    }).compile();

    service = module.get(ServerApiAuditService);
  });

  it("creates and saves normalized audit entries", async () => {
    await service.log({
      clientId: "client-1",
      action: "ap.read",
      method: "GET",
      path: "/server/ap/ap-1",
      success: true,
      statusCode: 200,
    });

    expect(auditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        action: "ap.read",
        method: "GET",
        path: "/server/ap/ap-1",
        apId: undefined,
        resourceId: undefined,
        success: true,
        details: {},
      }),
    );
    expect(auditRepository.save).toHaveBeenCalled();
  });

  it("returns filtered logs with a clamped limit", async () => {
    const rows = await service.list(900, "ap.read", "client-1", [
      "ap-1",
      "ap-2",
    ]);

    const qb = auditRepository.createQueryBuilder.mock.results[0].value;
    expect(auditRepository.createQueryBuilder).toHaveBeenCalledWith("log");
    expect(qb.limit).toHaveBeenCalledWith(500);
    expect(qb.andWhere).toHaveBeenNthCalledWith(1, "log.action = :action", {
      action: "acp.read",
    });
    expect(qb.andWhere).toHaveBeenNthCalledWith(
      2,
      "log.client_id = :clientId",
      { clientId: "client-1" },
    );
    expect(qb.andWhere).toHaveBeenNthCalledWith(
      3,
      "log.acp_id IN (:...allowedApIds)",
      { allowedApIds: ["ap-1", "ap-2"] },
    );
    expect(rows).toEqual([{ id: "log-1" }]);
  });

  it("uses minimum limit of 1 and no filters when omitted", async () => {
    await service.list(0);

    const qb = auditRepository.createQueryBuilder.mock.results[0].value;
    expect(qb.limit).toHaveBeenCalledWith(1);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });
});
