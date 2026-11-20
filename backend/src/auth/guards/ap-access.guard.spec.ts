import { ExecutionContext } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ApAccessGuard } from "./ap-access.guard";
import {
  ApCredential,
  ApAccessConfig,
  ApRole,
  ApUserRole,
} from "../../database/entities";
import { User } from "../../database/entities/user.entity";

describe("ApAccessGuard", () => {
  const apId = "11111111-1111-4111-8111-111111111111";
  let guard: ApAccessGuard;
  let apUserRoleRepository: { findOne: jest.Mock };
  let accessConfigRepository: { findOne: jest.Mock };
  let userRepository: { findOne: jest.Mock; query?: jest.Mock };
  let jwtService: { verifyAsync: jest.Mock };

  const createContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    apUserRoleRepository = {
      findOne: jest.fn(),
    };
    accessConfigRepository = {
      findOne: jest.fn(),
    };
    userRepository = {
      findOne: jest.fn(),
    };
    jwtService = {
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApAccessGuard,
        {
          provide: getRepositoryToken(ApCredential),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              accessConfig: { apId, accessModel: "CREDENTIALS_LIST" },
            }),
          },
        },
        {
          provide: getRepositoryToken(ApUserRole),
          useValue: apUserRoleRepository,
        },
        {
          provide: getRepositoryToken(ApAccessConfig),
          useValue: accessConfigRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
      ],
    }).compile();

    guard = module.get(ApAccessGuard);
  });

  it("allows OIDC users with AP_MANAGER role for the requested AP", async () => {
    accessConfigRepository.findOne.mockResolvedValue(null);
    apUserRoleRepository.findOne.mockResolvedValue({
      role: ApRole.AP_MANAGER,
    });

    const request: any = {
      params: { apId },
      user: {
        sub: "julian-user-id",
        username: "julian",
        isAppAdmin: false,
        type: "oidc",
      },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(apUserRoleRepository.findOne).toHaveBeenCalledWith({
      where: { userId: "julian-user-id", apId },
    });
    expect(request.apAccessLevel).toBe("MANAGER");
  });

  it("prefers AP role access over PUBLIC fallback for authenticated users", async () => {
    apUserRoleRepository.findOne.mockResolvedValue({
      role: ApRole.AP_MANAGER,
    });
    accessConfigRepository.findOne.mockResolvedValue({
      id: "public-config",
      apId,
      accessModel: "PUBLIC",
    });

    const request: any = {
      params: { apId },
      user: {
        sub: "julian-user-id",
        username: "julian",
        isAppAdmin: false,
        type: "oidc",
      },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.apAccessLevel).toBe("MANAGER");
    expect(accessConfigRepository.findOne).not.toHaveBeenCalled();
  });

  it("resolves a bearer user and its requested AP role in one query", async () => {
    userRepository.query = jest.fn().mockResolvedValue([
      {
        isAppAdmin: false,
        apRole: ApRole.AP_MANAGER,
      },
    ]);
    jwtService.verifyAsync.mockResolvedValue({
      sub: "julian-user-id",
      username: "julian",
      type: "oidc",
      authType: "oidc",
    });

    const request: any = {
      params: { apId },
      headers: { authorization: "Bearer explorer-token" },
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(userRepository.query).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN "acp_user_roles"'),
      ["julian-user-id", apId],
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(apUserRoleRepository.findOne).not.toHaveBeenCalled();
    expect(request.apAccessLevel).toBe("MANAGER");
  });

  it("rejects legacy local bearer tokens before resolving the user", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: "legacy-user-id",
      username: "legacy",
      type: "user",
      authType: "local",
    });
    accessConfigRepository.findOne.mockResolvedValue(null);

    const request: any = {
      params: { apId },
      headers: { authorization: "Bearer legacy-token" },
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "Authentication required",
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it("does not reuse a role for a different AP", async () => {
    userRepository.query = jest.fn().mockResolvedValue([
      {
        isAppAdmin: false,
        apRole: null,
      },
    ]);
    jwtService.verifyAsync.mockResolvedValue({
      sub: "julian-user-id",
      username: "julian",
      type: "oidc",
      authType: "oidc",
    });
    accessConfigRepository.findOne.mockResolvedValue(null);

    const request: any = {
      params: { apId },
      headers: { authorization: "Bearer explorer-token" },
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "No access to this AP",
    );
    expect(apUserRoleRepository.findOne).not.toHaveBeenCalled();
  });

  it("allows anonymous access when AP is PUBLIC", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      id: "public-config",
      apId,
      accessModel: "PUBLIC",
    });

    const request: any = {
      params: { apId },
      user: null,
      headers: {},
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.apAccessLevel).toBe("PUBLIC");
  });

  it("rejects anonymous access when AP is PRIVATE", async () => {
    accessConfigRepository.findOne.mockResolvedValue(null);

    const request: any = {
      params: { apId },
      user: null,
      headers: {},
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "Authentication required",
    );
  });

  it("rejects malformed AP ids before querying repositories", async () => {
    const request: any = {
      params: { apId: "__coding-box-connection-test__" },
      user: null,
      headers: {},
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "AP ID must be a valid UUID",
    );
    expect(apUserRoleRepository.findOne).not.toHaveBeenCalled();
    expect(accessConfigRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });
});
