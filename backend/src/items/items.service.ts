import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Acp, AcpAccessConfig, AccessModel } from "../database/entities";
import { UnitParserService, VomdItemData } from "../files/unit-parser.service";
import { getIndexUnits } from "../acp/acp-index.utils";
import { normalizeFeatureConfig } from "../acp/feature-config.utils";
import { ItemParameterImportPipeline } from "./item-parameter-import.pipeline";

const SHOW_ONLY_ITEMS_WITH_EMPIRICAL_DIFFICULTY_KEY =
  "showOnlyItemsWithEmpiricalDifficulty";

export interface ItemData {
  itemId: string;
  uuid?: string;
  rowKey?: string;
  rowNumber?: number;
  subId?: string;
  subIdDisplay?: string;
  unitId: string;
  unitName: string;
  name: string;
  variableId?: string;
  sourceVariable?: string;
  variableReadOnlyId?: string;
  metadata?: Record<string, any>;
  empiricalDifficulty?: number;
  bista?: number;
  infit?: number;
  discrimination?: number;
  solutionRate?: number;
  textComplexity?: string;
  competenceLevel?: string;
  itemTimeSeconds?: number;
  stimulusTimeSeconds?: number;
  bookletOccurrences?: Array<{ booklet: string; position: number | null }>;
  tags?: string[];
}

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    private readonly unitParserService: UnitParserService,
    private readonly itemParameterImportPipeline: ItemParameterImportPipeline,
  ) {}

  /**
   * Extract all items from ACP-Index.
   */
  async getItems(acpId: string): Promise<ItemData[]> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) return [];

    const index = acp.acpIndex as any;
    const units = getIndexUnits(index);
    const items: ItemData[] = [];
    const parsedItemList =
      await this.unitParserService.getItemListFromFiles(acpId);
    const fileRowsByItem = new Map<string, VomdItemData[]>();
    for (const fileRow of parsedItemList?.items || []) {
      const key = `${fileRow.unitId}\u0000${fileRow.itemId}`;
      const rows = fileRowsByItem.get(key) || [];
      rows.push(fileRow);
      fileRowsByItem.set(key, rows);
    }

    for (const unit of units) {
      for (const item of unit.items || []) {
        const itemId =
          item.useUnitAliasAsPrefix !== false
            ? `${unit.id}_${item.id}`
            : item.id;
        const fileRows =
          fileRowsByItem.get(`${unit.id}\u0000${item.id}`) ||
          fileRowsByItem.get(`${unit.id}\u0000${itemId}`) ||
          [];

        if (fileRows.length) {
          for (const fileRow of fileRows) {
            items.push({
              itemId,
              uuid: fileRow.uuid,
              rowKey: fileRow.rowKey,
              rowNumber: fileRow.rowNumber,
              subId: fileRow.subId,
              subIdDisplay: fileRow.subIdDisplay,
              unitId: unit.id,
              unitName: unit.name,
              name: item.name || fileRow.description || item.id,
              variableId: fileRow.variableId || item.variableId,
              sourceVariable: fileRow.sourceVariable || item.sourceVariable,
              variableReadOnlyId:
                fileRow.variableReadOnlyId || item.variableReadOnlyId,
              metadata: {
                ...(item.metadata || {}),
                ...(fileRow.metadata || {}),
              },
              empiricalDifficulty: fileRow.empiricalDifficulty,
              bista: fileRow.bista,
              infit: fileRow.infit,
              discrimination: fileRow.discrimination,
              solutionRate: fileRow.solutionRate,
              textComplexity: fileRow.textComplexity,
              competenceLevel: fileRow.competenceLevel,
              itemTimeSeconds: fileRow.itemTimeSeconds,
              stimulusTimeSeconds: fileRow.stimulusTimeSeconds,
              bookletOccurrences: fileRow.bookletOccurrences,
              tags: fileRow.tags || [],
            });
          }
          continue;
        }

        const props = acp.itemProperties?.[itemId] || {};

        items.push({
          itemId,
          unitId: unit.id,
          unitName: unit.name,
          name: item.name || item.id,
          variableId: item.variableId,
          sourceVariable: item.sourceVariable,
          variableReadOnlyId: item.variableReadOnlyId,
          metadata: item.metadata,
          empiricalDifficulty: props.empiricalDifficulty,
          ...(this.toFiniteNumber(props.bista) !== undefined
            ? { bista: this.toFiniteNumber(props.bista) }
            : {}),
          ...(this.toFiniteNumber(props.infit) !== undefined
            ? { infit: this.toFiniteNumber(props.infit) }
            : {}),
          ...(this.toFiniteNumber(props.discrimination) !== undefined
            ? { discrimination: this.toFiniteNumber(props.discrimination) }
            : {}),
          ...(this.toFiniteNumber(props.solutionRate) !== undefined
            ? { solutionRate: this.toFiniteNumber(props.solutionRate) }
            : {}),
          ...(this.toNonEmptyText(props.textComplexity) !== undefined
            ? { textComplexity: this.toNonEmptyText(props.textComplexity) }
            : {}),
          ...(this.toNonEmptyText(props.competenceLevel) !== undefined
            ? {
                competenceLevel: this.toNonEmptyText(props.competenceLevel),
              }
            : {}),
          ...(this.toFiniteNumber(props.itemTimeSeconds) !== undefined
            ? { itemTimeSeconds: this.toFiniteNumber(props.itemTimeSeconds) }
            : {}),
          ...(this.toFiniteNumber(props.stimulusTimeSeconds) !== undefined
            ? {
                stimulusTimeSeconds: this.toFiniteNumber(
                  props.stimulusTimeSeconds,
                ),
              }
            : {}),
          ...(this.normalizeBookletOccurrences(props.bookletOccurrences).length
            ? {
                bookletOccurrences: this.normalizeBookletOccurrences(
                  props.bookletOccurrences,
                ),
              }
            : {}),
          tags: Array.isArray(props.tags) ? props.tags : [],
        });
      }
    }

    return items;
  }

  /**
   * Get a single item by ID.
   */
  async getItem(acpId: string, itemId: string): Promise<ItemData | null> {
    const items = await this.getItems(acpId);
    return items.find((i) => i.itemId === itemId) || null;
  }

  /**
   * Get items filtered and sorted.
   */
  async getFilteredItems(
    acpId: string,
    filter?: string,
    sortBy?: string,
    sortDir?: "asc" | "desc",
  ): Promise<ItemData[]> {
    let items = await this.getItems(acpId);

    if (filter) {
      const term = filter.toLowerCase();
      items = items.filter(
        (i) =>
          i.itemId.toLowerCase().includes(term) ||
          i.name.toLowerCase().includes(term) ||
          i.unitId.toLowerCase().includes(term),
      );
    }

    if (sortBy) {
      items.sort((a: any, b: any) => {
        const aVal = (a[sortBy] || "").toString().toLowerCase();
        const bVal = (b[sortBy] || "").toString().toLowerCase();
        const cmp = aVal.localeCompare(bVal);
        return sortDir === "desc" ? -cmp : cmp;
      });
    }

    return items;
  }

  /**
   * Upload empirical item difficulties from a CSV buffer.
   */
  async uploadEmpiricalDifficulties(
    acpId: string,
    fileBuffer: Buffer,
    options: {
      persist?: boolean;
      itemPropertiesOverride?: Record<string, Record<string, unknown>>;
      confirmWarnings?: boolean;
    } = {},
  ) {
    return this.uploadItemParameters(acpId, fileBuffer, {
      ...options,
      requireEmpiricalDifficulty: true,
    });
  }

  /**
   * Upload empirical values and additional item parameters from a wide CSV.
   * Rows that share an item/Sub-ID are grouped so booklet occurrences remain
   * a 1:n property of one stable Explorer row.
   */
  async uploadItemParameters(
    acpId: string,
    fileBuffer: Buffer,
    options: {
      persist?: boolean;
      itemPropertiesOverride?: Record<string, Record<string, unknown>>;
      requireEmpiricalDifficulty?: boolean;
      confirmWarnings?: boolean;
    } = {},
  ) {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) throw new NotFoundException("AP not found");

    const itemList = await this.unitParserService.getItemListFromFiles(acpId);
    const result = this.itemParameterImportPipeline.execute({
      fileBuffer,
      items: itemList.items || [],
      itemProperties:
        options.itemPropertiesOverride || acp.itemProperties || {},
      requireEmpiricalDifficulty: options.requireEmpiricalDifficulty,
      confirmWarnings: options.confirmWarnings,
    });

    if (
      result.updated > 0 &&
      result.requiresConfirmation !== true &&
      options.persist !== false
    ) {
      acp.itemProperties = result.nextItemProperties;
      await this.acpRepository.save(acp);
    }

    return result;
  }

  private toFiniteNumber(value: unknown): number | undefined {
    const numberValue = Number(value);
    return value === undefined ||
      value === null ||
      !Number.isFinite(numberValue)
      ? undefined
      : numberValue;
  }

  private toNonEmptyText(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text || undefined;
  }

  private normalizeBookletOccurrences(
    value: unknown,
  ): Array<{ booklet: string; position: number | null }> {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        const booklet =
          entry && typeof entry === "object" && "booklet" in entry
            ? String((entry as { booklet?: unknown }).booklet || "").trim()
            : "";
        const rawPosition =
          entry && typeof entry === "object" && "position" in entry
            ? (entry as { position?: unknown }).position
            : null;
        const position =
          rawPosition === null ||
          rawPosition === undefined ||
          rawPosition === ""
            ? null
            : Number(rawPosition);
        return { booklet, position };
      })
      .filter(
        (entry) =>
          entry.booklet.length > 0 &&
          (entry.position === null ||
            (Number.isInteger(entry.position) && entry.position > 0)),
      )
      .sort((left, right) => {
        const bookletComparison = left.booklet.localeCompare(
          right.booklet,
          "de",
          { numeric: true },
        );
        if (bookletComparison) return bookletComparison;
        if (left.position === right.position) return 0;
        if (left.position === null) return 1;
        if (right.position === null) return -1;
        return left.position - right.position;
      });
  }

  /**
   * Clears all empirical item difficulties from the database
   */
  async clearEmpiricalDifficulties(
    acpId: string,
    options: {
      persist?: boolean;
      itemPropertiesOverride?: Record<string, Record<string, unknown>>;
    } = {},
  ) {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) throw new NotFoundException("AP not found");

    const props = this.cloneItemProperties(
      options.itemPropertiesOverride || acp.itemProperties || {},
    );
    let isUpdated = false;

    for (const key of Object.keys(props)) {
      if (props[key].empiricalDifficulty !== undefined) {
        delete props[key].empiricalDifficulty;
        isUpdated = true;
      }
    }

    if (isUpdated && options.persist !== false) {
      acp.itemProperties = props;
      await this.acpRepository.save(acp);
    }

    return { success: true, nextItemProperties: props };
  }

  async getItemTags(acpId: string): Promise<Record<string, string[]>> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) throw new NotFoundException("AP not found");
    return this.extractTags(acp.itemProperties || {});
  }

  async canUseItemTags(acpId: string): Promise<boolean> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    const featureConfig = (config?.featureConfig || {}) as Record<
      string,
      unknown
    >;
    return Boolean(featureConfig.enableItemListTags);
  }

  async canUseItemList(acpId: string): Promise<boolean> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    const featureConfig = (config?.featureConfig || {}) as Record<
      string,
      unknown
    >;
    return featureConfig.enableItemList !== false;
  }

  async ensureShowOnlyItemsWithEmpiricalDifficulty(
    acpId: string,
  ): Promise<boolean> {
    let config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });

    if (!config) {
      config = this.accessConfigRepository.create({
        acpId,
        accessModel: AccessModel.PRIVATE,
        allowRegistered: false,
        featureConfig: normalizeFeatureConfig({
          [SHOW_ONLY_ITEMS_WITH_EMPIRICAL_DIFFICULTY_KEY]: true,
        }),
      });
      await this.accessConfigRepository.save(config);
      return true;
    }

    const normalizedFeatureConfig = normalizeFeatureConfig(
      config.featureConfig || {},
    ) as Record<string, unknown>;
    const currentValue =
      normalizedFeatureConfig[SHOW_ONLY_ITEMS_WITH_EMPIRICAL_DIFFICULTY_KEY];

    if (currentValue === false) {
      if (
        JSON.stringify(config.featureConfig || {}) !==
        JSON.stringify(normalizedFeatureConfig)
      ) {
        config.featureConfig = normalizedFeatureConfig;
        await this.accessConfigRepository.save(config);
      }
      return false;
    }

    if (currentValue === true) {
      if (
        JSON.stringify(config.featureConfig || {}) !==
        JSON.stringify(normalizedFeatureConfig)
      ) {
        config.featureConfig = normalizedFeatureConfig;
        await this.accessConfigRepository.save(config);
      }
      return true;
    }

    normalizedFeatureConfig[SHOW_ONLY_ITEMS_WITH_EMPIRICAL_DIFFICULTY_KEY] =
      true;
    config.featureConfig = normalizedFeatureConfig;
    await this.accessConfigRepository.save(config);
    return true;
  }

  private extractTags(
    itemProperties: Record<string, Record<string, any>>,
  ): Record<string, string[]> {
    const tags: Record<string, string[]> = {};
    for (const [itemId, props] of Object.entries(itemProperties || {})) {
      if (!Array.isArray(props?.tags)) continue;
      const normalized = this.normalizeTagArray(props.tags);
      tags[itemId] = normalized;
    }
    return tags;
  }

  private normalizeTagArray(values: unknown[]): string[] {
    const clean = values
      .map((v) => String(v || "").trim())
      .filter((v) => v.length > 0);
    return Array.from(new Set(clean));
  }

  private cloneItemProperties(
    source: Record<string, Record<string, unknown>>,
  ): Record<string, Record<string, unknown>> {
    return JSON.parse(JSON.stringify(source || {}));
  }
}
