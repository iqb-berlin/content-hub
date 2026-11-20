import { translateApContract } from "./ap-contract";
import { apRoleStorage, apScopeStorage } from "../database/ap-storage";

describe("AP compatibility envelopes", () => {
  it("does not reinterpret object-prototype names as contract aliases", () => {
    const payload = JSON.parse(
      '{"constructor":"custom","__proto__":{"apId":"opaque"}}',
    );
    expect(translateApContract(payload)).toEqual(payload);
    expect({}).not.toHaveProperty("apId");
  });
  it("keeps legacy output stable when serializing already legacy values", () => {
    const legacy = {
      acpRoles: [{ acpId: "id", role: "ACP_MANAGER" }],
      scopes: ["acp.read"],
      capabilities: { "acp.read": true },
    };
    expect(translateApContract(legacy, true)).toEqual(legacy);
  });
  it("normalizes old requests without rewriting package content", () => {
    const index = {
      acpId: "custom-field",
      role: "ACP_MANAGER",
      nested: { acpIndex: 7 },
    };
    expect(
      translateApContract({
        acpId: "id",
        acpIndex: index,
        role: "ACP_MANAGER",
        scopes: ["acp.read"],
      }),
    ).toEqual({
      apId: "id",
      apIndex: index,
      role: "AP_MANAGER",
      scopes: ["ap.read"],
    });
  });

  it("retains nested legacy profiles and transfer envelopes for existing clients", () => {
    const result = {
      user: { apRoles: [{ apId: "id", role: "AP_MANAGER" }] },
      ap: { apIndex: { acpId: "user-content" } },
    };
    expect(translateApContract(result, true)).toEqual({
      user: { acpRoles: [{ acpId: "id", role: "ACP_MANAGER" }] },
      acp: { acpIndex: { acpId: "user-content" } },
    });
  });

  it("rejects conflicting aliases, including explicit null access restrictions", () => {
    expect(() =>
      translateApContract({
        allowedAcpIds: null,
        allowedApIds: ["restricted"],
      }),
    ).toThrow("Conflicting");
    expect(() =>
      translateApContract({ acpId: "first", apId: "second" }),
    ).toThrow("Conflicting");
    expect(translateApContract({ acpId: "same", apId: "same" })).toEqual({
      apId: "same",
    });
  });

  it("keeps files, dates and arbitrary settings intact", () => {
    const date = new Date();
    const bytes = Buffer.from("ACP bytes must not change");
    const settings = { acpId: "custom", scopes: ["acp.read"] };
    const result = translateApContract({
      createdAt: date,
      file: bytes,
      settings,
    }) as Record<string, unknown>;
    expect(result.createdAt).toBe(date);
    expect(result.file).toBe(bytes);
    expect(result.settings).toBe(settings);
  });

  it("translates capabilities only at the application boundary", () => {
    expect(
      translateApContract(
        {
          scopes: ["ap.read"],
          capabilities: { "ap.read": true },
          allowedApIds: ["id"],
        },
        true,
      ),
    ).toEqual({
      scopes: ["acp.read"],
      capabilities: { "acp.read": true },
      allowedAcpIds: ["id"],
    });
  });

  it("normalizes old audit resource types and emits legacy audit details", () => {
    expect(
      translateApContract({
        details: { resourceType: "acp", allowedAcpIds: ["id"] },
      }),
    ).toEqual({ details: { resourceType: "ap", allowedApIds: ["id"] } });
    expect(
      translateApContract(
        { details: { resourceType: "ap", allowedApIds: ["id"] } },
        true,
      ),
    ).toEqual({ details: { resourceType: "acp", allowedAcpIds: ["id"] } });
  });

  it("maps canonical roles and scopes to the existing physical storage", () => {
    expect(apRoleStorage.from("ACP_MANAGER")).toBe("AP_MANAGER");
    expect(apRoleStorage.to("AP_MANAGER")).toBe("ACP_MANAGER");
    expect(apScopeStorage.from(["acp.read", "files.read"])).toEqual([
      "ap.read",
      "files.read",
    ]);
    expect(apScopeStorage.to(["ap.read", "files.read"])).toEqual([
      "acp.read",
      "files.read",
    ]);
  });
});
