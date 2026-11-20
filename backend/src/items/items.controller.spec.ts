import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ItemsController } from "./items.controller";

describe("ItemsController", () => {
  let controller: ItemsController;
  let itemsService: any;
  let stateService: any;
  let itemExplorerStateService: any;

  beforeEach(() => {
    itemsService = {
      getFilteredItems: jest.fn().mockResolvedValue([{ itemId: "item-1" }]),
      canUseItemList: jest.fn().mockResolvedValue(true),
      canUseItemTags: jest.fn().mockResolvedValue(true),
      getItemTags: jest.fn().mockResolvedValue({ item1: ["A"] }),
      getItem: jest.fn().mockResolvedValue({ itemId: "item-1" }),
      uploadEmpiricalDifficulties: jest.fn().mockResolvedValue({
        updated: 2,
        failed: ["item-x"],
        successes: ["item-1"],
        nextItemProperties: {
          "item-1": { id: "item-1", empiricalDifficulty: 0.7 },
        },
      }),
      uploadItemParameters: jest.fn().mockResolvedValue({
        updated: 1,
        failed: [],
        successes: ["item-1"],
        nextItemProperties: {
          "item-1": { infit: 1.05, itemTimeSeconds: 30 },
        },
      }),
      clearEmpiricalDifficulties: jest.fn().mockResolvedValue({
        nextItemProperties: {
          "item-1": { id: "item-1" },
        },
      }),
      ensureShowOnlyItemsWithEmpiricalDifficulty: jest
        .fn()
        .mockResolvedValue(true),
    };

    stateService = {
      getAllStatesForAp: jest.fn().mockResolvedValue([{ itemId: "item-1" }]),
      saveResponseState: jest.fn().mockResolvedValue({ success: true }),
      getResponseState: jest.fn().mockResolvedValue({ state: { value: 1 } }),
      getResponseStateWithFallback: jest
        .fn()
        .mockResolvedValue({ state: {}, isFallback: true }),
      deleteResponseState: jest.fn().mockResolvedValue({ success: true }),
    };

    itemExplorerStateService = {
      getStateForViewer: jest.fn().mockResolvedValue({
        status: "CLEAN",
        version: 4,
        publishedState: {
          itemProperties: {
            "item-1": { id: "item-1", empiricalDifficulty: 0.4 },
          },
        },
        draftState: {
          itemProperties: {
            "item-1": { id: "item-1" },
          },
        },
      }),
      resolveActor: jest.fn().mockReturnValue({ type: "user", id: "u-1" }),
      patchDraft: jest.fn().mockResolvedValue({ status: "DIRTY", version: 5 }),
      saveDraft: jest.fn().mockResolvedValue({ status: "CLEAN", version: 6 }),
      publishItemPropertiesImmediately: jest
        .fn()
        .mockResolvedValue({ status: "CLEAN", version: 5 }),
      publishTagsImmediately: jest.fn().mockResolvedValue({
        tags: { item1: ["A"] },
        state: { status: "CLEAN", version: 5 },
      }),
    };

    controller = new ItemsController(
      itemsService,
      stateService,
      itemExplorerStateService,
    );
  });

  it("returns filtered items", async () => {
    const result = await controller.getItems("ap-1", "abc", "label", "asc");

    expect(result).toEqual([{ itemId: "item-1" }]);
    expect(itemsService.getFilteredItems).toHaveBeenCalledWith(
      "ap-1",
      "abc",
      "label",
      "asc",
    );
  });

  it("rejects item reads for non-managers when the item list is disabled", async () => {
    itemsService.canUseItemList.mockResolvedValue(false);
    const req = { user: { isAppAdmin: false }, apAccessLevel: "READ_ONLY" };

    await expect(
      controller.getItems("ap-1", undefined, undefined, undefined, req),
    ).rejects.toThrow(ForbiddenException);
    await expect(controller.getItem("ap-1", "item-1", req)).rejects.toThrow(
      ForbiddenException,
    );
    expect(itemsService.getFilteredItems).not.toHaveBeenCalled();
    expect(itemsService.getItem).not.toHaveBeenCalled();
  });

  it("allows managers to read items when the item list is disabled", async () => {
    itemsService.canUseItemList.mockResolvedValue(false);
    const req = { user: { isAppAdmin: false }, apAccessLevel: "MANAGER" };

    await expect(
      controller.getItems("ap-1", undefined, undefined, undefined, req),
    ).resolves.toEqual([{ itemId: "item-1" }]);
    expect(itemsService.canUseItemList).not.toHaveBeenCalled();
  });

  it("returns item tags for manager users", async () => {
    const req = { user: { isAppAdmin: false }, apAccessLevel: "MANAGER" };
    const result = await controller.getItemTags("ap-1", req);

    expect(result).toEqual({ item1: ["A"] });
    expect(itemsService.canUseItemTags).not.toHaveBeenCalled();
  });

  it("rejects item tags for non-managers when feature disabled", async () => {
    itemsService.canUseItemTags.mockResolvedValueOnce(false);
    const req = { user: { isAppAdmin: false }, apAccessLevel: "PUBLIC" };

    await expect(controller.getItemTags("ap-1", req)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("returns item tags for non-managers when feature enabled", async () => {
    itemsService.canUseItemTags.mockResolvedValueOnce(true);
    const req = { user: { isAppAdmin: false }, apAccessLevel: "PUBLIC" };

    const result = await controller.getItemTags("ap-1", req);

    expect(result).toEqual({ item1: ["A"] });
  });

  it("saves item tags for non-managers when feature enabled", async () => {
    itemsService.canUseItemTags.mockResolvedValueOnce(true);
    const req = { user: { isAppAdmin: false }, apAccessLevel: "PUBLIC" };

    await controller.saveItemTags(
      "ap-1",
      { tags: { item1: ["A"] } } as any,
      req,
    );

    expect(
      itemExplorerStateService.publishTagsImmediately,
    ).toHaveBeenCalledWith(
      "ap-1",
      { item1: ["A"] },
      expect.objectContaining({
        actor: { type: "user", id: "u-1" },
        changeType: "REPLACE_ITEM_TAGS",
      }),
    );
  });

  it("uses empty map when save item tags payload has no tags", async () => {
    const req = { user: { isAppAdmin: true }, apAccessLevel: "PUBLIC" };

    await controller.saveItemTags("ap-1", {} as any, req);

    expect(
      itemExplorerStateService.publishTagsImmediately,
    ).toHaveBeenCalledWith(
      "ap-1",
      {},
      expect.objectContaining({ changeType: "REPLACE_ITEM_TAGS" }),
    );
  });

  it("rejects save item tags for non-managers when feature disabled", async () => {
    itemsService.canUseItemTags.mockResolvedValueOnce(false);
    const req = { user: { isAppAdmin: false }, apAccessLevel: "PUBLIC" };

    await expect(
      controller.saveItemTags("ap-1", { tags: {} } as any, req),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns single item", async () => {
    await expect(controller.getItem("ap-1", "item-1")).resolves.toEqual({
      itemId: "item-1",
    });
  });

  it("uploads empirical difficulties directly when not in draft mode", async () => {
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;
    const result = await controller.uploadEmpiricalDifficulties(
      "ap-1",
      file,
      "false",
      "7",
    );

    expect(result).toEqual(
      expect.objectContaining({
        updated: 2,
        failed: ["item-x"],
        successes: ["item-1"],
        showOnlyItemsWithEmpiricalDifficulty: true,
      }),
    );
    expect(itemsService.uploadEmpiricalDifficulties).toHaveBeenCalledWith(
      "ap-1",
      file.buffer,
      {
        persist: false,
        itemPropertiesOverride: {
          "item-1": { id: "item-1", empiricalDifficulty: 0.4 },
        },
      },
    );
    expect(
      itemsService.ensureShowOnlyItemsWithEmpiricalDifficulty,
    ).toHaveBeenCalledWith("ap-1");
    expect(
      itemExplorerStateService.publishItemPropertiesImmediately,
    ).toHaveBeenCalledWith(
      "ap-1",
      {
        "item-1": { id: "item-1", empiricalDifficulty: 0.7 },
      },
      expect.objectContaining({ baseVersion: 4 }),
    );
    expect(itemExplorerStateService.patchDraft).not.toHaveBeenCalled();
    expect(itemExplorerStateService.saveDraft).not.toHaveBeenCalled();
  });

  it("uploads wide item parameters into the explorer draft", async () => {
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;
    const req = { user: { sub: "u-1" } };

    const result = await controller.uploadItemParameters(
      "ap-1",
      file,
      "true",
      "4",
      req,
    );

    expect(itemsService.uploadItemParameters).toHaveBeenCalledWith(
      "ap-1",
      file.buffer,
      {
        persist: false,
        itemPropertiesOverride: { "item-1": { id: "item-1" } },
      },
    );
    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "ap-1",
      {
        itemProperties: {
          "item-1": { infit: 1.05, itemTimeSeconds: 30 },
        },
      },
      expect.objectContaining({
        changeType: "CSV_UPLOAD_ITEM_PARAMETERS",
        baseVersion: 4,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        updated: 1,
        explorerState: { status: "DIRTY", version: 5 },
      }),
    );
    expect(
      itemsService.ensureShowOnlyItemsWithEmpiricalDifficulty,
    ).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before patching a warning-gated import", async () => {
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;
    const req = { user: { sub: "u-1" } };
    itemsService.uploadItemParameters.mockResolvedValueOnce({
      updated: 1,
      failed: [],
      successes: ["item-1"],
      warnings: [
        {
          code: "BOOKLET_OCCURRENCES_SKIPPED",
          message: "Booklet-Zuordnungen werden übersprungen.",
        },
      ],
      requiresConfirmation: true,
      nextItemProperties: { "item-1": { empiricalDifficulty: 0.5 } },
    });

    const preview = await controller.uploadItemParameters(
      "ap-1",
      file,
      "true",
      "4",
      req,
    );

    expect(preview).toEqual(
      expect.objectContaining({ requiresConfirmation: true }),
    );
    expect(itemExplorerStateService.patchDraft).not.toHaveBeenCalled();

    itemsService.uploadItemParameters.mockResolvedValueOnce({
      updated: 1,
      failed: [],
      successes: ["item-1"],
      warnings: [],
      requiresConfirmation: false,
      nextItemProperties: { "item-1": { empiricalDifficulty: 0.5 } },
    });
    await controller.uploadItemParameters(
      "ap-1",
      file,
      "true",
      "4",
      req,
      "true",
    );

    expect(itemsService.uploadItemParameters).toHaveBeenLastCalledWith(
      "ap-1",
      file.buffer,
      {
        persist: false,
        itemPropertiesOverride: { "item-1": { id: "item-1" } },
        confirmWarnings: true,
      },
    );
    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledTimes(1);
  });

  it("preserves the difficulty-only visibility behavior for wide imports", async () => {
    itemsService.uploadItemParameters.mockResolvedValueOnce({
      updated: 1,
      failed: [],
      successes: [{ fields: ["est", "infit"], value: -0.4 }],
      nextItemProperties: {
        "item-1": { empiricalDifficulty: -0.4, infit: 1.05 },
      },
    });
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;

    const result = await controller.uploadItemParameters(
      "ap-1",
      file,
      "true",
      "4",
      { user: { sub: "u-1" } },
    );

    expect(
      itemsService.ensureShowOnlyItemsWithEmpiricalDifficulty,
    ).toHaveBeenCalledWith("ap-1");
    expect(result).toEqual(
      expect.objectContaining({
        showOnlyItemsWithEmpiricalDifficulty: true,
      }),
    );
  });

  it("uploads empirical difficulties in draft mode and patches explorer state", async () => {
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;
    const req = { user: { sub: "u-1" } };

    const result = await controller.uploadEmpiricalDifficulties(
      "ap-1",
      file,
      "true",
      "11",
      req as any,
    );

    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      true,
    );
    expect(itemsService.uploadEmpiricalDifficulties).toHaveBeenCalledWith(
      "ap-1",
      file.buffer,
      expect.objectContaining({
        persist: false,
        itemPropertiesOverride: { "item-1": { id: "item-1" } },
      }),
    );
    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "ap-1",
      expect.objectContaining({
        itemProperties: {
          "item-1": { id: "item-1", empiricalDifficulty: 0.7 },
        },
      }),
      expect.objectContaining({
        changeType: "CSV_UPLOAD_EMPIRICAL_DIFFICULTY",
        baseVersion: 11,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        updated: 2,
        showOnlyItemsWithEmpiricalDifficulty: true,
        explorerState: { status: "DIRTY", version: 5 },
      }),
    );
    expect(
      itemsService.ensureShowOnlyItemsWithEmpiricalDifficulty,
    ).toHaveBeenCalledWith("ap-1");
  });

  it("uses undefined baseVersion when draft upload baseVersion is invalid", async () => {
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;

    await controller.uploadEmpiricalDifficulties("ap-1", file, "true", "abc", {
      user: { sub: "u-1" },
    } as any);

    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "ap-1",
      expect.any(Object),
      expect.objectContaining({ baseVersion: undefined }),
    );
  });

  it("clears empirical difficulties directly when not in draft mode", async () => {
    await controller.clearEmpiricalDifficulties("ap-1", "false", "3");

    expect(itemsService.clearEmpiricalDifficulties).toHaveBeenCalledWith(
      "ap-1",
      {
        persist: false,
        itemPropertiesOverride: {
          "item-1": { id: "item-1", empiricalDifficulty: 0.4 },
        },
      },
    );
    expect(
      itemExplorerStateService.publishItemPropertiesImmediately,
    ).toHaveBeenCalledWith(
      "ap-1",
      { "item-1": { id: "item-1" } },
      expect.objectContaining({
        changeType: "CLEAR_EMPIRICAL_DIFFICULTY",
        baseVersion: 4,
      }),
    );
    expect(itemExplorerStateService.patchDraft).not.toHaveBeenCalled();
    expect(itemExplorerStateService.saveDraft).not.toHaveBeenCalled();
  });

  it("rejects direct item-property writes while a draft is pending", async () => {
    itemExplorerStateService.getStateForViewer.mockResolvedValueOnce({
      status: "DIRTY",
      version: 7,
      publishedState: { itemProperties: {} },
      draftState: { itemProperties: {} },
    });
    const file = { buffer: Buffer.from("csv-data") } as Express.Multer.File;

    await expect(
      controller.uploadEmpiricalDifficulties("ap-1", file, "false"),
    ).rejects.toThrow(ConflictException);
    expect(itemsService.uploadEmpiricalDifficulties).not.toHaveBeenCalled();
  });

  it("clears empirical difficulties in draft mode and patches explorer state", async () => {
    const req = { user: { sub: "u-1" } };

    const result = await controller.clearEmpiricalDifficulties(
      "ap-1",
      "true",
      "4",
      req as any,
    );

    expect(itemsService.clearEmpiricalDifficulties).toHaveBeenCalledWith(
      "ap-1",
      expect.objectContaining({
        persist: false,
        itemPropertiesOverride: { "item-1": { id: "item-1" } },
      }),
    );
    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "ap-1",
      expect.any(Object),
      expect.objectContaining({
        changeType: "CLEAR_EMPIRICAL_DIFFICULTY",
        baseVersion: 4,
      }),
    );
    expect(result).toEqual({
      success: true,
      explorerState: { status: "DIRTY", version: 5 },
    });
  });

  it("uses undefined baseVersion when draft clear baseVersion is invalid", async () => {
    await controller.clearEmpiricalDifficulties(
      "ap-1",
      "true",
      "not-a-number",
      { user: { sub: "u-1" } } as any,
    );

    expect(itemExplorerStateService.patchDraft).toHaveBeenCalledWith(
      "ap-1",
      expect.any(Object),
      expect.objectContaining({ baseVersion: undefined }),
    );
  });

  it("returns all response states for AP", async () => {
    await expect(
      controller.getAllResponseStates("ap-1", {} as any),
    ).resolves.toEqual([{ itemId: "item-1" }]);

    expect(stateService.getAllStatesForAp).toHaveBeenCalledWith("ap-1", true);
  });

  it("saves response state", async () => {
    await controller.saveResponseState(
      "ap-1",
      "item-1",
      { unitId: "unit-1", responseData: { answer: 1 } },
      {} as any,
    );

    expect(stateService.saveResponseState).toHaveBeenCalledWith(
      "ap-1",
      "item-1",
      "unit-1",
      { answer: 1 },
      true,
      undefined,
    );
  });

  it("returns existing response state and fallback null when missing", async () => {
    await expect(
      controller.getResponseState("ap-1", "item-1", "unit-1"),
    ).resolves.toEqual({
      state: { value: 1 },
    });
    expect(stateService.getResponseState).toHaveBeenCalledWith(
      "ap-1",
      "item-1",
      "unit-1",
      undefined,
    );

    stateService.getResponseState.mockResolvedValueOnce(null);
    await expect(
      controller.getResponseState("ap-1", "item-2", "unit-1"),
    ).resolves.toEqual({
      state: null,
    });
  });

  it("returns response state with fallback", async () => {
    const itemList = [{ itemId: "item-1", unitId: "unit-1" }];
    await expect(
      controller.getResponseStateWithFallback("ap-1", "item-1", {
        unitId: "unit-1",
        itemList,
      }),
    ).resolves.toEqual({ state: {}, isFallback: true });

    expect(stateService.getResponseStateWithFallback).toHaveBeenCalledWith(
      "ap-1",
      "item-1",
      "unit-1",
      itemList,
      undefined,
    );
  });

  it("rejects direct response-state read without unitId", async () => {
    await expect(
      controller.getResponseState("ap-1", "item-1", undefined),
    ).rejects.toThrow('Query parameter "unitId" is required.');
  });

  it("deletes response state", async () => {
    await expect(
      controller.deleteResponseState("ap-1", "item-1", "unit-1", {} as any),
    ).resolves.toEqual({ success: true });

    expect(stateService.deleteResponseState).toHaveBeenCalledWith(
      "ap-1",
      "item-1",
      "unit-1",
      true,
      undefined,
    );
  });

  it("rejects response-state delete without unitId", async () => {
    await expect(
      controller.deleteResponseState("ap-1", "item-1", undefined, {} as any),
    ).rejects.toThrow('Query parameter "unitId" is required.');
  });
});
