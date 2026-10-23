import { CallHandler, ExecutionContext, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of, throwError } from "rxjs";
import { SERVER_API_AUDIT_KEY } from "./server-api-audit.decorator";
import { ServerApiAuditInterceptor } from "./server-api-audit.interceptor";
import { ServerApiRequest } from "./server-api.types";
import { Response } from "express";
import { createServerApiRequest } from "../testing/test-fixtures";

describe("ServerApiAuditInterceptor", () => {
  let interceptor: ServerApiAuditInterceptor;
  let reflector: { getAllAndOverride: jest.Mock };
  let auditService: { log: jest.Mock };

  const createContext = (
    req: Partial<ServerApiRequest>,
    res: Partial<Response>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => function handler() {},
      getClass: () => class TestClass {},
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    interceptor = new ServerApiAuditInterceptor(
      reflector as unknown as Reflector,
      auditService as any,
    );
  });

  it("passes through when no audit metadata is present", async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === SERVER_API_AUDIT_KEY ? undefined : undefined,
    );

    const next: CallHandler = {
      handle: () => of({ ok: true }),
    };

    const result = await lastValueFrom(
      interceptor.intercept(createContext({}, {}), next),
    );

    expect(result).toEqual({ ok: true });
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it("logs successful requests", async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: "acp.files.read",
      resourceType: "file",
    });

    const req = Object.assign(createServerApiRequest({ id: "client-1" }), {
      method: "GET",
      originalUrl: "/server/acp/acp-1/files/file-1",
      params: { acpId: "acp-1", fileId: "file-1" },
      query: { verbose: "1" },
    });
    const res = { statusCode: 200 };

    const next: CallHandler = {
      handle: () => of({ done: true }),
    };

    await lastValueFrom(interceptor.intercept(createContext(req, res), next));

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        action: "acp.files.read",
        method: "GET",
        path: "/server/acp/acp-1/files/file-1",
        acpId: "acp-1",
        resourceId: "file-1",
        success: true,
        statusCode: 200,
      }),
    );
  });

  it("logs failed requests and rethrows the error", async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: "acp.files.write",
      resourceType: "file",
    });

    const req = Object.assign(createServerApiRequest({ id: "client-2" }), {
      method: "POST",
      url: "/server/acp/acp-1/files/upload",
      params: { acpId: "acp-1" },
      query: {},
    });
    const res = { statusCode: 500 };

    const err = new Error("boom");
    const next: CallHandler = {
      handle: () => throwError(() => err),
    };

    await expect(
      lastValueFrom(interceptor.intercept(createContext(req, res), next)),
    ).rejects.toBe(err);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-2",
        action: "acp.files.write",
        success: false,
        statusCode: 500,
        details: expect.objectContaining({
          resourceType: "file",
          errorMessage: "boom",
        }),
      }),
    );
  });
  it.each([true, false])(
    "preserves the request result when audit persistence fails (success: %s)",
    async (success) => {
      reflector.getAllAndOverride.mockReturnValue({
        action: "acp.files.read",
        resourceType: "file",
      });
      const failure = new Error("audit unavailable");
      const requestFailure = new Error("request failed");
      auditService.log.mockRejectedValue(failure);
      const log = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      try {
        const result = lastValueFrom(
          interceptor.intercept(createContext({}, {}), {
            handle: () =>
              success ? of({ ok: true }) : throwError(() => requestFailure),
          }),
        );
        if (success) await expect(result).resolves.toEqual({ ok: true });
        else await expect(result).rejects.toBe(requestFailure);
        expect(log).toHaveBeenCalledWith(
          "Failed to persist server API audit entry",
          failure,
        );
      } finally {
        log.mockRestore();
      }
    },
  );
});
