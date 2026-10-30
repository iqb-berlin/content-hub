import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException, ForbiddenException, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AdminService } from "./admin.service";
import {
  Acp,
  AppSettings,
  ApplicationToken,
  ServerApiAuditLog,
} from "../database/entities";
import { DEFAULT_ACP_INDEX_VERSION } from "../acp/acp-index.utils";
import {
  GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
  getGeoGebraBundleCurrentDir,
} from "./geogebra-bundle.util";

describe("AdminService", () => {
  let service: AdminService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let applicationTokenRepository: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    manager: {
      transaction: jest.Mock;
    };
  };
  let auditRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let acpRepository: {
    find: jest.Mock;
  };
  let tempStoragePath: string;

  beforeEach(async () => {
    tempStoragePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "content-hub-geogebra-"),
    );
    process.env.FILE_STORAGE_PATH = tempStoragePath;

    repo = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto) => ({ id: "settings-1", ...dto })),
      save: jest.fn().mockImplementation(async (entity) => entity),
    };
    auditRepository = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity) => entity),
    };
    acpRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    applicationTokenRepository = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({
        id: "token-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...dto,
      })),
      save: jest.fn().mockImplementation(async (entity) => ({
        id: entity.id || "token-1",
        createdAt: entity.createdAt || new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: entity.updatedAt || new Date("2026-01-01T00:00:00.000Z"),
        ...entity,
      })),
      manager: {
        transaction: jest.fn().mockImplementation(async (callback) =>
          callback({
            getRepository: (entity: unknown) =>
              entity === ApplicationToken
                ? applicationTokenRepository
                : auditRepository,
          }),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(AppSettings), useValue: repo },
        {
          provide: getRepositoryToken(ApplicationToken),
          useValue: applicationTokenRepository,
        },
        {
          provide: getRepositoryToken(ServerApiAuditLog),
          useValue: auditRepository,
        },
        { provide: getRepositoryToken(Acp), useValue: acpRepository },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  afterEach(async () => {
    await fs.rm(tempStoragePath, { recursive: true, force: true });
    delete process.env.FILE_STORAGE_PATH;
  });

  it("creates default settings when none exist", async () => {
    repo.findOne.mockResolvedValueOnce(null);

    const result = await service.getSettings();

    expect(repo.create).toHaveBeenCalledWith({
      theme: {},
      language: "de",
      defaultAcpIndex: {
        version: DEFAULT_ACP_INDEX_VERSION,
        assessmentParts: [],
      },
      geoGebraBundle: null,
    });
    expect(repo.save).toHaveBeenCalled();
    expect(result.language).toBe("de");
  });

  it("normalizes legacy GeoGebra metadata to the API-backed path on read", async () => {
    repo.findOne.mockResolvedValue({
      id: "settings-1",
      theme: {},
      language: "de",
      defaultAcpIndex: {},
      geoGebraBundle: {
        sourceFileName: "GeoGebra.itcr.zip",
        deployScriptUrl: "/assets/GeoGebra/GeoGebra/deployggb.js",
        publicBasePath: "/assets/GeoGebra/",
        checksum: "abc",
        entryCount: 2,
        uploadedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    } as AppSettings);

    const result = await service.getSettings();

    expect(result.geoGebraBundle).toEqual(
      expect.objectContaining({
        deployScriptUrl: GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
        publicBasePath: "/api/shared-assets",
      }),
    );
  });

  it("updates theme and default ACP index settings", async () => {
    const existing = {
      id: "settings-1",
      theme: {},
      language: "de",
      logoUrl: undefined,
      landingPageHtml: undefined,
      imprintHtml: undefined,
      privacyHtml: undefined,
      accessibilityHtml: undefined,
      defaultAcpIndex: {},
      geoGebraBundle: null,
      updatedAt: new Date(),
    } as AppSettings;

    repo.findOne.mockResolvedValue(existing);

    const updated = await service.updateSettings({
      language: "en",
      logoUrl: "https://example.org/logo.svg",
      theme: { "--color-primary": "#123456" },
      defaultAcpIndex: { quality: "standard" },
      landingPageHtml: "<p>Landing</p>",
      imprintHtml: "<p>Imprint</p>",
      privacyHtml: "<p>Privacy</p>",
      accessibilityHtml: "<p>Accessibility</p>",
    });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "en",
        logoUrl: "https://example.org/logo.svg",
        theme: { "--color-primary": "#123456" },
        defaultAcpIndex: { quality: "standard" },
      }),
    );

    expect(updated.language).toBe("en");
    expect(updated.defaultAcpIndex).toEqual({ quality: "standard" });
  });

  it("lists application tokens without exposing token hashes", async () => {
    applicationTokenRepository.findAndCount.mockResolvedValue([
      [
        {
          id: "token-1",
          name: "Studio",
          tokenHash: "hidden",
          tokenPrefix: "ch_abc...",
          scopes: ["acp.read"],
          active: true,
          expiresAt: null,
          lastUsedAt: null,
          createdByUserId: "user-1",
          revokedByUserId: null,
          revokedAt: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        } as ApplicationToken,
      ],
      1,
    ]);

    const result = await service.listApplicationTokens({
      limit: 500,
      offset: 2,
    });

    expect(applicationTokenRepository.findAndCount).toHaveBeenCalledWith({
      where: {},
      order: { createdAt: "DESC" },
      take: 200,
      skip: 2,
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "token-1",
          name: "Studio",
          tokenPrefix: "ch_abc...",
          scopes: ["acp.read"],
          allowedAcpIds: null,
        }),
      ],
      total: 1,
      limit: 200,
      offset: 2,
    });
    expect(result.items[0]).not.toHaveProperty("tokenHash");
  });

  it("creates application tokens with one-time secrets and stored hashes", async () => {
    applicationTokenRepository.findOne.mockResolvedValue(null);

    const result = await service.createApplicationToken(
      {
        name: " Studio ",
        scopes: ["acp.read", "files.read", "files.read"],
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      "user-1",
    );

    expect(result.token).toMatch(/^ch_/);
    expect(result.name).toBe("Studio");
    expect(result.scopes).toEqual(["acp.read", "files.read"]);
    expect(result).not.toHaveProperty("tokenHash");
    expect(applicationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Studio",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        tokenPrefix: expect.stringMatching(/^ch_/),
        scopes: ["acp.read", "files.read"],
        allowedAcpIds: null,
        active: true,
        createdByUserId: "user-1",
        revokedAt: null,
      }),
    );
    expect(applicationTokenRepository.manager.transaction).toHaveBeenCalled();
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "admin:user-1",
        action: "application-token.create",
        method: "POST",
        path: "/api/admin/application-tokens",
        resourceId: "token-1",
        details: expect.objectContaining({
          resourceType: "application-token",
          tokenId: "token-1",
          name: "Studio",
          tokenPrefix: expect.stringMatching(/^ch_/),
          scopes: ["acp.read", "files.read"],
          allowedAcpIds: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      }),
    );
  });

  it("creates ACP-limited tokens only within the manager constraints", async () => {
    const acpId = "11111111-1111-4111-8111-111111111111";
    applicationTokenRepository.findOne.mockResolvedValue(null);
    acpRepository.find.mockResolvedValue([{ id: acpId }]);

    const result = await service.createApplicationToken(
      {
        name: "ACP Studio",
        scopes: ["acp.read"],
        allowedAcpIds: [acpId],
      },
      "manager-1",
      {
        allowedAcpIds: [acpId],
        auditAcpId: acpId,
        auditPath: `/api/acp/${acpId}/application-tokens`,
      },
    );

    expect(result.allowedAcpIds).toEqual([acpId]);
    expect(applicationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ allowedAcpIds: [acpId] }),
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/acp/${acpId}/application-tokens`,
        acpId,
        details: expect.objectContaining({ allowedAcpIds: [acpId] }),
      }),
    );
  });

  it("rejects global or out-of-scope tokens created by ACP managers", async () => {
    const managedAcpId = "11111111-1111-4111-8111-111111111111";
    const otherAcpId = "22222222-2222-4222-8222-222222222222";

    await expect(
      service.createApplicationToken(
        { name: "Global", scopes: ["acp.read"] },
        "manager-1",
        { allowedAcpIds: [managedAcpId] },
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.createApplicationToken(
        {
          name: "Other ACP",
          scopes: ["acp.read"],
          allowedAcpIds: [otherAcpId],
        },
        "manager-1",
        { allowedAcpIds: [managedAcpId] },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(
      applicationTokenRepository.manager.transaction,
    ).not.toHaveBeenCalled();
  });

  it("fails application token creation when transactional audit write fails", async () => {
    applicationTokenRepository.findOne.mockResolvedValue(null);
    auditRepository.save.mockRejectedValueOnce(new Error("audit down"));

    await expect(
      service.createApplicationToken(
        {
          name: "Studio",
          scopes: ["acp.read"],
        },
        "user-1",
      ),
    ).rejects.toThrow("audit down");
  });

  it("rejects duplicate names and unsupported application token scopes", async () => {
    applicationTokenRepository.findOne.mockResolvedValueOnce({
      id: "existing",
      name: "Studio",
    });

    await expect(
      service.createApplicationToken({
        name: "Studio",
        scopes: ["acp.read"],
      }),
    ).rejects.toThrow("already exists");

    applicationTokenRepository.findOne.mockResolvedValueOnce(null);
    await expect(
      service.createApplicationToken({
        name: "Studio 2",
        scopes: ["not-a-scope"],
      }),
    ).rejects.toThrow("Unsupported application token scopes");
  });

  it("maps concurrent duplicate application token creation to conflict", async () => {
    applicationTokenRepository.findOne.mockResolvedValue(null);
    applicationTokenRepository.save.mockRejectedValueOnce({
      code: "23505",
      constraint: "UQ_application_tokens_name",
    });

    await expect(
      service.createApplicationToken({
        name: "Studio",
        scopes: ["acp.read"],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("maps generated database name constraints to application token conflicts", async () => {
    applicationTokenRepository.findOne.mockResolvedValue(null);
    applicationTokenRepository.save.mockRejectedValueOnce({
      code: "23505",
      constraint: "UQ_d5f6164d651fcbf9f45011b841b",
      detail: "Key (name)=(Studio) already exists.",
    });

    await expect(
      service.createApplicationToken({
        name: "Studio",
        scopes: ["acp.read"],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("revokes application tokens", async () => {
    applicationTokenRepository.findOne.mockResolvedValue({
      id: "token-1",
      name: "Studio",
      tokenPrefix: "ch_abc...",
      scopes: ["acp.read"],
      active: true,
      expiresAt: null,
      lastUsedAt: null,
      createdByUserId: "user-1",
      revokedByUserId: null,
      revokedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as ApplicationToken);

    const result = await service.revokeApplicationToken("token-1", "admin-1");

    expect(applicationTokenRepository.findOne).toHaveBeenCalledWith({
      where: { id: "token-1" },
    });
    expect(applicationTokenRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "token-1",
        active: false,
        revokedByUserId: "admin-1",
        revokedAt: expect.any(Date),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "token-1",
        active: false,
        revokedByUserId: "admin-1",
      }),
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "admin:admin-1",
        action: "application-token.revoke",
        method: "PATCH",
        path: "/api/admin/application-tokens/token-1/revoke",
        resourceId: "token-1",
        details: expect.objectContaining({
          resourceType: "application-token",
          tokenId: "token-1",
          name: "Studio",
          tokenPrefix: "ch_abc...",
        }),
      }),
    );
  });

  it("allows ACP managers to revoke only tokens exclusive to their ACP", async () => {
    const managedAcpId = "11111111-1111-4111-8111-111111111111";
    const tokenBase = {
      id: "token-1",
      name: "Studio",
      tokenPrefix: "ch_abc...",
      scopes: ["acp.read"],
      active: true,
      expiresAt: null,
      lastUsedAt: null,
      createdByUserId: "user-1",
      revokedByUserId: null,
      revokedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as ApplicationToken;

    applicationTokenRepository.findOne
      .mockResolvedValueOnce({ ...tokenBase, allowedAcpIds: null })
      .mockResolvedValueOnce({
        ...tokenBase,
        allowedAcpIds: [managedAcpId, "22222222-2222-4222-8222-222222222222"],
      })
      .mockResolvedValueOnce({ ...tokenBase, allowedAcpIds: [managedAcpId] });

    const constraints = {
      allowedAcpIds: [managedAcpId],
      requireExclusiveAcp: true,
      auditAcpId: managedAcpId,
    };
    await expect(
      service.revokeApplicationToken("token-1", "manager-1", constraints),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.revokeApplicationToken("token-1", "manager-1", constraints),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.revokeApplicationToken("token-1", "manager-1", constraints),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "token-1",
        active: false,
        allowedAcpIds: [managedAcpId],
      }),
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ acpId: managedAcpId }),
    );
  });

  it("still revokes application tokens when non-blocking audit write fails", async () => {
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    applicationTokenRepository.findOne.mockResolvedValue({
      id: "token-1",
      name: "Studio",
      tokenPrefix: "ch_abc...",
      scopes: ["acp.read"],
      active: true,
      expiresAt: null,
      lastUsedAt: null,
      createdByUserId: "user-1",
      revokedByUserId: null,
      revokedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as ApplicationToken);
    auditRepository.save.mockRejectedValueOnce(new Error("audit down"));

    try {
      await expect(
        service.revokeApplicationToken("token-1", "admin-1"),
      ).resolves.toEqual(
        expect.objectContaining({
          id: "token-1",
          active: false,
          revokedByUserId: "admin-1",
        }),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not write non-blocking"),
        expect.any(String),
      );
    } finally {
      loggerErrorSpy.mockRestore();
    }
  });

  it("extracts and activates a GeoGebra bundle from a ZIP upload", async () => {
    const JSZip = require("jszip");
    const zip = new JSZip();
    zip.file("GeoGebra.itcr/GeoGebra/deployggb.js", "console.log('ggb');");
    zip.file(
      "GeoGebra.itcr/GeoGebra/HTML5/5.0/web/web.nocache.js",
      "console.log('web');",
    );
    zip.file("GeoGebra.itcr/README.txt", "metadata");
    zip.file("__MACOSX/GeoGebra.itcr/._GeoGebra", "");

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const existing = {
      id: "settings-1",
      theme: {},
      language: "de",
      defaultAcpIndex: {},
      geoGebraBundle: null,
      updatedAt: new Date(),
    } as AppSettings;
    repo.findOne.mockResolvedValue(existing);

    const result = await service.uploadGeoGebraBundle({
      originalname: "GeoGebra.itcr.zip",
      buffer,
    } as Express.Multer.File);

    await expect(
      fs.readFile(
        path.join(getGeoGebraBundleCurrentDir(), "GeoGebra", "deployggb.js"),
        "utf-8",
      ),
    ).resolves.toContain("ggb");
    await expect(
      fs.readFile(
        path.join(
          getGeoGebraBundleCurrentDir(),
          "GeoGebra",
          "HTML5",
          "5.0",
          "web",
          "web.nocache.js",
        ),
        "utf-8",
      ),
    ).resolves.toContain("web");

    expect(result.geoGebraBundle).toEqual(
      expect.objectContaining({
        sourceFileName: "GeoGebra.itcr.zip",
        deployScriptUrl: GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
        publicBasePath: "/api/shared-assets",
        entryCount: 2,
      }),
    );
  });

  it("rejects ZIP uploads without deployggb.js", async () => {
    const JSZip = require("jszip");
    const zip = new JSZip();
    zip.file("GeoGebra.itcr/GeoGebra/HTML5/5.0/web/web.nocache.js", "web");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await expect(
      service.uploadGeoGebraBundle({
        originalname: "GeoGebra.itcr.zip",
        buffer,
      } as Express.Multer.File),
    ).rejects.toThrow("must contain GeoGebra/deployggb.js");
  });

  it("removes the installed GeoGebra bundle and clears metadata", async () => {
    const currentDir = getGeoGebraBundleCurrentDir();
    await fs.mkdir(path.join(currentDir, "GeoGebra"), { recursive: true });
    await fs.writeFile(
      path.join(currentDir, "GeoGebra", "deployggb.js"),
      "console.log('ggb');",
    );

    const existing = {
      id: "settings-1",
      theme: {},
      language: "de",
      defaultAcpIndex: {},
      geoGebraBundle: {
        sourceFileName: "GeoGebra.itcr.zip",
        deployScriptUrl: GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
        publicBasePath: "/api/shared-assets",
        checksum: "abc",
        entryCount: 2,
        uploadedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    } as AppSettings;
    repo.findOne.mockResolvedValue(existing);

    const result = await service.deleteGeoGebraBundle();

    await expect(fs.access(currentDir)).rejects.toThrow();
    expect(result.geoGebraBundle).toBeNull();
  });
});
