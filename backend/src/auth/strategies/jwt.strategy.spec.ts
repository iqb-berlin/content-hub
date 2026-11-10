import { ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  let configService: { get: jest.Mock };
  let userRepository: { findOne: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue("secret-key"),
    };

    userRepository = {
      findOne: jest.fn(),
    };

    strategy = new JwtStrategy(
      configService as unknown as ConfigService,
      userRepository as any,
    );
  });

  it("accepts a credential token issued with only the legacy claim", async () => {
    const payload = {
      sub: "cred-1",
      username: "reader",
      type: "credential",
      acpId: "legacy-id",
    } as any;
    expect(await strategy.validate(payload)).toMatchObject({
      apId: "legacy-id",
      apRoles: [],
    });
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(
      await strategy.validate({ ...payload, apId: "different-id" }),
    ).toBeNull();
  });

  it("returns credential payload without DB lookup", async () => {
    const payload: any = {
      sub: "cred-1",
      username: "reader",
      type: "credential",
      authType: "credential",
      apId: "ap-1",
    };

    const result = await strategy.validate(payload);

    expect(result).toEqual({
      sub: "cred-1",
      username: "reader",
      isAppAdmin: false,
      type: "credential",
      authType: "credential",
      apId: "ap-1",
      apRoles: [],
    });
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it("returns null when regular user does not exist", async () => {
    userRepository.findOne.mockResolvedValue(null);

    const result = await strategy.validate({
      sub: "user-1",
      username: "julian",
      type: "oidc",
      authType: "oidc",
      apId: undefined,
    } as any);

    expect(result).toBeNull();
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: "user-1" },
      relations: ["apRoles", "apRoles.ap"],
    });
  });

  it("rejects legacy local user tokens without a DB lookup", async () => {
    const result = await strategy.validate({
      sub: "legacy-user-1",
      username: "legacy",
      type: "user",
      authType: "local",
    } as any);

    expect(result).toBeNull();
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it("uses the current profile name when the token still contains an old username", async () => {
    userRepository.findOne.mockResolvedValue({
      username: "current-user",
      displayName: "Current Name",
      isAppAdmin: false,
      apRoles: [],
    });
    const result = await strategy.validate({
      sub: "user-1",
      username: "old@example.org",
      type: "oidc",
      authType: "oidc",
    } as any);
    expect(result).toEqual(
      expect.objectContaining({
        sub: "user-1",
        username: "current-user",
        displayName: "Current Name",
      }),
    );
  });

  it("maps DB roles for regular users", async () => {
    userRepository.findOne.mockResolvedValue({
      displayName: "Julian Beispiel",
      isAppAdmin: true,
      apRoles: [
        {
          apId: "ap-1",
          role: "AP_MANAGER",
          ap: { name: "Demo AP" },
        },
      ],
    });

    const result = await strategy.validate({
      sub: "user-1",
      username: "julian",
      type: "oidc",
      authType: "oidc",
      apId: "ap-1",
    } as any);

    expect(result).toEqual({
      sub: "user-1",
      username: "julian",
      displayName: "Julian Beispiel",
      isAppAdmin: true,
      type: "oidc",
      authType: "oidc",
      apId: "ap-1",
      apRoles: [
        {
          apId: "ap-1",
          apName: "Demo AP",
          role: "AP_MANAGER",
        },
      ],
    });
  });
});
