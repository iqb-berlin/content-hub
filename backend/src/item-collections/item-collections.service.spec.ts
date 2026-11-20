import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ItemCollectionsService } from "./item-collections.service";

describe("ItemCollectionsService", () => {
  let service: ItemCollectionsService;
  let store: any;
  let itemExplorerStateService: any;
  let unitParserService: any;
  const owner = { kind: "user" as const, userId: "user-1" };

  beforeEach(() => {
    store = {
      readPreferences: jest.fn().mockResolvedValue(null),
      readSharedCollections: jest.fn().mockResolvedValue([]),
      mutate: jest.fn(),
    };
    itemExplorerStateService = {
      getStateForViewer: jest.fn().mockResolvedValue({
        activeState: { itemProperties: {} },
        publishedState: { itemProperties: {} },
      }),
    };
    unitParserService = {
      getItemListFromFiles: jest.fn().mockResolvedValue({ items: [] }),
      getItemRowKeysFromFiles: jest
        .fn()
        .mockResolvedValue(new Set(["uuid-1::1", "uuid-2::1"])),
    };
    service = new ItemCollectionsService(
      store,
      itemExplorerStateService,
      unitParserService,
    );
  });

  it("resolves own and foreign shared lists but rejects private or removed lists", async () => {
    store.readPreferences.mockResolvedValue({
      collections: [{ id: "own", name: "Own", rowKeys: ["uuid::A"] }],
    });
    store.readSharedCollections.mockResolvedValue([
      {
        collection: {
          id: "shared",
          name: "Shared",
          shared: true,
          rowKeys: ["uuid::B"],
        },
        ownerLabel: "Other",
      },
      {
        collection: {
          id: "private",
          name: "Private",
          shared: false,
          rowKeys: ["uuid::C"],
        },
        ownerLabel: "Other",
      },
    ]);
    await expect(
      service.getAccessibleCollectionRowKeys("ap-1", owner, "own"),
    ).resolves.toEqual(["uuid::A"]);
    expect(store.readSharedCollections).not.toHaveBeenCalled();
    await expect(
      service.getAccessibleCollectionRowKeys("ap-1", owner, "shared"),
    ).resolves.toEqual(["uuid::B"]);
    expect(store.readSharedCollections).toHaveBeenCalledWith(
      "ap-1",
      owner,
      expect.any(Number),
    );
    await expect(
      service.getAccessibleCollectionRowKeys("ap-1", owner, "private"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getAccessibleCollectionRowKeys("ap-1", owner, "removed"),
    ).rejects.toThrow(NotFoundException);
  });

  it("resolves summaries without double-counting partial-credit rows", async () => {
    store.readPreferences.mockResolvedValue({
      activeCollectionId: "collection-1",
      collections: [
        {
          id: "collection-1",
          name: "Auswahl A",
          rowKeys: ["uuid-1::1", "uuid-1::2", "uuid-2", "removed"],
          version: 3,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-02T10:00:00.000Z",
        },
      ],
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        {
          rowKey: "uuid-1::1",
          uuid: "uuid-1",
          unitId: "unit-1",
          itemTimeSeconds: 10,
          stimulusTimeSeconds: 5,
        },
        {
          rowKey: "uuid-1::2",
          uuid: "uuid-1",
          unitId: "unit-1",
          itemTimeSeconds: 10,
          stimulusTimeSeconds: 5,
        },
        {
          rowKey: "uuid-2",
          uuid: "uuid-2",
          unitId: "unit-1",
          stimulusTimeSeconds: 5,
        },
      ],
    });

    const result = await service.getItemCollections("ap-1", owner, true);

    expect(result.collections[0].unavailableRowKeys).toEqual(["removed"]);
    expect(result.collections[0].summary).toEqual({
      rowCount: 4,
      itemCount: 2,
      unitCount: 1,
      itemTimeSeconds: 10,
      stimulusTimeSeconds: 5,
      testTimeSeconds: 15,
      missingItemTimeCount: 1,
      missingStimulusTimeUnitCount: 0,
      complete: false,
    });
    expect(result.collectionViewMode).toBe("all");
  });

  it("defaults missing or invalid collection view modes to all", async () => {
    const basePreferences = {
      activeCollectionId: "collection-1",
      collections: [
        {
          id: "collection-1",
          name: "Auswahl A",
          rowKeys: [],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    };
    store.readPreferences.mockResolvedValue(basePreferences);
    await expect(service.getItemCollections("ap-1", owner)).resolves.toEqual(
      expect.objectContaining({ collectionViewMode: "all" }),
    );

    store.readPreferences.mockResolvedValue({
      ...basePreferences,
      collectionViewMode: "invalid",
    });
    await expect(service.getItemCollections("ap-1", owner)).resolves.toEqual(
      expect.objectContaining({ collectionViewMode: "all" }),
    );
  });

  it("falls back to all when the stored active collection no longer exists", async () => {
    store.readPreferences.mockResolvedValue({
      activeCollectionId: "deleted-collection",
      collectionViewMode: "active",
      collections: [
        {
          id: "collection-1",
          name: "Auswahl A",
          rowKeys: [],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });

    await expect(service.getItemCollections("ap-1", owner)).resolves.toEqual(
      expect.objectContaining({
        activeCollectionId: "collection-1",
        collectionViewMode: "all",
      }),
    );
  });

  it("persists active view mode and resets it when no active list remains", async () => {
    const preferences: Record<string, unknown> = {
      activeCollectionId: "collection-1",
      collectionViewMode: "all",
      collections: [
        {
          id: "collection-1",
          name: "Auswahl A",
          rowKeys: [],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    };
    store.mutate.mockImplementation(async (...args: any[]) => {
      const state = args[3](preferences);
      preferences.collections = state.collections;
      preferences.activeCollectionId = state.activeCollectionId;
      preferences.collectionViewMode = state.collectionViewMode;
      return state;
    });

    const activated = await service.activateItemCollection(
      "ap-1",
      owner,
      "collection-1",
      false,
      "active",
    );
    expect(activated.collectionViewMode).toBe("active");

    const deleted = await service.deleteItemCollection(
      "ap-1",
      owner,
      "collection-1",
    );
    expect(deleted).toEqual(
      expect.objectContaining({
        activeCollectionId: null,
        collectionViewMode: "all",
      }),
    );
  });

  it("checks the base version inside the store mutation", async () => {
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "Alt",
          rowKeys: ["uuid-1::1"],
          version: 2,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) =>
      args[3](preferences),
    );

    await expect(
      service.updateItemCollection("ap-1", owner, "collection-1", {
        baseVersion: 1,
        name: "Neu",
      }),
    ).rejects.toThrow(ConflictException);

    const result = await service.updateItemCollection(
      "ap-1",
      owner,
      "collection-1",
      { baseVersion: 2, name: "Neu", shared: true },
    );
    expect(result.collections[0]).toEqual(
      expect.objectContaining({ name: "Neu", shared: true, version: 3 }),
    );
  });

  it("allows stale stored rows but rejects newly added unknown rows", async () => {
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "Alt",
          rowKeys: ["removed-row"],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) =>
      args[3](preferences),
    );

    await expect(
      service.updateItemCollection("ap-1", owner, "collection-1", {
        baseVersion: 1,
        rowKeys: ["removed-row", "invented-row"],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("adds deduplicated rows in order and returns a compact mutation result", async () => {
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "Auswahl",
          rowKeys: ["uuid-1::1"],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) => {
      const state = args[3](preferences);
      preferences.collections = state.collections;
      return state;
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        { rowKey: "uuid-1::1", uuid: "uuid-1", unitId: "unit-1" },
        { rowKey: "uuid-2::1", uuid: "uuid-2", unitId: "unit-2" },
      ],
    });

    const result = await service.mutateItemCollectionRows(
      "ap-1",
      owner,
      "collection-1",
      { baseVersion: 1, addRowKeys: ["uuid-2::1", "uuid-2::1"] },
    );

    expect(preferences.collections[0].rowKeys).toEqual([
      "uuid-1::1",
      "uuid-2::1",
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        collectionId: "collection-1",
        version: 2,
        summary: expect.objectContaining({ rowCount: 2 }),
      }),
    );
    expect(result).not.toHaveProperty("rowKeys");
    expect(result).not.toHaveProperty("collections");
  });

  it("removes unavailable rows, clears collections, and preserves remaining order", async () => {
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "Auswahl",
          rowKeys: ["known-a", "removed-row", "known-b"],
          version: 4,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) => {
      const state = args[3](preferences);
      preferences.collections = state.collections;
      return state;
    });

    const removed = await service.mutateItemCollectionRows(
      "ap-1",
      owner,
      "collection-1",
      { baseVersion: 4, removeRowKeys: ["removed-row"] },
    );
    expect(preferences.collections[0].rowKeys).toEqual(["known-a", "known-b"]);
    expect(removed.version).toBe(5);

    const cleared = await service.mutateItemCollectionRows(
      "ap-1",
      owner,
      "collection-1",
      { baseVersion: 5, clear: true },
    );
    expect(preferences.collections[0].rowKeys).toEqual([]);
    expect(cleared.version).toBe(6);
  });

  it("keeps version and timestamp unchanged for no-op row mutations", async () => {
    const updatedAt = "2026-07-01T10:00:00.000Z";
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "Auswahl",
          rowKeys: ["uuid-1::1"],
          version: 2,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) =>
      args[3](preferences),
    );

    const result = await service.mutateItemCollectionRows(
      "ap-1",
      owner,
      "collection-1",
      { baseVersion: 2, addRowKeys: ["uuid-1::1"] },
    );

    expect(result.version).toBe(2);
    expect(result.updatedAt).toBe(updatedAt);
  });

  it("rejects invalid row mutations, unknown additions, limits, and conflicts", async () => {
    const rowKeys = Array.from(
      { length: 10_000 },
      (_, index) => `row-${index}`,
    );
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "Auswahl",
          rowKeys,
          version: 3,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) =>
      args[3](preferences),
    );
    unitParserService.getItemRowKeysFromFiles.mockResolvedValue(
      new Set([...rowKeys, "extra-row"]),
    );

    await expect(
      service.mutateItemCollectionRows("ap-1", owner, "collection-1", {
        baseVersion: 3,
        addRowKeys: [],
        removeRowKeys: [],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.mutateItemCollectionRows("ap-1", owner, "collection-1", {
        baseVersion: 3,
        clear: false,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.mutateItemCollectionRows("ap-1", owner, "collection-1", {
        baseVersion: 3,
        addRowKeys: ["unknown-row"],
      }),
    ).rejects.toThrow("Collections can only add existing item rows");
    await expect(
      service.mutateItemCollectionRows("ap-1", owner, "collection-1", {
        baseVersion: 3,
        addRowKeys: ["extra-row"],
      }),
    ).rejects.toThrow("At most 10000 item rows");
    await expect(
      service.mutateItemCollectionRows("ap-1", owner, "collection-1", {
        baseVersion: 2,
        removeRowKeys: ["row-1"],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("limits collection creation and delegates create-if-missing to the store", async () => {
    const timestamp = "2026-07-01T10:00:00.000Z";
    const preferences = {
      collections: Array.from({ length: 100 }, (_, index) => ({
        id: `collection-${index + 1}`,
        name: `Kollektion ${index + 1}`,
        rowKeys: [],
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) => {
      expect(args[2]).toBe(true);
      return args[3](preferences);
    });

    await expect(
      service.createItemCollection("ap-1", owner, "Eine zu viel"),
    ).rejects.toThrow("At most 100 item collections can be stored");
  });

  it("activates and deletes only collections belonging to the locked owner state", async () => {
    const preferences = {
      collections: [
        {
          id: "collection-1",
          name: "A",
          rowKeys: [],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "collection-1",
    };
    store.mutate.mockImplementation(async (...args: any[]) =>
      args[3](preferences),
    );

    await expect(
      service.activateItemCollection("ap-1", owner, "missing"),
    ).rejects.toThrow(NotFoundException);
    const result = await service.deleteItemCollection(
      "ap-1",
      owner,
      "collection-1",
    );
    expect(result.collections).toEqual([]);
    expect(result.activeCollectionId).toBeNull();
  });

  it("exposes only AP-shared foreign collections as read-only views", async () => {
    store.readPreferences.mockResolvedValue({
      collections: [
        {
          id: "own-private",
          name: "Meine Liste",
          rowKeys: [],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      activeCollectionId: "own-private",
    });
    store.readSharedCollections.mockResolvedValue([
      {
        ownerLabel: "Charlotte",
        collection: {
          id: "foreign-shared",
          name: "Geteilte Liste",
          rowKeys: [],
          version: 2,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-02T10:00:00.000Z",
          shared: true,
        },
      },
    ]);

    const result = await service.getItemCollections("ap-1", owner);

    expect(result.collections).toEqual([
      expect.objectContaining({
        id: "own-private",
        ownedByCurrentUser: true,
        shared: false,
        ownerLabel: "Ich",
      }),
      expect.objectContaining({
        id: "foreign-shared",
        ownedByCurrentUser: false,
        shared: true,
        ownerLabel: "Charlotte",
      }),
    ]);
    expect(result.collections).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "foreign-private" }),
      ]),
    );
  });

  it("returns a bounded AP-wide shared collection result with a truncation marker", async () => {
    const timestamp = "2026-07-01T10:00:00.000Z";
    store.readSharedCollections.mockResolvedValue(
      Array.from({ length: 1_001 }, (_, index) => ({
        ownerLabel: `Owner ${index}`,
        collection: {
          id: `shared-${index}`,
          name: `Liste ${index}`,
          rowKeys: [],
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          shared: true,
        },
      })),
    );

    const result = await service.getItemCollections("ap-1", owner);

    expect(result.collections).toHaveLength(1_000);
    expect(result.collections[0]).toEqual(
      expect.objectContaining({ id: "shared-0", ownedByCurrentUser: false }),
    );
    expect(result.collections.at(-1)).toEqual(
      expect.objectContaining({ id: "shared-999", ownedByCurrentUser: false }),
    );
    expect(result.sharedCollectionsTruncated).toBe(true);
    expect(store.readSharedCollections).toHaveBeenCalledWith(
      "ap-1",
      owner,
      1_001,
    );
  });

  it("copies a shared collection into an independent private owner list", async () => {
    const preferences: Record<string, unknown> = { collections: [] };
    store.readPreferences.mockResolvedValue(preferences);
    store.readSharedCollections.mockResolvedValue([
      {
        ownerLabel: "Charlotte",
        collection: {
          id: "foreign-shared",
          name: "Geteilte Liste",
          rowKeys: ["uuid-1::1"],
          version: 3,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-02T10:00:00.000Z",
          shared: true,
        },
      },
    ]);
    store.mutate.mockImplementation(async (...args: any[]) => {
      const state = args[3](preferences);
      preferences.collections = state.collections;
      preferences.activeCollectionId = state.activeCollectionId;
      return state;
    });

    const result = await service.copyItemCollection(
      "ap-1",
      owner,
      "foreign-shared",
    );
    const copy = result.collections.find(
      (collection) => collection.ownedByCurrentUser,
    );
    expect(copy).toEqual(
      expect.objectContaining({
        name: "Geteilte Liste (Kopie)",
        rowKeys: ["uuid-1::1"],
        shared: false,
        ownedByCurrentUser: true,
      }),
    );
    expect(copy?.id).not.toBe("foreign-shared");
    expect(result.activeCollectionId).toBe(copy?.id);
  });

  it("activates a shared foreign collection without granting edit ownership", async () => {
    const preferences: Record<string, unknown> = { collections: [] };
    store.readSharedCollections.mockResolvedValue([
      {
        ownerLabel: "Charlotte",
        collection: {
          id: "foreign-shared",
          name: "Geteilte Liste",
          rowKeys: [],
          version: 2,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-02T10:00:00.000Z",
          shared: true,
        },
      },
    ]);
    store.mutate.mockImplementation(async (...args: any[]) => {
      const state = args[3](preferences);
      preferences.activeCollectionId = state.activeCollectionId;
      preferences.collectionViewMode = state.collectionViewMode;
      return state;
    });

    const result = await service.activateItemCollection(
      "ap-1",
      owner,
      "foreign-shared",
      false,
      "active",
    );

    expect(result).toEqual(
      expect.objectContaining({
        activeCollectionId: "foreign-shared",
        collectionViewMode: "active",
      }),
    );
    expect(result.collections[0]).toEqual(
      expect.objectContaining({
        id: "foreign-shared",
        ownedByCurrentUser: false,
        shared: true,
      }),
    );
    expect(store.mutate).toHaveBeenCalledWith(
      "ap-1",
      owner,
      true,
      expect.any(Function),
    );
  });

  it("does not allow foreign shared collections to be changed through owner mutations", async () => {
    const preferences = { collections: [], activeCollectionId: null };
    store.mutate.mockImplementation(async (...args: any[]) =>
      args[3](preferences),
    );

    await expect(
      service.updateItemCollection("ap-1", owner, "foreign-shared", {
        baseVersion: 1,
        name: "Manipuliert",
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.deleteItemCollection("ap-1", owner, "foreign-shared"),
    ).rejects.toThrow(NotFoundException);
  });

  it("exports collection rows together with personal row metadata", async () => {
    store.readPreferences.mockResolvedValue({
      collections: [
        {
          id: "collection-1",
          name: "Auswahl A",
          rowKeys: ["uuid-1::A", "removed-row"],
          version: 1,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      rowData: {
        "uuid-1::A": {
          category: " II ",
          tags: [" Prüfen ", "Prüfen", ""],
          note: "Erste Zeile\r\nZweite Zeile",
          ignored: "not exported",
        },
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        {
          itemId: "item-1",
          uuid: "uuid-1",
          rowKey: "uuid-1::A",
          subId: "A",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          bista: 503.25,
          itemTimeSeconds: 20,
          stimulusTimeSeconds: 12,
          bookletOccurrences: [{ booklet: "B1", position: 3 }],
        },
      ],
    });

    const csv = (
      await service.exportItemCollectionCsv("ap-1", owner, "collection-1", true)
    ).toString("utf8");

    expect(csv).toContain('"Auswahl A";"1";"unit-1";"Aufgabe 1"');
    expect(csv).toContain('"BiSta-Wert"');
    expect(csv).toContain('"503.25"');
    expect(csv).toContain('"II";"Prüfen";"Erste Zeile\\nZweite Zeile"');
    expect(csv).not.toContain("not exported");
    expect(csv).not.toContain("removed-row");
  });
});
