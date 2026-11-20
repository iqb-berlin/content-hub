import { ApCapabilitiesService } from "./ap-capabilities.service";
import { AP_CAPABILITIES } from "./ap-capabilities";

describe("AP capability matrix", () => {
  for (const type of ["oidc", "credential"]) {
    for (let mask = 0; mask < 16; mask++) {
      const grants = AP_CAPABILITIES.filter((_, i) => mask & (1 << i));
      it(`${type}: ${grants.join(",") || "none"}`, async () => {
        const credentials = {
          findOne: jest.fn().mockResolvedValue({
            capabilities: grants,
            accessConfig: { apId: "a", accessModel: "CREDENTIALS_LIST" },
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
        const service = new ApCapabilitiesService(
          credentials as any,
          roles as any,
          configs as any,
        );
        for (const capability of AP_CAPABILITIES) {
          const req = {
            params: { apId: "a" },
            user: { type, sub: "u", apId: "a" },
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
        apId: "a",
        accessModel: "CREDENTIALS_LIST",
        featureConfig: { enableItemList: false },
      };
      const service = new ApCapabilitiesService(
        {
          findOne: async () => ({
            capabilities: [...AP_CAPABILITIES],
            accessConfig: config,
          }),
        } as any,
        {
          findOne: async () => ({ capabilities: [...AP_CAPABILITIES] }),
        } as any,
        { findOne: async () => config } as any,
      );
      const req = {
        params: { apId: "a" },
        user: { type, sub: "u", apId: "a" },
        apAccessLevel: "READ_ONLY",
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
      req.apAccessLevel = "MANAGER";
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
    const service = new ApCapabilitiesService(
      {} as any,
      roles as any,
      {} as any,
    );
    const req = { params: { apId: "a" }, user: { type: "oidc", sub: "u" } };
    await expect(
      service.assert(req, "review:participate"),
    ).resolves.toBeUndefined();
    await expect(service.assert(req, "review:participate")).rejects.toThrow();
  });
  it("does not give administrators implicit participation", async () => {
    const service = new ApCapabilitiesService(
      {} as any,
      { findOne: async () => null } as any,
      {} as any,
    );
    const req = {
      params: { apId: "a" },
      user: { type: "oidc", sub: "u", isAppAdmin: true },
    };
    await expect(service.assert(req, "review:manage")).resolves.toBeUndefined();
    await expect(service.assert(req, "review:participate")).rejects.toThrow();
  });
  it("retains public reading without public editing or reviewing", async () => {
    const service = new ApCapabilitiesService(
      {} as any,
      {} as any,
      {
        findOne: async () => ({ accessModel: "PUBLIC", featureConfig: {} }),
      } as any,
    );
    const req = { params: { apId: "a" } };
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
  it("rejects deleted and cross-AP credentials", async () => {
    const credentials = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ accessConfig: { apId: "other" } }),
    };
    const service = new ApCapabilitiesService(
      credentials as any,
      {} as any,
      {} as any,
    );
    const req = {
      params: { apId: "a" },
      user: { type: "credential", sub: "u", apId: "a" },
    };
    await expect(service.resolve(req)).rejects.toThrow();
    await expect(service.resolve(req)).rejects.toThrow();
  });
  it("retains public fallback with a credential token for another AP", async () => {
    const service = new ApCapabilitiesService(
      {} as any,
      {} as any,
      {
        findOne: async () => ({ accessModel: "PUBLIC", featureConfig: {} }),
      } as any,
    );
    const req = {
      params: { apId: "public" },
      apAccessLevel: "PUBLIC",
      user: { type: "credential", sub: "c", apId: "other" },
    };
    await expect(
      service.assert(req, "item-explorer:view", true),
    ).resolves.toBeUndefined();
    await expect(service.assert(req, "review:participate")).rejects.toThrow();
  });
});
