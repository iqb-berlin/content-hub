import { AcpCapabilitiesService } from "./acp-capabilities.service";
import { ACP_CAPABILITIES } from "./acp-capabilities";

describe("ACP capability matrix", () => {
  for (const type of ["oidc", "credential"]) {
    for (let mask = 0; mask < 16; mask++) {
      const grants = ACP_CAPABILITIES.filter((_, i) => mask & (1 << i));
      it(`${type}: ${grants.join(",") || "none"}`, async () => {
        const credentials = {
          findOne: jest.fn().mockResolvedValue({
            capabilities: grants,
            accessConfig: { acpId: "a", accessModel: "CREDENTIALS_LIST" },
          }),
        };
        const roles = {
          findOne: jest
            .fn()
            .mockResolvedValue({ role: "READ_ONLY", capabilities: grants }),
        };
        const configs = {
          findOne: jest.fn().mockResolvedValue({ accessModel: "PRIVATE" }),
        };
        const service = new AcpCapabilitiesService(
          credentials as any,
          roles as any,
          configs as any,
        );
        for (const capability of ACP_CAPABILITIES) {
          const req = {
            params: { acpId: "a" },
            user: { type, sub: "u", acpId: "a" },
          };
          const expected =
            grants.includes(capability) ||
            (capability === "item-explorer:view" &&
              grants.includes("item-explorer:edit"));
          if (expected)
            await expect(
              service.assert(req, capability, true),
            ).resolves.toBeUndefined();
          else
            await expect(
              service.assert(req, capability, true),
            ).rejects.toThrow();
        }
      });
    }
  }
  it.each(["oidc", "credential"])(
    "honors the feature switch with existing %s grants",
    async (type) => {
      const config = {
        acpId: "a",
        accessModel: "CREDENTIALS_LIST",
        featureConfig: { enableItemList: false },
      };
      const service = new AcpCapabilitiesService(
        {
          findOne: async () => ({
            capabilities: [...ACP_CAPABILITIES],
            accessConfig: config,
          }),
        } as any,
        {
          findOne: async () => ({ capabilities: [...ACP_CAPABILITIES] }),
        } as any,
        { findOne: async () => config } as any,
      );
      const req = {
        params: { acpId: "a" },
        user: { type, sub: "u", acpId: "a" },
        acpAccessLevel: "READ_ONLY",
      };
      for (const capability of [
        "item-explorer:view",
        "item-explorer:edit",
      ] as const) {
        await expect(service.assert(req, capability, true)).rejects.toThrow(
          "Item list is not enabled",
        );
      }
      await expect(
        service.assert(req, "review:participate"),
      ).resolves.toBeUndefined();
      config.featureConfig.enableItemList = true;
      await expect(
        service.assert(req, "item-explorer:view"),
      ).resolves.toBeUndefined();
      config.featureConfig.enableItemList = false;
      req.acpAccessLevel = "MANAGER";
      await expect(
        service.assert(req, "item-explorer:edit"),
      ).resolves.toBeUndefined();
    },
  );

  it("revokes grants immediately without replacing tokens", async () => {
    const roles = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ capabilities: ["review:participate"] })
        .mockResolvedValue({ capabilities: [] }),
    };
    const service = new AcpCapabilitiesService(
      {} as any,
      roles as any,
      {} as any,
    );
    const req = { params: { acpId: "a" }, user: { type: "oidc", sub: "u" } };
    await expect(
      service.assert(req, "review:participate"),
    ).resolves.toBeUndefined();
    await expect(service.assert(req, "review:participate")).rejects.toThrow();
  });
  it("does not give administrators implicit participation", async () => {
    const service = new AcpCapabilitiesService(
      {} as any,
      { findOne: async () => null } as any,
      {} as any,
    );
    const req = {
      params: { acpId: "a" },
      user: { type: "oidc", sub: "u", isAppAdmin: true },
    };
    await expect(service.assert(req, "review:manage")).resolves.toBeUndefined();
    await expect(service.assert(req, "review:participate")).rejects.toThrow();
  });
  it("retains public reading without public editing or reviewing", async () => {
    const service = new AcpCapabilitiesService(
      {} as any,
      {} as any,
      {
        findOne: async () => ({ accessModel: "PUBLIC", featureConfig: {} }),
      } as any,
    );
    const req = { params: { acpId: "a" } };
    await expect(
      service.assert(req, "item-explorer:view", true),
    ).resolves.toBeUndefined();
    await expect(
      service.assert(req, "item-explorer:edit", true),
    ).rejects.toThrow();
    await expect(
      service.assert(req, "review:participate", true),
    ).rejects.toThrow();
  });
  it("rejects deleted and cross-ACP credentials", async () => {
    const credentials = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ accessConfig: { acpId: "other" } }),
    };
    const service = new AcpCapabilitiesService(
      credentials as any,
      {} as any,
      {} as any,
    );
    const req = {
      params: { acpId: "a" },
      user: { type: "credential", sub: "u", acpId: "a" },
    };
    await expect(service.resolve(req)).rejects.toThrow();
    await expect(service.resolve(req)).rejects.toThrow();
  });
  it("retains public fallback with a credential token for another ACP", async () => {
    const service = new AcpCapabilitiesService(
      {} as any,
      {} as any,
      {
        findOne: async () => ({ accessModel: "PUBLIC", featureConfig: {} }),
      } as any,
    );
    const req = {
      params: { acpId: "public" },
      acpAccessLevel: "PUBLIC",
      user: { type: "credential", sub: "c", acpId: "other" },
    };
    await expect(
      service.assert(req, "item-explorer:view", true),
    ).resolves.toBeUndefined();
    await expect(service.assert(req, "review:participate")).rejects.toThrow();
  });
});
