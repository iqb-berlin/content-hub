import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard, ROLES_KEY } from "./roles.guard";

describe("RolesGuard", () => {
  const apId = "11111111-1111-4111-8111-111111111111";
  const otherApId = "22222222-2222-4222-8222-222222222222";
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const createContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class TestClass {},
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it("allows when no role metadata is set", () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ROLES_KEY ? undefined : undefined,
    );

    expect(guard.canActivate(createContext({ user: null, params: {} }))).toBe(
      true,
    );
  });

  it("rejects unauthenticated users when roles are required", () => {
    reflector.getAllAndOverride.mockReturnValue(["AP_MANAGER"]);

    expect(() =>
      guard.canActivate(createContext({ user: null, params: {} })),
    ).toThrow(ForbiddenException);
  });

  it("grants access to app admins", () => {
    reflector.getAllAndOverride.mockReturnValue(["AP_MANAGER"]);

    const request = {
      user: { isAppAdmin: true },
      params: { id: apId },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it("grants AP_MANAGER access for matching AP role", () => {
    reflector.getAllAndOverride.mockReturnValue(["AP_MANAGER"]);

    const request = {
      user: {
        isAppAdmin: false,
        apRoles: [{ apId, role: "AP_MANAGER" }],
      },
      params: { id: apId },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it("grants READ_ONLY endpoints to AP_MANAGER in the same AP", () => {
    reflector.getAllAndOverride.mockReturnValue(["READ_ONLY"]);

    const request = {
      user: {
        isAppAdmin: false,
        apRoles: [{ apId, role: "AP_MANAGER" }],
      },
      params: { apId },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it("rejects when role requirements are not met", () => {
    reflector.getAllAndOverride.mockReturnValue(["AP_MANAGER"]);

    const request = {
      user: {
        isAppAdmin: false,
        apRoles: [{ apId: otherApId, role: "READ_ONLY" }],
      },
      params: { id: apId },
    };

    expect(() => guard.canActivate(createContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects malformed resource ids after authentication", () => {
    reflector.getAllAndOverride.mockReturnValue(["AP_MANAGER"]);

    expect(() =>
      guard.canActivate(
        createContext({
          user: { isAppAdmin: true },
          params: { id: "not-a-uuid" },
        }),
      ),
    ).toThrow("Resource ID must be a valid UUID");
  });
});
