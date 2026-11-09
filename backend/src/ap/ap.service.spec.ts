import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { ApCredentialsService } from "./ap-credentials.service";
import { ApService } from "./ap.service";
import {
  Ap,
  ApUserRole,
  ApAccessConfig,
  ApCredential,
  AppSettings,
  AccessModel,
  ItemResponseState,
  User,
} from "../database/entities";

describe("ApService", () => {
  let service: ApService;
  let apRepo: any;
  let roleRepo: any;
  let accessConfigRepo: any;
  let credentialRepo: any;
  let settingsRepo: any;
  let userRepo: any;
  let responseStateRepo: any;
  let dataSource: any;

  const mockAp = {
    id: "ap-1",
    packageId: "test-pkg",
    name: "Test AP",
    description: "A test AP",
    apIndex: { packageId: "test-pkg", version: "0.5.0", units: [] },
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    apRepo = {
      find: jest.fn().mockResolvedValue([mockAp]),
      findOne: jest.fn().mockResolvedValue(mockAp),
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: "new-ap" })),
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
            entity === ItemResponseState ? responseStateRepo : apRepo,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApService,
        ApCredentialsService,
        { provide: getRepositoryToken(Ap), useValue: apRepo },
        { provide: getRepositoryToken(ApUserRole), useValue: roleRepo },
        {
          provide: getRepositoryToken(ApAccessConfig),
          useValue: accessConfigRepo,
        },
        {
          provide: getRepositoryToken(ApCredential),
          useValue: credentialRepo,
        },
        { provide: getRepositoryToken(AppSettings), useValue: settingsRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<ApService>(ApService);
  });

  it("rejects capability updates for missing role assignments", async () => {
    roleRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateRoleCapabilities("ap-1", "user-1", []),
    ).rejects.toThrow(NotFoundException);
    expect(roleRepo.save).not.toHaveBeenCalled();
  });

  it("persists normalized capabilities on the requested assignment", async () => {
    const role = {
      apId: "ap-1",
      userId: "user-1",
      capabilities: ["explorer.read"],
    };
    roleRepo.findOne.mockResolvedValue(role);
    roleRepo.save.mockImplementation(async (value: typeof role) => value);
    const result = await service.updateRoleCapabilities("ap-1", "user-1", []);
    expect(roleRepo.findOne).toHaveBeenCalledWith({
      where: { apId: "ap-1", userId: "user-1" },
    });
    expect(result.capabilities).toEqual([]);
    expect(roleRepo.save).toHaveBeenCalledWith(role);
  });

  describe("findAll", () => {
    it("should return all APs", async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(apRepo.find).toHaveBeenCalledWith({ order: { name: "ASC" } });
    });
  });

  describe("findById", () => {
    it("should return AP by id", async () => {
      const result = await service.findById("ap-1");
      expect(result.name).toBe("Test AP");
    });

    it("should throw NotFoundException", async () => {
      apRepo.findOne.mockResolvedValue(null);
      await expect(service.findById("bad")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("should create a new AP", async () => {
      apRepo.findOne.mockResolvedValueOnce(null); // packageId check
      await service.create({ packageId: "new-pkg", name: "New" });
      expect(apRepo.create).toHaveBeenCalled();
      expect(apRepo.save).toHaveBeenCalled();
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apId: "new-ap",
          accessModel: AccessModel.PRIVATE,
          allowRegistered: false,
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
          }),
        }),
      );
    });

    it("should throw ConflictException for duplicate package ID", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      await expect(
        service.create({ packageId: "test-pkg", name: "Dup" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("delete", () => {
    it("should delete existing AP", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      await service.delete("ap-1");
      expect(responseStateRepo.delete).toHaveBeenCalledWith({ apId: "ap-1" });
      expect(apRepo.remove).toHaveBeenCalledWith(mockAp);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateIndex", () => {
    it("should update AP-Index", async () => {
      const newIndex = {
        packageId: "test-pkg",
        version: "1.0.0",
        units: [{ id: "u1" }],
      };
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      apRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      const result = await service.updateIndex("ap-1", newIndex);
      expect(result).toMatchObject(newIndex);
      expect((result as any).assessmentParts?.[0]?.units).toEqual([
        { id: "u1" },
      ]);
    });

    it("should reject invalid status", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      await expect(
        service.updateIndex("ap-1", {
          packageId: "test-pkg",
          status: "DRAFT",
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("importIndex", () => {
    it("should fill missing required fields with defaults", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      apRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const result = await service.importIndex("ap-1", {
        assessmentParts: [],
      });

      expect((result as any).packageId).toBe("test-pkg");
      expect((result as any).version).toBe("0.5.0");
      expect((result as any).status).toBe("IN_DEVELOPMENT");
      expect((result as any).name).toEqual([{ lang: "de", value: "Test AP" }]);
    });

    it("should reject unknown status values", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      await expect(
        service.importIndex("ap-1", {
          packageId: "test-pkg",
          status: "INVALID_STATUS",
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject packageId mismatch", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      await expect(
        service.importIndex("ap-1", { packageId: "other-pkg" } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("deleteIndex", () => {
    it("should reset index using configured defaults", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      apRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      settingsRepo.findOne.mockResolvedValue({
        defaultApIndex: {
          assessmentParts: [
            {
              id: "part-1",
            },
          ],
        },
      });

      const result = await service.deleteIndex("ap-1");

      expect(settingsRepo.findOne).toHaveBeenCalledWith({ where: {} });
      expect(apRepo.save).toHaveBeenCalled();
      expect((result as any).packageId).toBe("test-pkg");
      expect((result as any).assessmentParts).toHaveLength(1);
    });

    it("should reset index with AP fallbacks when no defaults are configured", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      apRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      settingsRepo.findOne.mockResolvedValue(null);

      const result = await service.deleteIndex("ap-1");

      expect((result as any).packageId).toBe("test-pkg");
      expect((result as any).version).toBe("0.5.0");
      expect((result as any).status).toBe("IN_DEVELOPMENT");
    });
  });

  describe("assignRole", () => {
    it("should create new role assignment", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      roleRepo.findOne.mockResolvedValue(null);
      await service.assignRole("ap-1", {
        userId: "user-1",
        role: "AP_MANAGER",
      });
      expect(roleRepo.create).toHaveBeenCalled();
      expect(roleRepo.save).toHaveBeenCalled();
    });

    it("should update existing role", async () => {
      const existingRole = {
        userId: "user-1",
        apId: "ap-1",
        role: "READ_ONLY",
      };
      apRepo.findOne.mockResolvedValue(mockAp);
      roleRepo.findOne.mockResolvedValue(existingRole);
      await service.assignRole("ap-1", {
        userId: "user-1",
        role: "AP_MANAGER",
      });
      expect(roleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: "AP_MANAGER" }),
      );
    });
  });

  describe("updateAccessConfig", () => {
    it("should create access config if none exists", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValue(null);
      await service.updateAccessConfig("ap-1", { accessModel: "PUBLIC" });
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
          }),
        }),
      );
      expect(accessConfigRepo.save).toHaveBeenCalled();
    });

    it("creates access config without accepting review visibility settings", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValue(null);
      await service.updateAccessConfig("ap-1", {
        accessModel: "PUBLIC",
        featureConfig: {
          hideReviewMetadata: true,
          hideReviewDeveloperNames: true,
          showMetadata: true,
        },
      });
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
            hideReviewMetadata: false,
            hideReviewDeveloperNames: false,
            showMetadata: true,
          }),
        }),
      );
      expect(accessConfigRepo.save).toHaveBeenCalled();
    });

    it.each([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
      [undefined, undefined],
    ])(
      "preserves stored review visibility (%s, %s) when access settings change",
      async (hideReviewMetadata, hideReviewDeveloperNames) => {
        for (const incoming of [
          undefined,
          true,
          false,
          "true",
          null,
          1,
          [],
          {},
        ]) {
          const config = {
            apId: "ap-1",
            accessModel: AccessModel.PUBLIC,
            reviewConfigVersion: 3,
            reviewRevision: "7",
            featureConfig: {
              hideReviewMetadata,
              hideReviewDeveloperNames,
              showMetadata: true,
            },
          };
          accessConfigRepo.findOne.mockResolvedValue(config);
          const result = await service.updateAccessConfig("ap-1", {
            accessModel: "PUBLIC",
            featureConfig: {
              ...(incoming !== undefined
                ? {
                    hideReviewMetadata: incoming,
                    hideReviewDeveloperNames: incoming,
                  }
                : {}),
              showMetadata: false,
              extension: { version: 1 },
            },
          });
          expect(result.featureConfig).toMatchObject({
            hideReviewMetadata: hideReviewMetadata ?? false,
            hideReviewDeveloperNames: hideReviewDeveloperNames ?? false,
            showMetadata: false,
            extension: { version: 1 },
          });
          expect(result.reviewConfigVersion).toBe(3);
          expect(result.reviewRevision).toBe("7");
          expect(accessConfigRepo.save).toHaveBeenLastCalledWith(config);
        }
      },
    );

    it("normalizes legacy metadata column key on update", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValue({
        apId: "ap-1",
        accessModel: AccessModel.PUBLIC,
        featureConfig: {},
      });

      await service.updateAccessConfig("ap-1", {
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
      apRepo.findOne.mockResolvedValue(mockAp);

      await expect(
        service.updateAccessConfig("ap-1", {
          accessModel: "CREDENTIALS_LIST",
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateAccessConfig("ap-1", {
          accessModel: "CREDENTIALS_LIST",
          validFrom: "invalid",
          validUntil: "2026-01-01T00:00:00.000Z",
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateAccessConfig("ap-1", {
          accessModel: "CREDENTIALS_LIST",
          validFrom: "2026-01-02T00:00:00.000Z",
          validUntil: "2026-01-01T00:00:00.000Z",
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateAccessConfig("ap-1", {
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
        apId: "ap-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
        allowRegistered: false,
        featureConfig: {},
        validFrom,
        validUntil,
      });

      await service.updateAccessConfig("ap-1", {
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
        apId: "ap-1",
        accessModel: AccessModel.PUBLIC,
        allowRegistered: false,
        featureConfig: {},
        validFrom: new Date("2025-01-01T00:00:00.000Z"),
        validUntil: new Date("2025-02-01T00:00:00.000Z"),
      });

      await expect(
        service.updateAccessConfig("ap-1", {
          accessModel: "CREDENTIALS_LIST",
        }),
      ).rejects.toThrow(
        "Credential-based access requires validFrom and validUntil",
      );
    });

    it("updates existing access config values", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValue({
        apId: "ap-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
        allowRegistered: false,
        featureConfig: {},
      });

      await service.updateAccessConfig("ap-1", {
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

  describe("misc AP operations", () => {
    it("finds APs by user role relation", async () => {
      roleRepo.find.mockResolvedValue([
        { ap: { id: "ap-a" } },
        { ap: { id: "ap-b" } },
      ]);
      await expect(service.findByUser("user-1")).resolves.toEqual([
        { id: "ap-a" },
        { id: "ap-b" },
      ]);
      expect(roleRepo.find).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        relations: ["ap"],
      });
    });

    it("updates AP metadata fields", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      await service.update("ap-1", {
        name: "Updated Name",
        description: "Updated Desc",
      });
      expect(apRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated Name",
          description: "Updated Desc",
        }),
      );
    });

    it("returns normalized AP index via getIndex", async () => {
      apRepo.findOne.mockResolvedValue({
        ...mockAp,
        apIndex: {
          version: "0.5.0",
          assessmentParts: [],
        },
      });
      const index = await service.getIndex("ap-1");
      expect((index as any).assessmentParts).toEqual([]);
      expect((index as any).version).toBe("0.5.0");
    });
  });

  describe("role management edge cases", () => {
    it("throws when target user does not exist", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assignRole("ap-1", {
          userId: "missing-user",
          role: "READ_ONLY",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("prevents removing last AP manager on role downgrade/remove", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      roleRepo.findOne.mockResolvedValue({
        userId: "user-1",
        apId: "ap-1",
        role: "AP_MANAGER",
      });
      roleRepo.count.mockResolvedValue(1);

      await expect(
        service.assignRole("ap-1", { userId: "user-1", role: "READ_ONLY" }),
      ).rejects.toThrow(BadRequestException);

      await expect(service.removeRole("ap-1", "user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("removes role when manager count is sufficient", async () => {
      roleRepo.findOne.mockResolvedValue({
        userId: "user-1",
        apId: "ap-1",
        role: "AP_MANAGER",
      });
      roleRepo.count.mockResolvedValue(2);

      await service.removeRole("ap-1", "user-1");
      expect(roleRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1" }),
      );
    });

    it("returns roles with user relation", async () => {
      roleRepo.find.mockResolvedValue([{ id: "role-1" }]);
      await expect(service.getRoles("ap-1")).resolves.toEqual([
        { id: "role-1" },
      ]);
      expect(roleRepo.find).toHaveBeenCalledWith({
        where: { apId: "ap-1" },
        relations: ["user"],
      });
    });
  });

  describe("access config retrieval and metadata updates", () => {
    it("creates a default private config when missing and persists normalized feature config when needed", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getAccessConfig("ap-1")).resolves.toMatchObject({
        apId: "ap-1",
        accessModel: AccessModel.PRIVATE,
        allowRegistered: false,
      });
      expect(accessConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apId: "ap-1",
          accessModel: AccessModel.PRIVATE,
          allowRegistered: false,
          featureConfig: expect.objectContaining({
            enablePlayerFocusHighlight: false,
          }),
        }),
      );

      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValueOnce({
        id: "cfg-1",
        apId: "ap-1",
        featureConfig: {
          itemListMetadataColumns: ["legacy"],
        },
      });

      await service.getAccessConfig("ap-1");
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
      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateMetadataColumns("ap-1", {
          visibleColumns: ["a"],
          columnOrder: ["a"],
        }),
      ).resolves.toMatchObject({
        apId: "ap-1",
        accessModel: AccessModel.PRIVATE,
        featureConfig: expect.objectContaining({
          metadataColumns: expect.objectContaining({
            visible: ["a"],
            order: ["a"],
            configured: true,
          }),
        }),
      });

      apRepo.findOne.mockResolvedValue(mockAp);
      accessConfigRepo.findOne.mockResolvedValueOnce({
        apId: "ap-1",
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

      await service.updateMetadataColumns("ap-1", {
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
          "ap-1",
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
        "ap-1",
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
        "ap-1",
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
        "ap-1",
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
        "ap-1",
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
        "ap-1",
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
        "ap-1",
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
        "ap-1",
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
      await expect(service.getCredentials("ap-1")).resolves.toEqual([
        { id: "cred-1", username: "reader-1" },
      ]);

      credentialRepo.findOne.mockResolvedValueOnce(null);
      credentialRepo.save.mockResolvedValueOnce({
        id: "cred-2",
        username: "reader-2",
      });
      await expect(
        service.createCredential("ap-1", {
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
        service.createCredential("ap-1", {
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
        service.updateCredential("ap-1", "cred-2", {
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
        service.deleteCredential("ap-1", "cred-3"),
      ).resolves.toBeUndefined();
      await expect(service.deleteCredential("ap-1", "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns assignable users including admins needing explicit participation", async () => {
      apRepo.findOne.mockResolvedValue(mockAp);
      userRepo.find.mockResolvedValue([
        { id: "user-1", username: "u1", displayName: "User 1" },
      ]);

      await expect(service.getAssignableUsers("ap-1")).resolves.toEqual([
        { id: "user-1", username: "u1", displayName: "User 1" },
      ]);
      expect(userRepo.find).toHaveBeenCalledWith({
        select: ["id", "username", "displayName"],
        order: { username: "ASC" },
      });
    });
  });

  describe("index payload validation", () => {
    it("rejects invalid AP index object types and language payloads", async () => {
      apRepo.findOne.mockResolvedValue({ ...mockAp });

      await expect(service.updateIndex("ap-1", [] as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.importIndex("ap-1", {
          packageId: "test-pkg",
          version: 1 as any,
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("ap-1", {
          packageId: "test-pkg",
          name: {} as any,
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("ap-1", {
          packageId: "test-pkg",
          name: [{ lang: "deu", value: "Bad Lang" }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("ap-1", {
          packageId: "test-pkg",
          name: [{ lang: "de", value: "" }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importIndex("ap-1", {
          packageId: "test-pkg",
          status: 123 as any,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
