import { ReviewerColumnPolicy } from "../item-explorer/reviewer-column-policy";
import { ReviewManifestService } from "../review/review-manifest.service";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  Acp,
  AcpAccessConfig,
  AccessModel,
  AcpFile,
  AppSettings,
  AcpItemPreference,
} from "../database/entities";
import {
  findUnitInIndex,
  findUnitInPart,
  findUnitsInIndex,
  getAssessmentParts,
  getIndexUnits,
  toRuntimeAcpIndex,
} from "../acp/acp-index.utils";
import { normalizeFeatureConfig } from "../acp/feature-config.utils";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { UnitParserService, VomdItemData } from "../files/unit-parser.service";
import {
  buildPatchPersonalItemPreferenceRowQuery,
  PreferenceIdentityColumn,
} from "./personal-item-preferences.query";
import { StablePreferenceIdentity } from "../item-preferences/preference-identity";
import {
  ItemPreferencesPayload,
  normalizeItemPreferenceRowData,
  normalizeItemPreferences,
} from "../item-preferences/item-preference-normalizer";
import {
  getItemExportCell,
  ITEM_EXPORT_IDENTITY_COLUMNS,
  ITEM_EXPORT_IDENTITY_WITH_UUID_COLUMNS,
  ITEM_EXPORT_PARAMETER_COLUMNS,
  ItemExportProjection,
  MEAN_DIFFICULTY_EXPORT_COLUMN,
  projectItemExportRow,
} from "../item-explorer/item-export-projection";
import { SimpleItemListEntryDto } from "./dto/simple-item-list-entry.dto";
import {
  projectSimpleItemListEntry,
  simpleItemListKey,
} from "./simple-item-list-projection";

const MAX_PERSONAL_ITEM_ROWS = 10_000;
const MAX_EXPORT_ROW_KEY_LENGTH = 500;

export type { ItemPreferencesPayload } from "../item-preferences/item-preference-normalizer";

@Injectable()
export class ViewsService {
  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(AppSettings)
    private readonly settingsRepository: Repository<AppSettings>,
    @InjectRepository(AcpItemPreference)
    private readonly itemPreferenceRepository: Repository<AcpItemPreference>,
    private readonly itemExplorerStateService: ItemExplorerStateService,
    private readonly unitParserService: UnitParserService,
    private readonly reviewManifestService: ReviewManifestService,
  ) {}

  /**
   * Get public-facing app settings (no auth required).
   */
  async getPublicSettings(): Promise<any> {
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (!settings) {
      return {
        theme: {},
        language: "de",
        logoUrl: null,
        landingPageHtml: null,
        imprintHtml: null,
        privacyHtml: null,
        accessibilityHtml: null,
      };
    }
    return {
      theme: settings.theme,
      language: settings.language,
      logoUrl: settings.logoUrl,
      landingPageHtml: settings.landingPageHtml,
      imprintHtml: settings.imprintHtml,
      privacyHtml: settings.privacyHtml,
      accessibilityHtml: settings.accessibilityHtml,
    };
  }

  /**
   * Get list of publicly accessible ACPs for the landing page.
   */
  async getPublicAcps(): Promise<any[]> {
    const publicConfigs = await this.accessConfigRepository.find({
      where: { accessModel: AccessModel.PUBLIC },
      relations: ["acp"],
    });
    const credentialConfigs = await this.accessConfigRepository.find({
      where: { accessModel: AccessModel.CREDENTIALS_LIST },
      relations: ["acp"],
    });
    const now = new Date();
    const activeCredentialConfigs = credentialConfigs.filter((cfg) => {
      const startsOk = !cfg.validFrom || cfg.validFrom <= now;
      const endsOk = !cfg.validUntil || cfg.validUntil >= now;
      return startsOk && endsOk;
    });

    console.log(
      "[DEBUG] getPublicAcps - PUBLIC configs:",
      publicConfigs.length,
    );
    console.log(
      "[DEBUG] getPublicAcps - CREDENTIALS_LIST configs:",
      credentialConfigs.length,
    );
    console.log(
      "[DEBUG] getPublicAcps - active CREDENTIALS_LIST configs:",
      activeCredentialConfigs.length,
    );
    for (const cfg of activeCredentialConfigs) {
      console.log("[DEBUG] Credential config:", {
        id: cfg.id,
        acpId: cfg.acpId,
        acpName: cfg.acp?.name,
        accessModel: cfg.accessModel,
        validFrom: cfg.validFrom,
        validUntil: cfg.validUntil,
      });
    }

    const results: any[] = [];
    const seenIds = new Set<string>();

    for (const config of publicConfigs) {
      if (config.acp) {
        results.push({
          id: config.acp.id,
          name: config.acp.name,
          description: config.acp.description,
          accessModel: "PUBLIC",
        });
        seenIds.add(config.acp.id);
      }
    }

    // Include credential-based ACPs (they are listed on landing page too)
    for (const config of activeCredentialConfigs) {
      if (seenIds.has(config.acpId)) continue;
      if (config.acp) {
        results.push({
          id: config.acp.id,
          name: config.acp.name,
          description: config.acp.description,
          accessModel: "CREDENTIALS_LIST",
          requiresLogin: true,
        });
        seenIds.add(config.acp.id);
      }
    }

    console.log("[DEBUG] getPublicAcps - final results:", results.length);
    return results;
  }

  /**
   * Get ACP start page data.
   */
  async getAcpStartPage(acpId: string): Promise<any> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) return null;

    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });

    const featureConfig = normalizeFeatureConfig(config?.featureConfig || {});
    const index = toRuntimeAcpIndex(acp.acpIndex);

    // Extract units from ACP-Index
    const assessmentParts = getAssessmentParts(index);
    const units = assessmentParts.length
      ? assessmentParts.flatMap((part: any) =>
          (Array.isArray(part?.units) ? part.units : []).map((unit: any) => ({
            id: unit.id,
            partId: part.id,
            name: unit.name,
            description: unit.description,
          })),
        )
      : getIndexUnits(index).map((unit: any) => ({
          id: unit.id,
          name: unit.name,
          description: unit.description,
        }));

    // Sequence model: one sequence equals one booklet module.
    const sequenceMap = new Map<string, any>();
    for (const part of assessmentParts) {
      const modulesById = new Map<string, any>();
      for (const module of part.bookletModules || []) {
        if (!module?.id || typeof module.id !== "string") continue;
        modulesById.set(module.id, module);
        if (!sequenceMap.has(module.id)) {
          sequenceMap.set(module.id, {
            id: module.id,
            name: module.name || module.id,
          });
        }
      }

      for (const instrument of part.instruments || []) {
        for (const booklet of instrument.testcenterBooklet || []) {
          for (const moduleRef of booklet.modules || []) {
            const moduleId = this.getModuleReferenceId(moduleRef);
            if (!moduleId) continue;

            const existing = sequenceMap.get(moduleId) || {};
            const module = modulesById.get(moduleId);

            sequenceMap.set(moduleId, {
              id: moduleId,
              name: module?.name || existing.name || moduleId,
              instrumentName: existing.instrumentName || instrument.name,
              bookletDefinitionId:
                existing.bookletDefinitionId ||
                (typeof booklet.definitionId === "string"
                  ? booklet.definitionId
                  : undefined),
            });
          }
        }
      }
    }
    const manifest = await this.reviewManifestService.getManifest(acpId);
    const booklets = manifest.booklets.filter((booklet) => !booklet.legacy);
    const definitions = new Set(
      booklets.map((booklet) => booklet.definitionId).filter(Boolean),
    );
    const assignedModuleIds = new Set(
      booklets.flatMap((booklet) => booklet.moduleIds || []),
    );
    const sequences = [
      ...booklets.map(({ id, name, definitionId }) => ({
        id,
        name,
        bookletDefinitionId: definitionId,
        kind: "booklet",
      })),
      ...Array.from(sequenceMap.values()).filter(
        (sequence) =>
          !definitions.has(sequence.bookletDefinitionId) &&
          !assignedModuleIds.has(sequence.id),
      ),
    ];

    return {
      id: acp.id,
      name: acp.name,
      description: acp.description,
      featureConfig,
      units,
      sequences,
    };
  }

  /**
   * Get full ACP-Index for read-only/public view routes.
   */
  async getAcpIndex(acpId: string): Promise<Record<string, unknown> | null> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) return null;
    return acp.acpIndex;
  }

  /**
   * Get unit view data including player reference.
   */
  async getUnitViewData(
    acpId: string,
    unitId: string,
    partId?: string,
  ): Promise<any> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) return null;

    const index = toRuntimeAcpIndex(acp.acpIndex);
    const matches = findUnitsInIndex(index, unitId);
    if (!partId && matches.length > 1) {
      throw new ConflictException({
        message: `Unit ${unitId} exists in multiple assessment parts`,
        possibleParts: matches.map((entry) => entry.partId),
      });
    }
    const unit = partId
      ? findUnitInPart(index, partId, unitId)
      : matches[0]?.unit || findUnitInIndex(index, unitId);
    if (!unit) return null;

    // Resolve file references
    const dependencies = unit.dependencies || [];
    const fileRefs: any[] = [];
    for (const dep of dependencies) {
      const file = await this.fileRepository.findOne({
        where: { acpId, relativePath: dep.id },
      });
      if (file) {
        fileRefs.push({
          type: dep.type,
          originalName: file.originalName,
          downloadUrl: `/api/acp/${acpId}/files/${file.id}/download`,
          fileId: file.id,
        });
      }
    }

    return {
      id: unit.id,
      ...(partId || matches[0]?.partId
        ? { partId: partId || matches[0]?.partId }
        : {}),
      name: unit.name,
      description: unit.description,
      lang: unit.lang,
      items: unit.items,
      dependencies: fileRefs,
      codingScheme: unit.codingScheme,
      richText: unit.richText,
    };
  }

  /**
   * Get all items across all units in an ACP.
   */
  async getItemList(
    acpId: string,
    canEditExplorerState = false,
  ): Promise<SimpleItemListEntryDto[]> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) return [];

    const index = toRuntimeAcpIndex(acp.acpIndex);
    const explorerState = await this.itemExplorerStateService.getStateForViewer(
      acpId,
      canEditExplorerState,
    );
    const parsedItemList = await this.unitParserService.getItemListFromFiles(
      acpId,
      {
        itemPropertiesOverride: explorerState.activeState.itemProperties,
        publishedItemPropertiesOverride:
          explorerState.publishedState.itemProperties,
      },
    );
    const meanDifficultyByItem = new Map<string, number>();
    for (const row of parsedItemList.items || []) {
      if (
        row.meanTaskDifficulty === undefined ||
        meanDifficultyByItem.has(simpleItemListKey(row.unitId, row.itemId))
      ) {
        continue;
      }
      meanDifficultyByItem.set(
        simpleItemListKey(row.unitId, row.itemId),
        row.meanTaskDifficulty,
      );
    }

    const items: SimpleItemListEntryDto[] = [];

    for (const unit of getIndexUnits(index)) {
      for (const item of unit.items || []) {
        const projectedItemId =
          item.useUnitAliasAsPrefix !== false
            ? `${unit.id}_${item.id}`
            : item.id;
        const meanTaskDifficulty =
          meanDifficultyByItem.get(simpleItemListKey(unit.id, item.id)) ??
          meanDifficultyByItem.get(simpleItemListKey(unit.id, projectedItemId));
        items.push(projectSimpleItemListEntry(unit, item, meanTaskDifficulty));
      }
    }

    return items;
  }

  /**
   * Get task sequence (ordered list of units from a booklet module).
   */
  async getTaskSequence(
    acpId: string,
    sequenceId: string,
    kind?: "booklet",
  ): Promise<any> {
    if (kind === "booklet") {
      const manifest = await this.reviewManifestService.getManifest(acpId);
      return (
        manifest.booklets.find(
          (entry) => !entry.legacy && entry.id === sequenceId,
        ) || null
      );
    }
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) return null;

    const index = toRuntimeAcpIndex(acp.acpIndex);
    const parts = getAssessmentParts(index);

    // Find the module
    for (const part of parts) {
      for (const module of part.bookletModules || []) {
        if (module.id === sequenceId) {
          const unitIds = [...(module.units || [])]
            .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
            .map((u: any) => u.id);

          const units = unitIds.map((uid: string) => {
            const unit = findUnitInIndex(index, uid);
            return unit
              ? { id: unit.id, name: unit.name }
              : { id: uid, name: uid };
          });

          return {
            id: module.id,
            name: module.name,
            units,
          };
        }
      }
    }

    return null;
  }

  async getItemPreferences(
    acpId: string,
    identity: StablePreferenceIdentity | null,
    viewId?: string,
  ): Promise<ItemPreferencesPayload> {
    const normalizedViewId = this.normalizeViewId(viewId);
    if (!identity) {
      if (normalizedViewId === "item-explorer") {
        throw new UnauthorizedException(
          "Authentication is required for personal item data",
        );
      }
      return { ui: {}, tags: {}, rowData: {} };
    }
    const record = await this.findPreferenceRecord(
      acpId,
      normalizedViewId,
      identity,
    );
    return normalizeItemPreferences(record?.preferences);
  }

  async saveItemPreferences(
    acpId: string,
    identity: StablePreferenceIdentity | null,
    preferences: Partial<ItemPreferencesPayload>,
    viewId?: string,
  ): Promise<ItemPreferencesPayload> {
    const normalized = normalizeItemPreferences(preferences);
    if (!identity) {
      return normalized;
    }

    const normalizedViewId = this.normalizeViewId(viewId);
    await this.upsertItemPreferences(
      acpId,
      normalizedViewId,
      identity,
      normalized,
    );
    return normalized;
  }

  async patchPersonalItemPreferenceRow(
    acpId: string,
    identity: StablePreferenceIdentity | null,
    rawRowKey: string,
    rawRowData: Record<string, unknown> | null,
    viewId = "item-explorer",
    canEditExplorerState = false,
  ): Promise<Pick<ItemPreferencesPayload, "rowData">> {
    const rowKey = String(rawRowKey || "").trim();
    if (!rowKey || rowKey.length > 500) {
      throw new BadRequestException("A valid item row key is required");
    }

    const normalizedRow = rawRowData
      ? normalizeItemPreferenceRowData({ [rowKey]: rawRowData })[rowKey] || null
      : null;
    if (!identity) {
      throw new UnauthorizedException(
        "A stable identity is required for personal item data",
      );
    }

    if (normalizedRow) {
      await this.assertKnownPersonalItemRow(
        acpId,
        rowKey,
        canEditExplorerState,
      );
    }

    const normalizedViewId = this.normalizeViewId(viewId);
    const identityColumn: PreferenceIdentityColumn =
      identity.kind === "user" ? "user_id" : "credential_id";
    const initialPreferences: ItemPreferencesPayload = {
      ui: {},
      tags: {},
      rowData: normalizedRow ? { [rowKey]: normalizedRow } : {},
    };
    const rowDataJson = normalizedRow ? JSON.stringify(normalizedRow) : null;

    const rows = await this.itemPreferenceRepository.query(
      buildPatchPersonalItemPreferenceRowQuery(identityColumn),
      [
        acpId,
        normalizedViewId,
        identity.kind === "user" ? identity.userId : null,
        identity.kind === "credential" ? identity.credentialId : null,
        identity.kind === "credential"
          ? identity.credentialUsername || null
          : null,
        JSON.stringify(initialPreferences),
        rowDataJson,
        rowKey,
        MAX_PERSONAL_ITEM_ROWS,
      ],
    );

    if (!rows[0]) {
      throw new BadRequestException(
        `Personal item data is limited to ${MAX_PERSONAL_ITEM_ROWS} rows`,
      );
    }

    return {
      rowData: normalizedRow ? { [rowKey]: normalizedRow } : {},
    };
  }

  async exportPersonalItemDataXlsx(
    acpId: string,
    identity: StablePreferenceIdentity | null,
    rawRowKeys: string[],
    canEditExplorerState = false,
    columnPolicy?: ReviewerColumnPolicy,
  ): Promise<Buffer> {
    const rowKeys = this.normalizeExportRowKeys(rawRowKeys);
    const [preferences, explorerState, accessConfig] = await Promise.all([
      this.getItemPreferences(acpId, identity, "item-explorer"),
      this.itemExplorerStateService.getStateForViewer(
        acpId,
        canEditExplorerState,
      ),
      this.accessConfigRepository.findOne({ where: { acpId } }),
    ]);
    const itemList = await this.unitParserService.getItemListFromFiles(acpId, {
      itemPropertiesOverride: explorerState.activeState.itemProperties,
      publishedItemPropertiesOverride:
        explorerState.publishedState.itemProperties,
    });
    const itemsByRowKey = new Map(
      itemList.items.map((item) => [item.rowKey, item] as const),
    );
    const items = rowKeys
      .map((rowKey) => itemsByRowKey.get(rowKey))
      .filter((item): item is VomdItemData => Boolean(item));
    const personalTagColors = this.getPersonalTagColors(
      accessConfig?.featureConfig,
    );
    const personalCategoryLabel = this.getPersonalCategoryExportLabel(
      accessConfig?.featureConfig,
    );

    const rows = items.map((item, index) => {
      const projection = projectItemExportRow({
        rowKey: item.rowKey,
        item,
        personalRow: preferences.rowData[item.rowKey],
      });

      return {
        ...projection,
        sequenceNumber: index + 1,
        markers: this.formatPersonalMarkers(projection.tags, personalTagColors),
        personalCompetenceLevel: projection.category,
      };
    });

    return this.buildPersonalItemDataXlsx(
      rows,
      columnPolicy ||
        new ReviewerColumnPolicy(
          canEditExplorerState
            ? undefined
            : explorerState.publishedState.metadataColumns,
        ),
      personalCategoryLabel,
    );
  }

  async exportAllPersonalItemDataCsv(
    acpId: string,
    canEditExplorerState = false,
    collectionRowKeys?: readonly string[],
  ): Promise<Buffer> {
    // An empty collection must stay empty; only an omitted filter exports all rows.
    const includedRows =
      collectionRowKeys === undefined ? null : new Set(collectionRowKeys);
    const [preferenceRecords, explorerState] = await Promise.all([
      this.itemPreferenceRepository.find({
        where: { acpId, viewId: "item-explorer" },
        relations: { user: true, credential: true },
      }),
      this.itemExplorerStateService.getStateForViewer(
        acpId,
        canEditExplorerState,
      ),
    ]);
    const itemList = await this.unitParserService.getItemListFromFiles(acpId, {
      itemPropertiesOverride: explorerState.activeState.itemProperties,
      publishedItemPropertiesOverride:
        explorerState.publishedState.itemProperties,
    });
    const itemsByRowKey = new Map(
      itemList.items.map((item) => [item.rowKey, item] as const),
    );
    const itemOrder = new Map(
      itemList.items.map((item, index) => [item.rowKey, index] as const),
    );
    const rows = preferenceRecords.flatMap((record) => {
      const participant = this.getPreferenceParticipantIdentifier(record);
      if (!participant) return [];

      const preferences = normalizeItemPreferences(record.preferences);
      return Object.entries(preferences.rowData)
        .filter(([rowKey]) => includedRows === null || includedRows.has(rowKey))
        .map(([rowKey, personalRow]) => {
          const item = itemsByRowKey.get(rowKey);
          const projection = projectItemExportRow({
            rowKey,
            item,
            personalRow,
          });

          return {
            ...projection,
            participant,
            itemOrder: itemOrder.get(rowKey) ?? Number.MAX_SAFE_INTEGER,
          };
        });
    });

    rows.sort(
      (left, right) =>
        left.participant.localeCompare(right.participant, "de") ||
        left.itemOrder - right.itemOrder ||
        left.rowKey.localeCompare(right.rowKey, "de"),
    );

    return this.buildAllPersonalItemDataCsv(rows);
  }

  private async upsertItemPreferences(
    acpId: string,
    viewId: string,
    identity: StablePreferenceIdentity,
    preferences: ItemPreferencesPayload,
  ): Promise<void> {
    const identityColumn =
      identity.kind === "user" ? "user_id" : "credential_id";
    const identityPredicate =
      identity.kind === "user"
        ? '"user_id" IS NOT NULL'
        : '"credential_id" IS NOT NULL';

    await this.itemPreferenceRepository.query(
      `
        INSERT INTO "acp_item_preferences" (
          "id", "acp_id", "view_id", "user_id", "credential_id",
          "credential_username", "preferences", "created_at", "updated_at"
        )
        VALUES (
          uuid_generate_v4(), $1, $2, $3, $4, $5, $6::jsonb, now(), now()
        )
        ON CONFLICT ("acp_id", "view_id", "${identityColumn}")
          WHERE ${identityPredicate}
        DO UPDATE SET
          "preferences" = (
            CASE
              WHEN jsonb_typeof("acp_item_preferences"."preferences") = 'object'
                THEN "acp_item_preferences"."preferences"
              ELSE '{}'::jsonb
            END
          ) || EXCLUDED."preferences",
          "credential_username" = CASE
            WHEN EXCLUDED."credential_id" IS NOT NULL
              THEN EXCLUDED."credential_username"
            ELSE "acp_item_preferences"."credential_username"
          END,
          "updated_at" = now()
      `,
      [
        acpId,
        viewId,
        identity.kind === "user" ? identity.userId : null,
        identity.kind === "credential" ? identity.credentialId : null,
        identity.kind === "credential"
          ? identity.credentialUsername || null
          : null,
        JSON.stringify(preferences),
      ],
    );
  }

  private async assertKnownPersonalItemRow(
    acpId: string,
    rowKey: string,
    canEditExplorerState: boolean,
  ): Promise<void> {
    const explorerState = await this.itemExplorerStateService.getStateForViewer(
      acpId,
      canEditExplorerState,
    );
    const validRowKeys = await this.unitParserService.getItemRowKeysFromFiles(
      acpId,
      {
        itemPropertiesOverride: explorerState.activeState.itemProperties,
        publishedItemPropertiesOverride:
          explorerState.publishedState.itemProperties,
      },
    );
    if (!validRowKeys.has(rowKey)) {
      throw new BadRequestException(
        "Personal item data can only be saved for an existing item row",
      );
    }
  }

  private getModuleReferenceId(moduleRef: unknown): string | null {
    if (typeof moduleRef === "string" && moduleRef.trim().length > 0) {
      return moduleRef.trim();
    }
    if (moduleRef && typeof moduleRef === "object") {
      const ref = moduleRef as { moduleId?: unknown; id?: unknown };
      if (typeof ref.moduleId === "string" && ref.moduleId.trim().length > 0) {
        return ref.moduleId.trim();
      }
      if (typeof ref.id === "string" && ref.id.trim().length > 0) {
        return ref.id.trim();
      }
    }
    return null;
  }

  private normalizeViewId(viewId?: string): string {
    const normalized = (viewId || "").trim();
    return normalized.length > 0 ? normalized.slice(0, 120) : "item-list";
  }

  private normalizeExportRowKeys(rawRowKeys: unknown): string[] {
    if (
      !Array.isArray(rawRowKeys) ||
      rawRowKeys.length > MAX_PERSONAL_ITEM_ROWS
    ) {
      throw new BadRequestException(
        `At most ${MAX_PERSONAL_ITEM_ROWS} item rows can be exported`,
      );
    }

    const rowKeys: string[] = [];
    const seen = new Set<string>();
    for (const rawRowKey of rawRowKeys) {
      if (typeof rawRowKey !== "string") {
        throw new BadRequestException("Export row keys must be strings");
      }
      const rowKey = rawRowKey.trim();
      if (!rowKey || rowKey.length > MAX_EXPORT_ROW_KEY_LENGTH) {
        throw new BadRequestException("A valid export row key is required");
      }
      if (!seen.has(rowKey)) {
        seen.add(rowKey);
        rowKeys.push(rowKey);
      }
    }
    return rowKeys;
  }

  private getPersonalTagColors(rawFeatureConfig: unknown): Map<string, string> {
    const featureConfig = normalizeFeatureConfig(
      this.isRecord(rawFeatureConfig) ? rawFeatureConfig : {},
    ) as Record<string, unknown>;
    const tags = Array.isArray(featureConfig.personalItemTags)
      ? featureConfig.personalItemTags
      : [];
    const colors = new Map<string, string>();

    for (const rawTag of tags) {
      if (!this.isRecord(rawTag)) continue;
      const label = this.normalizePlainText(rawTag.label, 100);
      const color = this.normalizePlainText(rawTag.color, 100);
      if (label && color) colors.set(label, color);
    }
    return colors;
  }

  private getPersonalCategoryExportLabel(rawFeatureConfig: unknown): string {
    const featureConfig = normalizeFeatureConfig(
      this.isRecord(rawFeatureConfig) ? rawFeatureConfig : {},
    ) as Record<string, unknown>;
    const configuredLabel =
      this.normalizePlainText(featureConfig.personalItemCategoryLabel, 100) ||
      "Kompetenzstufe";
    return configuredLabel.toLocaleLowerCase("de-DE") === "kompetenzstufe"
      ? "Kompetenzstufe (persönlich)"
      : configuredLabel;
  }

  private formatPersonalMarkers(
    tags: string[],
    tagColors: Map<string, string>,
  ): string | null {
    if (!tags.length) return null;
    return tags
      .map((tag) => {
        const color = tagColors.get(tag);
        return color ? `${tag} (${color})` : tag;
      })
      .join("; ");
  }

  private async buildPersonalItemDataXlsx(
    rows: Array<
      ItemExportProjection & {
        sequenceNumber: number;
        markers: string | null;
        personalCompetenceLevel: string | null;
      }
    >,
    policy = new ReviewerColumnPolicy(),
    personalCategoryLabel = "Kompetenzstufe (persönlich)",
  ): Promise<Buffer> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "IQB ContentPool";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Persönliche Itemdaten");
    sheet.columns = [
      { header: "Laufende Nummer", key: "sequenceNumber", width: 18 },
      ...ITEM_EXPORT_IDENTITY_WITH_UUID_COLUMNS,
      { header: "Markierung/Farbe", key: "markers", width: 32 },
      { header: "Notiz", key: "note", width: 50 },
      {
        header: personalCategoryLabel,
        key: "personalCompetenceLevel",
        width: 28,
      },
      ...ITEM_EXPORT_PARAMETER_COLUMNS,
      MEAN_DIFFICULTY_EXPORT_COLUMN,
    ].filter((column) => policy.allowsExportField(column.key));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A5276" },
    };

    rows.forEach((row) => sheet.addRow(row));
    sheet.getColumn("note").alignment = { vertical: "top", wrapText: true };
    sheet.getColumn("markers").alignment = {
      vertical: "top",
      wrapText: true,
    };
    for (const column of [
      ...ITEM_EXPORT_PARAMETER_COLUMNS,
      MEAN_DIFFICULTY_EXPORT_COLUMN,
    ]) {
      if (column.numeric && policy.allowsExportField(column.key)) {
        sheet.getColumn(column.key).numFmt = "0.############";
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private buildAllPersonalItemDataCsv(
    rows: Array<
      {
        participant: string;
        itemOrder: number;
      } & ItemExportProjection
    >,
  ): Buffer {
    const headers = [
      "Teilnehmerkennung",
      ...ITEM_EXPORT_IDENTITY_COLUMNS.map((column) => column.header),
      "Kategorie",
      "Tags",
      "Notiz",
      ...ITEM_EXPORT_PARAMETER_COLUMNS.map((column) => column.header),
      MEAN_DIFFICULTY_EXPORT_COLUMN.header,
    ];
    const lines = [
      headers,
      ...rows.map((row) => [
        row.participant,
        ...ITEM_EXPORT_IDENTITY_COLUMNS.map((column) =>
          getItemExportCell(row, column),
        ),
        row.category || "",
        row.tags.join(", "),
        row.note?.replace(/\n/g, "\\n") || "",
        ...ITEM_EXPORT_PARAMETER_COLUMNS.map((column) =>
          getItemExportCell(row, column),
        ),
        getItemExportCell(row, MEAN_DIFFICULTY_EXPORT_COLUMN),
      ]),
    ].map((row) => row.map((value) => this.escapeCsvCell(value)).join(";"));

    return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
  }

  private escapeCsvCell(value: string | number): string {
    let normalized = String(value ?? "");
    if (typeof value === "string" && /^[=+\-@]/.test(normalized)) {
      normalized = `'${normalized}`;
    }
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  private getPreferenceParticipantIdentifier(
    record: AcpItemPreference,
  ): string | null {
    const identifiers = [
      record.credential?.username,
      record.credentialUsername,
      record.user?.username,
      record.credentialId,
      record.userId,
    ];
    for (const identifier of identifiers) {
      if (typeof identifier === "string" && identifier.trim()) {
        return identifier.trim();
      }
    }
    return null;
  }

  private async findPreferenceRecord(
    acpId: string,
    viewId: string,
    identity: StablePreferenceIdentity,
  ): Promise<AcpItemPreference | null> {
    if (identity.kind === "user") {
      return this.itemPreferenceRepository.findOne({
        where: {
          acpId,
          viewId,
          userId: identity.userId,
        },
      });
    }

    return this.itemPreferenceRepository.findOne({
      where: {
        acpId,
        viewId,
        credentialId: identity.credentialId,
      },
    });
  }

  private normalizePlainText(
    value: unknown,
    maxLength: number,
    multiline = false,
  ): string | null {
    if (typeof value !== "string") return null;
    const normalized = value
      .replace(/\r\n?/g, "\n")
      .replace(multiline ? /[\t\f\v]+/g : /\s+/g, " ")
      .trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
