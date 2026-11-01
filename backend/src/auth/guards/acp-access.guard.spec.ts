import { ExecutionContext } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { AcpAccessGuard } from "./acp-access.guard";
import {
  AcpCredential,
  AcpAccessConfig,
  AcpRole,
  AcpUserRole,
} from "../../database/entities";
import { User } from "../../database/entities/user.entity";

describe("AcpAccessGuard", () => {
  const acpId = "11111111-1111-4111-8111-111111111111";
  let guard: AcpAccessGuard;
  let acpUserRoleRepository: { findOne: jest.Mock };
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
    acpUserRoleRepository = {
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
        AcpAccessGuard,
        {
          provide: getRepositoryToken(AcpCredential),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              accessConfig: { acpId, accessModel: "CREDENTIALS_LIST" },
            }),
          },
        },
        {
          provide: getRepositoryToken(AcpUserRole),
          useValue: acpUserRoleRepository,
        },
        {
          provide: getRepositoryToken(AcpAccessConfig),
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

    guard = module.get(AcpAccessGuard);
  });

  it("allows OIDC users with ACP_MANAGER role for the requested ACP", async () => {
    accessConfigRepository.findOne.mockResolvedValue(null);
    acpUserRoleRepository.findOne.mockResolvedValue({
      role: AcpRole.ACP_MANAGER,
    });

    const request: any = {
      params: { acpId },
      user: {
        sub: "julian-user-id",
        username: "julian",
        isAppAdmin: false,
        type: "oidc",
      },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(acpUserRoleRepository.findOne).toHaveBeenCalledWith({
      where: { userId: "julian-user-id", acpId },
    });
    expect(request.acpAccessLevel).toBe("MANAGER");
  });

  it("prefers ACP role access over PUBLIC fallback for authenticated users", async () => {
    acpUserRoleRepository.findOne.mockResolvedValue({
      role: AcpRole.ACP_MANAGER,
    });
    accessConfigRepository.findOne.mockResolvedValue({
      id: "public-config",
      acpId,
      accessModel: "PUBLIC",
    });

    const request: any = {
      params: { acpId },
      user: {
        sub: "julian-user-id",
        username: "julian",
        isAppAdmin: false,
        type: "oidc",
      },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.acpAccessLevel).toBe("MANAGER");
    expect(accessConfigRepository.findOne).not.toHaveBeenCalled();
  });

  it("resolves a bearer user and its requested ACP role in one query", async () => {
    userRepository.query = jest.fn().mockResolvedValue([
      {
        isAppAdmin: false,
        acpRole: AcpRole.ACP_MANAGER,
      },
    ]);
    jwtService.verifyAsync.mockResolvedValue({
      sub: "julian-user-id",
      username: "julian",
      type: "oidc",
      authType: "oidc",
    });

    const request: any = {
      params: { acpId },
      headers: { authorization: "Bearer explorer-token" },
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(userRepository.query).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN "acp_user_roles"'),
      ["julian-user-id", acpId],
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(acpUserRoleRepository.findOne).not.toHaveBeenCalled();
    expect(request.acpAccessLevel).toBe("MANAGER");
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
      params: { acpId },
      headers: { authorization: "Bearer legacy-token" },
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "Authentication required",
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it("does not reuse a role for a different ACP", async () => {
    userRepository.query = jest.fn().mockResolvedValue([
      {
        isAppAdmin: false,
        acpRole: null,
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
      params: { acpId },
      headers: { authorization: "Bearer explorer-token" },
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "No access to this AP",
    );
    expect(acpUserRoleRepository.findOne).not.toHaveBeenCalled();
  });

  it("allows anonymous access when ACP is PUBLIC", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      id: "public-config",
      acpId,
      accessModel: "PUBLIC",
    });

    const request: any = {
      params: { acpId },
      user: null,
      headers: {},
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.acpAccessLevel).toBe("PUBLIC");
  });

  it("rejects anonymous access when ACP is PRIVATE", async () => {
    accessConfigRepository.findOne.mockResolvedValue(null);

    const request: any = {
      params: { acpId },
      user: null,
      headers: {},
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "Authentication required",
    );
  });

  it("rejects malformed ACP ids before querying repositories", async () => {
    const request: any = {
      params: { acpId: "__coding-box-connection-test__" },
      user: null,
      headers: {},
      query: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      "AP ID must be a valid UUID",
    );
    expect(acpUserRoleRepository.findOne).not.toHaveBeenCalled();
    expect(accessConfigRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });
});
