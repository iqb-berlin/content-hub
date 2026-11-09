import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ServerApiAuthGuard } from "./server-api-auth.guard";
import { SERVER_API_SCOPES_KEY } from "./server-api-scopes.decorator";
import { ServerApiRequest } from "./server-api.types";

describe("ServerApiAuthGuard", () => {
  let guard: ServerApiAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authService: { validateToken: jest.Mock; hasScopes: jest.Mock };

  const createContext = (req: Partial<ServerApiRequest>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => function handler() {},
      getClass: () => class TestClass {},
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };

    authService = {
      validateToken: jest.fn(),
      hasScopes: jest.fn(),
    };

    guard = new ServerApiAuthGuard(
      reflector as unknown as Reflector,
      authService as any,
    );
  });

  it("rejects when token is missing", async () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    await expect(
      guard.canActivate(createContext({ headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when token is invalid", async () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    authService.validateToken.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({ headers: { "x-server-token": "abc" } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when required scopes are missing", async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === SERVER_API_SCOPES_KEY ? ["files.write"] : [],
    );
    authService.validateToken.mockResolvedValue({
      id: "client-1",
      scopes: ["files.read"],
    });
    authService.hasScopes.mockReturnValue(false);

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: "Bearer token-1" } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("accepts x-server-token and enriches request with client identity", async () => {
    const req: Partial<ServerApiRequest> = {
      headers: { "x-server-token": "  token-a  " },
    };

    reflector.getAllAndOverride.mockReturnValue(["ap.read"]);
    authService.validateToken.mockResolvedValue({
      id: "client-a",
      scopes: ["ap.read"],
    });
    authService.hasScopes.mockReturnValue(true);

    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect(authService.validateToken).toHaveBeenCalledWith("token-a");
    expect(req.serverApiClient).toEqual({
      id: "client-a",
      scopes: ["ap.read"],
      allowedApIds: null,
    });
  });

  it("accepts x-integration-token as fallback header", async () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    authService.validateToken.mockResolvedValue({ id: "client-b", scopes: [] });
    authService.hasScopes.mockReturnValue(true);

    const req: Partial<ServerApiRequest> = {
      headers: { "x-integration-token": "integration-token" },
    };
    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect(authService.validateToken).toHaveBeenCalledWith("integration-token");
  });
});
