import { parseBookletXml } from "../review/booklet-parser";
import { registerBooklets, UploadedBooklet } from "../review/register-booklets";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import * as fs from "fs/promises";
import { performance } from "perf_hooks";
import {
  AcpFile,
  Acp,
  AcpAccessConfig,
  AcpItemRowNumber,
} from "../database/entities";
import {
  getAssessmentParts,
  normalizeIndexForStorage,
} from "../acp/acp-index.utils";
import { FileProcessingProgressReporter } from "./file-processing-progress";
import { normalizeFeatureConfig } from "../acp/feature-config.utils";
import { AcpIndexService } from "../acp/acp-index.service";
import { parseItemRowKeyParts } from "../items/item-row-key.util";
import { ItemRowNumberingService } from "./item-row-numbering.service";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import {
  buildSourceFileSignature,
  FileCatalogCache,
} from "./file-catalog.cache";
import {
  ItemListParser,
  ItemListParseContext,
  ItemListParseResult,
} from "./item-list.parser";
import { NumberedItemListCache } from "./numbered-item-list.cache";
import { UnitViewResolver } from "./unit-view.resolver";
import {
  extractValueText,
  findPlayerFile,
  getXmlRootElement,
  isRecord,
  isValidVomdItem,
  parseUnitXml,
  parseVomd,
} from "./unit-file-parsing";
import type {
  ItemExplorerCacheStatus,
  ItemExplorerLoadDiagnostics,
  ItemListResult,
  UnitValidationResult,
  UnitXmlData,
} from "./unit-parser.types";
export type {
  ItemExplorerCacheStatus,
  ItemExplorerLoadDiagnostics,
  ItemListResult,
  MetadataColumn,
  UnitValidationResult,
  UnitXmlData,
  VomdItemData,
} from "./unit-parser.types";

interface ParsedItemListResult {
  itemList: ItemListResult;
  sourceFileSignature: string;
  cacheIdentity: string;
  cacheStatus: ItemExplorerCacheStatus;
  sourceReadMs: number;
  fileSignatureMs: number;
  parseMs: number;
  cacheable: boolean;
}

interface ItemListSourceContext {
  allFiles: AcpFile[];
  fallbackItemProperties: Record<string, Record<string, unknown>>;
  normalizedFeatureConfig: Record<string, unknown>;
  sourceFileSignature: string;
  sourceReadMs: number;
  fileSignatureMs: number;
}

interface ItemRowKeyCacheEntry {
  signature: string;
  rowKeys: ReadonlySet<string>;
}

export interface IndexSyncReport {
  unitsAdded: number;
  unitsUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
  warnings: string[];
}

export interface IndexDependencyCleanupReport {
  unitsUpdated: number;
  dependenciesRemoved: number;
  bookletsUpdated: number;
  bookletDefinitionsRemoved: number;
  indexUpdated: boolean;
}

@Injectable()
export class UnitParserService {
  private readonly logger = new Logger(UnitParserService.name);
  private readonly itemRowKeyCache = new Map<string, ItemRowKeyCacheEntry>();
  private readonly maxItemRowKeyCacheEntries = 100;
  private readOnlyRowNumbers = false;

  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    private readonly itemRowNumberingService: ItemRowNumberingService,
    private readonly itemExplorerStateService: ItemExplorerStateService,
    private readonly fileCatalogCache: FileCatalogCache,
    private readonly itemListParser: ItemListParser,
    private readonly numberedItemListCache: NumberedItemListCache,
    private readonly unitViewResolver: UnitViewResolver,
    @Optional() private readonly acpIndexService?: AcpIndexService,
  ) {}

  /**
   * Parse a Unit .xml file content and extract references.
   */
  parseUnitXml(xmlContent: string, xmlFilename: string): UnitXmlData | null {
    return parseUnitXml(xmlContent, xmlFilename, this.logger);
  }

  /**
   * Parse a .vomd JSON file and extract items with their profile entries.
   */
  parseVomd(
    vomdContent: string,
    strictStructure = false,
  ): {
    unitProfiles: any[];
    items: any[];
  } | null {
    return parseVomd(vomdContent, strictStructure, this.logger);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return isRecord(value);
  }

  private isValidVomdItem(
    value: unknown,
  ): value is Record<string, any> & { id: string; profiles?: any[] } {
    return isValidVomdItem(value);
  }

  /**
   * Resolve a player reference like "iqb-player-aspect@2.11" to an actual
   * uploaded file. Finds the best match among uploaded HTML files.
   */
  private findPlayerFile(
    playerRef: string,
    fileNames: string[],
  ): string | undefined {
    return findPlayerFile(playerRef, fileNames);
  }

  /**
   * Validate that all files referenced by a unit .xml are present.
   */
  async validateUnitFiles(acpId: string): Promise<UnitValidationResult[]> {
    // Get all files for this ACP
    const allFiles = await this.fileRepository.find({ where: { acpId } });
    const fileNames = allFiles.map((f) => f.originalName);
    const results: UnitValidationResult[] = [];

    const xmlFiles = allFiles.filter((f) =>
      f.originalName.toLowerCase().endsWith(".xml"),
    );

    for (const xmlFile of xmlFiles) {
      try {
        const content = await fs.readFile(xmlFile.filePath, "utf-8");

        // Classify by the XML root instead of relying on file-name prefixes.
        // Booklets contain nested <Unit> references but are not Unit files.
        if (getXmlRootElement(content) !== "Unit") continue;

        const parsed = this.parseUnitXml(content, xmlFile.originalName);
        if (!parsed) continue;

        const playerFileName = this.findPlayerFile(parsed.playerRef, fileNames);

        const result: UnitValidationResult = {
          unitId: parsed.unitId,
          unitLabel: parsed.unitLabel,
          valid: true,
          files: {
            xml: { expected: xmlFile.originalName, found: true },
            definition: {
              expected: parsed.definitionRef,
              found: fileNames.includes(parsed.definitionRef),
            },
            codingScheme: {
              expected: parsed.codingSchemeRef || "(nicht referenziert)",
              found: parsed.codingSchemeRef
                ? fileNames.includes(parsed.codingSchemeRef)
                : true,
            },
            metadata: {
              expected: parsed.metadataRef || "(nicht referenziert)",
              found: parsed.metadataRef
                ? fileNames.some(
                    (n) =>
                      n === parsed.metadataRef ||
                      n === parsed.metadataRef + ".json",
                  )
                : true,
            },
            player: {
              expected: parsed.playerRef,
              found: !!playerFileName,
              resolvedName: playerFileName,
            },
          },
        };

        // Check overall validity
        result.valid =
          result.files.definition.found &&
          result.files.codingScheme.found &&
          result.files.metadata.found &&
          result.files.player.found;

        results.push(result);
      } catch (e) {
        this.logger.error(
          `Error validating unit file ${xmlFile.originalName}: ${e}`,
        );
      }
    }

    return results;
  }

  /**
   * Merge uploaded unit files into ACP-Index (non-destructive).
   * - Adds/updates units and items inferred from unit XML + VOMD
   * - Preserves existing manual index fields
   * - Never removes existing units/items automatically
   * - Prunes dependency entries that reference files no longer present
   */
  async syncIndexFromFiles(
    acpId: string,
    progress?: FileProcessingProgressReporter,
  ): Promise<IndexSyncReport> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }

    const allFiles = await this.fileRepository.find({ where: { acpId } });
    const fileNames = allFiles.map((f) => f.originalName);
    const fileNameSet = new Set(fileNames);

    const warningSet = new Set<string>();
    const report: IndexSyncReport = {
      unitsAdded: 0,
      unitsUpdated: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      warnings: [],
    };

    const normalizedIndex = normalizeIndexForStorage(acp.acpIndex || {});
    const parts = getAssessmentParts(normalizedIndex).map((part: any) => ({
      ...part,
      ...(Array.isArray(part?.instruments)
        ? { instruments: structuredClone(part.instruments) }
        : {}),
      units: Array.isArray(part?.units) ? [...part.units] : [],
    }));

    if (!parts.length) {
      parts.push({
        id: "default-assessment-part",
        name: [{ lang: "de", value: "Default Assessment Part" }],
        units: [],
      });
    }

    const unitLocation = new Map<
      string,
      { partIndex: number; unitIndex: number }
    >();
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const units = Array.isArray(parts[partIndex].units)
        ? parts[partIndex].units
        : [];
      parts[partIndex].units = units;
      for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
        const unitId =
          typeof units[unitIndex]?.id === "string" ? units[unitIndex].id : "";
        if (unitId && !unitLocation.has(unitId)) {
          unitLocation.set(unitId, { partIndex, unitIndex });
        }
      }
    }

    const xmlFiles = allFiles.filter((f) =>
      f.originalName.toLowerCase().endsWith(".xml"),
    );

    const uploadedBooklets: UploadedBooklet[] = [];

    await progress?.startPhase("sync-index", xmlFiles.length, {
      message:
        xmlFiles.length > 0
          ? "Unit- und Booklet-XML-Dateien werden in den ACP-Index eingelesen."
          : "Keine XML-Dateien fuer die Synchronisierung gefunden.",
    });

    for (const xmlFile of xmlFiles) {
      let xmlContent = "";
      try {
        xmlContent = await fs.readFile(xmlFile.filePath, "utf-8");
      } catch (e) {
        warningSet.add(`Konnte Unit-XML nicht lesen: ${xmlFile.originalName}`);
        this.logger.warn(
          `Could not read XML file ${xmlFile.originalName}: ${e}`,
        );
        await progress?.advance({ message: xmlFile.originalName });
        continue;
      }

      if (/<Booklet(?:\s|>)/.test(xmlContent)) {
        try {
          const booklet = parseBookletXml(xmlContent, xmlFile.originalName);
          uploadedBooklets.push({
            id: booklet.id,
            label: booklet.label,
            definitionId: xmlFile.originalName,
          });
        } catch (error) {
          warningSet.add(
            `Booklet ${xmlFile.originalName} konnte nicht verknüpft werden: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        await progress?.advance({ message: xmlFile.originalName });
        continue;
      }

      if (
        xmlFile.originalName.toLowerCase().startsWith("testtaker") ||
        !xmlContent.includes("<Unit")
      ) {
        await progress?.advance({ message: xmlFile.originalName });
        continue;
      }

      const parsedUnit = this.parseUnitXml(xmlContent, xmlFile.originalName);
      if (!parsedUnit?.unitId) {
        warningSet.add(
          `Unit-XML konnte nicht geparst werden: ${xmlFile.originalName}`,
        );
        await progress?.advance({ message: xmlFile.originalName });
        continue;
      }

      const location = unitLocation.get(parsedUnit.unitId);
      const existingUnit = location
        ? parts[location.partIndex].units[location.unitIndex]
        : undefined;

      const dependencies = this.buildDependenciesFromUnitRefs(
        parsedUnit,
        fileNames,
        fileNameSet,
        warningSet,
      );

      const existingItems = Array.isArray(existingUnit?.items)
        ? [...existingUnit.items]
        : [];
      const parsedItems = await this.extractItemsForUnit(
        parsedUnit,
        allFiles,
        warningSet,
      );
      const mergedItems = [...existingItems];

      for (const parsedItem of parsedItems) {
        const existingIndex = mergedItems.findIndex(
          (i: any) => i?.id === parsedItem.id,
        );
        if (existingIndex === -1) {
          mergedItems.push(parsedItem);
          report.itemsAdded++;
          continue;
        }

        const existingItem = mergedItems[existingIndex] || {};
        const nextItem = { ...existingItem };
        let changed = false;

        if (!nextItem.name && parsedItem.name) {
          nextItem.name = parsedItem.name;
          changed = true;
        }

        if (!nextItem.sourceVariable && parsedItem.sourceVariable) {
          nextItem.sourceVariable = parsedItem.sourceVariable;
          changed = true;
        }

        if (!nextItem.variableId && parsedItem.variableId) {
          nextItem.variableId = parsedItem.variableId;
          changed = true;
        }

        if (!nextItem.variableReadOnlyId && parsedItem.variableReadOnlyId) {
          nextItem.variableReadOnlyId = parsedItem.variableReadOnlyId;
          changed = true;
        }

        if (
          nextItem.useUnitAliasAsPrefix === undefined &&
          parsedItem.useUnitAliasAsPrefix !== undefined
        ) {
          nextItem.useUnitAliasAsPrefix = parsedItem.useUnitAliasAsPrefix;
          changed = true;
        }

        if (parsedItem.metadata && Object.keys(parsedItem.metadata).length) {
          const existingMetadata =
            nextItem.metadata && typeof nextItem.metadata === "object"
              ? nextItem.metadata
              : {};
          const mergedMetadata = {
            ...parsedItem.metadata,
            ...existingMetadata,
          };
          if (
            JSON.stringify(mergedMetadata) !== JSON.stringify(existingMetadata)
          ) {
            nextItem.metadata = mergedMetadata;
            changed = true;
          }
        }

        if (changed) {
          mergedItems[existingIndex] = nextItem;
          report.itemsUpdated++;
        }
      }

      const existingDependencies = Array.isArray(existingUnit?.dependencies)
        ? existingUnit.dependencies
        : [];

      const mergedUnit = {
        ...(existingUnit || {}),
        id: parsedUnit.unitId,
        name: existingUnit?.name || parsedUnit.unitLabel || parsedUnit.unitId,
        description: existingUnit?.description || parsedUnit.description,
        dependencies: this.mergeDependencies(
          existingDependencies,
          dependencies,
        ),
        items: mergedItems,
      };

      if (!location) {
        parts[0].units.push(mergedUnit);
        unitLocation.set(parsedUnit.unitId, {
          partIndex: 0,
          unitIndex: parts[0].units.length - 1,
        });
        report.unitsAdded++;
        continue;
      }

      const previous = parts[location.partIndex].units[location.unitIndex];
      if (JSON.stringify(previous) !== JSON.stringify(mergedUnit)) {
        parts[location.partIndex].units[location.unitIndex] = mergedUnit;
        report.unitsUpdated++;
      }

      await progress?.advance({ message: xmlFile.originalName });
    }

    registerBooklets(parts, uploadedBooklets, warningSet);
    this.pruneMissingReferencesFromParts(parts, fileNameSet);

    const nextIndex = normalizeIndexForStorage({
      ...normalizedIndex,
      assessmentParts: parts,
    });

    if (JSON.stringify(acp.acpIndex || {}) !== JSON.stringify(nextIndex)) {
      if (this.acpIndexService) {
        await this.acpIndexService.saveCandidate(
          acpId,
          nextIndex,
          acp.updatedAt?.toISOString(),
        );
      } else {
        acp.acpIndex = nextIndex;
        await this.acpRepository.save(acp);
      }
    }

    report.warnings = Array.from(warningSet);
    await progress?.completePhase(
      xmlFiles.length > 0
        ? "ACP-Index-Synchronisierung abgeschlossen."
        : "ACP-Index-Synchronisierung ohne verarbeitbare Unit-Dateien abgeschlossen.",
    );
    return report;
  }

  /**
   * Remove unit dependency entries that reference files no longer present
   * in ACP storage. This is intended for cleanup after file deletions.
   */
  async pruneMissingDependencies(
    acpId: string,
  ): Promise<IndexDependencyCleanupReport> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }

    const allFiles = await this.fileRepository.find({ where: { acpId } });
    const fileNameSet = new Set(allFiles.map((f) => f.originalName));
    const normalizedIndex = normalizeIndexForStorage(acp.acpIndex || {});
    const parts = getAssessmentParts(normalizedIndex).map((part: any) => ({
      ...part,
      units: Array.isArray(part?.units) ? [...part.units] : [],
    }));

    const cleanup = this.pruneMissingReferencesFromParts(parts, fileNameSet);

    const nextIndex = normalizeIndexForStorage({
      ...normalizedIndex,
      assessmentParts: parts,
    });
    const indexUpdated =
      JSON.stringify(acp.acpIndex || {}) !== JSON.stringify(nextIndex);

    if (indexUpdated) {
      if (this.acpIndexService) {
        await this.acpIndexService.saveCandidate(
          acpId,
          nextIndex,
          acp.updatedAt?.toISOString(),
        );
      } else {
        acp.acpIndex = nextIndex;
        await this.acpRepository.save(acp);
      }
    }

    return {
      unitsUpdated: cleanup.unitsUpdated,
      dependenciesRemoved: cleanup.dependenciesRemoved,
      bookletsUpdated: cleanup.bookletsUpdated,
      bookletDefinitionsRemoved: cleanup.bookletDefinitionsRemoved,
      indexUpdated,
    };
  }

  /**
   * Read all .vomd files for an ACP, extract items with profile metadata,
   * and determine dynamic columns.
   */
  async getItemListFromFiles(
    acpId: string,
    options: {
      itemPropertiesOverride?: Record<string, Record<string, unknown>>;
      publishedItemPropertiesOverride?: Record<string, Record<string, unknown>>;
      activeStateSignature?: string;
      publishedStateSignature?: string;
      onDiagnostics?: (diagnostics: ItemExplorerLoadDiagnostics) => void;
    } = {},
    manager?: EntityManager,
  ): Promise<ItemListResult> {
    if (manager) {
      // Share only the pure file parser. Database-backed in-flight caches must
      // not wait for another transaction while this one holds the ACP lock.
      const scoped = new UnitParserService(
        manager.getRepository(AcpFile),
        manager.getRepository(Acp),
        manager.getRepository(AcpAccessConfig),
        new ItemRowNumberingService(manager.getRepository(AcpItemRowNumber)),
        this.itemExplorerStateService,
        new FileCatalogCache(manager.getRepository(AcpFile)),
        this.itemListParser,
        new NumberedItemListCache(),
        this.unitViewResolver,
      );
      // Review transactions already hold the configuration lock. Persisting
      // missing numbers would also lock ACP and invert the Explorer save order.
      scoped.readOnlyRowNumbers = true;
      return scoped.getItemListFromFiles(acpId, options);
    }
    const totalStartedAt = performance.now();
    const rowRevisionStartedAt = performance.now();
    const rowRevisionPromise = this.itemRowNumberingService
      .getRevision(acpId)
      .then((rowRevision) => ({
        rowRevision,
        rowNumberRevisionMs: performance.now() - rowRevisionStartedAt,
      }));
    const sourceContext = await this.loadItemListSourceContext(
      acpId,
      options.itemPropertiesOverride === undefined,
    );
    const activeParse = await this.parseItemListFromContext(
      acpId,
      sourceContext,
      options.itemPropertiesOverride || sourceContext.fallbackItemProperties,
      options.activeStateSignature,
    );
    let parseDiagnostics = activeParse;
    let publishedParse: ParsedItemListResult | undefined;

    if (
      options.publishedItemPropertiesOverride &&
      !this.haveSamePartialCreditRows(
        options.itemPropertiesOverride || {},
        options.publishedItemPropertiesOverride,
      )
    ) {
      publishedParse = await this.parseItemListFromContext(
        acpId,
        sourceContext,
        options.publishedItemPropertiesOverride,
        options.publishedStateSignature,
      );
      parseDiagnostics = {
        ...activeParse,
        cacheStatus: this.combineCacheStatus(
          activeParse.cacheStatus,
          publishedParse.cacheStatus,
        ),
        parseMs: activeParse.parseMs + publishedParse.parseMs,
      };
    }

    if (this.readOnlyRowNumbers) {
      const { rowNumberRevisionMs } = await rowRevisionPromise;
      const rowNumberingStartedAt = performance.now();
      const result = await this.applyItemRowNumbers(
        acpId,
        activeParse.itemList,
        {
          persistMissingRowNumbers: false,
        },
      );
      options.onDiagnostics?.({
        cacheStatus: parseDiagnostics.cacheStatus,
        rowCacheStatus: "miss",
        sourceReadMs: sourceContext.sourceReadMs,
        fileSignatureMs: sourceContext.fileSignatureMs,
        rowNumberRevisionMs,
        parseMs: parseDiagnostics.parseMs,
        rowNumberingMs: performance.now() - rowNumberingStartedAt,
        totalMs: performance.now() - totalStartedAt,
      });
      return result;
    }

    if (
      !activeParse.cacheable ||
      (publishedParse && !publishedParse.cacheable)
    ) {
      const { rowNumberRevisionMs } = await rowRevisionPromise;
      const rowNumberingStartedAt = performance.now();
      let result: ItemListResult;
      if (publishedParse) {
        await this.applyItemRowNumbers(acpId, publishedParse.itemList, {});
        result = await this.applyItemRowNumbers(acpId, activeParse.itemList, {
          persistMissingRowNumbers: false,
        });
      } else {
        result = await this.applyItemRowNumbers(
          acpId,
          activeParse.itemList,
          {},
        );
      }
      options.onDiagnostics?.({
        cacheStatus: parseDiagnostics.cacheStatus,
        rowCacheStatus: "miss",
        sourceReadMs: sourceContext.sourceReadMs,
        fileSignatureMs: sourceContext.fileSignatureMs,
        rowNumberRevisionMs,
        parseMs: parseDiagnostics.parseMs,
        rowNumberingMs: performance.now() - rowNumberingStartedAt,
        totalMs: performance.now() - totalStartedAt,
      });
      return result;
    }

    const { rowRevision, rowNumberRevisionMs } = await rowRevisionPromise;
    const numberedCacheBaseKey = `${activeParse.cacheIdentity}:${
      publishedParse?.cacheIdentity || activeParse.cacheIdentity
    }`;
    const { value, status: rowCacheStatus } =
      await this.numberedItemListCache.getOrLoad(
        acpId,
        numberedCacheBaseKey,
        rowRevision,
        async () => {
          const rowNumberingStartedAt = performance.now();
          const numberedResult =
            await this.applyItemRowNumbersWithStableRevision(
              acpId,
              activeParse.itemList,
              publishedParse?.itemList,
              rowRevision,
            );
          return {
            itemList: structuredClone(numberedResult.itemList),
            rowRevision: numberedResult.rowRevision,
            rowNumberingMs: performance.now() - rowNumberingStartedAt,
          };
        },
      );
    options.onDiagnostics?.({
      cacheStatus: parseDiagnostics.cacheStatus,
      rowCacheStatus,
      sourceReadMs: sourceContext.sourceReadMs,
      fileSignatureMs: sourceContext.fileSignatureMs,
      rowNumberRevisionMs,
      parseMs: parseDiagnostics.parseMs,
      rowNumberingMs: rowCacheStatus === "hit" ? 0 : value.rowNumberingMs,
      totalMs: performance.now() - totalStartedAt,
    });
    return structuredClone(value.itemList);
  }

  private async loadItemListSourceContext(
    acpId: string,
    loadFallbackItemProperties: boolean,
  ): Promise<ItemListSourceContext> {
    const sourceReadStartedAt = performance.now();
    const [catalog, acp, accessConfig] = await Promise.all([
      this.fileCatalogCache.get(acpId),
      loadFallbackItemProperties
        ? this.acpRepository.findOne({ where: { id: acpId } })
        : Promise.resolve(null),
      this.accessConfigRepository.findOne({ where: { acpId } }),
    ]);
    return {
      allFiles: catalog.files,
      fallbackItemProperties: acp?.itemProperties || {},
      normalizedFeatureConfig: normalizeFeatureConfig(
        accessConfig?.featureConfig || {},
      ) as Record<string, unknown>,
      sourceFileSignature: catalog.signature,
      sourceReadMs: performance.now() - sourceReadStartedAt,
      fileSignatureMs: catalog.fileSignatureMs,
    };
  }

  private async parseItemListFromContext(
    acpId: string,
    sourceContext: ItemListSourceContext,
    itemProperties: Record<string, Record<string, unknown>>,
    itemPropertiesSignature?: string,
    strictSourceReads = false,
  ): Promise<ParsedItemListResult> {
    const context: ItemListParseContext = {
      allFiles: sourceContext.allFiles,
      itemProps: itemProperties,
      itemPropertiesSignature,
      normalizedFeatureConfig: sourceContext.normalizedFeatureConfig,
      sourceFileSignature: sourceContext.sourceFileSignature,
    };
    const parsed: ItemListParseResult = await this.itemListParser.parse(
      acpId,
      context,
      strictSourceReads,
    );
    return {
      ...parsed,
      sourceReadMs: sourceContext.sourceReadMs,
      fileSignatureMs: sourceContext.fileSignatureMs,
    };
  }

  async recalculatePublishedItemRowNumbers(
    acpId: string,
  ): Promise<{ renumberedCount: number }> {
    const publishedState =
      await this.itemExplorerStateService.getCleanPublishedState(acpId);
    const sourceContext = await this.loadItemListSourceContext(acpId, false);
    const expectedSourceFileSignature = this.buildSourceFileSignature(
      sourceContext.allFiles,
    );
    const { itemList } = await this.parseItemListFromContext(
      acpId,
      sourceContext,
      publishedState.publishedState.itemProperties,
      `published:${publishedState.publishedVersion}`,
      true,
    );

    const result = await this.itemExplorerStateService.runWithLockedCleanState(
      acpId,
      async (_explorerState, manager) => {
        const result = await this.applyItemRowNumbers(acpId, itemList, {
          recalculateRowNumbers: true,
          rowNumberingManager: manager,
          validateSourceFiles: (lockedManager) =>
            this.assertSourceFilesUnchanged(
              acpId,
              expectedSourceFileSignature,
              lockedManager,
            ),
        });
        return { renumberedCount: result.items.length };
      },
      publishedState.publishedVersion,
    );
    this.numberedItemListCache.invalidate(acpId);
    return result;
  }

  private async applyItemRowNumbersWithStableRevision(
    acpId: string,
    activeItemList: ItemListResult,
    publishedItemList: ItemListResult | undefined,
    initialRevision: string,
  ): Promise<{
    itemList: ItemListResult;
    rowRevision: string;
  }> {
    let expectedRevision = initialRevision;
    const maxRevisionChecks = 3;

    for (let attempt = 0; attempt < maxRevisionChecks; attempt += 1) {
      let result: ItemListResult;
      if (publishedItemList) {
        const publishedResult = await this.applyPersistedItemRowNumbers(
          acpId,
          publishedItemList,
        );
        result = await this.applyItemRowNumbers(acpId, activeItemList, {
          persistMissingRowNumbers: false,
        });
        const observedRevision =
          await this.itemRowNumberingService.getRevision(acpId);
        if (
          observedRevision === (publishedResult.rowRevision || expectedRevision)
        ) {
          return {
            itemList: result,
            rowRevision: observedRevision,
          };
        }
        expectedRevision = observedRevision;
        continue;
      } else {
        const activeResult = await this.applyPersistedItemRowNumbers(
          acpId,
          activeItemList,
        );
        result = activeResult.itemList;
        if (activeResult.rowRevision) {
          return {
            itemList: result,
            rowRevision: activeResult.rowRevision,
          };
        }
      }

      const observedRevision =
        await this.itemRowNumberingService.getRevision(acpId);
      if (observedRevision === expectedRevision) {
        return {
          itemList: result,
          rowRevision: observedRevision,
        };
      }
      expectedRevision = observedRevision;
    }

    throw new ConflictException(
      "Item row numbers changed repeatedly while the item list was loading",
    );
  }

  private async applyPersistedItemRowNumbers(
    acpId: string,
    itemList: ItemListResult,
  ): Promise<{ itemList: ItemListResult; rowRevision?: string }> {
    const assignment =
      await this.itemRowNumberingService.assignNumbersWithRevision(
        acpId,
        this.getNumberableItemRows(itemList),
      );
    this.setItemRowNumbers(itemList, assignment.numbers);
    return {
      itemList,
      rowRevision: assignment.revision,
    };
  }

  private async applyItemRowNumbers(
    acpId: string,
    itemList: ItemListResult,
    options: {
      recalculateRowNumbers?: boolean;
      rowNumberingManager?: EntityManager;
      validateSourceFiles?: (manager: EntityManager) => Promise<void>;
      persistMissingRowNumbers?: boolean;
    },
  ): Promise<ItemListResult> {
    const numberableRows = this.getNumberableItemRows(itemList);

    const rowNumbers = options.recalculateRowNumbers
      ? await this.itemRowNumberingService.recalculateNumbers(
          acpId,
          numberableRows,
          options.rowNumberingManager,
          options.validateSourceFiles,
        )
      : options.persistMissingRowNumbers === false
        ? await this.itemRowNumberingService.assignProvisionalNumbers(
            acpId,
            numberableRows,
          )
        : await this.itemRowNumberingService.assignNumbers(
            acpId,
            numberableRows,
          );
    this.setItemRowNumbers(itemList, rowNumbers);

    return itemList;
  }

  private getNumberableItemRows(itemList: ItemListResult) {
    return itemList.items.map((item) => ({
      rowKey: item.rowKey,
      itemId: item.itemId,
      unitId: item.unitId,
      subId: item.subId,
    }));
  }

  private setItemRowNumbers(
    itemList: ItemListResult,
    rowNumbers: Map<string, number>,
  ): void {
    for (const item of itemList.items) {
      item.rowNumber = rowNumbers.get(item.rowKey)!;
    }
  }

  private async assertSourceFilesUnchanged(
    acpId: string,
    expectedSignature: string,
    manager: EntityManager,
  ): Promise<void> {
    const currentFiles = await manager
      .getRepository(AcpFile)
      .createQueryBuilder("file")
      .setLock("pessimistic_read")
      .where("file.acpId = :acpId", { acpId })
      .orderBy("file.id", "ASC")
      .getMany();

    if (this.buildSourceFileSignature(currentFiles) !== expectedSignature) {
      throw new ConflictException(
        "The ACP source files changed while row numbers were being recalculated",
      );
    }
  }

  private buildSourceFileSignature(files: AcpFile[]): string {
    return buildSourceFileSignature(files);
  }

  invalidateFileCaches(acpId: string): void {
    this.fileCatalogCache.invalidate(acpId);
    this.itemListParser.invalidate(acpId);
    this.numberedItemListCache.invalidate(acpId);
    this.unitViewResolver.invalidate(acpId);
    const prefix = `${acpId}:`;
    for (const key of this.itemRowKeyCache.keys()) {
      if (key.startsWith(prefix)) this.itemRowKeyCache.delete(key);
    }
  }

  private combineCacheStatus(
    left: ItemExplorerCacheStatus,
    right: ItemExplorerCacheStatus,
  ): ItemExplorerCacheStatus {
    if (left === "miss" || right === "miss") return "miss";
    if (left === "coalesced" || right === "coalesced") return "coalesced";
    return "hit";
  }

  /**
   * Resolve the row keys that can currently be shown in the Item Explorer.
   * The cache signature follows both uploaded file revisions and the active
   * Explorer item-property keys, which are what create partial-credit rows.
   */
  async getItemRowKeysFromFiles(
    acpId: string,
    options: {
      itemPropertiesOverride?: Record<string, Record<string, unknown>>;
      publishedItemPropertiesOverride?: Record<string, Record<string, unknown>>;
    } = {},
  ): Promise<ReadonlySet<string>> {
    const [files, acp] = await Promise.all([
      this.fileRepository.find({ where: { acpId } }),
      this.acpRepository.findOne({ where: { id: acpId } }),
    ]);
    const itemProperties =
      options.itemPropertiesOverride || acp?.itemProperties || {};
    const signature = JSON.stringify({
      files: files
        .map((file) => [
          file.id,
          file.originalName,
          file.checksum || "",
          String(file.fileSize || ""),
          file.uploadedAt instanceof Date
            ? file.uploadedAt.toISOString()
            : String(file.uploadedAt || ""),
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      itemPropertyKeys: Object.keys(itemProperties).sort(),
      publishedItemPropertyKeys: Object.keys(
        options.publishedItemPropertiesOverride || {},
      ).sort(),
    });
    const cacheKey = `${acpId}:${signature}`;
    const cached = this.itemRowKeyCache.get(cacheKey);
    if (cached?.signature === signature) {
      return cached.rowKeys;
    }

    const itemList = await this.getItemListFromFiles(acpId, options);
    const rowKeys = new Set(
      itemList.items
        .map((item) => String(item.rowKey || "").trim())
        .filter(Boolean),
    );
    if (this.itemRowKeyCache.size >= this.maxItemRowKeyCacheEntries) {
      const oldestKey = this.itemRowKeyCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.itemRowKeyCache.delete(oldestKey);
    }
    this.itemRowKeyCache.set(cacheKey, { signature, rowKeys });
    return rowKeys;
  }

  private haveSamePartialCreditRows(
    left: Record<string, Record<string, unknown>>,
    right: Record<string, Record<string, unknown>>,
  ): boolean {
    const leftKeys = Object.keys(left).filter(
      (rowKey) => parseItemRowKeyParts(rowKey) !== null,
    );
    const rightKeys = Object.keys(right).filter(
      (rowKey) => parseItemRowKeyParts(rowKey) !== null,
    );
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    const rightKeySet = new Set(rightKeys);
    return leftKeys.every((rowKey) => rightKeySet.has(rowKey));
  }

  /**
   * Get unit view data (player + definition file references) directly from
   * uploaded files, without relying on the ACP-Index.
   */
  async getUnitViewFromFiles(
    acpId: string,
    unitId: string,
    onDiagnostics?: (diagnostics: ItemExplorerLoadDiagnostics) => void,
    explorerStateSignature: string | Promise<string> = "",
    partId?: string,
  ): Promise<any> {
    const totalStartedAt = performance.now();
    const result = await this.unitViewResolver.resolve(
      acpId,
      unitId,
      explorerStateSignature,
      partId,
    );
    onDiagnostics?.({
      cacheStatus: result.cacheStatus,
      rowCacheStatus: "hit",
      sourceReadMs: result.catalog.sourceReadMs,
      fileSignatureMs: result.catalog.fileSignatureMs,
      rowNumberRevisionMs: 0,
      parseMs: result.parseMs,
      rowNumberingMs: 0,
      totalMs: performance.now() - totalStartedAt,
    });
    return result.value;
  }

  private buildDependenciesFromUnitRefs(
    parsedUnit: UnitXmlData,
    fileNames: string[],
    fileNameSet: Set<string>,
    warningSet: Set<string>,
  ): { id: string; type: string }[] {
    const dependencies: { id: string; type: string }[] = [];

    if (parsedUnit.definitionRef) {
      dependencies.push({
        id: parsedUnit.definitionRef,
        type: "UNIT_UI_DEFINITION",
      });
      if (!fileNameSet.has(parsedUnit.definitionRef)) {
        warningSet.add(
          `Unit "${parsedUnit.unitId}" referenziert fehlende Definitionsdatei: ${parsedUnit.definitionRef}`,
        );
      }
    }

    if (parsedUnit.codingSchemeRef) {
      dependencies.push({
        id: parsedUnit.codingSchemeRef,
        type: "UNIT_CODING_SCHEME",
      });
      if (!fileNameSet.has(parsedUnit.codingSchemeRef)) {
        warningSet.add(
          `Unit "${parsedUnit.unitId}" referenziert fehlendes Kodierschema: ${parsedUnit.codingSchemeRef}`,
        );
      }
    }

    if (parsedUnit.metadataRef) {
      const metadataFileName = fileNameSet.has(parsedUnit.metadataRef)
        ? parsedUnit.metadataRef
        : fileNameSet.has(`${parsedUnit.metadataRef}.json`)
          ? `${parsedUnit.metadataRef}.json`
          : parsedUnit.metadataRef;

      dependencies.push({ id: metadataFileName, type: "UNIT_METADATA" });
      if (!fileNameSet.has(metadataFileName)) {
        warningSet.add(
          `Unit "${parsedUnit.unitId}" referenziert fehlende Metadaten: ${parsedUnit.metadataRef}`,
        );
      }
    }

    if (parsedUnit.playerRef) {
      const playerFileName = this.findPlayerFile(
        parsedUnit.playerRef,
        fileNames,
      );
      if (playerFileName) {
        dependencies.push({ id: playerFileName, type: "PLAYER" });
      } else {
        warningSet.add(
          `Unit "${parsedUnit.unitId}" hat keinen passenden Player für Ref "${parsedUnit.playerRef}"`,
        );
      }
    }

    return dependencies;
  }

  private mergeDependencies(
    existing: any[],
    inferred: { id: string; type: string }[],
  ): { id: string; type: string }[] {
    const merged: { id: string; type: string }[] = [];
    const seen = new Set<string>();

    const pushIfValid = (dep: any) => {
      const id = typeof dep?.id === "string" ? dep.id : "";
      if (!id) return;
      const type = typeof dep?.type === "string" ? dep.type : "FILE";
      const key = `${type}::${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({ id, type });
    };

    for (const dep of existing || []) pushIfValid(dep);
    for (const dep of inferred || []) pushIfValid(dep);

    return merged;
  }

  private shouldKeepDependency(dep: any, availableFiles: Set<string>): boolean {
    const id = typeof dep?.id === "string" ? dep.id.trim() : "";
    if (!id) return false;

    const type = typeof dep?.type === "string" ? dep.type : "FILE";
    const fileBackedTypes = new Set([
      "UNIT_UI_DEFINITION",
      "UNIT_CODING_SCHEME",
      "UNIT_METADATA",
      "UNIT_DEFINITION",
      "CODING_SCHEME",
      "METADATA",
      "PLAYER",
      "FILE",
    ]);

    if (!fileBackedTypes.has(type)) {
      return true;
    }

    return availableFiles.has(id);
  }

  private pruneMissingReferencesFromParts(
    parts: any[],
    fileNameSet: Set<string>,
  ): {
    unitsUpdated: number;
    dependenciesRemoved: number;
    bookletsUpdated: number;
    bookletDefinitionsRemoved: number;
  } {
    let unitsUpdated = 0;
    let dependenciesRemoved = 0;
    let bookletsUpdated = 0;
    let bookletDefinitionsRemoved = 0;

    for (const part of parts) {
      for (let unitIndex = 0; unitIndex < part.units.length; unitIndex++) {
        const unit = part.units[unitIndex];
        const dependencies = Array.isArray(unit?.dependencies)
          ? unit.dependencies
          : [];
        if (!dependencies.length) continue;

        const filteredDependencies = dependencies.filter((dep: any) =>
          this.shouldKeepDependency(dep, fileNameSet),
        );

        const removedForUnit =
          dependencies.length - filteredDependencies.length;
        if (removedForUnit > 0) {
          part.units[unitIndex] = {
            ...unit,
            dependencies: filteredDependencies,
          };
          unitsUpdated++;
          dependenciesRemoved += removedForUnit;
        }
      }

      const sourceInstruments = Array.isArray(part?.instruments)
        ? part.instruments
        : [];
      if (!sourceInstruments.length) {
        continue;
      }

      const instruments = [...sourceInstruments];
      let partInstrumentsChanged = false;

      for (
        let instrumentIndex = 0;
        instrumentIndex < instruments.length;
        instrumentIndex++
      ) {
        const instrument = instruments[instrumentIndex];
        const sourceBooklets = Array.isArray(instrument?.testcenterBooklet)
          ? instrument.testcenterBooklet
          : [];
        if (!sourceBooklets.length) {
          continue;
        }

        const booklets = [...sourceBooklets];
        let instrumentChanged = false;

        for (
          let bookletIndex = 0;
          bookletIndex < booklets.length;
          bookletIndex++
        ) {
          const booklet = booklets[bookletIndex];
          if (
            !booklet ||
            typeof booklet !== "object" ||
            Array.isArray(booklet)
          ) {
            continue;
          }

          const definitionId =
            typeof booklet.definitionId === "string"
              ? booklet.definitionId.trim()
              : "";
          if (!definitionId || fileNameSet.has(definitionId)) {
            continue;
          }

          const { definitionId: _removed, ...bookletWithoutDefinition } =
            booklet;
          booklets[bookletIndex] = bookletWithoutDefinition;
          instrumentChanged = true;
          bookletsUpdated++;
          bookletDefinitionsRemoved++;
        }

        if (instrumentChanged) {
          instruments[instrumentIndex] = {
            ...instrument,
            testcenterBooklet: booklets,
          };
          partInstrumentsChanged = true;
        }
      }

      if (partInstrumentsChanged) {
        part.instruments = instruments;
      }
    }

    return {
      unitsUpdated,
      dependenciesRemoved,
      bookletsUpdated,
      bookletDefinitionsRemoved,
    };
  }

  private async extractItemsForUnit(
    parsedUnit: UnitXmlData,
    allFiles: AcpFile[],
    warningSet: Set<string>,
  ): Promise<
    Array<{
      id: string;
      name: string;
      sourceVariable?: string;
      variableId?: string;
      variableReadOnlyId?: string;
      metadata: Record<string, string>;
      useUnitAliasAsPrefix?: boolean;
    }>
  > {
    if (!parsedUnit.metadataRef) return [];

    const vomdFile = this.findFileByOriginalName(
      allFiles,
      parsedUnit.metadataRef,
    );
    if (!vomdFile) {
      warningSet.add(
        `Unit "${parsedUnit.unitId}" referenziert VOMD "${parsedUnit.metadataRef}", die nicht hochgeladen wurde`,
      );
      return [];
    }

    let vomdContent = "";
    try {
      vomdContent = await fs.readFile(vomdFile.filePath, "utf-8");
    } catch (e) {
      warningSet.add(
        `VOMD für Unit "${parsedUnit.unitId}" konnte nicht gelesen werden: ${vomdFile.originalName}`,
      );
      this.logger.warn(`Could not read VOMD ${vomdFile.originalName}: ${e}`);
      return [];
    }

    const vomdData = this.parseVomd(vomdContent);
    if (!vomdData) {
      warningSet.add(
        `VOMD für Unit "${parsedUnit.unitId}" ist ungültig: ${vomdFile.originalName}`,
      );
      return [];
    }

    const parsedItems: Array<{
      id: string;
      name: string;
      sourceVariable?: string;
      variableId?: string;
      variableReadOnlyId?: string;
      metadata: Record<string, string>;
      useUnitAliasAsPrefix?: boolean;
    }> = [];
    for (const item of vomdData.items || []) {
      if (
        !this.isRecord(item) ||
        typeof item.id !== "string" ||
        item.id.trim().length === 0
      ) {
        warningSet.add(
          `Unit "${parsedUnit.unitId}" enthält ein Item ohne ID in ${vomdFile.originalName}`,
        );
        continue;
      }
      if (!this.isValidVomdItem(item)) {
        warningSet.add(
          `Unit "${parsedUnit.unitId}" enthält ein Item mit ungültiger Profilstruktur in ${vomdFile.originalName}`,
        );
        continue;
      }

      const metadata: Record<string, string> = {};
      for (const profile of item.profiles || []) {
        for (const entry of profile.entries || []) {
          if (!entry?.id) continue;
          metadata[entry.id] = this.extractValueText(entry.valueAsText);
        }
      }

      parsedItems.push({
        id: item.id,
        name: item.description || item.id,
        sourceVariable: item.sourceVariable || undefined,
        variableId: item.variableId || undefined,
        variableReadOnlyId: item.variableReadOnlyId || undefined,
        metadata,
        useUnitAliasAsPrefix: item.useUnitAliasAsPrefix,
      });
    }

    return parsedItems;
  }

  private findFileByOriginalName(
    allFiles: AcpFile[],
    originalName: string,
  ): AcpFile | undefined {
    return allFiles.find(
      (f) =>
        f.originalName === originalName ||
        f.originalName === `${originalName}.json`,
    );
  }

  /**
   * Extract display text from valueAsText field.
   * Can be: [{"lang":"de","value":"..."}] or {"lang":"de","value":"..."} or string
   */
  private extractValueText(valueAsText: any): string {
    return extractValueText(valueAsText);
  }
}
