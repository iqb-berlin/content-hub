import { BadRequestException, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of, throwError } from "rxjs";
import { ApContractInterceptor } from "./ap-contract.interceptor";
import { ApResponseEnvelopes, RawApResponse } from "./ap-contract.metadata";

class ExampleController {
  @RawApResponse()
  dictionary() {}

  @ApResponseEnvelopes("items")
  tokenPage() {}

  @ApResponseEnvelopes("state", "explorerState")
  responseState() {}

  @ApResponseEnvelopes("data")
  event() {}

  ordinary() {}
}

describe("AP response serialization boundaries", () => {
  const interceptor = new ApContractInterceptor(new Reflector());
  const context = (
    handler: keyof ExampleController,
    apTerminology = "acp",
    path = "/api/ap/id",
  ) =>
    ({
      getClass: () => ExampleController,
      getHandler: () => ExampleController.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ apTerminology, path }) }),
    }) as unknown as ExecutionContext;
  const serialize = (
    handler: keyof ExampleController,
    value: unknown,
    mode = "acp",
    path?: string,
  ) =>
    firstValueFrom(
      interceptor.intercept(context(handler, mode, path), {
        handle: () => of(value),
      }),
    );

  it("preserves dictionary keys that resemble aliases", async () => {
    const tags = { apId: ["first row"], acpId: ["second row"] };
    expect(await serialize("dictionary", tags)).toBe(tags);
  });

  it("leaves unit items opaque by default", async () => {
    const items = [
      { apId: "custom", acpId: "other custom", role: "AP_MANAGER" },
    ];
    expect(await serialize("ordinary", { items })).toEqual({ items });
  });

  it("converts declared token-page entries", async () => {
    expect(
      await serialize("tokenPage", {
        items: [{ allowedApIds: ["id"], scopes: ["ap.read"] }],
        total: 1,
      }),
    ).toEqual({
      items: [{ allowedAcpIds: ["id"], scopes: ["acp.read"] }],
      total: 1,
    });
  });

  it("does not carry envelope traversal into arbitrary nested items", async () => {
    const items = [{ apId: "custom" }];
    expect(
      await serialize("tokenPage", {
        items: [{ allowedApIds: ["id"], items }],
      }),
    ).toEqual({ items: [{ allowedAcpIds: ["id"], items }] });
  });

  it("translates fallback and explorer envelopes while preserving response data", async () => {
    const responseData = {
      apId: "custom",
      acpId: "other custom",
      scopes: ["ap.read"],
    };
    expect(
      await serialize("responseState", {
        state: { apId: "id", responseData },
        explorerState: { updatedByRole: "AP_MANAGER" },
      }),
    ).toEqual({
      state: { acpId: "id", responseData },
      explorerState: { updatedByRole: "ACP_MANAGER" },
    });
  });

  it("translates the declared server-sent event data", async () => {
    expect(
      await serialize("event", { data: { apId: "id", id: "job" } }),
    ).toEqual({ data: { acpId: "id", id: "job" } });
  });

  it("keeps canonical responses and raw index responses unchanged", async () => {
    const value = { apId: "id", acpId: "custom", role: "AP_MANAGER" };
    expect(await serialize("ordinary", value, "ap")).toBe(value);
    expect(await serialize("ordinary", value, "acp", "/api/AP/id/INDEX")).toBe(
      value,
    );
  });

  it("retains legacy failure messages and status codes", async () => {
    const error = new BadRequestException("allowedApIds requires AP_MANAGER");
    const failed = () =>
      interceptor.intercept(context("ordinary"), {
        handle: () => throwError(() => error),
      });
    await expect(firstValueFrom(failed())).rejects.toMatchObject({
      status: 400,
      message: "allowedAcpIds requires ACP_MANAGER",
    });
    await expect(
      firstValueFrom(
        interceptor.intercept(context("ordinary", "ap"), {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
  });
});
