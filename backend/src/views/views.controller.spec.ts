import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ViewsController } from "./views.controller";

describe("ViewsController", () => {
  let controller: ViewsController;
  let viewsService: any;
  let itemExplorerStateService: any;
  let itemCollectionsService: any;

  beforeEach(() => {
    viewsService = {
      getPublicSettings: jest
        .fn()
        .mockResolvedValue({ theme: { primary: "#000" } }),
      getPublicAps: jest.fn().mockResolvedValue([{ id: "ap-1" }]),
      getApStartPage: jest.fn().mockResolvedValue({
        units: [{ id: "unit-1" }],
        sequences: [{ id: "seq-1" }],
        featureConfig: {
          allowIndexDownload: true,
          enableUnitView: true,
          enableItemList: true,
          enableSequenceNavigation: true,
          persistUserPreferences: true,
          enablePersonalItemData: true,
          enableItemCollections: true,
        },
      }),
      getApIndex: jest.fn().mockResolvedValue({ packageId: "pkg-1" }),
      getUnitViewData: jest.fn().mockResolvedValue({ unitId: "unit-1" }),
      getItemList: jest.fn().mockResolvedValue([{ itemId: "item-1" }]),
      getItemPreferences: jest
        .fn()
        .mockResolvedValue({ ui: { q: 1 }, tags: { item1: ["A"] } }),
      saveItemPreferences: jest
        .fn()
        .mockResolvedValue({ ui: { q: 2 }, tags: { item1: ["B"] } }),
      patchPersonalItemPreferenceRow: jest.fn().mockResolvedValue({
        rowData: { "uuid::1": { note: "mine" } },
      }),
      exportPersonalItemDataXlsx: jest
        .fn()
        .mockResolvedValue(Buffer.from("personal-xlsx")),
      exportAllPersonalItemDataCsv: jest
        .fn()
        .mockResolvedValue(Buffer.from("all-personal-csv")),
      getTaskSequence: jest
        .fn()
        .mockResolvedValue({ id: "seq-1", units: [{ id: "unit-1" }] }),
    };

    itemCollectionsService = {
      getAccessibleCollectionRowKeys: jest.fn().mockResolvedValue(["uuid::1"]),
      getItemCollections: jest.fn().mockResolvedValue({
        activeCollectionId: "collection-1",
        collections: [],
      }),
      createItemCollection: jest.fn().mockResolvedValue({
        activeCollectionId: "collection-1",
        collections: [],
      }),
      updateItemCollection: jest.fn().mockResolvedValue({
        activeCollectionId: "collection-1",
        collections: [],
      }),
      copyItemCollection: jest.fn().mockResolvedValue({
        activeCollectionId: "collection-copy",
        collections: [],
      }),
      mutateItemCollectionRows: jest.fn().mockResolvedValue({
        collectionId: "collection-1",
        version: 3,
        updatedAt: "2026-07-22T10:00:00.000Z",
        summary: { rowCount: 1 },
      }),
      activateItemCollection: jest.fn().mockResolvedValue({
        activeCollectionId: "collection-1",
        collections: [],
      }),
      deleteItemCollection: jest.fn().mockResolvedValue({
        activeCollectionId: null,
        collections: [],
      }),
      exportItemCollectionCsv: jest
        .fn()
        .mockResolvedValue(Buffer.from("collection-csv")),
    };

    itemExplorerStateService = {
      getStateForViewer: jest
        .fn()
        .mockResolvedValue({ status: "CLEAN", canEdit: false }),
    };

    controller = new ViewsController(
      viewsService,
      itemExplorerStateService,
      itemCollectionsService,
      { resolve: jest.fn().mockResolvedValue([]) } as any,
    );
  });

  it("returns public settings and AP list", async () => {
    await expect(controller.getPublicSettings()).resolves.toEqual({
      theme: { primary: "#000" },
    });
    await expect(controller.getPublicAps()).resolves.toEqual([{ id: "ap-1" }]);
  });

  it("returns AP start page and AP index", async () => {
    await expect(
      controller.getApStartPage("ap-1", { params: { apId: "ap-1" } }),
    ).resolves.toEqual(expect.objectContaining({ units: [{ id: "unit-1" }] }));
    await expect(controller.getApIndex("ap-1")).resolves.toEqual({
      packageId: "pkg-1",
    });
  });

  it("exports AP index for managers and sets response headers", async () => {
    const res = { setHeader: jest.fn(), json: jest.fn() } as any;

    await controller.exportApIndex(
      "ap-1",
      { apCapabilities: ["item-explorer:edit"], apAccessLevel: "MANAGER" },
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="ap-index-ap-1.json"',
    );
    expect(res.json).toHaveBeenCalledWith({ packageId: "pkg-1" });
  });

  it("blocks AP index export when feature is disabled for non-managers", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { allowIndexDownload: false },
    });

    await expect(
      controller.exportApIndex("ap-1", { apAccessLevel: "PUBLIC" }, {} as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns units and supports empty fallback", async () => {
    await expect(controller.getUnits("ap-1")).resolves.toEqual([
      { id: "unit-1" },
    ]);

    viewsService.getApStartPage.mockResolvedValueOnce({});
    await expect(controller.getUnits("ap-1")).resolves.toEqual([]);
  });

  it("blocks unit view when feature is disabled for non-managers", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { enableUnitView: false },
    });

    await expect(
      controller.getUnit("ap-1", "unit-1", { apAccessLevel: "PUBLIC" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("uses default allow=true for unit view when flag is unset", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: {},
    });

    await expect(
      controller.getUnit("ap-1", "unit-1", { apAccessLevel: "PUBLIC" }),
    ).resolves.toEqual({ unitId: "unit-1" });
  });

  it("returns unit view for managers regardless of feature config", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { enableUnitView: false },
    });

    await expect(
      controller.getUnit("ap-1", "unit-1", {
        apCapabilities: ["item-explorer:edit"],
        apAccessLevel: "MANAGER",
      }),
    ).resolves.toEqual({ unitId: "unit-1" });
  });

  it("uses default allow=true for item list when flag is unset", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({ featureConfig: {} });

    await expect(
      controller.getItems("ap-1", { apAccessLevel: "PUBLIC" }),
    ).resolves.toEqual([{ itemId: "item-1" }]);
    expect(viewsService.getItemList).toHaveBeenCalledWith("ap-1", false);
  });

  it("uses the active Item Explorer state for manager item lists", async () => {
    await controller.getItems("ap-1", {
      apCapabilities: ["item-explorer:edit"],
      apAccessLevel: "MANAGER",
    });

    expect(viewsService.getItemList).toHaveBeenCalledWith("ap-1", true);
  });

  it("blocks item list when explicitly disabled", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { enableItemList: false },
    });

    await expect(
      controller.getItems("ap-1", { apAccessLevel: "PUBLIC" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns item explorer state with edit flag derived from access level", async () => {
    await controller.getItemExplorerState("ap-1", {
      apCapabilities: ["item-explorer:edit"],
      apAccessLevel: "MANAGER",
    });
    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      true,
    );

    await controller.getItemExplorerState("ap-1", {
      apAccessLevel: "PUBLIC",
    });
    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      false,
    );
  });

  it("returns empty preferences when persistence is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { persistUserPreferences: false },
    });

    const result = await controller.getItemPreferences(
      "ap-1",
      { user: { sub: "u-1" } },
      "item-list",
    );

    expect(result).toEqual({ ui: {}, tags: {}, rowData: {} });
    expect(viewsService.getItemPreferences).not.toHaveBeenCalled();
  });

  it("loads and saves preferences when persistence is enabled", async () => {
    await expect(
      controller.getItemPreferences(
        "ap-1",
        { user: { sub: "u-1" } },
        "item-list",
      ),
    ).resolves.toEqual({ ui: { q: 1 }, tags: { item1: ["A"] } });

    await expect(
      controller.saveItemPreferences(
        "ap-1",
        { viewId: "item-list", ui: { filter: "x" }, tags: { item2: ["B"] } },
        { user: { sub: "u-1" } },
      ),
    ).resolves.toEqual({ ui: { q: 2 }, tags: { item1: ["B"] } });
  });

  it("rejects full-map personal Explorer saves", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        persistUserPreferences: false,
        enablePersonalItemData: true,
      },
    });

    await expect(
      controller.saveItemPreferences(
        "ap-1",
        { viewId: "item-explorer", rowData: { "uuid::1": { note: "mine" } } },
        { user: { sub: "u-1" } },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(viewsService.saveItemPreferences).not.toHaveBeenCalled();
  });

  it.each(["item-explorer", " item-explorer "])(
    "rejects generic %s saves even when row data is omitted",
    async (viewId) => {
      viewsService.getApStartPage.mockResolvedValue({
        featureConfig: {
          persistUserPreferences: true,
          enablePersonalItemData: true,
        },
      });

      await expect(
        controller.saveItemPreferences(
          "ap-1",
          { viewId, ui: { filter: "mine" } },
          { user: { sub: "u-1" } },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(viewsService.saveItemPreferences).not.toHaveBeenCalled();
    },
  );

  it("patches one personal Explorer row when the feature is enabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        persistUserPreferences: false,
        enablePersonalItemData: true,
      },
    });

    await controller.patchPersonalItemRow(
      "ap-1",
      {
        rowKey: "uuid::1",
        rowData: { note: "mine" },
        perspective: "read-only",
      },
      { user: { sub: "u-1" } },
    );

    expect(viewsService.patchPersonalItemPreferenceRow).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "u-1" },
      "uuid::1",
      { note: "mine" },
      "item-explorer",
      false,
    );
  });

  it("uses the manager draft when validating personal item rows", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: { enablePersonalItemData: true },
    });

    await controller.patchPersonalItemRow(
      "ap-1",
      {
        rowKey: "uuid::draft",
        rowData: { note: "mine" },
        perspective: "editor",
      },
      {
        user: { sub: "u-1" },
        apCapabilities: ["item-explorer:edit"],
        apAccessLevel: "MANAGER",
      },
    );

    expect(viewsService.patchPersonalItemPreferenceRow).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "u-1" },
      "uuid::draft",
      { note: "mine" },
      "item-explorer",
      true,
    );
  });

  it("uses published state for a manager read-only preview", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: { enablePersonalItemData: true },
    });

    await controller.patchPersonalItemRow(
      "ap-1",
      {
        rowKey: "uuid::published",
        rowData: { note: "mine" },
        perspective: "read-only",
      },
      {
        user: { sub: "u-1" },
        apCapabilities: ["item-explorer:edit"],
        apAccessLevel: "MANAGER",
      },
    );

    expect(viewsService.patchPersonalItemPreferenceRow).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "u-1" },
      "uuid::published",
      { note: "mine" },
      "item-explorer",
      false,
    );
  });

  it("does not allow credentials to select the editor state", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: { enablePersonalItemData: true },
    });

    await controller.patchPersonalItemRow(
      "ap-1",
      {
        rowKey: "uuid::published",
        rowData: { note: "mine" },
        perspective: "editor",
      },
      {
        user: {
          type: "credential",
          sub: "credential-1",
          username: "reader-a",
        },
        apAccessLevel: "CREDENTIAL",
      },
    );

    expect(viewsService.patchPersonalItemPreferenceRow).toHaveBeenCalledWith(
      "ap-1",
      {
        kind: "credential",
        credentialId: "credential-1",
        credentialUsername: "reader-a",
      },
      "uuid::published",
      { note: "mine" },
      "item-explorer",
      false,
    );
  });

  it("exports the caller's personal data using the requested Explorer order", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.exportPersonalItemDataXlsx(
      "ap-1",
      {
        rowKeys: ["uuid-2::1", "uuid-1::1"],
        perspective: "editor",
      },
      {
        user: { sub: "u-1" },
        apCapabilities: ["item-explorer:edit"],
        apAccessLevel: "MANAGER",
      },
      res,
    );

    expect(viewsService.exportPersonalItemDataXlsx).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "u-1" },
      ["uuid-2::1", "uuid-1::1"],
      true,
      undefined,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="personal-item-data-ap-1.xlsx"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("personal-xlsx"));
  });

  it("blocks personal data exports when the feature is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        enableItemList: true,
        enablePersonalItemData: false,
      },
    });

    await expect(
      controller.exportPersonalItemDataXlsx(
        "ap-1",
        { rowKeys: [] },
        { user: { sub: "u-1" } },
        {} as any,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(viewsService.exportPersonalItemDataXlsx).not.toHaveBeenCalled();
  });

  it("blocks personal data exports when the item list is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        enableItemList: false,
        enablePersonalItemData: true,
      },
    });

    await expect(
      controller.exportPersonalItemDataXlsx(
        "ap-1",
        { rowKeys: ["uuid::1"] },
        { user: { sub: "u-1" }, apAccessLevel: "READ_ONLY" },
        {} as any,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(viewsService.exportPersonalItemDataXlsx).not.toHaveBeenCalled();
  });

  it("allows managers to export when the public item list is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        enableItemList: false,
        enablePersonalItemData: true,
      },
    });
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.exportPersonalItemDataXlsx(
      "ap-1",
      { rowKeys: ["uuid::1"] },
      {
        user: { sub: "manager-1" },
        apCapabilities: ["item-explorer:edit"],
        apAccessLevel: "MANAGER",
      },
      res,
    );

    expect(viewsService.exportPersonalItemDataXlsx).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "manager-1" },
      ["uuid::1"],
      false,
      undefined,
    );
  });

  it("exports all participants' data as CSV for AP managers", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.exportAllPersonalItemDataCsv(
      "ap-1",
      { perspective: "editor" },
      { apCapabilities: ["item-explorer:edit"], apAccessLevel: "MANAGER" },
      res,
    );

    expect(viewsService.exportAllPersonalItemDataCsv).toHaveBeenCalledWith(
      "ap-1",
      true,
      undefined,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/csv; charset=utf-8",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="all-participant-item-data-ap-1.csv"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("all-personal-csv"));
  });

  it("resolves a collection using the caller identity before exporting all participants", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;
    await controller.exportAllPersonalItemDataCsv(
      "ap-1",
      { collectionId: "collection-1" },
      {
        user: { sub: "manager-1" },
        apCapabilities: ["item-explorer:edit"],
        apAccessLevel: "MANAGER",
      },
      res,
    );
    expect(
      itemCollectionsService.getAccessibleCollectionRowKeys,
    ).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "manager-1" },
      "collection-1",
    );
    expect(viewsService.exportAllPersonalItemDataCsv).toHaveBeenCalledWith(
      "ap-1",
      false,
      ["uuid::1"],
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="all-participant-item-data-ap-1-collection-collection-1.csv"',
    );
  });

  it("does not fall back to all data when the requested collection is unavailable", async () => {
    itemCollectionsService.getAccessibleCollectionRowKeys.mockRejectedValue(
      new Error("Item collection not found"),
    );
    await expect(
      controller.exportAllPersonalItemDataCsv(
        "ap-1",
        { collectionId: "removed" },
        {
          user: { sub: "manager-1" },
          apCapabilities: ["item-explorer:edit"],
          apAccessLevel: "MANAGER",
        },
        {} as any,
      ),
    ).rejects.toThrow("Item collection not found");
    expect(viewsService.exportAllPersonalItemDataCsv).not.toHaveBeenCalled();
  });

  it.each(["READ_ONLY", "EDITOR"])(
    "rejects scoped aggregate exports for %s",
    async (role) => {
      await expect(
        controller.exportAllPersonalItemDataCsv(
          "ap-1",
          { collectionId: "collection-1" },
          { user: { sub: "user-1" }, apAccessLevel: role },
          {} as any,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(
        itemCollectionsService.getAccessibleCollectionRowKeys,
      ).not.toHaveBeenCalled();
      expect(viewsService.exportAllPersonalItemDataCsv).not.toHaveBeenCalled();
    },
  );

  it("rejects scoped exports when collections are disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: { enablePersonalItemData: true },
    });
    await expect(
      controller.exportAllPersonalItemDataCsv(
        "ap-1",
        { collectionId: "collection-1" },
        {
          user: { sub: "manager-1" },
          apCapabilities: ["item-explorer:edit"],
          apAccessLevel: "MANAGER",
        },
        {} as any,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(viewsService.exportAllPersonalItemDataCsv).not.toHaveBeenCalled();
  });

  it("routes personal collection reads, updates and exports to the caller identity", async () => {
    const request = {
      user: { sub: "user-1" },
      apCapabilities: ["item-explorer:edit"],
      apAccessLevel: "MANAGER",
    };
    await controller.getItemCollections("ap-1", "editor", request);
    await controller.updateItemCollection(
      "ap-1",
      "collection-1",
      {
        baseVersion: 2,
        rowKeys: ["uuid::1"],
        shared: true,
        perspective: "editor",
      },
      request,
    );
    await controller.copyItemCollection(
      "ap-1",
      "shared-collection",
      { perspective: "editor" },
      request,
    );
    await controller.mutateItemCollectionRows(
      "ap-1",
      "collection-1",
      { baseVersion: 2, removeRowKeys: ["uuid::1"], perspective: "editor" },
      request,
    );
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;
    await controller.exportItemCollectionCsv(
      "ap-1",
      "collection-1",
      "editor",
      request,
      res,
    );

    expect(itemCollectionsService.getItemCollections).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "user-1" },
      true,
    );
    expect(itemCollectionsService.updateItemCollection).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "user-1" },
      "collection-1",
      expect.objectContaining({
        baseVersion: 2,
        rowKeys: ["uuid::1"],
        shared: true,
      }),
      true,
    );
    expect(itemCollectionsService.copyItemCollection).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "user-1" },
      "shared-collection",
      true,
    );
    expect(
      itemCollectionsService.mutateItemCollectionRows,
    ).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "user-1" },
      "collection-1",
      expect.objectContaining({ baseVersion: 2, removeRowKeys: ["uuid::1"] }),
      true,
    );
    expect(itemCollectionsService.exportItemCollectionCsv).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "user-1" },
      "collection-1",
      true,
      undefined,
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("collection-csv"));
  });

  it("blocks collection endpoints when the feature is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: { enableItemCollections: false },
    });

    await expect(
      controller.getItemCollections("ap-1", "read-only", {
        user: { sub: "user-1" },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(itemCollectionsService.getItemCollections).not.toHaveBeenCalled();
  });

  it("blocks collection endpoints when the public item list is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        enableItemList: false,
        enableItemCollections: true,
      },
    });

    await expect(
      controller.getItemCollections("ap-1", "read-only", {
        user: { sub: "user-1" },
        apAccessLevel: "READ_ONLY",
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(itemCollectionsService.getItemCollections).not.toHaveBeenCalled();
  });

  it("allows managers to use collections when the public item list is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: {
        enableItemList: false,
        enableItemCollections: true,
      },
    });
    const request = {
      user: { sub: "manager-1" },
      apCapabilities: ["item-explorer:edit"],
      apAccessLevel: "MANAGER",
    };

    await controller.getItemCollections("ap-1", "editor", request);

    expect(itemCollectionsService.getItemCollections).toHaveBeenCalledWith(
      "ap-1",
      { kind: "user", userId: "manager-1" },
      true,
    );
  });

  it.each(["READ_ONLY", "CREDENTIAL", "PUBLIC", undefined])(
    "blocks all-participant exports for access level %s",
    async (apAccessLevel) => {
      await expect(
        controller.exportAllPersonalItemDataCsv(
          "ap-1",
          {},
          { apAccessLevel },
          {} as any,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(viewsService.exportAllPersonalItemDataCsv).not.toHaveBeenCalled();
    },
  );

  it("blocks all-participant exports when personal data is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { enablePersonalItemData: false },
    });

    await expect(
      controller.exportAllPersonalItemDataCsv(
        "ap-1",
        {},
        { apCapabilities: ["item-explorer:edit"], apAccessLevel: "ADMIN" },
        {} as any,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(viewsService.exportAllPersonalItemDataCsv).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "rejects personal row patches when only general persistence is %s",
    async (persistUserPreferences) => {
      viewsService.getApStartPage.mockResolvedValue({
        featureConfig: {
          persistUserPreferences,
          enablePersonalItemData: false,
        },
      });

      await expect(
        controller.patchPersonalItemRow(
          "ap-1",
          { rowKey: "uuid::1", rowData: { note: "mine" } },
          { user: { sub: "u-1" } },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(
        viewsService.patchPersonalItemPreferenceRow,
      ).not.toHaveBeenCalled();
    },
  );

  it("returns empty preferences on save when persistence is disabled", async () => {
    viewsService.getApStartPage.mockResolvedValueOnce({
      featureConfig: { persistUserPreferences: false },
    });

    const result = await controller.saveItemPreferences(
      "ap-1",
      { viewId: "item-list", ui: { filter: "x" }, tags: { item2: ["B"] } },
      { user: { sub: "u-1" } },
    );

    expect(result).toEqual({ ui: {}, tags: {}, rowData: {} });
    expect(viewsService.saveItemPreferences).not.toHaveBeenCalled();
  });

  it("returns sequences and sequence details when navigation is enabled", async () => {
    await expect(
      controller.getSequences("ap-1", { apAccessLevel: "PUBLIC" }),
    ).resolves.toEqual([{ id: "seq-1" }]);
    await expect(
      controller.getSequence("ap-1", "seq-1", { apAccessLevel: "PUBLIC" }),
    ).resolves.toEqual({ id: "seq-1", units: [{ id: "unit-1" }] });
  });

  it("uses default allow=true for sequence navigation when flag is unset", async () => {
    viewsService.getApStartPage
      .mockResolvedValueOnce({
        sequences: [{ id: "seq-2" }],
        featureConfig: {},
      })
      .mockResolvedValueOnce({
        sequences: [{ id: "seq-2" }],
        featureConfig: {},
      });

    await expect(
      controller.getSequences("ap-1", { apAccessLevel: "PUBLIC" }),
    ).resolves.toEqual([{ id: "seq-2" }]);
  });

  it("forwards explicit booklet navigation separately from module navigation", async () => {
    await controller.getSequence("ap-1", "same", {
      apCapabilities: ["item-explorer:edit"],
      apAccessLevel: "MANAGER",
      query: { kind: "booklet" },
    });
    expect(viewsService.getTaskSequence).toHaveBeenCalledWith(
      "ap-1",
      "same",
      "booklet",
    );
  });

  it("blocks sequence navigation when disabled", async () => {
    viewsService.getApStartPage.mockResolvedValue({
      featureConfig: { enableSequenceNavigation: false },
    });

    await expect(
      controller.getSequences("ap-1", { apAccessLevel: "PUBLIC" }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.getSequence("ap-1", "seq-1", { apAccessLevel: "PUBLIC" }),
    ).rejects.toThrow(ForbiddenException);
  });
});
