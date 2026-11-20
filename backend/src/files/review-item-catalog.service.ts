import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { readFile } from "fs/promises";
import { EntityManager, In, Repository } from "typeorm";
import { getIndexUnits } from "../ap/ap-index.utils";
import { Ap, ApFile } from "../database/entities";
import { AsyncLruCache } from "./async-lru-cache";
import { FileCatalogCache } from "./file-catalog.cache";
import type { ItemListUnitSources } from "./item-list.parser";
import {
  compareUnitXmlFilenames,
  extractLabelText,
  isRecord,
  isUnitXmlFilename,
  isValidVomdItem,
  parseUnitXml,
  parseVomd,
  findReferencedMetadataFile,
  matchIndexedVomdItem,
} from "./unit-file-parsing";
import type { UnitXmlData } from "./unit-parser.types";
import { UnitParserService } from "./unit-parser.service";

export interface ItemVariableReferences {
  variableId?: string;
  sourceVariable?: string;
  variableReadOnlyId?: string;
}

export interface ReviewItemCatalogEntry {
  variableReferences?: ItemVariableReferences;
  fileItemId?: string;
  previousItemId?: string;
  excludeFromLegacyTargets?: true;
  unitId: string;
  itemId: string;
  hasCodingScheme: boolean;
  unitLabel: string;
  itemLabel: string;
  unitOrder: number;
  itemOrder: number;
}

interface ItemCatalog {
  entries: ReviewItemCatalogEntry[];
  cacheable: boolean;
}

type StoredTargetLookup = (
  candidates: ReadonlyArray<{ unitId: string; itemId: string }>,
) => Promise<ReadonlySet<string>>;

interface CatalogFileItem extends ItemVariableReferences {
  unitId: string;
  itemId: string;
  unitLabel?: string;
  description?: string;
  rowNumber: number;
  useUnitAliasAsPrefix?: boolean;
  indexMetadataOnly?: true;
}

interface CatalogIndexUnit {
  id: string;
  name?: unknown;
  label?: unknown;
  description?: string;
  items?: unknown[];
  dependencies?: { id: string; type: string }[];
}

interface UnitNavigationItem extends ItemVariableReferences {
  id: string;
  fallbackIds?: string[];
}

export function itemCatalogKey(unitId: string, itemId: string): string {
  return `${unitId}\u0000${itemId}`;
}

@Injectable()
export class ReviewItemCatalogService {
  private readonly logger = new Logger(ReviewItemCatalogService.name);
  private readonly cache = new AsyncLruCache<string, ItemCatalog>(100);

  constructor(
    @InjectRepository(Ap)
    private readonly apRepository: Repository<Ap>,
    private readonly fileCatalogCache: FileCatalogCache,
    private readonly unitParserService: UnitParserService,
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
  ) {}

  async getCatalog(
    apId: string,
    options: {
      manager?: EntityManager;
      findStoredTargets?: StoredTargetLookup;
    } = {},
  ): Promise<ReviewItemCatalogEntry[]> {
    const { manager } = options;
    const repository = manager ? manager.getRepository(Ap) : this.apRepository;
    const [files, currentAp] = await Promise.all([
      this.fileCatalogCache.get(apId, manager),
      repository.findOne({ where: { id: apId } }),
    ]);
    const build = () =>
      this.buildItemCatalog(apId, currentAp, files.files, options);
    // A transaction may hold the review lock. Keep database-backed reads scoped to it.
    if (manager) return (await build()).entries;

    const key = `${apId}:${files.signature}:${currentAp?.updatedAt?.toISOString() || "missing"}`;
    this.cache.deleteWhere(
      (entry) => entry.startsWith(`${apId}:`) && entry !== key,
    );
    const { value } = await this.cache.getOrLoad(key, build, {
      shouldCache: (catalog) => catalog.cacheable,
    });
    return value.entries;
  }

  async getUnitNavigation(
    apId: string,
    unit: CatalogIndexUnit,
    indexMetadata: ApFile[],
  ): Promise<{ items: UnitNavigationItem[]; metadataFile?: ApFile }> {
    const unitId = unit.id.trim();
    const source = await this.findUnitXml(apId, unitId);
    const metadata = await this.readUnitMetadata(
      unitId,
      source,
      indexMetadata,
      apId,
    );
    const entries = this.mergeItems([unit], metadata?.items ?? [], new Set());
    const canonicalIds = new Set(entries.map(({ itemId }) => itemId));
    const prefix = `${unitId}_`;
    const items = entries.map(({ itemId, fileItemId, variableReferences }) => {
      const fallbackIds = new Set<string>();
      if (fileItemId && !canonicalIds.has(fileItemId))
        fallbackIds.add(fileItemId);
      if (itemId.startsWith(prefix)) {
        const raw = itemId.slice(prefix.length);
        if (raw && !canonicalIds.has(raw)) fallbackIds.add(raw);
      }
      return {
        id: itemId,
        ...variableReferences,
        ...(fallbackIds.size ? { fallbackIds: [...fallbackIds] } : {}),
      };
    });
    return { items, metadataFile: metadata?.file };
  }

  async getUnitMetadata(apId: string, unit: CatalogIndexUnit) {
    const unitId = unit.id.trim();
    const [source, files] = await Promise.all([
      this.findUnitXml(apId, unitId),
      this.indexMetadataFiles(apId, unit),
    ]);
    return this.readUnitMetadata(unitId, source, files, apId);
  }

  private async indexMetadataFiles(apId: string, unit: CatalogIndexUnit) {
    const references = (
      Array.isArray(unit.dependencies) ? unit.dependencies : []
    )
      .filter((entry) => String(entry?.type).toLowerCase() === "metadata")
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string");
    const files = references.length
      ? await this.fileRepository.find({
          where: { apId, originalName: In(references) },
        })
      : [];
    return references.flatMap((id) => {
      const file = files.find(({ originalName }) => originalName === id);
      return file ? [file] : [];
    });
  }

  private async readUnitMetadata(
    unitId: string,
    source: UnitXmlData | undefined,
    indexMetadata: ApFile[],
    apId: string,
  ) {
    const metadataRef = source?.metadataRef;
    const xmlMetadata = metadataRef
      ? (indexMetadata.find(
          ({ originalName }) => originalName === metadataRef,
        ) ?? (await this.findReferencedMetadata(apId, metadataRef)))
      : undefined;
    return this.readFirstMetadata(unitId, [xmlMetadata, ...indexMetadata]);
  }

  async getActiveUnitCommentTargets(
    apId: string,
    unitId: string,
    checkCoding: boolean,
    hasSavedThreads: boolean,
  ): Promise<{
    codingCommentsAvailable: boolean;
    itemIds: ReadonlySet<string>;
  }> {
    const source =
      checkCoding || hasSavedThreads
        ? await this.findUnitXml(apId, unitId)
        : undefined;
    const codingCommentsAvailable =
      checkCoding && (await this.hasCodingScheme(apId, source));
    if (!hasSavedThreads)
      return { codingCommentsAvailable, itemIds: new Set() };

    const ap = await this.apRepository.findOne({ where: { id: apId } });
    const unit: CatalogIndexUnit | undefined = getIndexUnits(ap?.apIndex).find(
      (entry) => entry?.id === unitId,
    );
    if (!unit) return { codingCommentsAvailable, itemIds: new Set() };
    const metadata = await this.readUnitMetadata(
      unitId,
      source,
      await this.indexMetadataFiles(apId, unit),
      apId,
    );
    const entries = this.mergeItems([unit], metadata?.items ?? [], new Set());
    return {
      codingCommentsAvailable,
      itemIds: new Set(entries.map(({ itemId }) => itemId)),
    };
  }

  private async hasCodingScheme(
    apId: string,
    unit?: UnitXmlData,
  ): Promise<boolean> {
    if (!unit?.codingSchemeRef) return false;
    const file = await this.fileRepository.findOne({
      where: { apId, originalName: unit.codingSchemeRef },
    });
    return file
      ? ((await this.readCodingSchemeAvailability(file)) ?? false)
      : false;
  }

  private async readCodingSchemeAvailability(
    file: ApFile,
  ): Promise<boolean | undefined> {
    try {
      return Boolean(JSON.parse(await readFile(file.filePath, "utf8")));
    } catch {
      return undefined;
    }
  }

  private async findReferencedMetadata(
    apId: string,
    reference: string,
  ): Promise<ApFile | undefined> {
    const files = await this.fileRepository.find({
      where: { apId, originalName: In([reference, `${reference}.json`]) },
    });
    return findReferencedMetadataFile(files, reference);
  }

  private async findUnitXml(
    apId: string,
    unitId: string,
  ): Promise<UnitXmlData | undefined> {
    const standardName = `${unitId}.xml`;
    const unitFile = isUnitXmlFilename(standardName)
      ? await this.fileRepository.findOne({
          where: { apId, originalName: standardName },
        })
      : undefined;
    if (unitFile) {
      const unit = await this.readUnitXml(unitId, unitFile);
      if (unit) return unit;
    }

    // Older exports can use a different filename for the same Unit ID.
    const { files } = await this.fileCatalogCache.get(apId);
    const candidates = files
      .filter(
        ({ originalName }) =>
          originalName !== unitFile?.originalName &&
          isUnitXmlFilename(originalName),
      )
      .sort((left, right) =>
        compareUnitXmlFilenames(unitId, left.originalName, right.originalName),
      );
    for (const file of candidates) {
      const unit = await this.readUnitXml(unitId, file);
      if (unit) return unit;
    }
    return undefined;
  }

  private async readUnitXml(
    unitId: string,
    file: ApFile,
  ): Promise<UnitXmlData | undefined> {
    try {
      const content = await readFile(file.filePath, "utf8");
      if (!content.includes("<Unit")) return undefined;
      const unit = parseUnitXml(content, file.originalName, this.logger);
      return unit?.unitId.trim() === unitId ? unit : undefined;
    } catch {
      return undefined;
    }
  }

  private async readFirstMetadata(
    unitId: string,
    files: readonly (ApFile | undefined)[],
    onUnreadable?: () => void,
  ) {
    for (const file of new Set(files)) {
      if (!file) continue;
      const metadata = await this.readMetadata(unitId, file);
      if (metadata) return { file, ...metadata };
      onUnreadable?.();
    }
    return undefined;
  }

  private itemVariableReferences(
    item: unknown,
  ): ItemVariableReferences | undefined {
    if (!isRecord(item)) return undefined;
    const references: ItemVariableReferences = {};
    for (const key of [
      "variableId",
      "sourceVariable",
      "variableReadOnlyId",
    ] as const) {
      const value = item[key];
      if (typeof value === "string" && value.trim())
        references[key] = value.trim();
    }
    return Object.keys(references).length ? references : undefined;
  }

  private async buildItemCatalog(
    apId: string,
    ap: Ap | null,
    files: ApFile[],
    {
      manager,
      findStoredTargets,
    }: { manager?: EntityManager; findStoredTargets?: StoredTargetLookup },
  ): Promise<ItemCatalog> {
    let cacheable = false;
    let unitSources: ItemListUnitSources | undefined;
    const onUnreadable = () => {
      cacheable = false;
    };
    const itemList = await this.unitParserService.getItemListFromFiles(
      apId,
      {
        includeStudioItemComments: false,
        ...(!manager ? { persistMissingRowNumbers: false } : {}),
        onUnitSources: (sources) => {
          unitSources = sources;
        },
        onDiagnostics: (diagnostics) => {
          cacheable = diagnostics.cacheable;
        },
      },
      manager,
    );
    const codingUnitIds = new Set(
      Object.entries(itemList.codingSchemes || {})
        .filter(([, scheme]) => Boolean(scheme))
        .map(([unitId]) => unitId.trim()),
    );
    const indexUnits: CatalogIndexUnit[] = getIndexUnits(ap?.apIndex);
    const fileItems: CatalogFileItem[] = [...(itemList.items || [])];
    const parsedUnits =
      unitSources?.unitsWithMetadata ??
      new Set(fileItems.map((item) => item.unitId.trim()));
    for (const unit of indexUnits) {
      const unitId = String(unit?.id || "").trim();
      if (!unitId || parsedUnits.has(unitId)) continue;
      const dependencies = Array.isArray(unit.dependencies)
        ? unit.dependencies
        : [];
      const candidates = dependencies
        .filter((entry) => String(entry?.type).toLowerCase() === "metadata")
        .map((entry) =>
          files.find((candidate) => candidate.originalName === entry.id),
        );
      const fallback = await this.readFirstMetadata(
        unitId,
        candidates,
        onUnreadable,
      );
      for (const item of fallback?.items ?? [])
        fileItems.push({ ...item, indexMetadataOnly: true });
    }

    const entries = this.mergeItems(indexUnits, fileItems, codingUnitIds);
    const hasConflictingAliases = unitSources?.alternateUnits.length
      ? await this.appendAlternateItemTargets(
          entries,
          indexUnits,
          unitSources.alternateUnits,
          files,
          codingUnitIds,
          onUnreadable,
          findStoredTargets,
        )
      : false;
    // Stored comment IDs can change independently of the files and AP index.
    return { entries, cacheable: cacheable && !hasConflictingAliases };
  }

  private async appendAlternateItemTargets(
    entries: ReviewItemCatalogEntry[],
    indexUnits: CatalogIndexUnit[],
    alternateUnits: readonly UnitXmlData[],
    files: ApFile[],
    codingUnitIds: ReadonlySet<string>,
    onUnreadable: () => void,
    findStoredTargets?: StoredTargetLookup,
  ): Promise<boolean> {
    const targets = new Map(
      entries.map((entry) => [
        itemCatalogKey(entry.unitId, entry.itemId),
        entry,
      ]),
    );
    const aliases = new Map<string, ReviewItemCatalogEntry>();
    const previous = new Map<string, ReviewItemCatalogEntry>();
    const ambiguous = new Map<string, ReviewItemCatalogEntry>();
    const unitOrders = new Map(
      entries.map((entry) => [entry.unitId, entry.unitOrder]),
    );
    // Before source selection, the index already owned its prefixed aliases.
    for (const [order, unit] of indexUnits.entries()) {
      const unitId = String(unit?.id || "").trim();
      if (!unitId) continue;
      unitOrders.set(unitId, order);
      for (const item of Array.isArray(unit.items) ? unit.items : []) {
        if (!isRecord(item)) continue;
        const itemId = String(item.id || "").trim();
        const target = targets.get(itemCatalogKey(unitId, itemId));
        if (target)
          aliases.set(itemCatalogKey(unitId, `${unitId}_${itemId}`), target);
      }
    }
    for (const entry of entries) {
      if (entry.previousItemId)
        previous.set(itemCatalogKey(entry.unitId, entry.previousItemId), entry);
    }
    for (const unit of alternateUnits) {
      const unitId = unit.unitId.trim();
      if (!unit.metadataRef) continue;
      const file = findReferencedMetadataFile(files, unit.metadataRef);
      const metadata = await this.readFirstMetadata(
        unitId,
        [file],
        onUnreadable,
      );
      if (!metadata?.items.length) continue;

      let hasCodingScheme = codingUnitIds.has(unitId);
      if (!hasCodingScheme && unit.codingSchemeRef) {
        const codingFile = files.find(
          ({ originalName }) => originalName === unit.codingSchemeRef,
        );
        if (codingFile) {
          const availability =
            await this.readCodingSchemeAvailability(codingFile);
          if (availability === undefined) onUnreadable();
          hasCodingScheme = availability ?? false;
        }
      }

      const unitOrder = unitOrders.get(unitId) ?? unitOrders.size;
      unitOrders.set(unitId, unitOrder);
      for (const { itemId, description, rowNumber } of metadata.items) {
        const key = itemCatalogKey(unitId, itemId);
        const existing =
          targets.get(key) ?? previous.get(key) ?? ambiguous.get(key);
        if (existing) {
          existing.hasCodingScheme ||= hasCodingScheme;
          continue;
        }
        // Keep established comment targets without changing active item references.
        const entry = {
          unitId,
          itemId,
          unitLabel: unit.unitLabel || unitId,
          itemLabel: String(description || itemId).trim(),
          unitOrder,
          itemOrder: rowNumber,
          hasCodingScheme,
        };
        if (aliases.has(key)) {
          ambiguous.set(key, entry);
        } else {
          targets.set(key, entry);
          entries.push(entry);
        }
      }
    }
    if (!ambiguous.size) return false;
    const stored = await findStoredTargets?.([...ambiguous.values()]);
    for (const [key, entry] of ambiguous) {
      if (stored?.has(key)) entries.push(entry);
      else {
        const alias = aliases.get(key)!;
        alias.hasCodingScheme ||= entry.hasCodingScheme;
      }
    }
    return true;
  }

  private mergeItems(
    indexUnits: CatalogIndexUnit[],
    fileItems: CatalogFileItem[],
    codingUnitIds: ReadonlySet<string>,
  ): ReviewItemCatalogEntry[] {
    const indexEntries: ReviewItemCatalogEntry[] = [];
    for (const [unitOrder, unit] of indexUnits.entries()) {
      const indexUnitId = String(unit?.id || "").trim();
      const unitLabel =
        extractLabelText(unit?.name || unit?.label) ||
        String(unit?.description || indexUnitId).trim();
      const items = Array.isArray(unit?.items) ? unit.items : [];
      for (const [itemOrder, item] of items.entries()) {
        if (!isRecord(item)) continue;
        const itemId = String(item.id || "").trim();
        indexEntries.push({
          unitId: indexUnitId,
          itemId,
          variableReferences: this.itemVariableReferences(item),
          hasCodingScheme: codingUnitIds.has(indexUnitId),
          unitLabel,
          itemLabel:
            extractLabelText(item?.name || item?.label) ||
            String(item?.description || itemId).trim(),
          unitOrder,
          itemOrder,
        });
      }
    }
    const entries = [...indexEntries];
    const indexUnitOrders = new Map(
      indexUnits.map((unit, unitOrder) => [
        String(unit?.id || "").trim(),
        unitOrder,
      ]),
    );
    const indexByUnit = new Map<string, Map<string, ReviewItemCatalogEntry>>();
    for (const entry of indexEntries) {
      const items =
        indexByUnit.get(entry.unitId) ??
        new Map<string, ReviewItemCatalogEntry>();
      if (!items.has(entry.itemId)) items.set(entry.itemId, entry);
      indexByUnit.set(entry.unitId, items);
    }
    const fileIdsByUnit = new Map<string, Set<string>>();
    for (const item of fileItems) {
      const unitId = item.unitId.trim();
      const ids = fileIdsByUnit.get(unitId) ?? new Set<string>();
      ids.add(item.itemId.trim());
      fileIdsByUnit.set(unitId, ids);
    }
    const parsedUnitOrders = new Map<string, number>();
    for (const [parsedOrder, item] of fileItems.entries()) {
      const unitId = String(item.unitId || "").trim();
      const parsedEntry: ReviewItemCatalogEntry = {
        unitId,
        itemId: String(item.itemId || "").trim(),
        variableReferences: this.itemVariableReferences(item),
        excludeFromLegacyTargets: item.indexMetadataOnly,
        hasCodingScheme: codingUnitIds.has(unitId),
        unitLabel: String(item.unitLabel || item.unitId || "").trim(),
        itemLabel: String(item.description || item.itemId || "").trim(),
        unitOrder: 0,
        itemOrder: Number.isFinite(item.rowNumber)
          ? Number(item.rowNumber)
          : parsedOrder,
      };
      if (!parsedUnitOrders.has(parsedEntry.unitId)) {
        parsedUnitOrders.set(
          parsedEntry.unitId,
          indexUnits.length + parsedUnitOrders.size,
        );
      }
      parsedEntry.unitOrder =
        indexUnitOrders.get(parsedEntry.unitId) ??
        parsedUnitOrders.get(parsedEntry.unitId)!;
      const { indexedItem: indexEntry, wasSeparateTarget } =
        matchIndexedVomdItem(
          unitId,
          {
            id: parsedEntry.itemId,
            useUnitAliasAsPrefix: item.useUnitAliasAsPrefix,
          },
          indexByUnit.get(unitId) ?? new Map<string, ReviewItemCatalogEntry>(),
          fileIdsByUnit.get(unitId) ?? new Set<string>(),
        );
      if (!indexEntry) {
        if (!wasSeparateTarget) parsedEntry.excludeFromLegacyTargets = true;
        entries.push(parsedEntry);
        continue;
      }

      // Keep indexed identities and attach current references from their VOMD item.
      if (parsedEntry.variableReferences)
        indexEntry.variableReferences = parsedEntry.variableReferences;
      if (indexEntry.itemId !== parsedEntry.itemId)
        indexEntry.fileItemId = parsedEntry.itemId;
      // The original comment catalog stored this raw ID as its own target.
      if (wasSeparateTarget && !item.indexMetadataOnly)
        indexEntry.previousItemId = parsedEntry.itemId;
      if (!indexEntry.unitLabel || indexEntry.unitLabel === indexEntry.unitId)
        indexEntry.unitLabel = parsedEntry.unitLabel;
      if (!indexEntry.itemLabel || indexEntry.itemLabel === indexEntry.itemId)
        indexEntry.itemLabel = parsedEntry.itemLabel;
    }

    const unique = new Map<string, ReviewItemCatalogEntry>();
    for (const entry of entries) {
      if (!entry.unitId || !entry.itemId) continue;
      const key = itemCatalogKey(entry.unitId, entry.itemId);
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, entry);
      } else {
        existing.unitOrder = Math.min(existing.unitOrder, entry.unitOrder);
        existing.itemOrder = Math.min(existing.itemOrder, entry.itemOrder);
        if (!existing.unitLabel) existing.unitLabel = entry.unitLabel;
        if (!existing.itemLabel) existing.itemLabel = entry.itemLabel;
      }
    }
    return [...unique.values()];
  }

  private async readMetadata(unitId: string, file: ApFile) {
    try {
      const parsed = parseVomd(
        await readFile(file.filePath, "utf8"),
        false,
        this.logger,
      );
      if (!parsed) return undefined;
      const items: CatalogFileItem[] = parsed.items
        .filter(isValidVomdItem)
        .map((item, rowNumber) => ({
          ...this.itemVariableReferences(item),
          unitId,
          itemId: item.id.trim(),
          description: item.description,
          useUnitAliasAsPrefix: item.useUnitAliasAsPrefix,
          rowNumber,
        }));
      return { items, unitProfiles: parsed.unitProfiles };
    } catch {
      return undefined;
    }
  }
}
