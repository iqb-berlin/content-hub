import { ForbiddenException } from "@nestjs/common";
import { ReviewAccessGuard } from "./review-access.guard";

describe("ReviewAccessGuard", () => {
  for (const grants of [
    [],
    ["review:participate"],
    ["review:manage"],
    ["review:participate", "review:manage"],
    ["item-explorer:edit"],
  ]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      it(`${method} with ${grants.join(",") || "no grants"}`, async () => {
        const request = { method };
        const access = { canActivate: jest.fn().mockResolvedValue(true) };
        const capabilities = { resolve: jest.fn().mockResolvedValue(grants) };
        const context = {
          switchToHttp: () => ({ getRequest: () => request }),
          getHandler: () => ({ name: "comment" }),
        } as any;
        const result = new ReviewAccessGuard(
          access as any,
          capabilities as any,
        ).canActivate(context);
        if (
          grants.includes("review:participate") ||
          (method === "GET" && grants.includes("review:manage"))
        )
          await expect(result).resolves.toBe(true);
        else await expect(result).rejects.toThrow(ForbiddenException);
      });
    }
  }
  it("does not bypass AP access", async () => {
    const capabilities = { resolve: jest.fn() };
    const guard = new ReviewAccessGuard(
      {
        canActivate: jest.fn().mockRejectedValue(new ForbiddenException()),
      } as any,
      capabilities as any,
    );
    await expect(guard.canActivate({} as any)).rejects.toThrow(
      ForbiddenException,
    );
    expect(capabilities.resolve).not.toHaveBeenCalled();
  });
});
