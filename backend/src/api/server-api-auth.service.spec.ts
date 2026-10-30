import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { ServerApiAuthService } from "./server-api-auth.service";
import { hashServerApiToken } from "./server-api-token.util";

describe("ServerApiAuthService", () => {
  const createApplicationTokenRepository = () => ({
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  });

  it("retains legacy cp_ integration tokens and updates lastUsedAt", async () => {
    const config = {
      get: jest.fn().mockImplementation((_key: string, fallback?: string) => {
        return fallback;
      }),
    } as unknown as ConfigService;
    const tokenHash = hashServerApiToken("cp_legacy-integration-token");
    const applicationTokenRepository = createApplicationTokenRepository();
    applicationTokenRepository.findOne.mockResolvedValue({
      id: "token-1",
      name: "studio-db",
      tokenHash,
      scopes: ["acp.read", "files.read"],
      active: true,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: null,
      revokedAt: null,
    });

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );
    const client = await service.validateToken("cp_legacy-integration-token");

    expect(client).toEqual({
      id: "studio-db",
      scopes: ["acp.read", "files.read"],
      allowedAcpIds: null,
    });
    expect(applicationTokenRepository.findOne).toHaveBeenCalledWith({
      where: { tokenHash },
    });
    expect(applicationTokenRepository.update).toHaveBeenCalledWith("token-1", {
      lastUsedAt: expect.any(Date),
    });
  });

  it("does not update lastUsedAt again when it was refreshed recently", async () => {
    const config = {
      get: jest.fn().mockImplementation((_key: string, fallback?: string) => {
        return fallback;
      }),
    } as unknown as ConfigService;
    const tokenHash = hashServerApiToken("db-token");
    const applicationTokenRepository = createApplicationTokenRepository();
    applicationTokenRepository.findOne.mockResolvedValue({
      id: "token-1",
      name: "studio-db",
      tokenHash,
      scopes: ["acp.read"],
      active: true,
      expiresAt: null,
      lastUsedAt: new Date(),
      revokedAt: null,
    });

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );

    await expect(service.validateToken("db-token")).resolves.toEqual({
      id: "studio-db",
      scopes: ["acp.read"],
      allowedAcpIds: null,
    });
    expect(applicationTokenRepository.update).not.toHaveBeenCalled();
  });

  it("accepts valid tokens when lastUsedAt cannot be updated", async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const config = {
      get: jest.fn().mockImplementation((_key: string, fallback?: string) => {
        return fallback;
      }),
    } as unknown as ConfigService;
    const tokenHash = hashServerApiToken("db-token");
    const applicationTokenRepository = createApplicationTokenRepository();
    applicationTokenRepository.findOne.mockResolvedValue({
      id: "token-1",
      name: "studio-db",
      tokenHash,
      scopes: ["acp.read"],
      active: true,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    applicationTokenRepository.update.mockRejectedValueOnce(
      new Error("last-used write failed"),
    );

    try {
      const service = new ServerApiAuthService(
        config,
        applicationTokenRepository as any,
      );

      await expect(service.validateToken("db-token")).resolves.toEqual({
        id: "studio-db",
        scopes: ["acp.read"],
        allowedAcpIds: null,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not update lastUsedAt"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects inactive, revoked or expired database tokens", async () => {
    const config = {
      get: jest.fn().mockImplementation((_key: string, fallback?: string) => {
        return fallback;
      }),
    } as unknown as ConfigService;

    for (const applicationToken of [
      { active: false, revokedAt: null, expiresAt: null },
      { active: true, revokedAt: new Date(), expiresAt: null },
      { active: true, revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    ]) {
      const applicationTokenRepository = createApplicationTokenRepository();
      applicationTokenRepository.findOne.mockResolvedValue({
        id: "token-1",
        name: "studio-db",
        tokenHash: hashServerApiToken("db-token"),
        scopes: ["acp.read"],
        ...applicationToken,
      });

      const service = new ServerApiAuthService(
        config,
        applicationTokenRepository as any,
      );

      await expect(service.validateToken("db-token")).resolves.toBeNull();
      expect(applicationTokenRepository.update).not.toHaveBeenCalled();
    }
  });

  it("parses clients from SERVER_API_TOKENS JSON and validates token", async () => {
    const config = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === "SERVER_API_TOKENS") {
          return JSON.stringify([
            {
              id: "studio",
              token: "token-studio",
              scopes: ["transfer.read", "files.read"],
            },
          ]);
        }

        return fallback;
      }),
    } as unknown as ConfigService;
    const applicationTokenRepository = createApplicationTokenRepository();

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );
    const client = await service.validateToken("token-studio");

    expect(client).toEqual({
      id: "studio",
      scopes: ["transfer.read", "files.read"],
      allowedAcpIds: null,
    });
    expect(service.hasScopes(client?.scopes || [], ["files.read"])).toBe(true);
    expect(service.hasScopes(client?.scopes || [], ["files.write"])).toBe(
      false,
    );
  });

  it("falls back to configured tokens when the application token table is missing", async () => {
    const config = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === "SERVER_API_TOKENS") {
          return JSON.stringify([
            {
              id: "studio",
              token: "token-studio",
              scopes: ["acp.read"],
            },
          ]);
        }

        return fallback;
      }),
    } as unknown as ConfigService;
    const applicationTokenRepository = createApplicationTokenRepository();
    applicationTokenRepository.findOne.mockRejectedValue({
      code: "42P01",
      message: 'relation "application_tokens" does not exist',
    });

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );

    await expect(service.validateToken("token-studio")).resolves.toEqual({
      id: "studio",
      scopes: ["acp.read"],
      allowedAcpIds: null,
    });
  });

  it("does not hide unexpected application token lookup errors", async () => {
    const config = {
      get: jest.fn().mockImplementation((_key: string, fallback?: string) => {
        return fallback;
      }),
    } as unknown as ConfigService;
    const applicationTokenRepository = createApplicationTokenRepository();
    applicationTokenRepository.findOne.mockRejectedValue(new Error("db down"));

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );

    await expect(service.validateToken("db-token")).rejects.toThrow("db down");
  });

  it("falls back to SERVER_API_KEY with full scopes", async () => {
    const config = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === "SERVER_API_TOKENS") {
          return "";
        }
        if (key === "SERVER_API_KEY") {
          return "legacy-token";
        }
        return fallback;
      }),
    } as unknown as ConfigService;
    const applicationTokenRepository = createApplicationTokenRepository();

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );
    const client = await service.validateToken("legacy-token");

    expect(client?.id).toBe("legacy");
    expect(client?.scopes.length).toBeGreaterThan(0);
    await expect(service.validateToken("wrong")).resolves.toBeNull();
  });

  it("ignores malformed JSON token config and still allows legacy fallback", async () => {
    const config = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === "SERVER_API_TOKENS") {
          return "{broken-json";
        }
        if (key === "SERVER_API_KEY") {
          return "legacy-fallback-token";
        }
        return fallback;
      }),
    } as unknown as ConfigService;
    const applicationTokenRepository = createApplicationTokenRepository();

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );

    await expect(
      service.validateToken("legacy-fallback-token"),
    ).resolves.toEqual(expect.objectContaining({ id: "legacy" }));
  });

  it("filters invalid token entries, deduplicates scopes and applies defaults", async () => {
    const config = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === "SERVER_API_TOKENS") {
          return JSON.stringify([
            null,
            { id: "", token: "missing-id" },
            { id: "missing-token", token: "" },
            { id: "default-scope", token: "token-a", scopes: [] },
            {
              id: "custom-scope",
              token: "token-b",
              scopes: ["files.read", "files.read", "  files.write  "],
            },
          ]);
        }
        return fallback;
      }),
    } as unknown as ConfigService;
    const applicationTokenRepository = createApplicationTokenRepository();

    const service = new ServerApiAuthService(
      config,
      applicationTokenRepository as any,
    );

    await expect(service.validateToken("token-a")).resolves.toEqual(
      expect.objectContaining({
        id: "default-scope",
        scopes: expect.arrayContaining([
          "acp.read",
          "transfer.read",
          "audit.read",
        ]),
      }),
    );
    await expect(service.validateToken("token-b")).resolves.toEqual({
      id: "custom-scope",
      scopes: ["files.read", "files.write"],
      allowedAcpIds: null,
    });
    expect(service.hasScopes(["x"], [])).toBe(true);
  });
});
