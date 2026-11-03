import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { OidcValidationService } from "./oidc-validation.service";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe("OidcValidationService", () => {
  let service: OidcValidationService;
  let configService: { get: jest.Mock };
  let userRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  const mockedCreateRemoteJWKSet = createRemoteJWKSet as jest.MockedFunction<
    typeof createRemoteJWKSet
  >;
  const mockedJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

  beforeEach(() => {
    const config: Record<string, string | undefined> = {
      OIDC_ISSUER_URL: "http://keycloak:8080/realms/iqb",
      OIDC_PUBLIC_ISSUER_URL: undefined,
      OIDC_CLIENT_ID: "contenthub",
    };

    configService = {
      get: jest.fn((key: string) => config[key]),
    };

    userRepository = {
      findOne: jest.fn(),
      create: jest.fn((entity) => entity),
      save: jest.fn(),
    };

    mockedCreateRemoteJWKSet.mockReturnValue(jest.fn() as any);

    service = new OidcValidationService(
      configService as unknown as ConfigService,
      userRepository as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("keeps manually granted app admin rights when token has no admin role", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: "oidc-sub-1",
        preferred_username: "oidc-user",
        realm_access: { roles: ["user"] },
        resource_access: { contenthub: { roles: ["user"] } },
      },
    } as any);

    const existingUser = {
      id: "user-1",
      username: "oidc-user",
      displayName: "OIDC User",
      oidcSub: "oidc-sub-1",
      isAppAdmin: true,
      acpRoles: [],
    };

    userRepository.findOne.mockResolvedValue(existingUser);

    const result = await service.validateIdToken("mock-id-token");

    expect(userRepository.save).not.toHaveBeenCalled();
    expect(result.isAppAdmin).toBe(true);
  });

  it("elevates existing users to app admin when token includes admin role", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: "oidc-sub-2",
        preferred_username: "oidc-user-2",
        realm_access: { roles: ["admin"] },
      },
    } as any);

    const existingUser = {
      id: "user-2",
      username: "oidc-user-2",
      displayName: "OIDC User 2",
      oidcSub: "oidc-sub-2",
      isAppAdmin: false,
      acpRoles: [],
    };

    userRepository.findOne.mockResolvedValue(existingUser);
    userRepository.save.mockResolvedValue({
      ...existingUser,
      isAppAdmin: true,
    });

    const result = await service.validateIdToken("mock-id-token");

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isAppAdmin: true }),
    );
    expect(result.isAppAdmin).toBe(true);
  });

  it("links a pre-provisioned user by username and keeps manually granted admin rights", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: "oidc-sub-3",
        preferred_username: "linked-user",
        realm_access: { roles: ["user"] },
      },
    } as any);

    const localUser = {
      id: "user-3",
      username: "linked-user",
      displayName: "Linked User",
      oidcSub: undefined,
      isAppAdmin: true,
      acpRoles: [],
    };

    userRepository.findOne
      .mockResolvedValueOnce(null) // by oidcSub
      .mockResolvedValueOnce(localUser); // by username
    userRepository.save.mockResolvedValue({
      ...localUser,
      oidcSub: "oidc-sub-3",
    });

    const result = await service.validateIdToken("mock-id-token");

    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-3",
        oidcSub: "oidc-sub-3",
        isAppAdmin: true,
      }),
    );
    expect(result.sub).toBe("user-3");
    expect(result.isAppAdmin).toBe(true);
  });

  it("creates a new OIDC profile without local credentials", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: "oidc-sub-new",
        preferred_username: "new-oidc-user",
        name: "New OIDC User",
        realm_access: { roles: ["user"] },
      },
    } as any);
    userRepository.findOne.mockResolvedValue(null);
    userRepository.create.mockImplementationOnce((entity) => ({
      ...entity,
      id: "user-new",
      acpRoles: [],
    }));
    userRepository.save.mockImplementationOnce(async (entity) => entity);

    const result = await service.validateIdToken("mock-id-token");

    expect(userRepository.create).toHaveBeenCalledWith({
      username: "new-oidc-user",
      displayName: "New OIDC User",
      oidcSub: "oidc-sub-new",
      isAppAdmin: false,
    });
    expect(result.sub).toBe("user-new");
  });
});
