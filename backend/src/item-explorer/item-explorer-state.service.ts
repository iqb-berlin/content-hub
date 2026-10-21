import { ReviewerColumnPolicy } from "./reviewer-column-policy";
import { normalizePreviewContext } from "./preview-context";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DeepPartial, EntityManager, Repository } from "typeorm";
import {
  Acp,
  AcpAccessConfig,
  AcpItemExplorerChangeLog,
  AcpItemExplorerState,
  ItemExplorerDraftStatus,
} from "../database/entities";
import { normalizeFeatureConfig } from "../acp/feature-config.utils";
import { parseItemRowKeyParts } from "../items/item-row-key.util";

export interface ExplorerActor {
  userId?: string;
  username?: string;
  role?: string;
}

export interface ExplorerMetadataColumns {
  restrictReviewerColumnsToManagerSelection?: boolean;
  visible: string[];
  order: string[];
  configured: boolean;
  widths: Record<string, number>;
  referenceNumberVisible?: boolean;
  layout?: ExplorerTableColumnLayout;
}

export interface ExplorerTableColumnLayout {
  visible: string[];
  order: string[];
  configured: boolean;
  widths: Record<string, number>;
  schemaVersion?: number;
}

export interface ExplorerSharedStatePayload {
  ui: Record<string, unknown>;
  tags: Record<string, string[]>;
  metadataColumns: ExplorerMetadataColumns;
  itemOrder: string[];
  itemProperties: Record<string, Record<string, unknown>>;
}

export interface ExplorerStateEnvelope {
  status: ItemExplorerDraftStatus;
  version: number;
  publishedVersion: number;
  canEdit: boolean;
  canPublish: boolean;
  updatedAt: Date;
  updatedByUsername?: string | null;
  updatedByRole?: string | null;
  activeState: ExplorerSharedStatePayload;
  publishedState: ExplorerSharedStatePayload;
  draftState: ExplorerSharedStatePayload;
}

export interface ItemListStateProjection {
  activeItemProperties: Record<string, Record<string, unknown>>;
  publishedItemProperties: Record<string, Record<string, unknown>>;
  activeVersion: number;
  publishedVersion: number;
}

export interface ExplorerDraftPatch {
  ui?: Record<string, unknown>;
  tags?: Record<string, string[]>;
  metadataColumns?: Partial<ExplorerMetadataColumns>;
  itemOrder?: string[];
  itemProperties?: Record<string, Record<string, unknown>>;
  itemPropertiesPatch?: Record<string, Record<string, unknown> | null>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ViewerStateCacheEntry {
  status: ItemExplorerDraftStatus;
  version: number;
  publishedVersion: number;
  updatedAt: Date;
  updatedByUsername?: string | null;
  updatedByRole?: string | null;
  draftState: ExplorerSharedStatePayload;
  publishedState: ExplorerSharedStatePayload;
}

@Injectable()
export class ItemExplorerStateService {
  private readonly viewerStateCache = new Map<string, ViewerStateCacheEntry>();
  private readonly maxViewerStateCacheEntries = 100;

  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    @InjectRepository(AcpItemExplorerState)
    private readonly stateRepository: Repository<AcpItemExplorerState>,
    @InjectRepository(AcpItemExplorerChangeLog)
    private readonly changeLogRepository: Repository<AcpItemExplorerChangeLog>,
  ) {}

  async getStateForViewer(
    acpId: string,
    canEdit: boolean,
  ): Promise<ExplorerStateEnvelope> {
    const state = await this.getCachedViewerState(acpId);
    return structuredClone(this.toViewerEnvelope(state, canEdit));
  }

  async getPublishedColumnPolicy(acpId: string): Promise<ReviewerColumnPolicy> {
    const state = await this.getCachedViewerState(acpId);
    return new ReviewerColumnPolicy(
      state.publishedState.metadataColumns,
      state.publishedVersion,
    );
  }

  async assertColumnPolicyCurrent(
    acpId: string,
    policy?: ReviewerColumnPolicy,
  ): Promise<void> {
    if (policy?.publishedVersion === undefined) return;
    const version = await this.getStateVersionForViewer(acpId, false);
    if (version !== policy.publishedVersion) {
      throw new ConflictException(
        "Die veröffentlichte Spaltenfreigabe wurde geändert. Bitte neu laden.",
      );
    }
  }

  async getItemListStateProjection(
    acpId: string,
    canEdit: boolean,
  ): Promise<ItemListStateProjection> {
    const state = await this.getCachedViewerState(acpId);
    return structuredClone({
      activeItemProperties: canEdit
        ? state.draftState.itemProperties
        : state.publishedState.itemProperties,
      publishedItemProperties: state.publishedState.itemProperties,
      activeVersion: canEdit ? state.version : state.publishedVersion,
      publishedVersion: state.publishedVersion,
    });
  }

  private async getCachedViewerState(
    acpId: string,
  ): Promise<ViewerStateCacheEntry> {
    const cached = this.viewerStateCache.get(acpId);
    if (cached) {
      const version = await this.stateRepository.findOne({
        where: { acpId },
        select: {
          version: true,
          publishedVersion: true,
        },
      });
      if (
        version &&
        version.version === cached.version &&
        version.publishedVersion === cached.publishedVersion
      ) {
        this.viewerStateCache.delete(acpId);
        this.viewerStateCache.set(acpId, cached);
        return cached;
      }
      this.viewerStateCache.delete(acpId);
    }

    const record = await this.ensureStateRecord(acpId);
    const entry = this.toViewerStateCacheEntry(record);
    this.viewerStateCache.set(acpId, entry);
    while (this.viewerStateCache.size > this.maxViewerStateCacheEntries) {
      const oldestKey = this.viewerStateCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.viewerStateCache.delete(oldestKey);
    }
    return entry;
  }

  async getStateVersionForViewer(
    acpId: string,
    canEdit: boolean,
  ): Promise<number> {
    const record = await this.stateRepository.findOne({
      where: { acpId },
      select: {
        version: true,
        publishedVersion: true,
      },
    });
    if (record) {
      return canEdit ? record.version : record.publishedVersion;
    }
    const initialized = await this.ensureStateRecord(acpId);
    return canEdit ? initialized.version : initialized.publishedVersion;
  }

  async getCleanPublishedState(acpId: string): Promise<ExplorerStateEnvelope> {
    const state = await this.getStateForViewer(acpId, false);
    this.assertCleanState(state.status);
    return state;
  }

  async runWithLockedCleanState<T>(
    acpId: string,
    operation: (
      state: ExplorerStateEnvelope,
      manager: EntityManager,
    ) => Promise<T>,
    expectedPublishedVersion?: number,
  ): Promise<T> {
    return this.withLockedState(acpId, async ({ manager }, record) => {
      this.assertCleanState(record.status);
      if (
        expectedPublishedVersion !== undefined &&
        record.publishedVersion !== expectedPublishedVersion
      ) {
        throw new ConflictException(
          "The published Item Explorer state changed while row numbers were being recalculated",
        );
      }
      return operation(this.toEnvelope(record, true), manager);
    });
  }

  async patchDraft(
    acpId: string,
    patch: ExplorerDraftPatch,
    options: {
      actor?: ExplorerActor;
      changeType?: string;
      baseVersion?: number;
    } = {},
  ): Promise<ExplorerStateEnvelope> {
    return this.withLockedState(
      acpId,
      async ({ stateRepository, changeLogRepository }, record) => {
        this.assertVersion(record, options.baseVersion);

        const before = this.normalizeStatePayload(record.draftState);
        const after = this.mergeDraftPatch(before, patch);
        const published = this.normalizeStatePayload(record.publishedState);

        record.draftState = after as unknown as Record<string, unknown>;
        record.status = this.statesEqual(after, published) ? "CLEAN" : "DIRTY";
        record.version += 1;
        this.applyActor(record, options.actor);
        const saved = await stateRepository.save(record);

        await this.logChange(
          {
            acpId,
            changeType: options.changeType || "PATCH_DRAFT",
            before,
            after,
            draftVersion: saved.version,
            publishedVersion: saved.publishedVersion,
            actor: options.actor,
          },
          changeLogRepository,
        );

        return this.toEnvelope(saved, true);
      },
    );
  }

  async saveDraft(
    acpId: string,
    options: { actor?: ExplorerActor; baseVersion?: number } = {},
  ): Promise<ExplorerStateEnvelope> {
    return this.withLockedState(
      acpId,
      async (
        {
          stateRepository,
          acpRepository,
          accessConfigRepository,
          changeLogRepository,
        },
        record,
      ) => {
        this.assertVersion(record, options.baseVersion);

        const beforePublished = this.normalizeStatePayload(
          record.publishedState,
        );
        const nextPublished = this.normalizeStatePayload(record.draftState);

        await this.applyPublishedStateToDomain(acpId, nextPublished, {
          acpRepository,
          accessConfigRepository,
        });

        record.publishedState = nextPublished as unknown as Record<
          string,
          unknown
        >;
        record.draftState = nextPublished as unknown as Record<string, unknown>;
        record.status = "CLEAN";
        record.version += 1;
        record.publishedVersion += 1;
        this.applyActor(record, options.actor);
        const saved = await stateRepository.save(record);

        await this.logChange(
          {
            acpId,
            changeType: "SAVE_DRAFT",
            before: beforePublished,
            after: nextPublished,
            draftVersion: saved.version,
            publishedVersion: saved.publishedVersion,
            actor: options.actor,
          },
          changeLogRepository,
        );

        return this.toEnvelope(saved, true);
      },
    );
  }

  async publishItemPropertiesImmediately(
    acpId: string,
    itemProperties: Record<string, Record<string, unknown>>,
    options: {
      actor?: ExplorerActor;
      changeType: string;
      baseVersion: number;
    },
  ): Promise<ExplorerStateEnvelope> {
    return this.withLockedState(
      acpId,
      async (
        {
          stateRepository,
          acpRepository,
          accessConfigRepository,
          changeLogRepository,
        },
        record,
      ) => {
        if (record.status === "DIRTY") {
          throw new ConflictException(
            "Direct item-property changes are not allowed while an Item Explorer draft is pending.",
          );
        }
        this.assertVersion(record, options.baseVersion);

        const before = this.normalizeStatePayload(record.publishedState);
        const nextPublished: ExplorerSharedStatePayload = {
          ...before,
          itemProperties: this.normalizeItemProperties(itemProperties),
        };

        await this.applyPublishedStateToDomain(acpId, nextPublished, {
          acpRepository,
          accessConfigRepository,
        });

        record.publishedState = nextPublished as unknown as Record<
          string,
          unknown
        >;
        record.draftState = nextPublished as unknown as Record<string, unknown>;
        record.status = "CLEAN";
        record.version += 1;
        record.publishedVersion += 1;
        this.applyActor(record, options.actor);
        const saved = await stateRepository.save(record);

        await this.logChange(
          {
            acpId,
            changeType: options.changeType,
            before,
            after: nextPublished,
            draftVersion: saved.version,
            publishedVersion: saved.publishedVersion,
            actor: options.actor,
          },
          changeLogRepository,
        );

        return this.toEnvelope(saved, true);
      },
    );
  }

  async publishTagsImmediately(
    acpId: string,
    tags: Record<string, string[]>,
    options: {
      actor?: ExplorerActor;
      changeType?: string;
      baseVersion?: number;
    } = {},
  ): Promise<{
    tags: Record<string, string[]>;
    state: ExplorerStateEnvelope;
  }> {
    return this.withLockedState(
      acpId,
      async (
        {
          stateRepository,
          acpRepository,
          accessConfigRepository,
          changeLogRepository,
        },
        record,
      ) => {
        if (record.status === "DIRTY") {
          throw new ConflictException(
            "Direct item-tag changes are not allowed while an Item Explorer draft is pending.",
          );
        }
        this.assertVersion(record, options.baseVersion);

        const before = this.normalizeStatePayload(record.publishedState);
        const normalizedTags = this.normalizeTags(tags);
        const itemProperties = this.normalizeItemProperties(
          before.itemProperties,
        );

        for (const [itemKey, currentProperties] of Object.entries(
          itemProperties,
        )) {
          const nextProperties = { ...currentProperties };
          delete nextProperties.tags;
          if (Object.keys(nextProperties).length > 0) {
            itemProperties[itemKey] = nextProperties;
          } else {
            delete itemProperties[itemKey];
          }
        }

        for (const [itemKey, tagValues] of Object.entries(normalizedTags)) {
          itemProperties[itemKey] = {
            ...(itemProperties[itemKey] || {}),
            tags: tagValues,
          };
        }

        const nextPublished: ExplorerSharedStatePayload = {
          ...before,
          tags: normalizedTags,
          itemProperties: this.normalizeItemProperties(itemProperties),
        };

        await this.applyPublishedStateToDomain(acpId, nextPublished, {
          acpRepository,
          accessConfigRepository,
        });

        record.publishedState = nextPublished as unknown as Record<
          string,
          unknown
        >;
        record.draftState = nextPublished as unknown as Record<string, unknown>;
        record.status = "CLEAN";
        record.version += 1;
        record.publishedVersion += 1;
        this.applyActor(record, options.actor);
        const saved = await stateRepository.save(record);

        await this.logChange(
          {
            acpId,
            changeType: options.changeType || "REPLACE_ITEM_TAGS",
            before,
            after: nextPublished,
            draftVersion: saved.version,
            publishedVersion: saved.publishedVersion,
            actor: options.actor,
          },
          changeLogRepository,
        );

        return {
          tags: normalizedTags,
          state: this.toEnvelope(saved, true),
        };
      },
    );
  }

  async discardDraft(
    acpId: string,
    options: { actor?: ExplorerActor; baseVersion?: number } = {},
  ): Promise<ExplorerStateEnvelope> {
    return this.withLockedState(
      acpId,
      async ({ stateRepository, changeLogRepository }, record) => {
        this.assertVersion(record, options.baseVersion);

        const before = this.normalizeStatePayload(record.draftState);
        const published = this.normalizeStatePayload(record.publishedState);

        record.draftState = published as unknown as Record<string, unknown>;
        record.status = "CLEAN";
        record.version += 1;
        this.applyActor(record, options.actor);
        const saved = await stateRepository.save(record);

        await this.logChange(
          {
            acpId,
            changeType: "DISCARD_DRAFT",
            before,
            after: published,
            draftVersion: saved.version,
            publishedVersion: saved.publishedVersion,
            actor: options.actor,
          },
          changeLogRepository,
        );

        return this.toEnvelope(saved, true);
      },
    );
  }

  async listChanges(
    acpId: string,
    limit = 100,
  ): Promise<AcpItemExplorerChangeLog[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return this.changeLogRepository.find({
      where: { acpId },
      order: { createdAt: "DESC" },
      take: safeLimit,
    });
  }

  resolveActor(user: any, acpId: string): ExplorerActor {
    const username =
      typeof user?.username === "string"
        ? user.username
        : typeof user?.displayName === "string"
          ? user.displayName
          : undefined;

    let role = "READ_ONLY";
    if (user?.isAppAdmin) {
      role = "APP_ADMIN";
    } else if (user?.type === "credential") {
      role = "CREDENTIAL";
    } else if (Array.isArray(user?.acpRoles)) {
      const acpRole = user.acpRoles.find(
        (entry: any) => entry?.acpId === acpId,
      );
      if (acpRole?.role === "ACP_MANAGER") {
        role = "ACP_MANAGER";
      }
    }

    const sub = typeof user?.sub === "string" ? user.sub : undefined;
    return {
      userId: user?.type === "credential" ? undefined : sub,
      username,
      role,
    };
  }

  private async withLockedState<T>(
    acpId: string,
    operation: (
      repositories: {
        manager: EntityManager;
        stateRepository: Repository<AcpItemExplorerState>;
        acpRepository: Repository<Acp>;
        accessConfigRepository: Repository<AcpAccessConfig>;
        changeLogRepository: Repository<AcpItemExplorerChangeLog>;
      },
      record: AcpItemExplorerState,
    ) => Promise<T>,
  ): Promise<T> {
    await this.ensureStateRecord(acpId);

    return this.stateRepository.manager.transaction(async (manager) => {
      const repositories = {
        manager,
        stateRepository: manager.getRepository(AcpItemExplorerState),
        acpRepository: manager.getRepository(Acp),
        accessConfigRepository: manager.getRepository(AcpAccessConfig),
        changeLogRepository: manager.getRepository(AcpItemExplorerChangeLog),
      };
      const record = await repositories.stateRepository.findOne({
        where: { acpId },
        lock: { mode: "pessimistic_write" },
      });
      if (!record) {
        throw new NotFoundException("Item Explorer state not found");
      }

      return operation(repositories, record);
    });
  }

  private assertCleanState(status: ItemExplorerDraftStatus): void {
    if (status === "DIRTY") {
      throw new ConflictException(
        "Save or discard the pending Item Explorer draft before recalculating row numbers",
      );
    }
  }

  private async ensureStateRecord(
    acpId: string,
  ): Promise<AcpItemExplorerState> {
    const record = await this.stateRepository.findOne({ where: { acpId } });
    if (record) {
      return record;
    }

    return this.stateRepository.manager.transaction(async (manager) => {
      const stateRepository = manager.getRepository(AcpItemExplorerState);
      const acpRepository = manager.getRepository(Acp);
      const accessConfigRepository = manager.getRepository(AcpAccessConfig);

      // Serialize first-time initialization on the ACP row. The Item Explorer
      // loads its item list and shared state concurrently, so both requests may
      // observe a missing state before either one inserts it.
      const acp = await acpRepository.findOne({
        where: { id: acpId },
        lock: { mode: "pessimistic_write" },
      });
      if (!acp) {
        throw new NotFoundException("ACP not found");
      }

      const concurrentlyCreated = await stateRepository.findOne({
        where: { acpId },
      });
      if (concurrentlyCreated) {
        return concurrentlyCreated;
      }

      const accessConfig = await accessConfigRepository.findOne({
        where: { acpId },
      });
      const defaultState = this.buildDefaultState(
        acp,
        accessConfig || undefined,
      );

      const newRecord = stateRepository.create({
        acpId,
        publishedState: defaultState as unknown as Record<string, unknown>,
        draftState: defaultState as unknown as Record<string, unknown>,
        status: "CLEAN",
        version: 1,
        publishedVersion: 1,
      } as DeepPartial<AcpItemExplorerState>);

      return stateRepository.save(newRecord);
    });
  }

  private buildDefaultState(
    acp: Acp,
    accessConfig?: AcpAccessConfig,
  ): ExplorerSharedStatePayload {
    const normalizedFeatureConfig = normalizeFeatureConfig(
      accessConfig?.featureConfig || {},
    );
    const rawMetadataColumns = (normalizedFeatureConfig.metadataColumns ||
      {}) as Record<string, unknown>;

    const visible = this.asStringArray(rawMetadataColumns.visible);
    const order = this.asStringArray(rawMetadataColumns.order);
    const configured =
      rawMetadataColumns.configured === true ||
      visible.length > 0 ||
      order.length > 0;
    const metadataColumns: ExplorerMetadataColumns = {
      ...(rawMetadataColumns.restrictReviewerColumnsToManagerSelection === true
        ? { restrictReviewerColumnsToManagerSelection: true }
        : {}),
      visible: visible.length ? visible : order,
      order: order.length ? order : visible,
      configured,
      widths: this.normalizeMetadataColumnWidths(rawMetadataColumns.widths),
      ...(rawMetadataColumns.referenceNumberVisible === true
        ? { referenceNumberVisible: true }
        : {}),
      ...this.withTableColumnLayout(rawMetadataColumns.layout),
    };

    const itemProperties = this.normalizeItemProperties(acp.itemProperties);
    const tags: Record<string, string[]> = {};
    for (const [itemKey, value] of Object.entries(itemProperties)) {
      const rawTags = Array.isArray(value.tags) ? value.tags : [];
      const normalizedTags = this.normalizeTagArray(rawTags);
      if (normalizedTags.length) {
        tags[itemKey] = normalizedTags;
      }
    }

    return {
      ui: {},
      tags,
      metadataColumns,
      itemOrder: [],
      itemProperties,
    };
  }

  private async applyPublishedStateToDomain(
    acpId: string,
    state: ExplorerSharedStatePayload,
    repositories: {
      acpRepository: Repository<Acp>;
      accessConfigRepository: Repository<AcpAccessConfig>;
    } = {
      acpRepository: this.acpRepository,
      accessConfigRepository: this.accessConfigRepository,
    },
  ): Promise<void> {
    const acp = await repositories.acpRepository.findOne({
      where: { id: acpId },
    });
    if (!acp) {
      throw new NotFoundException("ACP not found");
    }

    acp.itemProperties = this.normalizeItemProperties(state.itemProperties);
    await repositories.acpRepository.save(acp);

    const config = await repositories.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (!config) {
      return;
    }

    const normalizedFeatureConfig = normalizeFeatureConfig(
      config.featureConfig || {},
    );
    const visible = this.asStringArray(state.metadataColumns?.visible);
    const order = this.asStringArray(state.metadataColumns?.order);
    const widths = this.normalizeMetadataColumnWidths(
      state.metadataColumns?.widths,
    );
    const existingMetadataColumns = this.asRecord(
      normalizedFeatureConfig.metadataColumns,
    );
    const definitions = Array.isArray(existingMetadataColumns.definitions)
      ? existingMetadataColumns.definitions
      : [];
    const layout = this.normalizeTableColumnLayout(
      state.metadataColumns.layout,
    );

    if (
      state.metadataColumns.restrictReviewerColumnsToManagerSelection ||
      state.metadataColumns.configured ||
      visible.length ||
      order.length ||
      state.metadataColumns.referenceNumberVisible ||
      Object.keys(widths).length ||
      definitions.length ||
      layout
    ) {
      normalizedFeatureConfig.metadataColumns = {
        ...(state.metadataColumns.restrictReviewerColumnsToManagerSelection
          ? { restrictReviewerColumnsToManagerSelection: true }
          : {}),
        visible: visible.length ? visible : order,
        order: order.length ? order : visible,
        configured: state.metadataColumns.configured === true,
        ...(definitions.length ? { definitions } : {}),
        ...(Object.keys(widths).length ? { widths } : {}),
        ...(state.metadataColumns.referenceNumberVisible
          ? { referenceNumberVisible: true }
          : {}),
        ...(layout ? { layout } : {}),
      };
    } else {
      delete normalizedFeatureConfig.metadataColumns;
    }

    config.featureConfig = normalizedFeatureConfig;
    await repositories.accessConfigRepository.save(config);
  }

  private toEnvelope(
    record: AcpItemExplorerState,
    canEdit: boolean,
  ): ExplorerStateEnvelope {
    return this.toViewerEnvelope(this.toViewerStateCacheEntry(record), canEdit);
  }

  private toViewerEnvelope(
    state: ViewerStateCacheEntry,
    canEdit: boolean,
  ): ExplorerStateEnvelope {
    return {
      status: state.status,
      version: state.version,
      publishedVersion: state.publishedVersion,
      canEdit,
      canPublish: canEdit,
      updatedAt: state.updatedAt,
      updatedByUsername: state.updatedByUsername,
      updatedByRole: state.updatedByRole,
      activeState: canEdit ? state.draftState : state.publishedState,
      publishedState: state.publishedState,
      draftState: canEdit ? state.draftState : state.publishedState,
    };
  }

  private toViewerStateCacheEntry(
    record: AcpItemExplorerState,
  ): ViewerStateCacheEntry {
    return {
      status: record.status,
      version: record.version,
      publishedVersion: record.publishedVersion,
      updatedAt: record.updatedAt,
      updatedByUsername: record.updatedByUsername,
      updatedByRole: record.updatedByRole,
      draftState: this.normalizeStatePayload(record.draftState),
      publishedState: this.normalizeStatePayload(record.publishedState),
    };
  }

  private normalizeStatePayload(raw: unknown): ExplorerSharedStatePayload {
    const payload = this.asRecord(raw);
    const metadataColumnsRaw = this.asRecord(payload.metadataColumns);

    const visible = this.asStringArray(metadataColumnsRaw.visible);
    const order = this.asStringArray(metadataColumnsRaw.order);
    const configured =
      metadataColumnsRaw.configured === true ||
      visible.length > 0 ||
      order.length > 0;

    return {
      ui: this.asRecord(payload.ui),
      tags: this.normalizeTags(payload.tags),
      metadataColumns: {
        ...(metadataColumnsRaw.restrictReviewerColumnsToManagerSelection ===
        true
          ? { restrictReviewerColumnsToManagerSelection: true }
          : {}),
        visible: visible.length ? visible : order,
        order: order.length ? order : visible,
        configured,
        widths: this.normalizeMetadataColumnWidths(metadataColumnsRaw.widths),
        ...(metadataColumnsRaw.referenceNumberVisible === true
          ? { referenceNumberVisible: true }
          : {}),
        ...this.withTableColumnLayout(metadataColumnsRaw.layout),
      },
      itemOrder: this.asStringArray(payload.itemOrder),
      itemProperties: this.normalizeItemProperties(payload.itemProperties),
    };
  }

  private mergeDraftPatch(
    current: ExplorerSharedStatePayload,
    patch: ExplorerDraftPatch,
  ): ExplorerSharedStatePayload {
    const merged: ExplorerSharedStatePayload = {
      ui: { ...current.ui },
      tags: this.normalizeTags(current.tags),
      metadataColumns: {
        ...(current.metadataColumns
          .restrictReviewerColumnsToManagerSelection === true
          ? { restrictReviewerColumnsToManagerSelection: true }
          : {}),
        visible: [...current.metadataColumns.visible],
        order: [...current.metadataColumns.order],
        configured: current.metadataColumns.configured,
        widths: { ...current.metadataColumns.widths },
        ...(current.metadataColumns.referenceNumberVisible
          ? { referenceNumberVisible: true }
          : {}),
        ...this.withTableColumnLayout(current.metadataColumns.layout),
      },
      itemOrder: [...current.itemOrder],
      itemProperties: this.normalizeItemProperties(current.itemProperties),
    };

    if (patch.ui && this.isRecord(patch.ui)) {
      merged.ui = {
        ...merged.ui,
        ...this.asRecord(patch.ui),
      };
    }

    if (patch.tags !== undefined) {
      merged.tags = this.normalizeTags(patch.tags);
    }

    if (patch.metadataColumns) {
      const visible = this.asStringArray(patch.metadataColumns.visible);
      const order = this.asStringArray(patch.metadataColumns.order);
      const configured =
        patch.metadataColumns.configured === true ||
        visible.length > 0 ||
        order.length > 0;
      merged.metadataColumns = {
        ...((patch.metadataColumns.restrictReviewerColumnsToManagerSelection ??
          current.metadataColumns.restrictReviewerColumnsToManagerSelection) ===
        true
          ? { restrictReviewerColumnsToManagerSelection: true }
          : {}),
        visible: visible.length ? visible : order,
        order: order.length ? order : visible,
        configured,
        widths: this.normalizeMetadataColumnWidths(
          patch.metadataColumns.widths,
        ),
        ...(patch.metadataColumns.referenceNumberVisible === true
          ? { referenceNumberVisible: true }
          : {}),
        ...this.withTableColumnLayout(patch.metadataColumns.layout),
      };
    }

    if (patch.itemOrder !== undefined) {
      merged.itemOrder = this.asStringArray(patch.itemOrder);
    }

    if (patch.itemProperties !== undefined) {
      merged.itemProperties = this.normalizeItemProperties(
        patch.itemProperties,
      );
    }

    if (patch.itemPropertiesPatch && this.isRecord(patch.itemPropertiesPatch)) {
      for (const [itemKey, value] of Object.entries(
        patch.itemPropertiesPatch,
      )) {
        const normalizedKey = itemKey.trim();
        if (!normalizedKey) continue;

        if (value === null) {
          delete merged.itemProperties[normalizedKey];
          continue;
        }

        const currentItemProps = this.asRecord(
          merged.itemProperties[normalizedKey],
        );
        const nextItemProps = {
          ...currentItemProps,
          ...this.asRecord(value),
        };

        if (Object.keys(nextItemProps).length === 0) {
          delete merged.itemProperties[normalizedKey];
        } else {
          merged.itemProperties[normalizedKey] = nextItemProps;
        }
      }
      merged.itemProperties = this.normalizeItemProperties(
        merged.itemProperties,
      );
    }

    return merged;
  }

  private async logChange(
    params: {
      acpId: string;
      changeType: string;
      before: ExplorerSharedStatePayload;
      after: ExplorerSharedStatePayload;
      draftVersion?: number | null;
      publishedVersion?: number | null;
      actor?: ExplorerActor;
    },
    repository = this.changeLogRepository,
  ): Promise<void> {
    const diff = this.buildTopLevelDiff(params.before, params.after);
    const actorUserId = this.isUuid(params.actor?.userId)
      ? params.actor?.userId
      : null;

    const entry = repository.create({
      acpId: params.acpId,
      changeType: params.changeType,
      beforeState: params.before as unknown as Record<string, unknown>,
      afterState: params.after as unknown as Record<string, unknown>,
      diff,
      draftVersion: params.draftVersion ?? null,
      publishedVersion: params.publishedVersion ?? null,
      actorUserId,
      actorUsername: params.actor?.username || null,
      actorRole: params.actor?.role || null,
    } as DeepPartial<AcpItemExplorerChangeLog>);

    await repository.save(entry);
  }

  private buildTopLevelDiff(
    before: ExplorerSharedStatePayload,
    after: ExplorerSharedStatePayload,
  ): Record<string, unknown> {
    const diff: Record<string, unknown> = {};
    const keys: Array<keyof ExplorerSharedStatePayload> = [
      "ui",
      "tags",
      "metadataColumns",
      "itemOrder",
      "itemProperties",
    ];

    for (const key of keys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        diff[key] = {
          before: before[key],
          after: after[key],
        };
      }
    }

    return diff;
  }

  private assertVersion(
    record: AcpItemExplorerState,
    baseVersion?: number,
  ): void {
    if (
      typeof baseVersion === "number" &&
      Number.isInteger(baseVersion) &&
      baseVersion !== record.version
    ) {
      throw new ConflictException({
        message: "Item Explorer draft version conflict",
        expectedVersion: baseVersion,
        currentVersion: record.version,
      });
    }
  }

  private applyActor(
    record: AcpItemExplorerState,
    actor?: ExplorerActor,
  ): void {
    record.updatedByUserId = this.isUuid(actor?.userId)
      ? actor?.userId || null
      : null;
    record.updatedByUsername = actor?.username || null;
    record.updatedByRole = actor?.role || null;
  }

  private statesEqual(
    a: ExplorerSharedStatePayload,
    b: ExplorerSharedStatePayload,
  ): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private normalizeTags(rawTags: unknown): Record<string, string[]> {
    if (!this.isRecord(rawTags)) {
      return {};
    }

    const tags: Record<string, string[]> = {};
    for (const [itemKey, value] of Object.entries(rawTags)) {
      const normalizedItemKey = String(itemKey || "").trim();
      if (!normalizedItemKey || !Array.isArray(value)) {
        continue;
      }
      const normalizedValues = this.normalizeTagArray(value);
      // Explicit empty arrays are deletion tombstones. They must also be
      // retained for regular (non partial-credit) rows so an imported tag
      // cannot reappear after the draft is saved and reloaded.
      tags[normalizedItemKey] = normalizedValues;
    }

    return tags;
  }

  private normalizeTagArray(values: unknown[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => String(value || "").trim())
          .filter((value) => value.length > 0),
      ),
    );
  }

  private normalizeItemProperties(
    raw: unknown,
  ): Record<string, Record<string, unknown>> {
    if (!this.isRecord(raw)) {
      return {};
    }

    const normalized: Record<string, Record<string, unknown>> = {};
    for (const [itemKey, value] of Object.entries(raw)) {
      const normalizedKey = String(itemKey || "").trim();
      if (!normalizedKey || !this.isRecord(value)) {
        continue;
      }
      const isPartialRow = parseItemRowKeyParts(normalizedKey) !== null;
      const itemValue = this.asRecord(value);
      const nextItemValue: Record<string, unknown> = { ...itemValue };

      if (Array.isArray(itemValue.tags)) {
        const tags = this.normalizeTagArray(itemValue.tags);
        if (tags.length) {
          nextItemValue.tags = tags;
        } else {
          nextItemValue.tags = [];
        }
      }

      const empiricalDifficultyRaw = itemValue.empiricalDifficulty;
      if (
        empiricalDifficultyRaw !== undefined &&
        empiricalDifficultyRaw !== null
      ) {
        const parsed = Number(empiricalDifficultyRaw);
        if (Number.isFinite(parsed)) {
          nextItemValue.empiricalDifficulty = parsed;
        } else {
          delete nextItemValue.empiricalDifficulty;
        }
      }

      const previewStart = itemValue.previewStart;
      if (
        previewStart &&
        typeof previewStart === "object" &&
        !Array.isArray(previewStart)
      ) {
        const raw = previewStart as Record<string, unknown>;
        const values = raw.values;
        const context =
          raw.context === undefined
            ? null
            : normalizePreviewContext(raw.context);
        if (
          (raw.context === undefined || context !== null) &&
          values &&
          typeof values === "object" &&
          !Array.isArray(values) &&
          Object.keys(values).length <= 100 &&
          Object.entries(values).every(
            ([key, value]) =>
              key.length <= 256 &&
              typeof value === "string" &&
              value.length <= 4096,
          ) &&
          (raw.page === undefined ||
            (typeof raw.page === "number" &&
              Number.isInteger(raw.page) &&
              raw.page >= 0 &&
              raw.page < 10000))
        ) {
          nextItemValue.previewStart = {
            ...(raw.page === undefined ? {} : { page: raw.page }),
            values,
            ...(context ? { context } : {}),
          };
        } else delete nextItemValue.previewStart;
      } else delete nextItemValue.previewStart;

      const previewTargetIdRaw = itemValue.previewTargetId;
      if (typeof previewTargetIdRaw === "string") {
        const normalizedPreviewTargetId = previewTargetIdRaw.trim();
        if (normalizedPreviewTargetId.length > 0) {
          nextItemValue.previewTargetId = normalizedPreviewTargetId;
        } else if (isPartialRow) {
          nextItemValue.previewTargetId = "";
        } else {
          delete nextItemValue.previewTargetId;
        }
      } else {
        delete nextItemValue.previewTargetId;
      }

      if (typeof itemValue.excluded === "boolean") {
        if (itemValue.excluded) {
          nextItemValue.excluded = true;
        } else if (isPartialRow) {
          nextItemValue.excluded = false;
        } else {
          delete nextItemValue.excluded;
        }
      } else {
        delete nextItemValue.excluded;
      }

      if (Object.keys(nextItemValue).length > 0) {
        normalized[normalizedKey] = nextItemValue;
      }
    }

    return normalized;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .map((entry) => String(entry || "").trim())
          .filter((entry) => entry.length > 0),
      ),
    );
  }

  private normalizeMetadataColumnWidths(
    value: unknown,
  ): Record<string, number> {
    const source = this.asRecord(value);
    const widths: Record<string, number> = {};
    for (const [rawId, rawWidth] of Object.entries(source).slice(0, 100)) {
      const id = rawId.trim().slice(0, 200);
      const width = Number(rawWidth);
      if (!id || !Number.isFinite(width)) continue;
      widths[id] = Math.min(600, Math.max(80, Math.round(width)));
    }
    return widths;
  }

  private normalizeTableColumnWidths(value: unknown): Record<string, number> {
    const source = this.asRecord(value);
    const widths: Record<string, number> = {};
    for (const [rawKey, rawWidth] of Object.entries(source).slice(0, 120)) {
      const key = rawKey.trim().slice(0, 220);
      const width = Number(rawWidth);
      if (!key || !Number.isFinite(width)) continue;
      widths[key] = Math.min(600, Math.max(80, Math.round(width)));
    }
    return widths;
  }

  private normalizeTableColumnLayout(
    value: unknown,
  ): ExplorerTableColumnLayout | undefined {
    const source = this.asRecord(value);
    const visible = this.asStringArray(source.visible);
    const order = this.asStringArray(source.order);
    const configured =
      source.configured === true || visible.length > 0 || order.length > 0;
    const widths = this.normalizeTableColumnWidths(source.widths);
    const schemaVersion = Number(source.schemaVersion);
    if (!configured && Object.keys(widths).length === 0) return undefined;
    return {
      visible:
        source.configured === true ? visible : visible.length ? visible : order,
      order: order.length ? order : visible,
      configured,
      widths,
      ...(Number.isInteger(schemaVersion) && schemaVersion > 0
        ? { schemaVersion }
        : {}),
    };
  }

  private withTableColumnLayout(value: unknown): {
    layout?: ExplorerTableColumnLayout;
  } {
    const layout = this.normalizeTableColumnLayout(value);
    return layout ? { layout } : {};
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private isUuid(value?: string): boolean {
    return typeof value === "string" && UUID_REGEX.test(value);
  }
}
