import { normalizeGrants } from "../auth/capabilities/acp-capabilities";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { AcpCredentialsService } from "./acp-credentials.service";
import {
  Acp,
  AcpUserRole,
  AcpRole,
  AcpAccessConfig,
  AccessModel,
  AppSettings,
  ItemResponseState,
  User,
} from "../database/entities";
import {
  CreateAcpDto,
  UpdateAcpDto,
  AssignRoleDto,
  UpdateAccessConfigDto,
  CredentialEntryDto,
  UpdateMetadataColumnsDto,
  CredentialResponseDto,
  CreateCredentialDto,
  UpdateCredentialDto,
} from "./dto/acp.dto";
import {
  ACP_INDEX_ALLOWED_STATUS_VALUES,
  DEFAULT_ACP_INDEX_VERSION,
  normalizeIndexForStorage,
  toRuntimeAcpIndex,
} from "./acp-index.utils";
import { normalizeFeatureConfig } from "./feature-config.utils";

const PLAYER_FOCUS_HIGHLIGHT_FEATURE_KEY = "enablePlayerFocusHighlight";

@Injectable()
export class AcpService {
  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpUserRole)
    private readonly acpUserRoleRepository: Repository<AcpUserRole>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    private readonly credentialsService: AcpCredentialsService,
    @InjectRepository(AppSettings)
    private readonly settingsRepository: Repository<AppSettings>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(): Promise<Acp[]> {
    return this.acpRepository.find({ order: { name: "ASC" } });
  }

  async findByUser(userId: string): Promise<Acp[]> {
    const roles = await this.acpUserRoleRepository.find({
      where: { userId },
      relations: ["acp"],
    });
    return roles.map((r) => r.acp);
  }

  async findById(id: string): Promise<Acp> {
    const acp = await this.acpRepository.findOne({ where: { id } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${id} not found`);
    }
    return acp;
  }

  async create(dto: CreateAcpDto): Promise<Acp> {
    const existing = await this.acpRepository.findOne({
      where: { packageId: dto.packageId },
    });
    if (existing) {
      throw new ConflictException(
        `Package ID "${dto.packageId}" already exists`,
      );
    }

    // Get default ACP index from settings
    let defaultIndex: Record<string, unknown> = {};
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (settings?.defaultAcpIndex) {
      defaultIndex = { ...settings.defaultAcpIndex };
    }

    const normalizedIndex = normalizeIndexForStorage({
      ...defaultIndex,
      packageId: dto.packageId,
      version: DEFAULT_ACP_INDEX_VERSION,
      name: [{ lang: "de", value: dto.name }],
      description: dto.description
        ? [{ lang: "de", value: dto.description }]
        : [],
      status: "IN_DEVELOPMENT",
      units: [],
      assessmentParts: [],
    });

    const acp = this.acpRepository.create({
      packageId: dto.packageId,
      name: dto.name,
      description: dto.description,
      acpIndex: normalizedIndex,
    });

    const savedAcp = await this.acpRepository.save(acp);
    await this.createDefaultAccessConfig(savedAcp.id, false);
    return savedAcp;
  }

  async update(id: string, dto: UpdateAcpDto): Promise<Acp> {
    const acp = await this.findById(id);
    if (dto.name !== undefined) acp.name = dto.name;
    if (dto.description !== undefined) acp.description = dto.description;
    return this.acpRepository.save(acp);
  }

  async delete(id: string): Promise<void> {
    const acp = await this.findById(id);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ItemResponseState).delete({ acpId: id });
      await manager.getRepository(Acp).remove(acp);
    });
  }

  // ACP-Index management
  async getIndex(id: string): Promise<Record<string, unknown>> {
    const acp = await this.findById(id);
    return toRuntimeAcpIndex(acp.acpIndex);
  }

  async updateIndex(
    id: string,
    index: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const acp = await this.findById(id);
    acp.acpIndex = this.prepareIndexForSave(acp, index, {});
    const saved = await this.acpRepository.save(acp);
    return toRuntimeAcpIndex(saved.acpIndex);
  }

  async importIndex(
    id: string,
    indexJson: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const acp = await this.findById(id);

    // Get default settings for required fields
    let defaultIndex: Record<string, unknown> = {};
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (settings?.defaultAcpIndex) {
      defaultIndex = { ...settings.defaultAcpIndex };
    }

    // Merge: uploaded index takes priority, defaults fill in missing required fields
    acp.acpIndex = this.prepareIndexForSave(acp, indexJson, defaultIndex);
    const saved = await this.acpRepository.save(acp);
    return toRuntimeAcpIndex(saved.acpIndex);
  }

  async deleteIndex(id: string): Promise<Record<string, unknown>> {
    const acp = await this.findById(id);

    // Reset to default ACP index shape from settings + ACP fallback fields.
    let defaultIndex: Record<string, unknown> = {};
    const settings = await this.settingsRepository.findOne({ where: {} });
    if (settings?.defaultAcpIndex) {
      defaultIndex = { ...settings.defaultAcpIndex };
    }

    acp.acpIndex = this.prepareIndexForSave(acp, {}, defaultIndex);
    const saved = await this.acpRepository.save(acp);
    return toRuntimeAcpIndex(saved.acpIndex);
  }

  // Role management
  async updateRoleCapabilities(
    acpId: string,
    userId: string,
    capabilities: string[],
  ) {
    const role = await this.acpUserRoleRepository.findOne({
      where: { acpId, userId },
    });
    if (!role) throw new NotFoundException("ACP-Zuordnung nicht gefunden");
    role.capabilities = normalizeGrants(capabilities);
    return this.acpUserRoleRepository.save(role);
  }

  async assignRole(acpId: string, dto: AssignRoleDto): Promise<AcpUserRole> {
    await this.findById(acpId);
    const targetUser = await this.userRepository.findOne({
      where: { id: dto.userId },
    });
    if (!targetUser) {
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    const targetRole = AcpRole[dto.role];

    const existing = await this.acpUserRoleRepository.findOne({
      where: { userId: dto.userId, acpId },
    });
    if (existing) {
      if (
        existing.role === AcpRole.ACP_MANAGER &&
        targetRole !== AcpRole.ACP_MANAGER
      ) {
        const managerCount = await this.countAcpManagers(acpId);
        if (managerCount <= 1) {
          throw new BadRequestException(
            "At least one ACP_MANAGER must remain assigned",
          );
        }
      }
      existing.role = targetRole;
      if (dto.capabilities !== undefined)
        existing.capabilities = normalizeGrants(dto.capabilities);
      return this.acpUserRoleRepository.save(existing);
    }

    const role = this.acpUserRoleRepository.create({
      userId: dto.userId,
      acpId,
      role: targetRole,
      capabilities: normalizeGrants(dto.capabilities ?? []),
    });
    return this.acpUserRoleRepository.save(role);
  }

  async removeRole(acpId: string, userId: string): Promise<void> {
    const role = await this.acpUserRoleRepository.findOne({
      where: { userId, acpId },
    });
    if (role) {
      if (role.role === AcpRole.ACP_MANAGER) {
        const managerCount = await this.countAcpManagers(acpId);
        if (managerCount <= 1) {
          throw new BadRequestException(
            "At least one ACP_MANAGER must remain assigned",
          );
        }
      }
      await this.acpUserRoleRepository.remove(role);
    }
  }

  async getRoles(acpId: string): Promise<AcpUserRole[]> {
    return this.acpUserRoleRepository.find({
      where: { acpId },
      relations: ["user"],
    });
  }

  // Access configuration
  async getAccessConfig(acpId: string): Promise<AcpAccessConfig> {
    await this.findById(acpId);

    return this.accessConfigRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(AcpAccessConfig);
      const existingConfig = await repository.findOne({
        lock: { mode: "pessimistic_write", tables: ["acp_access_configs"] },
        where: { acpId },
        relations: ["credentials"],
      });
      const config = await this.ensureAccessConfig(
        acpId,
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
    acpId: string,
    dto: UpdateAccessConfigDto,
  ): Promise<AcpAccessConfig> {
    await this.findById(acpId);

    return this.accessConfigRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(AcpAccessConfig);
      let config = await repository.findOne({
        where: { acpId },
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
            enableReview: config.featureConfig.enableReview === true,
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
          acpId,
          accessModel: AccessModel[dto.accessModel],
          allowRegistered: dto.allowRegistered || false,
          featureConfig: normalizeFeatureConfig({
            [PLAYER_FOCUS_HIGHLIGHT_FEATURE_KEY]: false,
            ...(dto.featureConfig || {}),
            enableReview: false,
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
    acpId: string,
    dto: UpdateMetadataColumnsDto,
  ): Promise<AcpAccessConfig> {
    await this.findById(acpId);

    return this.accessConfigRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(AcpAccessConfig);
      const existingConfig = await repository.findOne({
        lock: { mode: "pessimistic_write", tables: ["acp_access_configs"] },
        where: { acpId },
      });
      const config = await this.ensureAccessConfig(
        acpId,
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
    acpId: string,
    credentials: CredentialEntryDto[],
    mode: "replace" | "append" | "upsert" = "replace",
    grants?: string[],
  ) {
    return this.credentialsService.uploadCredentials(
      acpId,
      credentials,
      mode,
      grants,
    );
  }

  getCredentials(acpId: string): Promise<CredentialResponseDto[]> {
    return this.credentialsService.getCredentials(acpId);
  }

  deleteCredential(acpId: string, credentialId: string): Promise<void> {
    return this.credentialsService.deleteCredential(acpId, credentialId);
  }

  createCredential(
    acpId: string,
    dto: CreateCredentialDto,
  ): Promise<CredentialResponseDto> {
    return this.credentialsService.createCredential(acpId, dto);
  }

  updateCredential(
    acpId: string,
    credentialId: string,
    dto: UpdateCredentialDto,
  ): Promise<CredentialResponseDto> {
    return this.credentialsService.updateCredential(acpId, credentialId, dto);
  }

  async getAssignableUsers(
    acpId: string,
  ): Promise<Pick<User, "id" | "username" | "displayName">[]> {
    await this.findById(acpId);
    return this.userRepository.find({
      select: ["id", "username", "displayName"],
      order: { username: "ASC" },
    });
  }

  private async countAcpManagers(acpId: string): Promise<number> {
    return this.acpUserRoleRepository.count({
      where: { acpId, role: AcpRole.ACP_MANAGER },
    });
  }

  private async ensureAccessConfig(
    acpId: string,
    existingConfig: AcpAccessConfig | null,
    repository = this.accessConfigRepository,
  ): Promise<AcpAccessConfig> {
    if (existingConfig) {
      return existingConfig;
    }

    return this.createDefaultAccessConfig(acpId, false, repository);
  }

  private async createDefaultAccessConfig(
    acpId: string,
    enablePlayerFocusHighlight: boolean,
    repository = this.accessConfigRepository,
  ): Promise<AcpAccessConfig> {
    const config = repository.create({
      acpId,
      accessModel: AccessModel.PRIVATE,
      allowRegistered: false,
      featureConfig: normalizeFeatureConfig({
        [PLAYER_FOCUS_HIGHLIGHT_FEATURE_KEY]: enablePlayerFocusHighlight,
      }),
    });
    return repository.save(config);
  }

  private prepareIndexForSave(
    acp: Acp,
    inputIndex: Record<string, unknown>,
    defaultIndex: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      !inputIndex ||
      typeof inputIndex !== "object" ||
      Array.isArray(inputIndex)
    ) {
      throw new BadRequestException("ACP-Index muss ein JSON-Objekt sein.");
    }

    const merged = { ...defaultIndex, ...inputIndex } as Record<
      string,
      unknown
    >;
    const packageId = this.resolvePackageId(acp, merged.packageId);
    const version = this.resolveVersion(merged.version);
    const status = this.resolveStatus(merged.status);
    const name = this.resolveLanguageTextArray(
      merged.name,
      [{ lang: "de", value: acp.name || acp.packageId }],
      "name",
    );
    const description = this.resolveLanguageTextArray(
      merged.description,
      acp.description ? [{ lang: "de", value: acp.description }] : [],
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

  private resolvePackageId(acp: Acp, rawPackageId: unknown): string {
    if (
      rawPackageId === undefined ||
      rawPackageId === null ||
      rawPackageId === ""
    ) {
      return acp.packageId;
    }

    if (typeof rawPackageId !== "string") {
      throw new BadRequestException(
        'Ungültiges Feld "packageId": Muss ein Text sein.',
      );
    }

    if (rawPackageId !== acp.packageId) {
      throw new BadRequestException(
        `Ungültiges Feld "packageId": Erwartet "${acp.packageId}", erhalten "${rawPackageId}".`,
      );
    }

    return rawPackageId;
  }

  private resolveVersion(rawVersion: unknown): string {
    if (rawVersion === undefined || rawVersion === null || rawVersion === "") {
      return DEFAULT_ACP_INDEX_VERSION;
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
      !ACP_INDEX_ALLOWED_STATUS_VALUES.some((status) => status === rawStatus)
    ) {
      throw new BadRequestException(
        `Ungültiges Feld "status": "${rawStatus}". Erlaubte Werte: ${ACP_INDEX_ALLOWED_STATUS_VALUES.join(", ")}`,
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
