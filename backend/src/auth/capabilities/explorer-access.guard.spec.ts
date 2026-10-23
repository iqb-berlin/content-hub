import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { AcpAccessGuard } from "../guards/acp-access.guard";
import { AcpCapabilitiesService } from "./acp-capabilities.service";
import { ExplorerReadGuard, ExplorerEditGuard } from "./explorer-access.guard";

describe.each([
  ["read", ExplorerReadGuard, "item-explorer:view", true],
  ["edit", ExplorerEditGuard, "item-explorer:edit", undefined],
] as const)("Explorer %s access", (_name, Guard, capability, allowPublic) => {
  const request = { params: { acpId: "acp-1" } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  function setup() {
    const access = { canActivate: jest.fn().mockResolvedValue(true) };
    const capabilities = { assert: jest.fn().mockResolvedValue(undefined) };
    const guard = new Guard(
      access as unknown as AcpAccessGuard,
      capabilities as unknown as AcpCapabilitiesService,
    );
    return { guard, access, capabilities };
  }

  it("checks the required capability after resolving ACP access", async () => {
    const { guard, access, capabilities } = setup();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(access.canActivate).toHaveBeenCalledWith(context);
    const expectedArguments = allowPublic
      ? [request, capability, true]
      : [request, capability];
    expect(capabilities.assert).toHaveBeenCalledWith(...expectedArguments);
    expect(access.canActivate.mock.invocationCallOrder[0]).toBeLessThan(
      capabilities.assert.mock.invocationCallOrder[0],
    );
  });

  it("propagates a denied ACP access without checking capabilities", async () => {
    const { guard, access, capabilities } = setup();
    const denied = new ForbiddenException("ACP access denied");
    access.canActivate.mockRejectedValueOnce(denied);
    await expect(guard.canActivate(context)).rejects.toBe(denied);
    expect(capabilities.assert).not.toHaveBeenCalled();
  });

  it("rejects access when the required capability is missing", async () => {
    const { guard, capabilities } = setup();
    const denied = new ForbiddenException("Capability missing");
    capabilities.assert.mockRejectedValueOnce(denied);
    await expect(guard.canActivate(context)).rejects.toBe(denied);
  });
});
