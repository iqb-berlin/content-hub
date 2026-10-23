import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AcpCredentialsService } from "./acp-credentials.service";
import { AcpService } from "./acp.service";
import {
  Acp,
  AcpUserRole,
  AcpAccessConfig,
  AcpCredential,
  AppSettings,
  AccessModel,
  ItemResponseState,
  User,
} from "../database/entities";

describe("AcpService", () => {
  let service: AcpService;
  let acpRepo: any;
  let roleRepo: any;
  let accessConfigRepo: any;
  let credentialRepo: any;
  let settingsRepo: any;
  let userRepo: any;
  let responseStateRepo: any;
  let dataSource: any;

  const mockAcp = {
    id: "acp-1",
    packageId: "test-pkg",
    name: "Test ACP",
    description: "A test ACP",
    acpIndex: { packageId: "test-pkg", version: "0.5.0", units: [] },
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    acpRepo = {
      find: jest.fn().mockResolvedValue([mockAcp]),
      findOne: jest.fn().mockResolvedValue(mockAcp),
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: "new-acp" })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    roleRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(2),
    };
    accessConfigRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    accessConfigRepo.manager = {
      transaction: async (fn: any) =>
        fn({ getRepository: () => accessConfigRepo }),
    };
    credentialRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest
        .fn()
        .mockImplementation((entities) => Promise.resolve(entities)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    credentialRepo.manager = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: () => credentialRepo,
          query: jest.fn().mockResolvedValue([]),
        }),
      ),
    };
    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: "user-1", isAppAdmin: false }),
      find: jest.fn().mockResolvedValue([]),
    };
    responseStateRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: (entity: unknown) =>
            entity === ItemResponseState ? responseStateRepo : acpRepo,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcpService,
        AcpCredentialsService,
        { provide: getRepositoryToken(Acp), useValue: acpRepo },
        { provide: getRepositoryToken(AcpUserRole), useValue: roleRepo },
        {
          provide: getRepositoryToken(AcpAccessConfig),
          useValue: accessConfigRepo,
        },
        {
          provide: getRepositoryToken(AcpCredential),
          useValue: credentialRepo,
        },
        { provide: getRepositoryToken(AppSettings), useValue: settingsRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<AcpService>(AcpService);
  });

  it("rejects capability updates for missing role assignments", async () => {
    roleRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateRoleCapabilities("acp-1", "user-1", []),
    ).rejects.toThrow(NotFoundException);
    expect(roleRepo.save).not.toHaveBeenCalled();
  });

  it("persists normalized capabilities on the requested assignment", async () => {
    const role = {
      acpId: "acp-1",
      userId: "user-1",
      capabilities: ["explorer.read"],
    };
    roleRepo.findOne.mockResolvedValue(role);
    roleRepo.save.mockImplementation(async (value: typeof role) => value);
    const result = await service.updateRoleCapabilities("acp-1", "user-1", []);
    expect(roleRepo.findOne).toHaveBeenCalledWith({
      where: { acpId: "acp-1", userId: "user-1" },
    });
    expect(result.capabilities).toEqual([]);
    expect(roleRepo.save).toHaveBeenCalledWith(role);
  });

  describe("findAll", () => {
    it("should return all ACPs", async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(acpRepo.find).toHaveBeenCalledWith({ order: { name: "ASC" } });
    });
  });

  describe("findById", () => {
    it("should return ACP by id", async () => {
      const result = await service.findById("acp-1");
      expect(result.name).toBe("Test ACP");
    });

    it("should throw NotFoundException", async () => {
      acpRepo.findOne.mockResolvedValue(null);
      await expect(service.findById("bad")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("should create a new ACP", async () => {
      acpRepo.findOne.mockResolvedValueOnce(null); // packageId check
      await service.create({ packageId: "new-pkg", name: "New" });
      expect(acpRepo.create).toHaveBeenCalled();
      expect(acpRepo.save).toHaveBeenCalled();
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          acpId: "new-acp",
          accessModel: AccessModel.PRIVATE,
          allowRegistered: false,
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
          }),
        }),
      );
    });

    it("should throw ConflictException for duplicate package ID", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      await expect(
        service.create({ packageId: "test-pkg", name: "Dup" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("delete", () => {
    it("should delete existing ACP", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      await service.delete("acp-1");
      expect(responseStateRepo.delete).toHaveBeenCalledWith({ acpId: "acp-1" });
      expect(acpRepo.remove).toHaveBeenCalledWith(mockAcp);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateIndex", () => {
    it("should update ACP-Index", async () => {
      const newIndex = {
        packageId: "test-pkg",
        version: "1.0.0",
        units: [{ id: "u1" }],
      };
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      acpRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      const result = await service.updateIndex("acp-1", newIndex);
      expect(result).toMatchObject(newIndex);
      expect((result as any).assessmentParts?.[0]?.units).toEqual([
        { id: "u1" },
      ]);
    });

    it("should reject invalid status", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      await expect(
        service.updateIndex("acp-1", {
          packageId: "test-pkg",
          status: "DRAFT",
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("importIndex", () => {
    it("should fill missing required fields with defaults", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      acpRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const result = await service.importIndex("acp-1", {
        assessmentParts: [],
      });

      expect((result as any).packageId).toBe("test-pkg");
      expect((result as any).version).toBe("0.5.0");
      expect((result as any).status).toBe("IN_DEVELOPMENT");
      expect((result as any).name).toEqual([{ lang: "de", value: "Test ACP" }]);
    });

    it("should reject unknown status values", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      await expect(
        service.importIndex("acp-1", {
          packageId: "test-pkg",
          status: "INVALID_STATUS",
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject packageId mismatch", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      await expect(
        service.importIndex("acp-1", { packageId: "other-pkg" } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("deleteIndex", () => {
    it("should reset index using configured defaults", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      acpRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      settingsRepo.findOne.mockResolvedValue({
        defaultAcpIndex: {
          assessmentParts: [
            {
              id: "part-1",
            },
          ],
        },
      });

      const result = await service.deleteIndex("acp-1");

      expect(settingsRepo.findOne).toHaveBeenCalledWith({ where: {} });
      expect(acpRepo.save).toHaveBeenCalled();
      expect((result as any).packageId).toBe("test-pkg");
      expect((result as any).assessmentParts).toHaveLength(1);
    });

    it("should reset index with ACP fallbacks when no defaults are configured", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      acpRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      settingsRepo.findOne.mockResolvedValue(null);

      const result = await service.deleteIndex("acp-1");

      expect((result as any).packageId).toBe("test-pkg");
      expect((result as any).version).toBe("0.5.0");
      expect((result as any).status).toBe("IN_DEVELOPMENT");
    });
  });

  describe("assignRole", () => {
    it("should create new role assignment", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      roleRepo.findOne.mockResolvedValue(null);
      await service.assignRole("acp-1", {
        userId: "user-1",
        role: "ACP_MANAGER",
      });
      expect(roleRepo.create).toHaveBeenCalled();
      expect(roleRepo.save).toHaveBeenCalled();
    });

    it("should update existing role", async () => {
      const existingRole = {
        userId: "user-1",
        acpId: "acp-1",
        role: "READ_ONLY",
      };
      acpRepo.findOne.mockResolvedValue(mockAcp);
      roleRepo.findOne.mockResolvedValue(existingRole);
      await service.assignRole("acp-1", {
        userId: "user-1",
        role: "ACP_MANAGER",
      });
      expect(roleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: "ACP_MANAGER" }),
      );
    });
  });

  describe("updateAccessConfig", () => {
    it("should create access config if none exists", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValue(null);
      await service.updateAccessConfig("acp-1", { accessModel: "PUBLIC" });
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
          }),
        }),
      );
      expect(accessConfigRepo.save).toHaveBeenCalled();
    });

    it("normalizes legacy metadata column key on update", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValue({
        acpId: "acp-1",
        accessModel: AccessModel.PUBLIC,
        featureConfig: {},
      });

      await service.updateAccessConfig("acp-1", {
        accessModel: "PUBLIC",
        featureConfig: {
          itemListMetadataColumns: ["col-1", "col-2"],
        },
      });

      expect(accessConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            metadataColumns: {
              visible: ["col-1", "col-2"],
              order: ["col-1", "col-2"],
            },
          }),
        }),
      );
    });

    it("validates credential access time window constraints", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);

      await expect(
        service.updateAccessConfig("acp-1", {
          accessModel: "CREDENTIALS_LIST",
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateAccessConfig("acp-1", {
          accessModel: "CREDENTIALS_LIST",
          validFrom: "invalid",
          validUntil: "2026-01-01T00:00:00.000Z",
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateAccessConfig("acp-1", {
          accessModel: "CREDENTIALS_LIST",
          validFrom: "2026-01-02T00:00:00.000Z",
          validUntil: "2026-01-01T00:00:00.000Z",
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateAccessConfig("acp-1", {
          accessModel: "CREDENTIALS_LIST",
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2026-05-05T00:00:00.000Z",
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("retains credential access dates during feature-only updates", async () => {
      const validFrom = new Date("2026-01-01T00:00:00.000Z");
      const validUntil = new Date("2026-02-01T00:00:00.000Z");
      accessConfigRepo.findOne.mockResolvedValue({
        acpId: "acp-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
        allowRegistered: false,
        featureConfig: {},
        validFrom,
        validUntil,
      });

      await service.updateAccessConfig("acp-1", {
        accessModel: "CREDENTIALS_LIST",
        featureConfig: { enablePersonalItemData: true },
      });

      expect(accessConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessModel: AccessModel.CREDENTIALS_LIST,
          validFrom,
          validUntil,
          featureConfig: expect.objectContaining({
            enablePersonalItemData: true,
          }),
        }),
      );
    });

    it("requires a new validity window when switching to credential access", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        acpId: "acp-1",
        accessModel: AccessModel.PUBLIC,
        allowRegistered: false,
        featureConfig: {},
        validFrom: new Date("2025-01-01T00:00:00.000Z"),
        validUntil: new Date("2025-02-01T00:00:00.000Z"),
      });

      await expect(
        service.updateAccessConfig("acp-1", {
          accessModel: "CREDENTIALS_LIST",
        }),
      ).rejects.toThrow(
        "Credential-based access requires validFrom and validUntil",
      );
    });

    it("updates existing access config values", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValue({
        acpId: "acp-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
        allowRegistered: false,
        featureConfig: {},
      });

      await service.updateAccessConfig("acp-1", {
        accessModel: "PUBLIC",
        allowRegistered: true,
      } as any);

      expect(accessConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessModel: "PUBLIC",
          allowRegistered: true,
          validFrom: null,
          validUntil: null,
        }),
      );
    });
  });

  describe("misc ACP operations", () => {
    it("finds ACPs by user role relation", async () => {
      roleRepo.find.mockResolvedValue([
        { acp: { id: "acp-a" } },
        { acp: { id: "acp-b" } },
      ]);
      await expect(service.findByUser("user-1")).resolves.toEqual([
        { id: "acp-a" },
        { id: "acp-b" },
      ]);
      expect(roleRepo.find).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        relations: ["acp"],
      });
    });

    it("updates ACP metadata fields", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });
      await service.update("acp-1", {
        name: "Updated Name",
        description: "Updated Desc",
      });
      expect(acpRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated Name",
          description: "Updated Desc",
        }),
      );
    });

    it("returns normalized ACP index via getIndex", async () => {
      acpRepo.findOne.mockResolvedValue({
        ...mockAcp,
        acpIndex: {
          version: "0.5.0",
          assessmentParts: [],
        },
      });
      const index = await service.getIndex("acp-1");
      expect((index as any).assessmentParts).toEqual([]);
      expect((index as any).version).toBe("0.5.0");
    });
  });

  describe("role management edge cases", () => {
    it("throws when target user does not exist", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assignRole("acp-1", {
          userId: "missing-user",
          role: "READ_ONLY",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("prevents removing last ACP manager on role downgrade/remove", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      roleRepo.findOne.mockResolvedValue({
        userId: "user-1",
        acpId: "acp-1",
        role: "ACP_MANAGER",
      });
      roleRepo.count.mockResolvedValue(1);

      await expect(
        service.assignRole("acp-1", { userId: "user-1", role: "READ_ONLY" }),
      ).rejects.toThrow(BadRequestException);

      await expect(service.removeRole("acp-1", "user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("removes role when manager count is sufficient", async () => {
      roleRepo.findOne.mockResolvedValue({
        userId: "user-1",
        acpId: "acp-1",
        role: "ACP_MANAGER",
      });
      roleRepo.count.mockResolvedValue(2);

      await service.removeRole("acp-1", "user-1");
      expect(roleRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1" }),
      );
    });

    it("returns roles with user relation", async () => {
      roleRepo.find.mockResolvedValue([{ id: "role-1" }]);
      await expect(service.getRoles("acp-1")).resolves.toEqual([
        { id: "role-1" },
      ]);
      expect(roleRepo.find).toHaveBeenCalledWith({
        where: { acpId: "acp-1" },
        relations: ["user"],
      });
    });
  });

  describe("access config retrieval and metadata updates", () => {
    it("creates a default private config when missing and persists normalized feature config when needed", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getAccessConfig("acp-1")).resolves.toMatchObject({
        acpId: "acp-1",
        accessModel: AccessModel.PRIVATE,
        allowRegistered: false,
      });
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          acpId: "acp-1",
          accessModel: AccessModel.PRIVATE,
          allowRegistered: false,
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
          }),
        }),
      );

      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValueOnce({
        id: "cfg-1",
        acpId: "acp-1",
        featureConfig: {
          itemListMetadataColumns: ["legacy"],
        },
      });

      await service.getAccessConfig("acp-1");
      expect(accessConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            metadataColumns: {
              visible: ["legacy"],
              order: ["legacy"],
            },
          }),
        }),
      );
    });

    it("updates metadata columns and creates a default config when missing", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateMetadataColumns("acp-1", {
          visibleColumns: ["a"],
          columnOrder: ["a"],
        }),
      ).resolves.toMatchObject({
        acpId: "acp-1",
        accessModel: AccessModel.PRIVATE,
        featureConfig: expect.objectContaining({
          metadataColumns: expect.objectContaining({
            visible: ["a"],
            order: ["a"],
            configured: true,
          }),
        }),
      });

      acpRepo.findOne.mockResolvedValue(mockAcp);
      accessConfigRepo.findOne.mockResolvedValueOnce({
        acpId: "acp-1",
        featureConfig: {
          metadataColumns: {
            visible: ["old"],
            order: ["old"],
            configured: true,
            definitions: [{ id: "custom", label: "Eigene Spalte" }],
            widths: { custom: 260 },
            referenceNumberVisible: true,
          },
        },
      });

      await service.updateMetadataColumns("acp-1", {
        visibleColumns: ["a", "b"],
        columnOrder: ["b", "a"],
      });

      expect(accessConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            metadataColumns: expect.objectContaining({
              visible: ["a", "b"],
              order: ["b", "a"],
              configured: true,
              definitions: [{ id: "custom", label: "Eigene Spalte" }],
              widths: { custom: 260 },
              referenceNumberVisible: true,
            }),
          }),
        }),
      );
    });
  });

  describe("credentials management", () => {
    beforeEach(() => {
      jest.spyOn(bcrypt, "hash").mockResolvedValue("hashed" as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("requires CREDENTIALS_LIST access model for credential upload", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.PUBLIC,
      });
      await expect(
        service.uploadCredentials(
          "acp-1",
          [{ username: "u", password: "p" }],
          "replace",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("supports replace/append/upsert credential upload modes", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
      });
      credentialRepo.find.mockResolvedValue([
        { id: "cred-1", username: "existing", passwordHash: "x" },
      ]);

      const replace = await service.uploadCredentials(
        "acp-1",
        [{ username: "new-user", password: "pw" }],
        "replace",
      );
      expect(replace).toEqual({
        added: 1,
        updated: 0,
        skipped: 0,
        duplicates: [],
      });
      expect(credentialRepo.remove).toHaveBeenCalledWith([
        expect.objectContaining({ id: "cred-1", username: "existing" }),
      ]);

      const append = await service.uploadCredentials(
        "acp-1",
        [
          { username: "existing", password: "pw" },
          { username: "new-user-2", password: "pw" },
        ],
        "append",
      );
      expect(append.skipped).toBe(1);
      expect(append.added).toBe(1);

      credentialRepo.save.mockClear();
      const upsert = await service.uploadCredentials(
        "acp-1",
        [
          { username: "existing", password: "pw" },
          { username: "brand-new", password: "pw" },
        ],
        "upsert",
      );
      expect(upsert.updated).toBe(1);
      expect(upsert.added).toBe(1);
    });

    it("preserves stable credential ids during replace uploads", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
      });
      credentialRepo.find.mockResolvedValue([
        { id: "cred-1", username: "existing", passwordHash: "old" },
      ]);

      const result = await service.uploadCredentials(
        "acp-1",
        [{ username: "existing", password: "new-password" }],
        "replace",
      );

      expect(result).toEqual({
        added: 0,
        updated: 1,
        skipped: 0,
        duplicates: [],
      });
      expect(credentialRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "cred-1",
          username: "existing",
          passwordHash: "hashed",
        }),
      ]);
      expect(credentialRepo.remove).not.toHaveBeenCalled();
    });

    it("removes duplicate existing usernames during replace uploads", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
      });
      credentialRepo.find.mockResolvedValue([
        { id: "cred-1", username: "existing", passwordHash: "old-a" },
        { id: "cred-2", username: "existing", passwordHash: "old-b" },
      ]);

      const result = await service.uploadCredentials(
        "acp-1",
        [{ username: "existing", password: "new-password" }],
        "replace",
      );

      expect(result).toEqual({
        added: 0,
        updated: 1,
        skipped: 0,
        duplicates: [],
      });
      expect(credentialRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: "cred-1", passwordHash: "hashed" }),
      ]);
      expect(credentialRepo.remove).toHaveBeenCalledWith([
        expect.objectContaining({ id: "cred-2" }),
      ]);
    });

    it("does not hash credentials skipped by append uploads", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
      });
      credentialRepo.find.mockResolvedValue([
        { id: "cred-1", username: "existing", passwordHash: "old" },
      ]);
      const hash = jest.mocked(bcrypt.hash);

      const result = await service.uploadCredentials(
        "acp-1",
        [
          { username: "existing", password: "must-not-be-hashed" },
          { username: "new-user", password: "new-password" },
        ],
        "append",
      );

      expect(result).toEqual({
        added: 1,
        updated: 0,
        skipped: 1,
        duplicates: [],
      });
      expect(hash).toHaveBeenCalledTimes(1);
      expect(hash).toHaveBeenCalledWith("new-password", 12);
    });

    it("handles duplicate usernames within upload payload", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
      });
      credentialRepo.find.mockResolvedValue([]);

      const result = await service.uploadCredentials(
        "acp-1",
        [
          { username: "dup-user", password: "a" },
          { username: "dup-user", password: "b" },
        ],
        "append",
      );

      expect(result.duplicates).toEqual(["dup-user"]);
      expect(result.added).toBe(1);
    });

    it("reads, creates, updates and deletes credentials", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        id: "cfg-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
      });
      credentialRepo.find.mockResolvedValue([
        { id: "cred-1", username: "reader-1" },
      ]);
      await expect(service.getCredentials("acp-1")).resolves.toEqual([
        { id: "cred-1", username: "reader-1" },
      ]);

      credentialRepo.findOne.mockResolvedValueOnce(null);
      credentialRepo.save.mockResolvedValueOnce({
        id: "cred-2",
        username: "reader-2",
      });
      await expect(
        service.createCredential("acp-1", {
          username: "reader-2",
          password: "pw",
        } as any),
      ).resolves.toEqual({ id: "cred-2", username: "reader-2" });

      credentialRepo.findOne.mockResolvedValueOnce({
        id: "cred-2",
        username: "reader-2",
        accessConfigId: "cfg-1",
      });
      await expect(
        service.createCredential("acp-1", {
          username: "reader-2",
          password: "pw",
        } as any),
      ).rejects.toThrow(ConflictException);

      credentialRepo.findOne
        .mockResolvedValueOnce({
          id: "cred-2",
          username: "reader-2",
          accessConfigId: "cfg-1",
          passwordHash: "old",
        })
        .mockResolvedValueOnce(null);
      credentialRepo.save.mockResolvedValueOnce({
        id: "cred-2",
        username: "reader-renamed",
      });
      await expect(
        service.updateCredential("acp-1", "cred-2", {
          username: "reader-renamed",
          password: "new",
        } as any),
      ).resolves.toEqual({ id: "cred-2", username: "reader-renamed" });

      credentialRepo.findOne
        .mockResolvedValueOnce({
          id: "cred-3",
          username: "reader-3",
          accessConfigId: "cfg-1",
        })
        .mockResolvedValueOnce(null);
      await expect(
        service.deleteCredential("acp-1", "cred-3"),
      ).resolves.toBeUndefined();
      await expect(
        service.deleteCredential("acp-1", "missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns assignable users including admins needing explicit participation", async () => {
      acpRepo.findOne.mockResolvedValue(mockAcp);
      userRepo.find.mockResolvedValue([
        { id: "user-1", username: "u1", displayName: "User 1" },
      ]);

      await expect(service.getAssignableUsers("acp-1")).resolves.toEqual([
        { id: "user-1", username: "u1", displayName: "User 1" },
      ]);
      expect(userRepo.find).toHaveBeenCalledWith({
        select: ["id", "username", "displayName"],
        order: { username: "ASC" },
      });
    });
  });

  describe("index payload validation", () => {
    it("rejects invalid ACP index object types and language payloads", async () => {
      acpRepo.findOne.mockResolvedValue({ ...mockAcp });

      await expect(service.updateIndex("acp-1", [] as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.importIndex("acp-1", {
          packageId: "test-pkg",
          version: 1 as any,
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("acp-1", {
          packageId: "test-pkg",
          name: {} as any,
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("acp-1", {
          packageId: "test-pkg",
          name: [{ lang: "deu", value: "Bad Lang" }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("acp-1", {
          packageId: "test-pkg",
          name: [{ lang: "de", value: "" }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("acp-1", {
          packageId: "test-pkg",
          status: 123 as any,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
