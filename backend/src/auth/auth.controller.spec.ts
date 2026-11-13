import { UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe("AuthController", () => {
  let controller: AuthController;
  let authService: any;
  let oidcValidationService: any;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    authService = {
      generateTokenForOidcUser: jest
        .fn()
        .mockResolvedValue({ accessToken: "jwt-oidc" }),
      linkOidcAccount: jest.fn().mockResolvedValue({ linked: true }),
      credentialLogin: jest.fn().mockResolvedValue({ accessToken: "jwt-cred" }),
      logout: jest.fn().mockResolvedValue({ success: true }),
      getProfile: jest.fn().mockResolvedValue({ id: "u-1" }),
    };
    oidcValidationService = {
      isOidcEnabled: jest.fn().mockReturnValue(true),
      validateIdToken: jest
        .fn()
        .mockResolvedValue({ sub: "u-1", username: "julian" }),
    };
    controller = new AuthController(authService, oidcValidationService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns OIDC config with public issuer and custom values", async () => {
    process.env.OIDC_PUBLIC_ISSUER_URL = "https://public.example.com";
    process.env.OIDC_ISSUER_URL = "https://internal.example.com";
    process.env.OIDC_CLIENT_ID = "client-1";
    process.env.OIDC_REDIRECT_URI = "https://app.example.com/callback";
    process.env.OIDC_SCOPE = "openid profile";

    const result = await controller.getOidcConfig();

    expect(result).toEqual({
      enabled: true,
      issuerUrl: "https://public.example.com",
      clientId: "client-1",
      redirectUri: "https://app.example.com/callback",
      scope: "openid profile",
    });
  });

  it("returns disabled OIDC config with fallback defaults", async () => {
    oidcValidationService.isOidcEnabled.mockReturnValue(false);
    delete process.env.OIDC_PUBLIC_ISSUER_URL;
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_REDIRECT_URI;
    delete process.env.OIDC_SCOPE;

    const result = await controller.getOidcConfig();

    expect(result).toEqual({
      enabled: false,
      issuerUrl: null,
      clientId: null,
      redirectUri: "http://localhost:4201/auth/callback",
      scope: "openid profile email",
    });
  });

  it("rejects OIDC callback when OIDC is disabled", async () => {
    oidcValidationService.isOidcEnabled.mockReturnValue(false);

    await expect(
      controller.oidcCallback({ idToken: "id-token" } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("handles OIDC callback and returns JWT", async () => {
    const result = await controller.oidcCallback({
      idToken: "id-token",
    } as any);

    expect(oidcValidationService.validateIdToken).toHaveBeenCalledWith(
      "id-token",
    );
    expect(authService.generateTokenForOidcUser).toHaveBeenCalledWith({
      sub: "u-1",
      username: "julian",
    });
    expect(result).toEqual({ accessToken: "jwt-oidc" });
  });

  it("links OIDC account", async () => {
    const result = await controller.linkOidcAccount({
      userId: "u-1",
      oidcSub: "oidc-1",
    });

    expect(authService.linkOidcAccount).toHaveBeenCalledWith("u-1", "oidc-1");
    expect(result).toEqual({ linked: true });
  });

  it("delegates credential login with client id from x-forwarded-for string", async () => {
    const req = { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } };

    await controller.credentialLogin(
      { apId: "ap-1", username: "cred", password: "pw" } as any,
      req,
    );

    expect(authService.credentialLogin).toHaveBeenCalledWith(
      "ap-1",
      "cred",
      "pw",
      "1.2.3.4",
    );
  });

  it("delegates credential login with client id from x-forwarded-for array", async () => {
    const req = { headers: { "x-forwarded-for": ["9.9.9.9, 8.8.8.8"] } };

    await controller.credentialLogin(
      { apId: "ap-1", username: "cred", password: "pw" } as any,
      req,
    );

    expect(authService.credentialLogin).toHaveBeenCalledWith(
      "ap-1",
      "cred",
      "pw",
      "9.9.9.9",
    );
  });

  it("delegates credential login with fallback unknown client id", async () => {
    const req = { headers: {}, ip: "", socket: { remoteAddress: "" } };

    await controller.credentialLogin(
      { apId: "ap-1", username: "cred", password: "pw" } as any,
      req,
    );

    expect(authService.credentialLogin).toHaveBeenCalledWith(
      "ap-1",
      "cred",
      "pw",
      "unknown",
    );
  });

  it("delegates logout and profile retrieval", async () => {
    await expect(controller.logout({ user: { sub: "u-1" } })).resolves.toEqual({
      success: true,
    });
    await expect(
      controller.getProfile({ user: { sub: "u-1" } }),
    ).resolves.toEqual({
      id: "u-1",
    });
    expect(authService.logout).toHaveBeenCalledWith("u-1");
    expect(authService.getProfile).toHaveBeenCalledWith("u-1");
  });

  it("rejects OIDC role sync when OIDC is disabled", async () => {
    oidcValidationService.isOidcEnabled.mockReturnValue(false);

    await expect(
      controller.syncOidcRoles({ user: { sub: "u-1" } }, {
        idToken: "id-token",
      } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects OIDC role sync when token user mismatches current user", async () => {
    oidcValidationService.validateIdToken.mockResolvedValueOnce({
      sub: "other-user",
    });

    await expect(
      controller.syncOidcRoles({ user: { sub: "u-1" } }, {
        idToken: "id-token",
      } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("syncs OIDC roles and returns refreshed token on success", async () => {
    const result = await controller.syncOidcRoles({ user: { sub: "u-1" } }, {
      idToken: "id-token",
    } as any);

    expect(oidcValidationService.validateIdToken).toHaveBeenCalledWith(
      "id-token",
    );
    expect(authService.generateTokenForOidcUser).toHaveBeenCalledWith({
      sub: "u-1",
      username: "julian",
    });
    expect(result).toEqual({ accessToken: "jwt-oidc" });
  });
});
