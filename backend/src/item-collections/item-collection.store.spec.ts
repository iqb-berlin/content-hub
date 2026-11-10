import { NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { ApItemPreference } from "../database/entities";
import { ItemCollectionStore } from "./item-collection.store";

describe("ItemCollectionStore", () => {
  let store: ItemCollectionStore;
  let repository: any;
  let manager: any;

  beforeEach(async () => {
    manager = {
      getRepository: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
    };
    repository = {
      findOne: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn(async (operation) => operation(manager)),
      },
    };
    manager.getRepository.mockReturnValue(repository);

    const module = await Test.createTestingModule({
      providers: [
        ItemCollectionStore,
        {
          provide: getRepositoryToken(ApItemPreference),
          useValue: repository,
        },
      ],
    }).compile();
    store = module.get(ItemCollectionStore);
  });

  it("reads credentials only through their stable credential id", async () => {
    repository.findOne.mockResolvedValue({
      preferences: { collections: [] },
    });

    await expect(
      store.readPreferences("ap-1", {
        kind: "credential",
        credentialId: "credential-1",
        credentialUsername: "reader-a",
      }),
    ).resolves.toEqual({ collections: [] });
    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        apId: "ap-1",
        viewId: "item-explorer",
        credentialId: "credential-1",
      },
    });
  });

  it("reads only projected shared collections with a bounded database query", async () => {
    repository.query.mockResolvedValue([
      {
        collection: { id: "shared", shared: true },
        ownerLabel: " Charlotte ",
      },
    ]);

    await expect(
      store.readSharedCollections(
        "ap-1",
        {
          kind: "user",
          userId: "user-1",
        },
        1001,
      ),
    ).resolves.toEqual([
      {
        collection: { id: "shared", shared: true },
        ownerLabel: "Charlotte",
      },
    ]);
    expect(repository.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /jsonb_array_elements[\s\S]*collection ->> 'shared' = 'true'[\s\S]*LIMIT \$3/,
      ),
      ["ap-1", "user-1", 1001],
    );
  });

  it("locks the owner row and updates only collection-owned JSON fields", async () => {
    repository.findOne.mockResolvedValue({
      id: "preference-1",
      preferences: {
        ui: { filter: "keep" },
        rowData: { row: { note: "keep" } },
        collections: [],
      },
    });

    const state = await store.mutate(
      "ap-1",
      { kind: "user", userId: "user-1" },
      false,
      () => ({
        collections: [
          {
            id: "collection-1",
            name: "A",
            rowKeys: [],
            version: 1,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
        activeCollectionId: "collection-1",
        collectionViewMode: "active",
      }),
    );

    expect(state.activeCollectionId).toBe("collection-1");
    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        apId: "ap-1",
        viewId: "item-explorer",
        userId: "user-1",
      },
      lock: { mode: "pessimistic_write" },
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE "acp_item_preferences"[\s\S]*jsonb_typeof\("preferences"\) = 'object'[\s\S]*ELSE '\{\}'::jsonb[\s\S]*'\{collections\}'[\s\S]*'\{activeCollectionId\}'[\s\S]*'\{collectionViewMode\}'/,
      ),
      [
        "preference-1",
        expect.stringContaining('"collection-1"'),
        JSON.stringify("collection-1"),
        JSON.stringify("active"),
        null,
      ],
    );
    expect(repository.save).toBeUndefined();
  });

  it("repairs a non-object preferences root before writing collections", async () => {
    repository.findOne.mockResolvedValue({
      id: "preference-1",
      preferences: [],
    });

    await store.mutate(
      "ap-1",
      { kind: "user", userId: "user-1" },
      false,
      (preferences) => {
        expect(preferences).toEqual({});
        return {
          collections: [],
          activeCollectionId: null,
          collectionViewMode: "all",
        };
      },
    );

    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it("creates a missing credential preference idempotently before locking", async () => {
    repository.findOne.mockResolvedValue({
      id: "preference-1",
      preferences: {},
    });

    await store.mutate(
      "ap-1",
      {
        kind: "credential",
        credentialId: "credential-1",
        credentialUsername: "reader-a",
      },
      true,
      () => ({
        collections: [],
        activeCollectionId: null,
        collectionViewMode: "all",
      }),
    );

    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'ON CONFLICT ("acp_id", "view_id", "credential_id")',
      ),
      ["ap-1", null, "credential-1", "reader-a"],
    );
  });

  it("fails inside the transaction when no owner row exists", async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      store.mutate("ap-1", { kind: "user", userId: "user-1" }, false, () => ({
        collections: [],
        activeCollectionId: null,
        collectionViewMode: "all",
      })),
    ).rejects.toThrow(NotFoundException);
    expect(manager.query).not.toHaveBeenCalled();
  });
});
