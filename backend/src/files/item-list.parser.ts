import { ConflictException, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import { performance } from "perf_hooks";
import type { AcpFile } from "../database/entities";
import {
  buildItemRowKey,
  parseItemRowKeyParts,
} from "../items/item-row-key.util";
import { calculateMeanTaskDifficultyByUnit } from "../items/mean-task-difficulty";
import type {
  ItemListResult,
  MetadataColumn,
  VomdItemData,
  StudioItemComment,
} from "./unit-parser.types";
import { parseStudioItemComments } from "./studio-item-comments";
import { AsyncCacheStatus, AsyncLruCache } from "./async-lru-cache";
import {
  extractLabelText,
  extractValueText,
  extractVomdTimeSeconds,
  isValidVomdItem,
  parseUnitXml,
  parseVomd,
} from "./unit-file-parsing";

export interface ItemListParseContext {
  allFiles: AcpFile[];
  itemProps: Record<string, Record<string, unknown>>;
  itemPropertiesSignature?: string;
  normalizedFeatureConfig: Record<string, unknown>;
  sourceFileSignature: string;
}

export interface ItemListParseResult {
  itemList: ItemListResult;
  sourceFileSignature: string;
  cacheIdentity: string;
  cacheStatus: AsyncCacheStatus;
  parseMs: number;
  cacheable: boolean;
}

type CachedItemListParseResult = Omit<ItemListParseResult, "cacheStatus">;

interface PartialCreditRow {
  rowKey: string;
  subId: string;
  properties: Record<string, unknown>;
}

@Injectable()
export class ItemListParser {
  private readonly logger = new Logger(ItemListParser.name);
  private readonly cache = new AsyncLruCache<string, CachedItemListParseResult>(
    100,
  );

  get size(): number {
    return this.cache.size;
  }

  async parse(
    acpId: string,
    context: ItemListParseContext,
    strictSourceReads = false,
  ): Promise<ItemListParseResult> {
    const cacheIdentity = this.buildCacheKey(acpId, context);
    if (strictSourceReads) {
      const parsed = await this.parseContext(context, true);
      return {
        ...parsed,
        cacheIdentity,
        cacheStatus: "miss",
      };
    }

    const { value, status } = await this.cache.getOrLoad(
      cacheIdentity,
      async () => ({
        ...(await this.parseContext(context, false)),
        cacheIdentity,
      }),
      { shouldCache: (parsed) => parsed.cacheable },
    );
    return {
      ...value,
      itemList: structuredClone(value.itemList),
      cacheStatus: status,
      parseMs: status === "hit" ? 0 : value.parseMs,
    };
  }

  invalidate(acpId: string): void {
    this.cache.deleteWhere((key) => key.startsWith(`${acpId}:`));
  }

  private async parseContext(
    context: ItemListParseContext,
    strictSourceReads: boolean,
  ): Promise<Omit<CachedItemListParseResult, "cacheIdentity">> {
    const parseStartedAt = performance.now();
    const {
      allFiles,
      itemProps,
      normalizedFeatureConfig,
      sourceFileSignature,
    } = context;
    const subIdLabel = String(
      normalizedFeatureConfig.itemSubIdLabel || "Sub-ID",
    );
    const subIdLabels = this.asStringMap(
      normalizedFeatureConfig.itemSubIdLabels,
    );
    const partialRowsByItemUuid = this.indexPartialCreditRows(itemProps);
    const columnMap = new Map<string, string>();
    const items: VomdItemData[] = [];
    const unitMetadata: Record<string, any[]> = {};
    const codingSchemes: Record<string, any> = {};
    const variableIdentityCollisions: ItemListResult["variableIdentityConsistency"]["collisions"] =
      [];
    let checkedVariableIdentityItemCount = 0;
    let cacheable = true;

    const xmlFiles = allFiles.filter(
      (file) =>
        file.originalName.toLowerCase().endsWith(".xml") &&
        !file.originalName.toLowerCase().startsWith("booklet") &&
        !file.originalName.toLowerCase().startsWith("testtaker"),
    );

    for (const xmlFile of xmlFiles) {
      try {
        const xmlContent = await fs.readFile(xmlFile.filePath, "utf-8");
        if (!xmlContent.includes("<Unit")) continue;

        const parsed = parseUnitXml(
          xmlContent,
          xmlFile.originalName,
          this.logger,
        );
        if (!parsed || !parsed.unitId.trim()) {
          if (strictSourceReads) {
            throw new ConflictException(
              `Invalid unit XML file: ${xmlFile.originalName}`,
            );
          }
          cacheable = false;
          continue;
        }

        const vomdFileName = parsed.metadataRef;
        if (!vomdFileName) continue;
        const vomdFile = allFiles.find(
          (file) =>
            file.originalName === vomdFileName ||
            file.originalName === `${vomdFileName}.json`,
        );
        if (!vomdFile) {
          if (strictSourceReads) {
            throw new ConflictException(
              `Referenced item metadata file is missing: ${vomdFileName}`,
            );
          }
          cacheable = false;
          continue;
        }

        const vomdContent = await fs.readFile(vomdFile.filePath, "utf-8");
        const vomdData = parseVomd(vomdContent, strictSourceReads, this.logger);
        if (!vomdData) {
          if (strictSourceReads) {
            throw new ConflictException(
              `Invalid item metadata file: ${vomdFile.originalName}`,
            );
          }
          cacheable = false;
          continue;
        }

        if (vomdData.unitProfiles.length > 0) {
          const entries = vomdData.unitProfiles[0]?.entries;
          unitMetadata[parsed.unitId] = Array.isArray(entries) ? entries : [];
        }
        const vomdStimulusTimeSeconds = extractVomdTimeSeconds(
          vomdData.unitProfiles,
          "iqb_time_stimulus",
        );

        if (parsed.codingSchemeRef) {
          const vocsFile = allFiles.find(
            (file) => file.originalName === parsed.codingSchemeRef,
          );
          if (vocsFile) {
            try {
              const vocsContent = await fs.readFile(vocsFile.filePath, "utf-8");
              codingSchemes[parsed.unitId] = JSON.parse(vocsContent);
            } catch {
              cacheable = false;
              this.logger.warn(
                `Could not parse coding scheme ${parsed.codingSchemeRef}`,
              );
            }
          } else {
            cacheable = false;
          }
        }

        let studioComments = new Map<string, StudioItemComment[]>();
        if (
          normalizedFeatureConfig.showStudioItemComments === true &&
          parsed.commentsRef
        ) {
          const commentsFile = allFiles.find(
            (file) => file.originalName === parsed.commentsRef,
          );
          if (commentsFile) {
            try {
              studioComments = parseStudioItemComments(
                await fs.readFile(commentsFile.filePath, "utf-8"),
              );
            } catch {
              cacheable = false;
              this.logger.warn(
                `Could not parse Studio comments ${parsed.commentsRef}`,
              );
            }
          } else {
            cacheable = false;
            this.logger.warn(
              `Referenced Studio comments file is missing: ${parsed.commentsRef}`,
            );
          }
        }

        for (const item of vomdData.items) {
          if (!isValidVomdItem(item)) {
            cacheable = false;
            this.logger.warn(
              `Skipping invalid item metadata in ${vomdFile.originalName}`,
            );
            continue;
          }
          const metadata: Record<string, string> = {};
          const vomdItemTimeSeconds =
            extractVomdTimeSeconds(item.profiles, "iqb_time_item") ??
            extractVomdTimeSeconds(item.profiles, "iqb_item_time");
          for (const profile of item.profiles || []) {
            for (const entry of profile.entries || []) {
              const entryId = entry.id;
              const label = extractLabelText(entry.label);
              const value = extractValueText(entry.valueAsText);
              if (entryId && label) columnMap.set(entryId, label);
              if (entryId) metadata[entryId] = value;
            }
          }

          const resolvedItemId =
            item.useUnitAliasAsPrefix === false
              ? item.id
              : `${parsed.unitId}_${item.id}`;
          const variableId = String(item.variableId || "").trim();
          const sourceVariable = String(item.sourceVariable || "").trim();
          const variableReadOnlyId = String(
            item.variableReadOnlyId || "",
          ).trim();
          if (variableReadOnlyId) {
            const codingVariables = Array.isArray(
              codingSchemes[parsed.unitId]?.variableCodings,
            )
              ? codingSchemes[parsed.unitId].variableCodings
              : Array.isArray(codingSchemes[parsed.unitId])
                ? codingSchemes[parsed.unitId]
                : [];
            const exactVariables = codingVariables.filter(
              (variable: any) =>
                String(variable?.id || "")
                  .trim()
                  .toLowerCase() === variableReadOnlyId.toLowerCase(),
            );
            const exactVariable =
              exactVariables.length === 1 ? exactVariables[0] : undefined;
            if (exactVariable) checkedVariableIdentityItemCount += 1;
            const legacyReference = sourceVariable || variableId;
            const legacyVariable = codingVariables.find((variable: any) =>
              [variable?.id, variable?.alias].some(
                (identifier) =>
                  String(identifier || "")
                    .trim()
                    .toLowerCase() === legacyReference.toLowerCase(),
              ),
            );
            if (
              legacyReference &&
              exactVariable &&
              legacyVariable &&
              exactVariable !== legacyVariable
            ) {
              variableIdentityCollisions.push({
                unitId: parsed.unitId,
                itemId: item.id,
                variableId,
                variableReadOnlyId,
                resolvedVariableId: String(exactVariable.id || "").trim(),
                legacyResolvedVariableId: String(
                  legacyVariable.id || "",
                ).trim(),
              });
            }
          }
          const itemUuid = item.uuid || `${parsed.unitId}_${item.id}`;
          const baseProperties = this.resolveItemProperties(itemProps, [
            itemUuid,
            resolvedItemId,
            item.id,
          ]);
          const partialRows = partialRowsByItemUuid.get(itemUuid) || [];
          const explorerRows = partialRows.length
            ? partialRows
            : [
                {
                  rowKey: buildItemRowKey(itemUuid),
                  subId: "",
                  properties: baseProperties,
                },
              ];

          for (const explorerRow of explorerRows) {
            const rowProperties = {
              ...baseProperties,
              ...explorerRow.properties,
            };
            const empiricalDifficultyRaw = rowProperties.empiricalDifficulty;
            const empiricalDifficulty =
              empiricalDifficultyRaw === undefined ||
              empiricalDifficultyRaw === null ||
              !Number.isFinite(Number(empiricalDifficultyRaw))
                ? undefined
                : Number(empiricalDifficultyRaw);
            const optionalNumber = (property: string): number | undefined => {
              const rawValue = rowProperties[property];
              if (rawValue === undefined || rawValue === null) return undefined;
              const value = Number(rawValue);
              return Number.isFinite(value) ? value : undefined;
            };
            const optionalText = (property: string): string | undefined => {
              const rawValue = rowProperties[property];
              if (rawValue === undefined || rawValue === null) return undefined;
              const value = String(rawValue).trim();
              return value || undefined;
            };
            const bookletOccurrences = Array.isArray(
              rowProperties.bookletOccurrences,
            )
              ? rowProperties.bookletOccurrences
                  .map((rawOccurrence) => {
                    const occurrence =
                      rawOccurrence && typeof rawOccurrence === "object"
                        ? (rawOccurrence as Record<string, unknown>)
                        : {};
                    return {
                      booklet: String(occurrence.booklet || "").trim(),
                      position:
                        occurrence.position === null ||
                        occurrence.position === undefined ||
                        occurrence.position === ""
                          ? null
                          : Number(occurrence.position),
                    };
                  })
                  .filter(
                    (occurrence) =>
                      occurrence.booklet.length > 0 &&
                      (occurrence.position === null ||
                        (Number.isInteger(occurrence.position) &&
                          occurrence.position > 0)),
                  )
                  .sort((left, right) => {
                    const bookletComparison = left.booklet.localeCompare(
                      right.booklet,
                      "de",
                      {
                        numeric: true,
                      },
                    );
                    if (bookletComparison) return bookletComparison;
                    if (left.position === right.position) return 0;
                    if (left.position === null) return 1;
                    if (right.position === null) return -1;
                    return left.position - right.position;
                  })
              : [];

            items.push({
              itemId: item.id,
              uuid: itemUuid,
              rowKey: explorerRow.rowKey,
              rowNumber: 0,
              subId: explorerRow.subId || undefined,
              subIdDisplay: explorerRow.subId
                ? subIdLabels[explorerRow.subId] || explorerRow.subId
                : undefined,
              unitId: parsed.unitId,
              unitLabel: parsed.unitLabel,
              description: item.description || "",
              variableId,
              sourceVariable: sourceVariable || undefined,
              variableReadOnlyId: variableReadOnlyId || undefined,
              useUnitAliasAsPrefix: item.useUnitAliasAsPrefix,
              metadata: { ...metadata },
              ...(studioComments.has(itemUuid)
                ? { studioComments: studioComments.get(itemUuid) }
                : {}),
              empiricalDifficulty,
              bista: optionalNumber("bista"),
              infit: optionalNumber("infit"),
              discrimination: optionalNumber("discrimination"),
              solutionRate: optionalNumber("solutionRate"),
              textComplexity: optionalText("textComplexity"),
              competenceLevel: optionalText("competenceLevel"),
              itemTimeSeconds:
                optionalNumber("itemTimeSeconds") ?? vomdItemTimeSeconds,
              stimulusTimeSeconds:
                optionalNumber("stimulusTimeSeconds") ??
                vomdStimulusTimeSeconds,
              bookletOccurrences,
              tags: Array.isArray(rowProperties.tags)
                ? rowProperties.tags.map(String)
                : [],
            });
          }
        }
      } catch (error) {
        this.logger.error(`Error processing ${xmlFile.originalName}: ${error}`);
        if (strictSourceReads) {
          if (error instanceof ConflictException) throw error;
          throw new ConflictException(
            "The ACP source files changed while row numbers were being recalculated",
          );
        }
        cacheable = false;
      }
    }

    const meanTaskDifficultyByUnit = calculateMeanTaskDifficultyByUnit(items);
    for (const item of items) {
      item.meanTaskDifficulty = meanTaskDifficultyByUnit.get(item.unitId);
    }
    const columns: MetadataColumn[] = Array.from(columnMap.entries()).map(
      ([id, label]) => ({ id, label }),
    );

    return {
      itemList: {
        columns,
        items,
        subIdLabel,
        subIdLabels,
        unitMetadata,
        codingSchemes,
        variableIdentityConsistency: {
          checkedItemCount: checkedVariableIdentityItemCount,
          collisionCount: variableIdentityCollisions.length,
          collisions: variableIdentityCollisions,
        },
      },
      sourceFileSignature,
      parseMs: performance.now() - parseStartedAt,
      cacheable,
    };
  }

  private buildCacheKey(acpId: string, context: ItemListParseContext): string {
    return `${acpId}:${this.hashCanonicalValue({
      files: context.sourceFileSignature,
      itemProperties: context.itemPropertiesSignature
        ? { version: context.itemPropertiesSignature }
        : { value: context.itemProps },
      itemSubIdLabel:
        context.normalizedFeatureConfig.itemSubIdLabel || "Sub-ID",
      itemSubIdLabels: context.normalizedFeatureConfig.itemSubIdLabels || {},
      showStudioItemComments:
        context.normalizedFeatureConfig.showStudioItemComments === true,
    })}`;
  }

  private hashCanonicalValue(value: unknown): string {
    return createHash("sha256")
      .update(this.canonicalStringify(value))
      .digest("hex");
  }

  private canonicalStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.canonicalStringify(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.canonicalStringify(record[key])}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  }

  private resolveItemProperties(
    itemProperties: Record<string, Record<string, unknown>>,
    candidates: string[],
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const candidate of [...candidates].reverse()) {
      const value = itemProperties[candidate];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(merged, value);
      }
    }
    return merged;
  }

  private indexPartialCreditRows(
    itemProperties: Record<string, Record<string, unknown>>,
  ): Map<string, PartialCreditRow[]> {
    const indexed = new Map<string, PartialCreditRow[]>();
    for (const [rowKey, rawProperties] of Object.entries(itemProperties)) {
      const parts = parseItemRowKeyParts(rowKey);
      if (
        !parts ||
        !rawProperties ||
        typeof rawProperties !== "object" ||
        Array.isArray(rawProperties)
      ) {
        continue;
      }
      const rows = indexed.get(parts.itemUuid) || [];
      rows.push({
        rowKey,
        subId: parts.subId,
        properties: rawProperties,
      });
      indexed.set(parts.itemUuid, rows);
    }
    return indexed;
  }

  private asStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const normalized: Record<string, string> = {};
    for (const [key, label] of Object.entries(value)) {
      if (typeof label === "string" && key.trim() && label.trim()) {
        normalized[key.trim()] = label.trim();
      }
    }
    return normalized;
  }
}
