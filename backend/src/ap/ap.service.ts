import { normalizeGrants } from "../auth/capabilities/ap-capabilities";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ApCredentialsService } from "./ap-credentials.service";
import {
  Ap,
  ApUserRole,
  ApRole,
  ApAccessConfig,
  AccessModel,
  AppSettings,
  ItemResponseState,
  User,
} from "../database/entities";
import {
  CreateApDto,
  UpdateApDto,
  AssignRoleDto,
  UpdateAccessConfigDto,
  CredentialEntryDto,
  UpdateMetadataColumnsDto,
  CredentialResponseDto,
  CreateCredentialDto,
  UpdateCredentialDto,
} from "./dto/ap.dto";
import {
  AP_INDEX_ALLOWED_STATUS_VALUES,
  DEFAULT_AP_INDEX_VERSION,
  normalizeIndexForStorage,
  toRuntimeApIndex,
} from "./ap-index.utils";
import { normalizeFeatureConfig } from "./feature-config.utils";

const PLAYER_FOCUS_HIGHLIGHT_FEATURE_KEY = "enablePlayerFocusHighlight";

@Injectable()
export class ApService {
  constructor(
    @InjectRepository(Ap)
    private readonly apRepository: Repository<Ap>,
    @InjectRepository(ApUserRole)
    private readonly apUserRoleRepository: Repository<ApUserRole>,
    @InjectRepository(ApAccessConfig)
    private readonly accessConfigRepository: Repository<ApAccessConfig>,
    private readonly credentialsService: ApCredentialsService,
    @InjectRepository(AppSettings)
    private readonly settingsRepository: Repository<AppSettings>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(): Promise<Ap[]> {
    return this.apRepository.find({ order: { name: "ASC" } });
  }

  async findByUser(userId: string): Promise<Ap[]> {
    const roles = await this.apUserRoleRepository.find({
      where: { userId },
      relations: ["ap"],
    });
    return roles.map((r) => r.ap);
  }

  async findById(id: string): Promise<Ap> {
    const ap = await this.apRepository.findOne({ where: { id } });
    if (!ap) {
      throw new NotFoundException(`AP with ID ${id} not found`);
    }
    return ap;
  }

  async create(dto: CreateApDto): Promise<Ap> {
    const existing = await this.apRepository.findOne({
      where: { packageId: dto.packageId },
    });
    if (existing) {
      throw new ConflictException(
        `Package ID "${dto.packageId}" already exists`,
      );
    }

    // Get default AP index from settings
    let defaultIndex: Record<string, unknown> = {};
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (settings?.defaultApIndex) {
      defaultIndex = { ...settings.defaultApIndex };
    }

    const normalizedIndex = normalizeIndexForStorage({
      ...defaultIndex,
      packageId: dto.packageId,
      version: DEFAULT_AP_INDEX_VERSION,
      name: [{ lang: "de", value: dto.name }],
      description: dto.description
        ? [{ lang: "de", value: dto.description }]
        : [],
      status: "IN_DEVELOPMENT",
      units: [],
      assessmentParts: [],
    });

    const ap = this.apRepository.create({
      packageId: dto.packageId,
      name: dto.name,
      description: dto.description,
      apIndex: normalizedIndex,
    });

    const savedAp = await this.apRepository.save(ap);
    await this.createDefaultAccessConfig(savedAp.id, false);
    return savedAp;
  }

  async update(id: string, dto: UpdateApDto): Promise<Ap> {
    const ap = await this.findById(id);
    if (dto.name !== undefined) ap.name = dto.name;
    if (dto.description !== undefined) ap.description = dto.description;
    return this.apRepository.save(ap);
  }

  async delete(id: string): Promise<void> {
    const ap = await this.findById(id);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ItemResponseState).delete({ apId: id });
      await manager.getRepository(Ap).remove(ap);
    });
  }

  // AP-Index management
  async getIndex(id: string): Promise<Record<string, unknown>> {
    const ap = await this.findById(id);
    return toRuntimeApIndex(ap.apIndex);
  }

  async updateIndex(
    id: string,
    index: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ap = await this.findById(id);
    ap.apIndex = this.prepareIndexForSave(ap, index, {});
    const saved = await this.apRepository.save(ap);
    return toRuntimeApIndex(saved.apIndex);
  }

  async importIndex(
    id: string,
    indexJson: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ap = await this.findById(id);

    // Get default settings for required fields
    let defaultIndex: Record<string, unknown> = {};
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (settings?.defaultApIndex) {
      defaultIndex = { ...settings.defaultApIndex };
    }

    // Merge: uploaded index takes priority, defaults fill in missing required fields
    ap.apIndex = this.prepareIndexForSave(ap, indexJson, defaultIndex);
    const saved = await this.apRepository.save(ap);
    return toRuntimeApIndex(saved.apIndex);
  }

  async deleteIndex(id: string): Promise<Record<string, unknown>> {
    const ap = await this.findById(id);

    // Reset to default AP index shape from settings + AP fallback fields.
    let defaultIndex: Record<string, unknown> = {};
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (settings?.defaultApIndex) {
      defaultIndex = { ...settings.defaultApIndex };
    }

    ap.apIndex = this.prepareIndexForSave(ap, {}, defaultIndex);
    const saved = await this.apRepository.save(ap);
    return toRuntimeApIndex(saved.apIndex);
  }

  // Role management
  async updateRoleCapabilities(
    apId: string,
    userId: string,
    capabilities: string[],
  ) {
    const role = await this.apUserRoleRepository.findOne({
      where: { apId, userId },
    });
    if (!role) throw new NotFoundException("AP-Zuordnung nicht gefunden");
    role.capabilities = normalizeGrants(capabilities);
    return this.apUserRoleRepository.save(role);
  }

  async assignRole(apId: string, dto: AssignRoleDto): Promise<ApUserRole> {
    await this.findById(apId);
    const targetUser = await this.userRepository.findOne({
      where: { id: dto.userId },
    });
    if (!targetUser) {
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    const targetRole = ApRole[dto.role];

    const existing = await this.apUserRoleRepository.findOne({
      where: { userId: dto.userId, apId },
    });
    if (existing) {
      if (
        existing.role === ApRole.AP_MANAGER &&
        targetRole !== ApRole.AP_MANAGER
      ) {
        const managerCount = await this.countApManagers(apId);
        if (managerCount <= 1) {
          throw new BadRequestException(
            "At least one AP_MANAGER must remain assigned",
          );
        }
      }
      existing.role = targetRole;
      if (dto.capabilities !== undefined)
        existing.capabilities = normalizeGrants(dto.capabilities);
      return this.apUserRoleRepository.save(existing);
    }

    const role = this.apUserRoleRepository.create({
      userId: dto.userId,
      apId,
      role: targetRole,
      capabilities: normalizeGrants(dto.capabilities ?? []),
    });
    return this.apUserRoleRepository.save(role);
  }

  async removeRole(apId: string, userId: string): Promise<void> {
    const role = await this.apUserRoleRepository.findOne({
      where: { userId, apId },
    });
    if (role) {
      if (role.role === ApRole.AP_MANAGER) {
        const managerCount = await this.countApManagers(apId);
        if (managerCount <= 1) {
          throw new BadRequestException(
            "At least one AP_MANAGER must remain assigned",
          );
        }
      }
      await this.apUserRoleRepository.remove(role);
    }
  }

  async getRoles(apId: string): Promise<ApUserRole[]> {
    return this.apUserRoleRepository.find({
      where: { apId },
      relations: ["user"],
    });
  }

  // Access configuration
  async getAccessConfig(apId: string): Promise<ApAccessConfig> {
    await this.findById(apId);

    return this.accessConfigRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ApAccessConfig);
      const existingConfig = await repository.findOne({
        lock: { mode: "pessimistic_write", tables: ["acp_access_configs"] },
        where: { apId },
        relations: ["credentials"],
      });
      const config = await this.ensureAccessConfig(
        apId,
        existingConfig,
        repository,
      );

      const normalizedFeatureConfig = normalizeFeatureConfig(
        config.featureConfig || {},
      );
      if (
        JSON.stringify(config.featureConfig || {}) !==
        JSON.stringify(normalizedFeatureConfig)
      ) {
        config.featureConfig = normalizedFeatureConfig;
        return repository.save(config);
      }

      return config;
    });
  }

  async updateAccessConfig(
    apId: string,
    dto: UpdateAccessConfigDto,
  ): Promise<ApAccessConfig> {
    await this.findById(apId);

    return this.accessConfigRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ApAccessConfig);
      let config = await repository.findOne({
        where: { apId },
        lock: { mode: "pessimistic_write" },
      });
      const canRetainCredentialValidity =
        config?.accessModel === AccessModel.CREDENTIALS_LIST &&
        dto.accessModel === AccessModel.CREDENTIALS_LIST;
      const existingValidFrom = canRetainCredentialValidity
        ? config?.validFrom
        : undefined;
      const existingValidUntil = canRetainCredentialValidity
        ? config?.validUntil
        : undefined;
      const validFrom = dto.validFrom
        ? new Date(dto.validFrom)
        : existingValidFrom;
      const validUntil = dto.validUntil
        ? new Date(dto.validUntil)
        : existingValidUntil;

      // Validate time limit for CREDENTIALS_LIST
      if (dto.accessModel === "CREDENTIALS_LIST") {
        if (!validFrom || !validUntil) {
          throw new BadRequestException(
            "Credential-based access requires validFrom and validUntil",
          );
        }

        if (
          Number.isNaN(validFrom.getTime()) ||
          Number.isNaN(validUntil.getTime())
        ) {
          throw new BadRequestException(
            "validFrom and validUntil must be valid ISO date strings",
          );
        }
        if (validUntil <= validFrom) {
          throw new BadRequestException("validUntil must be after validFrom");
        }

        const maxEnd = new Date(validFrom);
        maxEnd.setMonth(maxEnd.getMonth() + 3);
        if (validUntil > maxEnd) {
          throw new BadRequestException(
            "Credential-based access is limited to 3 months",
          );
        }
      }

      if (config) {
        config.accessModel = AccessModel[dto.accessModel];
        if (dto.allowRegistered !== undefined)
          config.allowRegistered = dto.allowRegistered;
        if (dto.featureConfig)
          config.featureConfig = normalizeFeatureConfig({
            ...dto.featureConfig,
            // Review-owned settings only change through the versioned review API.
            enableReview: config.featureConfig.enableReview === true,
            hideReviewMetadata:
              config.featureConfig.hideReviewMetadata === true,
            hideReviewDeveloperNames:
              config.featureConfig.hideReviewDeveloperNames === true,
            commentVisibilityMode:
              config.featureConfig.commentVisibilityMode || "PRIVATE",
            ungroupedVisibilityMode:
              config.featureConfig.ungroupedVisibilityMode || "PRIVATE",
          });
        config.validFrom =
          dto.accessModel === "CREDENTIALS_LIST" ? validFrom : null;
        config.validUntil =
          dto.accessModel === "CREDENTIALS_LIST" ? validUntil : null;
      } else {
        config = repository.create({
          apId,
          accessModel: AccessModel[dto.accessModel],
          allowRegistered: dto.allowRegistered || false,
          featureConfig: normalizeFeatureConfig({
            [PLAYER_FOCUS_HIGHLIGHT_FEATURE_KEY]: false,
            ...(dto.featureConfig || {}),
            enableReview: false,
            hideReviewMetadata: false,
            hideReviewDeveloperNames: false,
            commentVisibilityMode: "PRIVATE",
            ungroupedVisibilityMode: "PRIVATE",
          }),
          validFrom: dto.accessModel === "CREDENTIALS_LIST" ? validFrom : null,
          validUntil:
            dto.accessModel === "CREDENTIALS_LIST" ? validUntil : null,
        });
      }

      return repository.save(config);
    });
  }

  async updateMetadataColumns(
    apId: string,
    dto: UpdateMetadataColumnsDto,
  ): Promise<ApAccessConfig> {
    await this.findById(apId);

    return this.accessConfigRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ApAccessConfig);
      const existingConfig = await repository.findOne({
        lock: { mode: "pessimistic_write", tables: ["acp_access_configs"] },
        where: { apId },
      });
      const config = await this.ensureAccessConfig(
        apId,
        existingConfig,
        repository,
      );

      const currentConfig = config.featureConfig || {};
      const normalizedConfig = normalizeFeatureConfig(currentConfig);
      const currentMetadataColumns =
        normalizedConfig.metadataColumns &&
        typeof normalizedConfig.metadataColumns === "object" &&
        !Array.isArray(normalizedConfig.metadataColumns)
          ? (normalizedConfig.metadataColumns as Record<string, unknown>)
          : {};
      normalizedConfig.metadataColumns = {
        ...currentMetadataColumns,
        visible: dto.visibleColumns,
        order: dto.columnOrder || dto.visibleColumns,
        configured: true,
      };

      config.featureConfig = normalizedConfig;
      return repository.save(config);
    });
  }

  uploadCredentials(
    apId: string,
    credentials: CredentialEntryDto[],
    mode: "replace" | "append" | "upsert" = "replace",
    grants?: string[],
  ) {
    return this.credentialsService.uploadCredentials(
      apId,
      credentials,
      mode,
      grants,
    );
  }

  getCredentials(apId: string): Promise<CredentialResponseDto[]> {
    return this.credentialsService.getCredentials(apId);
  }

  deleteCredential(apId: string, credentialId: string): Promise<void> {
    return this.credentialsService.deleteCredential(apId, credentialId);
  }

  createCredential(
    apId: string,
    dto: CreateCredentialDto,
  ): Promise<CredentialResponseDto> {
    return this.credentialsService.createCredential(apId, dto);
  }

  updateCredential(
    apId: string,
    credentialId: string,
    dto: UpdateCredentialDto,
  ): Promise<CredentialResponseDto> {
    return this.credentialsService.updateCredential(apId, credentialId, dto);
  }

  async getAssignableUsers(
    apId: string,
  ): Promise<Pick<User, "id" | "username" | "displayName">[]> {
    await this.findById(apId);
    return this.userRepository.find({
      select: ["id", "username", "displayName"],
      order: { username: "ASC" },
    });
  }

  private async countApManagers(apId: string): Promise<number> {
    return this.apUserRoleRepository.count({
      where: { apId, role: ApRole.AP_MANAGER },
    });
  }

  private async ensureAccessConfig(
    apId: string,
    existingConfig: ApAccessConfig | null,
    repository = this.accessConfigRepository,
  ): Promise<ApAccessConfig> {
    if (existingConfig) {
      return existingConfig;
    }

    return this.createDefaultAccessConfig(apId, false, repository);
  }

  private async createDefaultAccessConfig(
    apId: string,
    enablePlayerFocusHighlight: boolean,
    repository = this.accessConfigRepository,
  ): Promise<ApAccessConfig> {
    const config = repository.create({
      apId,
      accessModel: AccessModel.PRIVATE,
      allowRegistered: false,
      featureConfig: normalizeFeatureConfig({
        [PLAYER_FOCUS_HIGHLIGHT_FEATURE_KEY]: enablePlayerFocusHighlight,
      }),
    });
    return repository.save(config);
  }

  private prepareIndexForSave(
    ap: Ap,
    inputIndex: Record<string, unknown>,
    defaultIndex: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      !inputIndex ||
      typeof inputIndex !== "object" ||
      Array.isArray(inputIndex)
    ) {
      throw new BadRequestException("AP-Index muss ein JSON-Objekt sein.");
    }

    const merged = { ...defaultIndex, ...inputIndex } as Record<
      string,
      unknown
    >;
    const packageId = this.resolvePackageId(ap, merged.packageId);
    const version = this.resolveVersion(merged.version);
    const status = this.resolveStatus(merged.status);
    const name = this.resolveLanguageTextArray(
      merged.name,
      [{ lang: "de", value: ap.name || ap.packageId }],
      "name",
    );
    const description = this.resolveLanguageTextArray(
      merged.description,
      ap.description ? [{ lang: "de", value: ap.description }] : [],
      "description",
      true,
    );

    const sanitizedIndex = {
      ...merged,
      packageId,
      version,
      status,
      name,
      description,
    };

    return normalizeIndexForStorage(sanitizedIndex);
  }

  private resolvePackageId(ap: Ap, rawPackageId: unknown): string {
    if (
      rawPackageId === undefined ||
      rawPackageId === null ||
      rawPackageId === ""
    ) {
      return ap.packageId;
    }

    if (typeof rawPackageId !== "string") {
      throw new BadRequestException(
        'Ungültiges Feld "packageId": Muss ein Text sein.',
      );
    }

    if (rawPackageId !== ap.packageId) {
      throw new BadRequestException(
        `Ungültiges Feld "packageId": Erwartet "${ap.packageId}", erhalten "${rawPackageId}".`,
      );
    }

    return rawPackageId;
  }

  private resolveVersion(rawVersion: unknown): string {
    if (rawVersion === undefined || rawVersion === null || rawVersion === "") {
      return DEFAULT_AP_INDEX_VERSION;
    }

    if (typeof rawVersion !== "string") {
      throw new BadRequestException(
        'Ungültiges Feld "version": Muss ein Text sein.',
      );
    }

    return rawVersion;
  }

  private resolveStatus(rawStatus: unknown): string {
    if (rawStatus === undefined || rawStatus === null || rawStatus === "") {
      return "IN_DEVELOPMENT";
    }

    if (typeof rawStatus !== "string") {
      throw new BadRequestException(
        'Ungültiges Feld "status": Muss ein Text sein.',
      );
    }

    if (
      !AP_INDEX_ALLOWED_STATUS_VALUES.some((status) => status === rawStatus)
    ) {
      throw new BadRequestException(
        `Ungültiges Feld "status": "${rawStatus}". Erlaubte Werte: ${AP_INDEX_ALLOWED_STATUS_VALUES.join(", ")}`,
      );
    }

    return rawStatus;
  }

  private resolveLanguageTextArray(
    rawValue: unknown,
    fallback: Array<{ lang: string; value: string }>,
    fieldName: string,
    optional = false,
  ): Array<{ lang: string; value: string }> {
    if (rawValue === undefined || rawValue === null) {
      return optional ? fallback : [...fallback];
    }

    if (!Array.isArray(rawValue)) {
      throw new BadRequestException(
        `Ungültiges Feld "${fieldName}": Muss ein Array sein.`,
      );
    }

    if (rawValue.length === 0) {
      return optional ? [] : [...fallback];
    }

    const parsed = rawValue.map((entry: unknown, idx) => {
      const record = entry !== null && typeof entry === "object" ? entry : {};
      const lang = "lang" in record ? record.lang : undefined;
      const value = "value" in record ? record.value : undefined;

      if (typeof lang !== "string" || !/^[a-z]{2}$/.test(lang)) {
        throw new BadRequestException(
          `Ungültiges Feld "${fieldName}[${idx}].lang": Muss ein ISO-Sprachcode mit 2 Kleinbuchstaben sein.`,
        );
      }
      if (typeof value !== "string" || !value.trim()) {
        throw new BadRequestException(
          `Ungültiges Feld "${fieldName}[${idx}].value": Muss ein nicht-leerer Text sein.`,
        );
      }

      return { lang, value };
    });

    return parsed;
  }
}
