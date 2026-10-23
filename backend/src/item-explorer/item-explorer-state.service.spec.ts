import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException } from "@nestjs/common";
import { ItemExplorerStateService } from "./item-explorer-state.service";
import {
  Acp,
  AcpAccessConfig,
  AcpItemExplorerChangeLog,
  AcpItemExplorerState,
} from "../database/entities";

describe("ItemExplorerStateService", () => {
  let service: ItemExplorerStateService;
  let acpRepo: any;
  let accessConfigRepo: any;
  let stateRepo: any;
  let changeLogRepo: any;
  let transactionManager: any;

  const baseSharedState = {
    ui: {},
    tags: {},
    metadataColumns: { visible: [], order: [], configured: false, widths: {} },
    itemOrder: [],
    itemProperties: {},
  };

  const buildStateRecord = (
    overrides: Partial<AcpItemExplorerState> = {},
  ): AcpItemExplorerState => {
    const now = new Date("2026-04-19T10:00:00.000Z");
    return {
      id: "state-1",
      acpId: "acp-1",
      publishedState: JSON.parse(JSON.stringify(baseSharedState)),
      draftState: JSON.parse(JSON.stringify(baseSharedState)),
      status: "CLEAN",
      version: 1,
      publishedVersion: 1,
      updatedByRole: null,
      updatedByUsername: null,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as AcpItemExplorerState;
  };

  beforeEach(async () => {
    acpRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    accessConfigRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    stateRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((payload) => payload),
      save: jest.fn(),
    };
    changeLogRepo = {
      find: jest.fn(),
      create: jest.fn().mockImplementation((payload) => payload),
      save: jest.fn(),
    };
    transactionManager = {
      getRepository: jest.fn((entity) => {
        if (entity === Acp) return acpRepo;
        if (entity === AcpAccessConfig) return accessConfigRepo;
        if (entity === AcpItemExplorerState) return stateRepo;
        if (entity === AcpItemExplorerChangeLog) return changeLogRepo;
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    stateRepo.manager = {
      transaction: jest.fn((callback) => callback(transactionManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemExplorerStateService,
        { provide: getRepositoryToken(Acp), useValue: acpRepo },
        {
          provide: getRepositoryToken(AcpAccessConfig),
          useValue: accessConfigRepo,
        },
        {
          provide: getRepositoryToken(AcpItemExplorerState),
          useValue: stateRepo,
        },
        {
          provide: getRepositoryToken(AcpItemExplorerChangeLog),
          useValue: changeLogRepo,
        },
      ],
    }).compile();

    service = module.get<ItemExplorerStateService>(ItemExplorerStateService);
  });

  it("initializes state for existing ACP and returns published state for read-only viewers", async () => {
    stateRepo.findOne.mockResolvedValue(null);
    acpRepo.findOne.mockResolvedValue({
      id: "acp-1",
      itemProperties: {
        unit1_item1: { tags: ["A"], empiricalDifficulty: 1.2, excluded: true },
      },
    });
    accessConfigRepo.findOne.mockResolvedValue({
      acpId: "acp-1",
      featureConfig: {
        metadataColumns: {
          visible: ["subject"],
          order: ["subject"],
        },
      },
    });
    stateRepo.save.mockImplementation(async (record: any) => ({
      ...record,
      id: "state-new",
      updatedAt: new Date("2026-04-19T10:01:00.000Z"),
      createdAt: new Date("2026-04-19T10:01:00.000Z"),
    }));

    const envelope = await service.getStateForViewer("acp-1", false);

    expect(envelope.canEdit).toBe(false);
    expect(envelope.canPublish).toBe(false);
    expect(envelope.activeState).toEqual(envelope.publishedState);
    expect(envelope.publishedState.metadataColumns.visible).toEqual([
      "subject",
    ]);
    expect(
      envelope.publishedState.itemProperties["unit1_item1"].empiricalDifficulty,
    ).toBe(1.2);
    expect(envelope.publishedState.itemProperties["unit1_item1"].excluded).toBe(
      true,
    );
    expect(stateRepo.save).toHaveBeenCalledTimes(1);
  });

  it("caches one normalized state pair and returns isolated item-list projections", async () => {
    const record = buildStateRecord({
      status: "DIRTY",
      version: 8,
      publishedVersion: 5,
      draftState: {
        ...baseSharedState,
        ui: { filterText: "draft filter" },
        itemProperties: {
          draft: { empiricalDifficulty: "1.5" },
        },
      },
      publishedState: {
        ...baseSharedState,
        ui: { filterText: "published filter" },
        itemProperties: {
          published: { empiricalDifficulty: "0.5" },
        },
      },
    });
    stateRepo.findOne.mockResolvedValue(record);
    const normalizeSpy = jest.spyOn(service as any, "normalizeStatePayload");

    const first = await service.getItemListStateProjection("acp-1", true);

    expect(first).toEqual({
      activeItemProperties: {
        draft: { empiricalDifficulty: 1.5 },
      },
      publishedItemProperties: {
        published: { empiricalDifficulty: 0.5 },
      },
      activeVersion: 8,
      publishedVersion: 5,
    });
    expect(normalizeSpy).toHaveBeenCalledTimes(2);

    first.activeItemProperties.draft.empiricalDifficulty = 99;
    const second = await service.getItemListStateProjection("acp-1", true);
    expect(second.activeItemProperties.draft.empiricalDifficulty).toBe(1.5);
    expect(normalizeSpy).toHaveBeenCalledTimes(2);

    const readOnly = await service.getItemListStateProjection("acp-1", false);
    expect(readOnly).toEqual({
      activeItemProperties: {
        published: { empiricalDifficulty: 0.5 },
      },
      publishedItemProperties: {
        published: { empiricalDifficulty: 0.5 },
      },
      activeVersion: 5,
      publishedVersion: 5,
    });

    const envelope = await service.getStateForViewer("acp-1", true);
    expect(envelope.activeState.ui).toEqual({
      filterText: "draft filter",
    });
    expect(normalizeSpy).toHaveBeenCalledTimes(2);
  });

  it("loads only the version columns for unit-view cache signatures", async () => {
    stateRepo.findOne.mockResolvedValue(
      buildStateRecord({ version: 8, publishedVersion: 5 }),
    );

    await expect(service.getStateVersionForViewer("acp-1", true)).resolves.toBe(
      8,
    );
    await expect(
      service.getStateVersionForViewer("acp-1", false),
    ).resolves.toBe(5);
    expect(stateRepo.findOne).toHaveBeenCalledWith({
      where: { acpId: "acp-1" },
      select: {
        version: true,
        publishedVersion: true,
      },
    });
  });

  it("returns state created by a concurrent initializer after locking the ACP", async () => {
    const concurrentlyCreated = buildStateRecord();
    stateRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentlyCreated);
    acpRepo.findOne.mockResolvedValue({ id: "acp-1", itemProperties: {} });

    const envelope = await service.getStateForViewer("acp-1", false);

    expect(acpRepo.findOne).toHaveBeenCalledWith({
      where: { id: "acp-1" },
      lock: { mode: "pessimistic_write" },
    });
    expect(envelope.version).toBe(1);
    expect(stateRepo.create).not.toHaveBeenCalled();
    expect(stateRepo.save).not.toHaveBeenCalled();
    expect(accessConfigRepo.findOne).not.toHaveBeenCalled();
  });

  it("runs clean-state work with the locked state transaction manager", async () => {
    const state = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(state);
    const operation = jest.fn().mockResolvedValue("done");

    await expect(
      service.runWithLockedCleanState("acp-1", operation),
    ).resolves.toBe("done");

    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CLEAN",
        publishedState: baseSharedState,
      }),
      transactionManager,
    );
    expect(stateRepo.findOne).toHaveBeenLastCalledWith({
      where: { acpId: "acp-1" },
      lock: { mode: "pessimistic_write" },
    });
  });

  it("rejects locked clean-state work while a draft is pending", async () => {
    stateRepo.findOne.mockResolvedValue(buildStateRecord({ status: "DIRTY" }));
    const operation = jest.fn();

    await expect(
      service.runWithLockedCleanState("acp-1", operation),
    ).rejects.toThrow(ConflictException);
    expect(operation).not.toHaveBeenCalled();
  });

  it("rejects an unlocked published-state snapshot while a draft is pending", async () => {
    stateRepo.findOne.mockResolvedValue(buildStateRecord({ status: "DIRTY" }));

    await expect(service.getCleanPublishedState("acp-1")).rejects.toThrow(
      ConflictException,
    );
  });

  it("rejects locked work when the published version changed after parsing", async () => {
    stateRepo.findOne.mockResolvedValue(
      buildStateRecord({ status: "CLEAN", publishedVersion: 8 }),
    );
    const operation = jest.fn();

    await expect(
      service.runWithLockedCleanState("acp-1", operation, 7),
    ).rejects.toThrow(ConflictException);
    expect(operation).not.toHaveBeenCalled();
  });

  it("returns conflict on outdated draft version", async () => {
    stateRepo.findOne.mockResolvedValue(buildStateRecord({ version: 7 }));

    await expect(
      service.patchDraft(
        "acp-1",
        { ui: { filterText: "x" } },
        {
          baseVersion: 6,
          actor: {
            userId: "1f2e3d4c-1234-4f56-8a90-abcdef123456",
            username: "manager",
          },
          changeType: "UI_STATE_CHANGED",
        },
      ),
    ).rejects.toThrow(ConflictException);

    expect(stateRepo.save).not.toHaveBeenCalled();
    expect(changeLogRepo.save).not.toHaveBeenCalled();
  });

  it("rechecks the draft version after acquiring the transaction lock", async () => {
    stateRepo.findOne
      .mockResolvedValueOnce(buildStateRecord({ version: 4 }))
      .mockResolvedValueOnce(buildStateRecord({ version: 5 }));

    await expect(
      service.patchDraft(
        "acp-1",
        { ui: { filterText: "new" } },
        { baseVersion: 4 },
      ),
    ).rejects.toThrow(ConflictException);

    expect(stateRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(stateRepo.findOne).toHaveBeenLastCalledWith({
      where: { acpId: "acp-1" },
      lock: { mode: "pessimistic_write" },
    });
    expect(stateRepo.save).not.toHaveBeenCalled();
    expect(changeLogRepo.save).not.toHaveBeenCalled();
  });

  it("patches draft, increments version and writes audit log entry", async () => {
    const record = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:00:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      { tags: { item1: ["tag-x"] } },
      {
        baseVersion: 1,
        actor: {
          userId: "11111111-1111-4111-8111-111111111111",
          username: "alice",
          role: "ACP_MANAGER",
        },
        changeType: "TAGS_CHANGED",
      },
    );

    expect(envelope.status).toBe("DIRTY");
    expect(envelope.version).toBe(2);
    expect(stateRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        acpId: "acp-1",
        changeType: "TAGS_CHANGED",
        actorUsername: "alice",
        actorRole: "ACP_MANAGER",
      }),
    );
    expect(changeLogRepo.save).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicitly empty column selection and configured widths", async () => {
    const record = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:00:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        metadataColumns: {
          visible: [],
          order: [],
          configured: true,
          widths: { subject: 245 },
        },
      },
      { baseVersion: 1, changeType: "METADATA_COLUMNS_CHANGED" },
    );

    expect(envelope.draftState.metadataColumns).toEqual({
      visible: [],
      order: [],
      configured: true,
      widths: { subject: 245 },
    });
  });

  it("persists and normalizes the unified table layout in draft state", async () => {
    const record = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:02:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        metadataColumns: {
          visible: ["custom"],
          order: ["custom"],
          configured: true,
          widths: { custom: 220 },
          layout: {
            visible: ["system:unitLabel", "metadata:custom"],
            order: ["metadata:custom", "system:unitLabel"],
            configured: true,
            widths: { "system:unitLabel": 310, "personal:category": 900 },
            schemaVersion: 2,
          },
        },
      },
      { baseVersion: 1, changeType: "METADATA_COLUMNS_CHANGED" },
    );

    expect(envelope.draftState.metadataColumns.layout).toEqual({
      visible: ["system:unitLabel", "metadata:custom"],
      order: ["metadata:custom", "system:unitLabel"],
      configured: true,
      widths: { "system:unitLabel": 310, "personal:category": 600 },
      schemaVersion: 2,
    });
  });

  it("keeps widths for all unified columns and full namespaced metadata keys", async () => {
    const record = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:02:30.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);
    const widths = Object.fromEntries(
      Array.from({ length: 110 }, (_, index) => [
        `metadata:column-${index}`,
        200 + index,
      ]),
    );
    const longMetadataKey = `metadata:${"x".repeat(200)}`;
    widths[longMetadataKey] = 333;

    const envelope = await service.patchDraft(
      "acp-1",
      {
        metadataColumns: {
          layout: {
            visible: ["system:itemId"],
            order: ["system:itemId"],
            configured: true,
            widths,
          },
        },
      },
      { baseVersion: 1, changeType: "METADATA_COLUMNS_CHANGED" },
    );
    const normalizedWidths =
      envelope.draftState.metadataColumns.layout?.widths || {};

    expect(Object.keys(normalizedWidths)).toHaveLength(111);
    expect(normalizedWidths[longMetadataKey]).toBe(333);
  });

  it("preserves an explicitly empty unified table selection", async () => {
    const record = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:03:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        metadataColumns: {
          visible: [],
          order: [],
          configured: true,
          widths: {},
          layout: {
            visible: [],
            order: ["system:referenceNumber"],
            configured: true,
            widths: {},
          },
        },
      },
      { baseVersion: 1, changeType: "METADATA_COLUMNS_CHANGED" },
    );

    expect(envelope.draftState.metadataColumns.layout?.visible).toEqual([]);
  });

  it("normalizes persisted preview targets in item property patches", async () => {
    const record = buildStateRecord();
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:05:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        itemPropertiesPatch: {
          item1: { previewTargetId: "  BASE_B  " },
        },
      },
      {
        baseVersion: 1,
        changeType: "PREVIEW_TARGET_CHANGED",
      },
    );

    expect(envelope.status).toBe("DIRTY");
    expect(envelope.draftState.itemProperties.item1.previewTargetId).toBe(
      "BASE_B",
    );
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "PREVIEW_TARGET_CHANGED",
      }),
    );
  });

  it("removes cleared preview target overrides while keeping other item properties", async () => {
    const record = buildStateRecord({
      draftState: {
        ...baseSharedState,
        itemProperties: {
          item1: {
            previewTargetId: "BASE_A",
            empiricalDifficulty: 2.5,
          },
        },
      } as any,
    });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:07:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        itemPropertiesPatch: {
          item1: { previewTargetId: "   " },
        },
      },
      {
        baseVersion: 1,
        changeType: "PREVIEW_TARGET_CHANGED",
      },
    );

    expect(
      envelope.draftState.itemProperties.item1.previewTargetId,
    ).toBeUndefined();
    expect(envelope.draftState.itemProperties.item1.empiricalDifficulty).toBe(
      2.5,
    );
  });

  it("drops false exclusion flags while keeping other item properties intact", async () => {
    const record = buildStateRecord({
      draftState: {
        ...baseSharedState,
        itemProperties: {
          item1: {
            excluded: true,
            previewTargetId: "BASE_A",
          },
        },
      } as any,
    });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:10:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        itemPropertiesPatch: {
          item1: { excluded: false },
        },
      },
      {
        baseVersion: 1,
        changeType: "ITEM_EXCLUSION_CHANGED",
      },
    );

    expect(envelope.draftState.itemProperties.item1.excluded).toBeUndefined();
    expect(envelope.draftState.itemProperties.item1.previewTargetId).toBe(
      "BASE_A",
    );
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "ITEM_EXCLUSION_CHANGED",
      }),
    );
  });

  it("preserves explicit empty tag overrides for regular and partial-credit rows", async () => {
    const record = buildStateRecord({
      draftState: {
        ...baseSharedState,
        tags: { "uuid-1": ["base"] },
        itemProperties: {
          "uuid-1": {
            tags: ["base"],
            excluded: true,
            previewTargetId: "BASE_A",
          },
          "uuid-1::1": {
            itemUuid: "uuid-1",
            subId: "1",
          },
        },
      } as any,
    });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T11:15:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.patchDraft(
      "acp-1",
      {
        tags: {
          "uuid-1": [],
          "uuid-1::1": [],
        },
        itemPropertiesPatch: {
          "uuid-1": {
            tags: [],
          },
          "uuid-1::1": {
            tags: [],
            excluded: false,
            previewTargetId: "",
          },
        },
      },
      {
        baseVersion: 1,
        changeType: "PARTIAL_ROW_OVERRIDES_CLEARED",
      },
    );

    expect(envelope.draftState.tags["uuid-1"]).toEqual([]);
    expect(envelope.draftState.tags["uuid-1::1"]).toEqual([]);
    expect(envelope.draftState.itemProperties["uuid-1"]).toEqual(
      expect.objectContaining({ tags: [] }),
    );
    expect(envelope.draftState.itemProperties["uuid-1::1"]).toEqual(
      expect.objectContaining({
        tags: [],
        excluded: false,
        previewTargetId: "",
      }),
    );
  });

  it("publishes draft atomically into ACP domain data and feature config", async () => {
    const draftState = {
      ...baseSharedState,
      metadataColumns: { visible: ["subject"], order: ["subject"] },
      itemProperties: {
        item1: {
          empiricalDifficulty: 2.5,
          excluded: true,
          tags: ["x"],
          previewTargetId: "BASE_A",
        },
      },
    };
    const record = buildStateRecord({
      draftState: JSON.parse(JSON.stringify(draftState)),
      status: "DIRTY",
      version: 3,
      publishedVersion: 2,
    });

    stateRepo.findOne.mockResolvedValue(record);
    acpRepo.findOne.mockResolvedValue({ id: "acp-1", itemProperties: {} });
    accessConfigRepo.findOne.mockResolvedValue({
      acpId: "acp-1",
      featureConfig: {
        itemExplorerReducedView: {
          enabled: true,
          showExplorerItemPanel: false,
        },
      },
    });
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T12:00:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.saveDraft("acp-1", {
      baseVersion: 3,
      actor: { username: "bob", role: "ACP_MANAGER" },
    });

    expect(acpRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        itemProperties: draftState.itemProperties,
      }),
    );
    expect(accessConfigRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        featureConfig: expect.objectContaining({
          itemExplorerReducedView: expect.objectContaining({
            enabled: true,
            showExplorerItemPanel: false,
          }),
          metadataColumns: expect.objectContaining({
            visible: draftState.metadataColumns.visible,
            order: draftState.metadataColumns.order,
            configured: true,
          }),
        }),
      }),
    );
    expect(envelope.status).toBe("CLEAN");
    expect(envelope.version).toBe(4);
    expect(envelope.publishedVersion).toBe(3);
    expect(stateRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "SAVE_DRAFT",
        publishedVersion: 3,
      }),
    );
  });

  it("publishes immediate item properties in one locked transaction", async () => {
    const record = buildStateRecord({
      publishedState: {
        ...baseSharedState,
        itemProperties: { item1: { empiricalDifficulty: 0.2 } },
      },
      draftState: {
        ...baseSharedState,
        itemProperties: { item1: { empiricalDifficulty: 0.2 } },
      },
      version: 4,
      publishedVersion: 2,
    });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T12:30:00.000Z"),
    }));
    acpRepo.findOne.mockResolvedValue({ id: "acp-1", itemProperties: {} });
    acpRepo.save.mockImplementation(async (entity: any) => entity);
    accessConfigRepo.findOne.mockResolvedValue(null);
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.publishItemPropertiesImmediately(
      "acp-1",
      { item1: { empiricalDifficulty: 0.8 } },
      {
        actor: { username: "alice", role: "ACP_MANAGER" },
        changeType: "CSV_UPLOAD_EMPIRICAL_DIFFICULTY",
        baseVersion: 4,
      },
    );

    expect(stateRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(stateRepo.findOne).toHaveBeenCalledWith({
      where: { acpId: "acp-1" },
      lock: { mode: "pessimistic_write" },
    });
    expect(acpRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        itemProperties: { item1: { empiricalDifficulty: 0.8 } },
      }),
    );
    expect(envelope.status).toBe("CLEAN");
    expect(envelope.version).toBe(5);
    expect(envelope.publishedVersion).toBe(3);
    expect(envelope.publishedState.itemProperties).toEqual({
      item1: { empiricalDifficulty: 0.8 },
    });
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "CSV_UPLOAD_EMPIRICAL_DIFFICULTY",
        draftVersion: 5,
        publishedVersion: 3,
      }),
    );
  });

  it("keeps audit logging inside the immediate publish transaction", async () => {
    const record = buildStateRecord({ version: 4, publishedVersion: 2 });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => entity);
    acpRepo.findOne.mockResolvedValue({ id: "acp-1", itemProperties: {} });
    acpRepo.save.mockImplementation(async (entity: any) => entity);
    accessConfigRepo.findOne.mockResolvedValue(null);
    changeLogRepo.save.mockRejectedValue(new Error("audit write failed"));

    await expect(
      service.publishItemPropertiesImmediately(
        "acp-1",
        { item1: { empiricalDifficulty: 0.8 } },
        {
          changeType: "CSV_UPLOAD_EMPIRICAL_DIFFICULTY",
          baseVersion: 4,
        },
      ),
    ).rejects.toThrow("audit write failed");

    expect(stateRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(changeLogRepo.save).toHaveBeenCalledTimes(1);
  });

  it("replaces tags in domain and explorer state in one transaction", async () => {
    const currentState = {
      ...baseSharedState,
      tags: {
        item1: ["old"],
        item2: ["stale"],
        "uuid-1::1": ["inherited"],
      },
      itemProperties: {
        item1: { empiricalDifficulty: 0.2, tags: ["old"] },
        item2: { tags: ["stale"] },
        "uuid-1::1": {
          itemUuid: "uuid-1",
          subId: "1",
          tags: ["inherited"],
        },
      },
    };
    const record = buildStateRecord({
      publishedState: JSON.parse(JSON.stringify(currentState)),
      draftState: JSON.parse(JSON.stringify(currentState)),
      version: 4,
      publishedVersion: 2,
    });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T12:45:00.000Z"),
    }));
    acpRepo.findOne.mockResolvedValue({ id: "acp-1", itemProperties: {} });
    acpRepo.save.mockImplementation(async (entity: any) => entity);
    accessConfigRepo.findOne.mockResolvedValue(null);
    changeLogRepo.save.mockResolvedValue(undefined);

    const result = await service.publishTagsImmediately(
      "acp-1",
      {
        item1: [" new ", "new"],
        item2: [],
        "uuid-1::1": [],
      },
      {
        actor: { username: "reader", role: "READ_ONLY" },
        changeType: "REPLACE_ITEM_TAGS",
      },
    );

    expect(result.tags).toEqual({
      item1: ["new"],
      item2: [],
      "uuid-1::1": [],
    });
    expect(result.state.publishedState.tags).toEqual(result.tags);
    expect(result.state.draftState.tags).toEqual(result.tags);
    expect(result.state.publishedState.itemProperties).toEqual({
      item1: { empiricalDifficulty: 0.2, tags: ["new"] },
      item2: { tags: [] },
      "uuid-1::1": {
        itemUuid: "uuid-1",
        subId: "1",
        tags: [],
      },
    });
    expect(acpRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        itemProperties: result.state.publishedState.itemProperties,
      }),
    );
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ changeType: "REPLACE_ITEM_TAGS" }),
    );
  });

  it("rejects direct tag replacement while a draft is pending", async () => {
    stateRepo.findOne.mockResolvedValue(
      buildStateRecord({ status: "DIRTY", version: 3 }),
    );

    await expect(
      service.publishTagsImmediately("acp-1", { item1: ["new"] }),
    ).rejects.toThrow(ConflictException);

    expect(acpRepo.save).not.toHaveBeenCalled();
    expect(stateRepo.save).not.toHaveBeenCalled();
    expect(changeLogRepo.save).not.toHaveBeenCalled();
  });

  it("discard resets draft to published and logs change", async () => {
    const publishedState = {
      ...baseSharedState,
      ui: { filterText: "abc" },
    };
    const record = buildStateRecord({
      publishedState: JSON.parse(JSON.stringify(publishedState)),
      draftState: {
        ...baseSharedState,
        ui: { filterText: "xyz" },
      },
      status: "DIRTY",
      version: 5,
      publishedVersion: 4,
    });
    stateRepo.findOne.mockResolvedValue(record);
    stateRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date("2026-04-19T13:00:00.000Z"),
    }));
    changeLogRepo.save.mockResolvedValue(undefined);

    const envelope = await service.discardDraft("acp-1", {
      baseVersion: 5,
      actor: { username: "carol", role: "ACP_MANAGER" },
    });

    expect(envelope.status).toBe("CLEAN");
    expect(envelope.version).toBe(6);
    expect(stateRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(envelope.draftState.ui).toEqual(publishedState.ui);
    expect(changeLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "DISCARD_DRAFT",
        actorUsername: "carol",
      }),
    );
  });

  it("resolves actor role for app admin, manager and credentials", () => {
    const appAdminActor = service.resolveActor(
      {
        sub: "u-admin",
        username: "admin",
        isAppAdmin: true,
      },
      "acp-1",
    );
    expect(appAdminActor.role).toBe("APP_ADMIN");

    const managerActor = service.resolveActor(
      {
        sub: "u-manager",
        username: "manager",
        acpRoles: [{ acpId: "acp-1", role: "ACP_MANAGER" }],
      },
      "acp-1",
    );
    expect(managerActor.role).toBe("ACP_MANAGER");

    const credentialActor = service.resolveActor(
      {
        sub: "cred-user",
        username: "credential",
        type: "credential",
      },
      "acp-1",
    );
    expect(credentialActor.role).toBe("CREDENTIAL");
  });
});
