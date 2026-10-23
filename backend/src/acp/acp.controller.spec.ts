import { ForbiddenException } from "@nestjs/common";
import { AcpCapabilitiesService } from "../auth/capabilities/acp-capabilities.service";
import { AcpController } from "./acp.controller";

describe("AcpController", () => {
  let controller: AcpController;
  let acpService: any;
  let itemExplorerStateService: any;
  let adminService: any;

  beforeEach(() => {
    acpService = {
      findAll: jest.fn().mockResolvedValue(["acp-admin"]),
      findByUser: jest.fn().mockResolvedValue(["acp-user"]),
      findById: jest.fn().mockResolvedValue({ id: "acp-1" }),
      create: jest.fn().mockResolvedValue({ id: "acp-1" }),
      update: jest.fn().mockResolvedValue({ id: "acp-1", name: "Updated" }),
      delete: jest.fn().mockResolvedValue(undefined),
      getIndex: jest.fn().mockResolvedValue({ packageId: "pkg-1" }),
      updateIndex: jest
        .fn()
        .mockResolvedValue({ packageId: "pkg-1", version: "1.0.0" }),
      importIndex: jest
        .fn()
        .mockResolvedValue({ packageId: "pkg-1", version: "1.1.0" }),
      deleteIndex: jest
        .fn()
        .mockResolvedValue({ packageId: "pkg-1", version: "0.5.0" }),
      getAssignableUsers: jest.fn().mockResolvedValue([{ id: "u-1" }]),
      getRoles: jest
        .fn()
        .mockResolvedValue([{ userId: "u-1", role: "READ_ONLY" }]),
      assignRole: jest
        .fn()
        .mockResolvedValue({ userId: "u-1", role: "READ_ONLY" }),
      removeRole: jest.fn().mockResolvedValue(undefined),
      getAccessConfig: jest.fn().mockResolvedValue({ accessModel: "PUBLIC" }),
      updateAccessConfig: jest
        .fn()
        .mockResolvedValue({ accessModel: "PUBLIC" }),
      uploadCredentials: jest
        .fn()
        .mockResolvedValue({ added: 1, updated: 2, skipped: 3 }),
      getCredentials: jest.fn().mockResolvedValue([{ id: "cred-1" }]),
      deleteCredential: jest.fn().mockResolvedValue(undefined),
      createCredential: jest.fn().mockResolvedValue({ id: "cred-1" }),
      updateCredential: jest
        .fn()
        .mockResolvedValue({ id: "cred-1", username: "new-name" }),
      updateMetadataColumns: jest
        .fn()
        .mockResolvedValue({ metadataColumns: { visible: ["col1"] } }),
    };

    itemExplorerStateService = {
      resolveActor: jest.fn().mockReturnValue({ type: "user", id: "u-1" }),
      patchDraft: jest.fn().mockResolvedValue({ status: "DIRTY", version: 2 }),
      saveDraft: jest.fn().mockResolvedValue({ status: "CLEAN", version: 3 }),
      discardDraft: jest
        .fn()
        .mockResolvedValue({ status: "CLEAN", version: 4 }),
      listChanges: jest.fn().mockResolvedValue([{ id: "change-1" }]),
    };

    adminService = {
      listApplicationTokens: jest.fn().mockResolvedValue({ items: [] }),
      createApplicationToken: jest.fn().mockResolvedValue({ id: "token-1" }),
      revokeApplicationToken: jest.fn().mockResolvedValue({ id: "token-1" }),
    };

    controller = new AcpController(
      acpService,
      itemExplorerStateService,
      adminService,
      { assert: jest.fn() } as any,
    );
    jest
      .spyOn((controller as any).logger, "log")
      .mockImplementation(() => undefined);
    jest
      .spyOn((controller as any).logger, "error")
      .mockImplementation(() => undefined);
  });

  describe("review settings authorization", () => {
    const request = () => ({
      params: { id: "acp-1" },
      acpAccessLevel: "MANAGER",
      user: { sub: "u-1", type: "oidc" },
    });

    beforeEach(() => {
      controller = new AcpController(
        acpService,
        itemExplorerStateService,
        adminService,
        new AcpCapabilitiesService(
          {} as any,
          { findOne: async () => ({ capabilities: [] }) } as any,
          {} as any,
        ),
      );
    });

    it.each([
      [
        {},
        {
          enableReview: false,
          enableCommenting: false,
          commentTargets: [],
          commentVisibilityMode: "PRIVATE",
        },
      ],
      [
        { enableReview: false, commentVisibilityMode: "PRIVATE" },
        {
          enableReview: false,
          commentVisibilityMode: "PRIVATE",
          commentTargets: [],
        },
      ],
      [
        { enableCommenting: true, commentTargets: ["UNIT", "ITEM"] },
        { enableCommenting: true, commentTargets: ["ITEM", "UNIT", "ITEM"] },
      ],
    ])(
      "allows unrelated changes with equivalent defaults or target sets",
      async (current, next) => {
        acpService.getAccessConfig.mockResolvedValue({
          featureConfig: current,
        });
        const dto = {
          accessModel: "PRIVATE",
          featureConfig: { ...next, showIndexOnStartPage: false },
        };
        await expect(
          controller.updateAccessConfig("acp-1", dto as any, request()),
        ).resolves.toEqual({ accessModel: "PUBLIC" });
        expect(acpService.updateAccessConfig).toHaveBeenCalledWith(
          "acp-1",
          dto,
        );
      },
    );

    it.each([
      [{}, { enableReview: true }],
      [{ enableReview: true }, {}],
      [{}, { enableCommenting: true }],
      [{ enableCommenting: "true" }, { enableCommenting: true }],
      [{ enableCommenting: true }, {}],
      [{}, { commentTargets: ["BOOKLET"] }],
      [{ commentTargets: ["ITEM"] }, { commentTargets: [] }],
      [{}, { commentVisibilityMode: "SHARED" }],
      [{ commentVisibilityMode: "GROUP" }, {}],
    ])(
      "still rejects effective review changes without review:manage",
      async (current, next) => {
        acpService.getAccessConfig.mockResolvedValue({
          featureConfig: current,
        });
        await expect(
          controller.updateAccessConfig(
            "acp-1",
            { featureConfig: next } as any,
            request(),
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(acpService.updateAccessConfig).not.toHaveBeenCalled();
      },
    );

    it("allows effective review changes with an explicit grant", async () => {
      controller = new AcpController(
        acpService,
        itemExplorerStateService,
        adminService,
        new AcpCapabilitiesService(
          {} as any,
          { findOne: async () => ({ capabilities: ["review:manage"] }) } as any,
          {} as any,
        ),
      );
      const dto = {
        featureConfig: { enableCommenting: true, commentTargets: ["UNIT"] },
      };
      await controller.updateAccessConfig("acp-1", dto as any, request());
      expect(acpService.updateAccessConfig).toHaveBeenCalledWith("acp-1", dto);
    });
  });

  it("findAll returns all ACPs for app admins", async () => {
    const result = await controller.findAll({
      user: { isAppAdmin: true, sub: "u-1" },
    });

    expect(result).toEqual(["acp-admin"]);
    expect(acpService.findAll).toHaveBeenCalledTimes(1);
    expect(acpService.findByUser).not.toHaveBeenCalled();
  });

  it("findAll returns user-scoped ACPs for non-admins", async () => {
    const result = await controller.findAll({
      user: { isAppAdmin: false, sub: "u-2" },
    });

    expect(result).toEqual(["acp-user"]);
    expect(acpService.findByUser).toHaveBeenCalledWith("u-2");
  });

  it("delegates basic ACP CRUD and index methods", async () => {
    await expect(controller.findOne("acp-1")).resolves.toEqual({ id: "acp-1" });
    await expect(
      controller.create({ packageId: "pkg-1", name: "ACP 1" } as any),
    ).resolves.toEqual({
      id: "acp-1",
    });
    await expect(
      controller.update("acp-1", { name: "Updated" } as any),
    ).resolves.toEqual({
      id: "acp-1",
      name: "Updated",
    });
    await expect(controller.delete("acp-1")).resolves.toBeUndefined();
    await expect(controller.getIndex("acp-1")).resolves.toEqual({
      packageId: "pkg-1",
    });
    await expect(
      controller.updateIndex("acp-1", { assessmentParts: [] }),
    ).resolves.toEqual({
      packageId: "pkg-1",
      version: "1.0.0",
    });
    await expect(
      controller.importIndex("acp-1", { assessmentParts: [] }),
    ).resolves.toEqual({
      packageId: "pkg-1",
      version: "1.1.0",
    });
    await expect(controller.deleteIndex("acp-1")).resolves.toEqual({
      packageId: "pkg-1",
      version: "0.5.0",
    });
  });

  it("exports ACP index as JSON attachment", async () => {
    const res = {
      setHeader: jest.fn(),
      json: jest.fn(),
    } as any;

    await controller.exportIndex("acp-1", res);

    expect(acpService.getIndex).toHaveBeenCalledWith("acp-1");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="acp-index-acp-1.json"',
    );
    expect(res.json).toHaveBeenCalledWith({ packageId: "pkg-1" });
  });

  it("returns assignable users and ACP roles", async () => {
    await expect(controller.getAssignableUsers("acp-1")).resolves.toEqual([
      { id: "u-1" },
    ]);
    await expect(controller.getRoles("acp-1")).resolves.toEqual([
      { userId: "u-1", role: "READ_ONLY" },
    ]);
  });

  it("forbids ACP_MANAGER assignment for non-admin users", async () => {
    await expect(
      controller.assignRole(
        "acp-1",
        { userId: "u-1", role: "ACP_MANAGER" } as any,
        { user: { isAppAdmin: false } },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(acpService.assignRole).not.toHaveBeenCalled();
  });

  it("assignRole succeeds for app admins", async () => {
    const dto = { userId: "u-1", role: "ACP_MANAGER" } as any;

    await controller.assignRole("acp-1", dto, { user: { isAppAdmin: true } });

    expect(acpService.assignRole).toHaveBeenCalledWith("acp-1", dto);
  });

  it("forbids removal of ACP_MANAGER role for non-admin users", async () => {
    acpService.getRoles.mockResolvedValueOnce([
      { userId: "u-2", role: "ACP_MANAGER" },
    ]);

    await expect(
      controller.removeRole("acp-1", "u-2", { user: { isAppAdmin: false } }),
    ).rejects.toThrow(ForbiddenException);

    expect(acpService.removeRole).not.toHaveBeenCalled();
  });

  it("allows non-admin removal of READ_ONLY roles", async () => {
    acpService.getRoles.mockResolvedValueOnce([
      { userId: "u-2", role: "READ_ONLY" },
    ]);

    await controller.removeRole("acp-1", "u-2", {
      user: { isAppAdmin: false },
    });

    expect(acpService.removeRole).toHaveBeenCalledWith("acp-1", "u-2");
  });

  it("allows app-admin role removal without pre-check lookup", async () => {
    await controller.removeRole("acp-1", "u-3", { user: { isAppAdmin: true } });

    expect(acpService.getRoles).not.toHaveBeenCalled();
    expect(acpService.removeRole).toHaveBeenCalledWith("acp-1", "u-3");
  });

  it("delegates ACP-limited application token management", async () => {
    await expect(
      controller.listApplicationTokens("acp-1", "10", "5"),
    ).resolves.toEqual({ items: [] });
    expect(adminService.listApplicationTokens).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
      allowedAcpId: "acp-1",
    });

    await expect(
      controller.createApplicationToken(
        "acp-1",
        { name: "Studio", scopes: ["acp.read"] } as any,
        { user: { sub: "u-1" } },
      ),
    ).resolves.toEqual({ id: "token-1" });
    expect(adminService.createApplicationToken).toHaveBeenCalledWith(
      {
        name: "Studio",
        scopes: ["acp.read"],
        allowedAcpIds: ["acp-1"],
      },
      "u-1",
      {
        allowedAcpIds: ["acp-1"],
        auditAcpId: "acp-1",
        auditPath: "/api/acp/acp-1/application-tokens",
      },
    );

    await expect(
      controller.revokeApplicationToken("acp-1", "token-1", {
        user: { sub: "u-1" },
      }),
    ).resolves.toEqual({ id: "token-1" });
    expect(adminService.revokeApplicationToken).toHaveBeenCalledWith(
      "token-1",
      "u-1",
      {
        allowedAcpIds: ["acp-1"],
        requireExclusiveAcp: true,
        auditAcpId: "acp-1",
        auditPath: "/api/acp/acp-1/application-tokens/token-1/revoke",
      },
    );
  });

  it("keeps group memberships and global review revisions out of general access responses", async () => {
    acpService.getAccessConfig.mockResolvedValue({
      accessModel: "PUBLIC",
      reviewGroups: [{ id: "hidden" }],
      reviewRevision: "42",
      reviewConfigVersion: 7,
    });
    expect(await controller.getAccessConfig("acp-1")).toEqual({
      accessModel: "PUBLIC",
    });
  });

  it("handles access config and credential endpoints", async () => {
    await expect(controller.getAccessConfig("acp-1")).resolves.toEqual({
      accessModel: "PUBLIC",
    });
    await expect(
      controller.updateAccessConfig("acp-1", { accessModel: "PUBLIC" } as any, {
        params: { id: "acp-1" },
      }),
    ).resolves.toEqual({ accessModel: "PUBLIC" });

    const uploadResult = await controller.uploadCredentials("acp-1", "append", {
      credentials: [{ username: "u", password: "p" }],
    } as any);
    expect(uploadResult).toEqual({
      message: "Credentials processed: 1 added, 2 updated, 3 skipped",
      added: 1,
      updated: 2,
      skipped: 3,
    });

    await expect(controller.getCredentials("acp-1")).resolves.toEqual([
      { id: "cred-1" },
    ]);
    await expect(
      controller.deleteCredential("acp-1", "cred-1"),
    ).resolves.toEqual({
      message: "Credential deleted successfully",
    });
    await expect(
      controller.createCredential("acp-1", {
        username: "new-user",
        password: "pw",
      } as any),
    ).resolves.toEqual({ id: "cred-1" });
    await expect(
      controller.updateCredential("acp-1", "cred-1", {
        username: "new-name",
      } as any),
    ).resolves.toEqual({ id: "cred-1", username: "new-name" });
  });

  it("updates metadata columns and logs success", async () => {
    const result = await controller.updateMetadataColumns(
      "acp-1",
      { metadataColumns: { visible: ["col1"] } } as any,
      { user: { sub: "u-1", roles: ["APP_ADMIN"], acpRoles: [] } },
    );

    expect(result).toEqual({ metadataColumns: { visible: ["col1"] } });
    expect(acpService.updateMetadataColumns).toHaveBeenCalledWith("acp-1", {
      metadataColumns: { visible: ["col1"] },
    });
  });

  it("rethrows metadata column update errors and logs failure", async () => {
    acpService.updateMetadataColumns.mockRejectedValueOnce(new Error("boom"));

    await expect(
      controller.updateMetadataColumns(
        "acp-1",
        { metadataColumns: { visible: ["x"] } } as any,
        { user: { sub: "u-1" } },
      ),
    ).rejects.toThrow("boom");
  });

  it("patches item explorer draft", async () => {
    const req = { user: { sub: "u-1" } };
    const dto = {
      patch: { ui: { filterText: "abc" } },
      changeType: "UI_UPDATE",
      baseVersion: 5,
    } as any;

    const result = await controller.patchItemExplorerDraft("acp-1", dto, req);

    expect(itemExplorerStateService.resolveActor).toHaveBeenCalledWith(
      req.user,
      "acp-1",
    );
    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "acp-1",
      dto.patch,
      {
        actor: { type: "user", id: "u-1" },
        changeType: "UI_UPDATE",
        baseVersion: 5,
      },
    );
    expect(result).toEqual({ status: "DIRTY", version: 2 });
  });

  it("patches item explorer draft with empty patch fallback", async () => {
    await controller.patchItemExplorerDraft(
      "acp-1",
      { changeType: "UI_UPDATE", baseVersion: 1 } as any,
      { user: { sub: "u-1" } },
    );

    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "acp-1",
      {},
      expect.any(Object),
    );
  });

  it("saves and discards item explorer drafts", async () => {
    const req = { user: { sub: "u-1" } };

    await expect(
      controller.saveItemExplorerDraft("acp-1", { baseVersion: 8 } as any, req),
    ).resolves.toEqual({ status: "CLEAN", version: 3 });
    await expect(
      controller.discardItemExplorerDraft(
        "acp-1",
        { baseVersion: 9 } as any,
        req,
      ),
    ).resolves.toEqual({ status: "CLEAN", version: 4 });
  });

  it("lists item explorer changes with parsed and fallback limit", async () => {
    await controller.getItemExplorerChanges("acp-1", "25");
    expect(itemExplorerStateService.listChanges).toHaveBeenCalledWith(
      "acp-1",
      25,
    );

    await controller.getItemExplorerChanges("acp-1", "not-a-number");
    expect(itemExplorerStateService.listChanges).toHaveBeenCalledWith(
      "acp-1",
      100,
    );
  });
});
