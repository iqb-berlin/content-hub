import { ReviewerColumnPolicy } from "../item-explorer/reviewer-column-policy";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { UnitParserService, VomdItemData } from "../files/unit-parser.service";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { StablePreferenceIdentity } from "../item-preferences/preference-identity";
import { normalizeItemPreferences } from "../item-preferences/item-preference-normalizer";
import {
  getItemExportCell,
  ITEM_EXPORT_IDENTITY_WITH_UUID_COLUMNS,
  ITEM_EXPORT_PARAMETER_COLUMNS,
  projectItemExportRow,
} from "../item-explorer/item-export-projection";
import {
  ItemCollectionState,
  ItemCollectionRowsMutation,
  ItemCollectionRowsMutationResult,
  ItemCollectionSummary,
  ItemCollectionViewMode,
  ItemCollectionsPayload,
  SharedItemCollectionSource,
  StoredItemCollection,
} from "./item-collection.models";
import { ItemCollectionStore } from "./item-collection.store";

const MAX_COLLECTION_ROWS = 10_000;
const MAX_ROW_KEY_LENGTH = 500;
const MAX_ITEM_COLLECTIONS = 100;
const MAX_SHARED_ITEM_COLLECTIONS = 1_000;

@Injectable()
export class ItemCollectionsService {
  constructor(
    private readonly store: ItemCollectionStore,
    private readonly itemExplorerStateService: ItemExplorerStateService,
    private readonly unitParserService: UnitParserService,
  ) {}

  async getItemCollections(
    apId: string,
    identity: StablePreferenceIdentity,
    canEditExplorerState = false,
  ): Promise<ItemCollectionsPayload> {
    const preferences = await this.store.readPreferences(apId, identity);
    const state = this.normalizeState(preferences);
    return this.resolveViews(apId, state, identity, canEditExplorerState);
  }

  async createItemCollection(
    apId: string,
    identity: StablePreferenceIdentity,
    rawName?: string,
    canEditExplorerState = false,
  ): Promise<ItemCollectionsPayload> {
    const name = this.normalizeName(rawName || "Meine Auswahlliste");
    const now = new Date().toISOString();
    const collection: StoredItemCollection = {
      id: uuidv4(),
      name,
      rowKeys: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      shared: false,
    };
    const state = await this.mutateState(
      apId,
      identity,
      true,
      (lockedState) => {
        if (lockedState.collections.length >= MAX_ITEM_COLLECTIONS) {
          throw new BadRequestException(
            `At most ${MAX_ITEM_COLLECTIONS} item collections can be stored`,
          );
        }
        lockedState.collections.push(collection);
        lockedState.activeCollectionId = collection.id;
      },
    );
    return this.resolveViews(apId, state, identity, canEditExplorerState);
  }

  async copyItemCollection(
    apId: string,
    identity: StablePreferenceIdentity,
    sourceCollectionId: string,
    canEditExplorerState = false,
  ): Promise<ItemCollectionsPayload> {
    const ownPreferences = await this.store.readPreferences(apId, identity);
    const ownState = this.normalizeState(ownPreferences);
    const ownSource = ownState.collections.find(
      (collection) => collection.id === sourceCollectionId,
    );
    const sharedSource = ownSource
      ? undefined
      : (await this.getSharedCollectionSources(apId, identity)).sources.find(
          (source) => source.collection.id === sourceCollectionId,
        )?.collection;
    const source = ownSource || sharedSource;
    if (!source) throw new NotFoundException("Item collection not found");

    const now = new Date().toISOString();
    const copy: StoredItemCollection = {
      id: uuidv4(),
      name: this.normalizeName(`${source.name} (Kopie)`),
      rowKeys: [...source.rowKeys],
      version: 1,
      createdAt: now,
      updatedAt: now,
      shared: false,
    };
    const state = await this.mutateState(
      apId,
      identity,
      true,
      (lockedState) => {
        if (lockedState.collections.length >= MAX_ITEM_COLLECTIONS) {
          throw new BadRequestException(
            `At most ${MAX_ITEM_COLLECTIONS} item collections can be stored`,
          );
        }
        lockedState.collections.push(copy);
        lockedState.activeCollectionId = copy.id;
      },
    );
    return this.resolveViews(apId, state, identity, canEditExplorerState);
  }

  async updateItemCollection(
    apId: string,
    identity: StablePreferenceIdentity,
    collectionId: string,
    update: {
      name?: unknown;
      rowKeys?: unknown;
      shared?: unknown;
      baseVersion?: unknown;
    },
    canEditExplorerState = false,
  ): Promise<ItemCollectionsPayload> {
    const normalizedName =
      update.name === undefined ? undefined : this.normalizeName(update.name);
    let normalizedRowKeys: string[] | undefined;
    let knownRowKeys: ReadonlySet<string> | undefined;
    if (update.rowKeys !== undefined) {
      normalizedRowKeys = this.normalizeRowKeys(update.rowKeys);
      const explorerState =
        await this.itemExplorerStateService.getStateForViewer(
          apId,
          canEditExplorerState,
        );
      knownRowKeys = await this.unitParserService.getItemRowKeysFromFiles(
        apId,
        {
          itemPropertiesOverride: explorerState.activeState.itemProperties,
          publishedItemPropertiesOverride:
            explorerState.publishedState.itemProperties,
        },
      );
    }

    const baseVersion = Number(update.baseVersion);
    const state = await this.mutateState(
      apId,
      identity,
      false,
      (lockedState) => {
        const collection = lockedState.collections.find(
          (candidate) => candidate.id === collectionId,
        );
        if (!collection) {
          throw new NotFoundException("Item collection not found");
        }
        if (
          !Number.isInteger(baseVersion) ||
          baseVersion !== collection.version
        ) {
          throw new ConflictException(
            "The item collection changed concurrently",
          );
        }
        if (normalizedName !== undefined) collection.name = normalizedName;
        if (update.shared !== undefined)
          collection.shared = update.shared === true;
        if (normalizedRowKeys !== undefined && knownRowKeys) {
          const previouslyStored = new Set(collection.rowKeys);
          const invalidRowKey = normalizedRowKeys.find(
            (rowKey) =>
              !knownRowKeys!.has(rowKey) && !previouslyStored.has(rowKey),
          );
          if (invalidRowKey) {
            throw new BadRequestException(
              "Collections can only add existing item rows",
            );
          }
          collection.rowKeys = normalizedRowKeys;
        }
        collection.version += 1;
        collection.updatedAt = new Date().toISOString();
      },
    );
    return this.resolveViews(apId, state, identity, canEditExplorerState);
  }

  async mutateItemCollectionRows(
    apId: string,
    identity: StablePreferenceIdentity,
    collectionId: string,
    mutation: ItemCollectionRowsMutation,
    canEditExplorerState = false,
  ): Promise<ItemCollectionRowsMutationResult> {
    const actions = [
      mutation.addRowKeys !== undefined,
      mutation.removeRowKeys !== undefined,
      mutation.clear !== undefined,
    ].filter(Boolean).length;
    if (
      actions !== 1 ||
      (mutation.clear !== undefined && mutation.clear !== true)
    ) {
      throw new BadRequestException(
        "Exactly one collection row mutation is required",
      );
    }

    const addRowKeys =
      mutation.addRowKeys === undefined
        ? undefined
        : this.normalizeRowKeys(mutation.addRowKeys);
    const removeRowKeys =
      mutation.removeRowKeys === undefined
        ? undefined
        : this.normalizeRowKeys(mutation.removeRowKeys);
    let knownRowKeys: ReadonlySet<string> | undefined;
    if (addRowKeys !== undefined) {
      const explorerState =
        await this.itemExplorerStateService.getStateForViewer(
          apId,
          canEditExplorerState,
        );
      knownRowKeys = await this.unitParserService.getItemRowKeysFromFiles(
        apId,
        {
          itemPropertiesOverride: explorerState.activeState.itemProperties,
          publishedItemPropertiesOverride:
            explorerState.publishedState.itemProperties,
        },
      );
    }

    const baseVersion = Number(mutation.baseVersion);
    const state = await this.mutateState(
      apId,
      identity,
      false,
      (lockedState) => {
        const collection = lockedState.collections.find(
          (candidate) => candidate.id === collectionId,
        );
        if (!collection) {
          throw new NotFoundException("Item collection not found");
        }
        if (
          !Number.isInteger(baseVersion) ||
          baseVersion !== collection.version
        ) {
          throw new ConflictException(
            "The item collection changed concurrently",
          );
        }

        let nextRowKeys = collection.rowKeys;
        if (addRowKeys !== undefined && knownRowKeys) {
          const existing = new Set(collection.rowKeys);
          const additions = addRowKeys.filter(
            (rowKey) => !existing.has(rowKey),
          );
          const invalidRowKey = additions.find(
            (rowKey) => !knownRowKeys!.has(rowKey),
          );
          if (invalidRowKey) {
            throw new BadRequestException(
              "Collections can only add existing item rows",
            );
          }
          if (
            collection.rowKeys.length + additions.length >
            MAX_COLLECTION_ROWS
          ) {
            throw new BadRequestException(
              `At most ${MAX_COLLECTION_ROWS} item rows can be stored in a collection`,
            );
          }
          if (additions.length)
            nextRowKeys = [...collection.rowKeys, ...additions];
        } else if (removeRowKeys !== undefined) {
          const removals = new Set(removeRowKeys);
          nextRowKeys = collection.rowKeys.filter(
            (rowKey) => !removals.has(rowKey),
          );
        } else if (mutation.clear === true && collection.rowKeys.length) {
          nextRowKeys = [];
        }

        const changed =
          nextRowKeys.length !== collection.rowKeys.length ||
          nextRowKeys.some(
            (rowKey, index) => rowKey !== collection.rowKeys[index],
          );
        if (!changed) return;
        collection.rowKeys = nextRowKeys;
        collection.version += 1;
        collection.updatedAt = new Date().toISOString();
      },
    );
    const collection = state.collections.find(
      (candidate) => candidate.id === collectionId,
    );
    if (!collection) throw new NotFoundException("Item collection not found");
    return this.resolveRowsMutationResult(
      apId,
      collection,
      canEditExplorerState,
    );
  }

  async activateItemCollection(
    apId: string,
    identity: StablePreferenceIdentity,
    collectionId: string | null,
    canEditExplorerState = false,
    collectionViewMode?: ItemCollectionViewMode,
  ): Promise<ItemCollectionsPayload> {
    const sharedCollectionIds = new Set(
      (await this.getSharedCollectionSources(apId, identity)).sources.map(
        (source) => source.collection.id,
      ),
    );
    const state = await this.mutateState(
      apId,
      identity,
      true,
      (lockedState) => {
        if (
          collectionId &&
          !lockedState.collections.some(
            (collection) => collection.id === collectionId,
          ) &&
          !sharedCollectionIds.has(collectionId)
        ) {
          throw new NotFoundException("Item collection not found");
        }
        lockedState.activeCollectionId = collectionId;
        if (collectionViewMode) {
          lockedState.collectionViewMode = collectionId
            ? collectionViewMode
            : "all";
        } else if (!collectionId) {
          lockedState.collectionViewMode = "all";
        }
      },
    );
    return this.resolveViews(apId, state, identity, canEditExplorerState);
  }

  async deleteItemCollection(
    apId: string,
    identity: StablePreferenceIdentity,
    collectionId: string,
    canEditExplorerState = false,
  ): Promise<ItemCollectionsPayload> {
    const state = await this.mutateState(
      apId,
      identity,
      false,
      (lockedState) => {
        const collections = lockedState.collections.filter(
          (collection) => collection.id !== collectionId,
        );
        if (collections.length === lockedState.collections.length) {
          throw new NotFoundException("Item collection not found");
        }
        lockedState.collections = collections;
        if (lockedState.activeCollectionId === collectionId) {
          lockedState.activeCollectionId = collections[0]?.id || null;
        }
        if (!lockedState.activeCollectionId) {
          lockedState.collectionViewMode = "all";
        }
      },
    );
    return this.resolveViews(apId, state, identity, canEditExplorerState);
  }

  async getAccessibleCollectionRowKeys(
    apId: string,
    identity: StablePreferenceIdentity,
    collectionId: string,
  ): Promise<string[]> {
    const state = this.normalizeState(
      await this.store.readPreferences(apId, identity),
    );
    const own = state.collections.find(
      (collection) => collection.id === collectionId,
    );
    const collection =
      own ??
      (await this.getSharedCollectionSources(apId, identity)).sources.find(
        (source) => source.collection.id === collectionId,
      )?.collection;
    if (!collection) throw new NotFoundException("Item collection not found");
    return [...collection.rowKeys];
  }

  async exportItemCollectionCsv(
    apId: string,
    identity: StablePreferenceIdentity,
    collectionId: string,
    canEditExplorerState = false,
    columnPolicy?: ReviewerColumnPolicy,
  ): Promise<Buffer> {
    const preferences = await this.store.readPreferences(apId, identity);
    const state = this.normalizeState(preferences);
    const ownCollection = state.collections.find(
      (candidate) => candidate.id === collectionId,
    );
    const sharedCollection = ownCollection
      ? undefined
      : (await this.getSharedCollectionSources(apId, identity)).sources.find(
          (source) => source.collection.id === collectionId,
        )?.collection;
    const collection = ownCollection || sharedCollection;
    if (!collection) throw new NotFoundException("Item collection not found");

    const explorerState = await this.itemExplorerStateService.getStateForViewer(
      apId,
      canEditExplorerState,
    );
    const itemList = await this.unitParserService.getItemListFromFiles(apId, {
      itemPropertiesOverride: explorerState.activeState.itemProperties,
      publishedItemPropertiesOverride:
        explorerState.publishedState.itemProperties,
    });
    const itemsByRowKey = new Map(
      itemList.items.map((item) => [item.rowKey, item] as const),
    );
    const personalRows = normalizeItemPreferences(preferences).rowData;
    const policy =
      columnPolicy ||
      new ReviewerColumnPolicy(
        canEditExplorerState
          ? undefined
          : explorerState.publishedState.metadataColumns,
      );
    const exportColumns = [
      ...ITEM_EXPORT_IDENTITY_WITH_UUID_COLUMNS,
      ...ITEM_EXPORT_PARAMETER_COLUMNS,
    ].filter((column) => policy.allowsExportField(column.key));
    const headers = [
      "Kollektion",
      "Reihenfolge",
      ...exportColumns.map((column) => column.header),
      "Kategorie",
      "Tags",
      "Notiz",
    ];
    const rows = collection.rowKeys.flatMap((rowKey, index) => {
      const item = itemsByRowKey.get(rowKey);
      if (!item) return [];
      const projection = projectItemExportRow({
        rowKey,
        item,
        personalRow: personalRows[rowKey],
      });
      return [
        [
          collection.name,
          index + 1,
          ...exportColumns.map((column) =>
            getItemExportCell(projection, column),
          ),
          projection.category || "",
          projection.tags.join(", "),
          projection.note?.replace(/\n/g, "\\n") || "",
        ],
      ];
    });
    const lines = [headers, ...rows].map((row) =>
      row.map((value) => this.escapeCsvCell(value)).join(";"),
    );
    return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
  }

  private mutateState(
    apId: string,
    identity: StablePreferenceIdentity,
    createIfMissing: boolean,
    mutation: (state: ItemCollectionState) => void,
  ): Promise<ItemCollectionState> {
    return this.store.mutate(apId, identity, createIfMissing, (preferences) => {
      const state = this.normalizeState(preferences);
      mutation(state);
      return state;
    });
  }

  private normalizeState(rawPreferences: unknown): ItemCollectionState {
    const preferences = this.isRecord(rawPreferences) ? rawPreferences : {};
    const seen = new Set<string>();
    const collections = Array.isArray(preferences.collections)
      ? preferences.collections
          .map((rawCollection): StoredItemCollection | null => {
            if (!this.isRecord(rawCollection)) return null;
            const id = String(rawCollection.id || "").trim();
            const name = String(rawCollection.name || "").trim();
            if (!id || !name || seen.has(id)) return null;
            seen.add(id);
            const createdAt = this.normalizeIsoDate(rawCollection.createdAt);
            return {
              id,
              name: name.slice(0, 100),
              rowKeys: this.normalizeRowKeys(
                Array.isArray(rawCollection.rowKeys)
                  ? rawCollection.rowKeys
                  : [],
              ),
              version: Math.max(1, Number(rawCollection.version) || 1),
              createdAt,
              updatedAt: this.normalizeIsoDate(
                rawCollection.updatedAt,
                createdAt,
              ),
              shared: rawCollection.shared === true,
            };
          })
          .filter(
            (collection): collection is StoredItemCollection =>
              collection !== null,
          )
      : [];
    const requestedActiveId = String(
      preferences.activeCollectionId || "",
    ).trim();
    const activeCollectionId = requestedActiveId || collections[0]?.id || null;
    const requestedViewMode: ItemCollectionViewMode =
      preferences.collectionViewMode === "active" ? "active" : "all";
    return {
      collections,
      activeCollectionId,
      collectionViewMode: activeCollectionId ? requestedViewMode : "all",
    };
  }

  private normalizeName(value: unknown): string {
    const name = this.normalizePlainText(value, 100);
    if (!name) throw new BadRequestException("Collection name is required");
    return name;
  }

  private normalizeRowKeys(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MAX_COLLECTION_ROWS) {
      throw new BadRequestException(
        `At most ${MAX_COLLECTION_ROWS} item rows can be stored in a collection`,
      );
    }
    const seen = new Set<string>();
    const rowKeys: string[] = [];
    for (const rawRowKey of value) {
      if (typeof rawRowKey !== "string") {
        throw new BadRequestException("Collection row keys must be strings");
      }
      const rowKey = rawRowKey.trim();
      if (!rowKey || rowKey.length > MAX_ROW_KEY_LENGTH) {
        throw new BadRequestException("A valid collection row key is required");
      }
      if (!seen.has(rowKey)) {
        seen.add(rowKey);
        rowKeys.push(rowKey);
      }
    }
    return rowKeys;
  }

  private normalizeIsoDate(value: unknown, fallback?: string): string {
    const parsed = typeof value === "string" ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime())
      ? parsed.toISOString()
      : fallback || new Date().toISOString();
  }

  private async getSharedCollectionSources(
    apId: string,
    identity: StablePreferenceIdentity,
  ): Promise<{ sources: SharedItemCollectionSource[]; truncated: boolean }> {
    const rawSources = await this.store.readSharedCollections(
      apId,
      identity,
      MAX_SHARED_ITEM_COLLECTIONS + 1,
    );
    const sources = rawSources
      .slice(0, MAX_SHARED_ITEM_COLLECTIONS)
      .flatMap((source) => {
        const collection = this.normalizeState({
          collections: [source.collection],
        }).collections[0];
        return collection?.shared
          ? [{ collection, ownerLabel: source.ownerLabel }]
          : [];
      });
    return {
      sources,
      truncated: rawSources.length > MAX_SHARED_ITEM_COLLECTIONS,
    };
  }

  private async resolveViews(
    apId: string,
    state: ItemCollectionState,
    identity: StablePreferenceIdentity,
    canEditExplorerState: boolean,
  ): Promise<ItemCollectionsPayload> {
    const explorerState = await this.itemExplorerStateService.getStateForViewer(
      apId,
      canEditExplorerState,
    );
    const itemList = await this.unitParserService.getItemListFromFiles(apId, {
      itemPropertiesOverride: explorerState.activeState.itemProperties,
      publishedItemPropertiesOverride:
        explorerState.publishedState.itemProperties,
    });
    const itemsByRowKey = new Map(
      itemList.items.map((item) => [item.rowKey, item] as const),
    );
    const sharedCollectionResult = await this.getSharedCollectionSources(
      apId,
      identity,
    );
    const sources = [
      ...state.collections.map((collection) => ({
        collection,
        ownerLabel: "Ich",
        ownedByCurrentUser: true,
      })),
      ...sharedCollectionResult.sources.map((source) => ({
        ...source,
        ownedByCurrentUser: false,
      })),
    ];
    const collections = sources.map(
      ({ collection, ownerLabel, ownedByCurrentUser }) => {
        const unavailableRowKeys = collection.rowKeys.filter(
          (rowKey) => !itemsByRowKey.has(rowKey),
        );
        const items = collection.rowKeys
          .map((rowKey) => itemsByRowKey.get(rowKey))
          .filter((item): item is VomdItemData => Boolean(item));
        return {
          ...collection,
          shared: collection.shared === true,
          ownerLabel,
          ownedByCurrentUser,
          unavailableRowKeys,
          summary: this.calculateSummary(items, collection.rowKeys.length),
        };
      },
    );
    const requestedActiveId = state.activeCollectionId;
    const requestedActiveFound = collections.some(
      (collection) => collection.id === requestedActiveId,
    );
    const activeCollectionId = requestedActiveFound
      ? requestedActiveId
      : collections.find((collection) => collection.ownedByCurrentUser)?.id ||
        null;
    return {
      activeCollectionId,
      collectionViewMode:
        state.collectionViewMode === "active" &&
        requestedActiveFound &&
        activeCollectionId
          ? "active"
          : "all",
      collections,
      sharedCollectionsTruncated: sharedCollectionResult.truncated,
    };
  }

  private async resolveRowsMutationResult(
    apId: string,
    collection: StoredItemCollection,
    canEditExplorerState: boolean,
  ): Promise<ItemCollectionRowsMutationResult> {
    const explorerState = await this.itemExplorerStateService.getStateForViewer(
      apId,
      canEditExplorerState,
    );
    const itemList = await this.unitParserService.getItemListFromFiles(apId, {
      itemPropertiesOverride: explorerState.activeState.itemProperties,
      publishedItemPropertiesOverride:
        explorerState.publishedState.itemProperties,
    });
    const itemsByRowKey = new Map(
      itemList.items.map((item) => [item.rowKey, item] as const),
    );
    const items = collection.rowKeys
      .map((rowKey) => itemsByRowKey.get(rowKey))
      .filter((item): item is VomdItemData => Boolean(item));
    return {
      collectionId: collection.id,
      version: collection.version,
      updatedAt: collection.updatedAt,
      summary: this.calculateSummary(items, collection.rowKeys.length),
    };
  }

  private calculateSummary(
    items: VomdItemData[],
    selectedRowCount = items.length,
  ): ItemCollectionSummary {
    const uniqueItems = new Map<string, VomdItemData[]>();
    const uniqueUnits = new Map<string, VomdItemData[]>();
    for (const item of items) {
      const itemRows = uniqueItems.get(item.uuid) || [];
      itemRows.push(item);
      uniqueItems.set(item.uuid, itemRows);
      const unitRows = uniqueUnits.get(item.unitId) || [];
      unitRows.push(item);
      uniqueUnits.set(item.unitId, unitRows);
    }

    let itemTimeSeconds = 0;
    let stimulusTimeSeconds = 0;
    let missingItemTimeCount = 0;
    let missingStimulusTimeUnitCount = 0;
    for (const rows of uniqueItems.values()) {
      const time = rows
        .map((row) => row.itemTimeSeconds)
        .find((value): value is number => Number.isFinite(value));
      if (time === undefined) missingItemTimeCount += 1;
      else itemTimeSeconds += time;
    }
    for (const rows of uniqueUnits.values()) {
      const time = rows
        .map((row) => row.stimulusTimeSeconds)
        .find((value): value is number => Number.isFinite(value));
      if (time === undefined) missingStimulusTimeUnitCount += 1;
      else stimulusTimeSeconds += time;
    }
    return {
      rowCount: selectedRowCount,
      itemCount: uniqueItems.size,
      unitCount: uniqueUnits.size,
      itemTimeSeconds,
      stimulusTimeSeconds,
      testTimeSeconds: itemTimeSeconds + stimulusTimeSeconds,
      missingItemTimeCount,
      missingStimulusTimeUnitCount,
      complete:
        missingItemTimeCount === 0 && missingStimulusTimeUnitCount === 0,
    };
  }

  private normalizePlainText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  private escapeCsvCell(value: string | number): string {
    let normalized = String(value ?? "");
    if (typeof value === "string" && /^[=+\-@]/.test(normalized)) {
      normalized = `'${normalized}`;
    }
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
