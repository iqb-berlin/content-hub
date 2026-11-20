import { normalizeGrants } from "../auth/capabilities/ap-capabilities";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
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
import { normalizeFeatureConfig } from "./feature-config.utils";
import { ApIndexService } from "./ap-index.service";

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
    @Optional() private readonly apIndexService?: ApIndexService,
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

    const ap = this.apRepository.create({
      packageId: dto.packageId,
      name: dto.name,
      description: dto.description,
      apIndex: {},
      apIndexSchemaId: "acp-index@0.6",
      apIndexValidationStatus: "CONFORMANT",
    });

    ap.apIndex =
      this.apIndexService?.createEmptyIndex(ap) || this.createFallbackIndex(ap);

    const savedAp = await this.apRepository.save(ap);
    await this.createDefaultAccessConfig(savedAp.id, false);
    return savedAp;
  }

  async update(id: string, dto: UpdateApDto): Promise<Ap> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Ap);
      const ap = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!ap) throw new NotFoundException(`AP with ID ${id} not found`);
      if (
        ["RELEASED_PUBLIC", "RELEASED_CONFIDENTIAL"].includes(
          String(ap.apIndex?.status),
        )
      ) {
        throw new ConflictException(
          "Published AP must be reopened before it can be changed",
        );
      }
      if (dto.name !== undefined) {
        const names = Array.isArray(ap.apIndex.name)
          ? [...ap.apIndex.name]
          : [];
        const german = names.findIndex((entry) => entry?.lang === "de");
        if (german < 0) names.push({ lang: "de", value: dto.name });
        else names[german] = { ...names[german], value: dto.name };
        ap.name = dto.name;
        ap.apIndex = { ...ap.apIndex, name: names };
        ap.apIndexValidationStatus = "UNKNOWN";
        ap.apIndexValidationReport = null;
      }
      if (dto.description !== undefined) ap.description = dto.description;
      return repository.save(ap);
    });
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
    return ap.apIndex;
  }

  async updateIndex(
    id: string,
    index: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ): Promise<Record<string, unknown>> {
    const saved = this.apIndexService
      ? await this.apIndexService.saveCandidate(id, index, expectedUpdatedAt)
      : await this.saveFallbackIndex(id, index);
    return saved.apIndex;
  }

  async importIndex(
    id: string,
    indexJson: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ): Promise<Record<string, unknown>> {
    const saved = this.apIndexService
      ? await this.apIndexService.saveCandidate(
          id,
          indexJson,
          expectedUpdatedAt,
        )
      : await this.saveFallbackIndex(id, indexJson);
    return saved.apIndex;
  }

  async deleteIndex(
    id: string,
    expectedUpdatedAt?: string,
  ): Promise<Record<string, unknown>> {
    const ap = await this.findById(id);

    let candidate =
      this.apIndexService?.createEmptyIndex(ap) || this.createFallbackIndex(ap);
    if (!this.apIndexService) {
      const settings = await this.settingsRepository.findOne({ where: {} });
      candidate = this.normalizeFallbackIndex(ap, {
        ...(settings?.defaultApIndex || {}),
        ...candidate,
      });
    }
    const saved = this.apIndexService
      ? await this.apIndexService.saveCandidate(
          id,
          candidate,
          expectedUpdatedAt,
        )
      : await this.saveFallbackIndex(id, candidate);
    return saved.apIndex;
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

  private createFallbackIndex(
    ap: Pick<Ap, "packageId" | "name" | "description">,
  ): Record<string, unknown> {
    return {
      packageId: ap.packageId,
      version: "0.5.0",
      name: [{ lang: "de", value: ap.name || ap.packageId }],
      ...(ap.description
        ? { description: [{ lang: "de", value: ap.description }] }
        : {}),
      status: "IN_DEVELOPMENT",
    };
  }

  private normalizeFallbackIndex(
    ap: Ap,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new BadRequestException("AP index must be an object");
    const candidate = { ...this.createFallbackIndex(ap), ...input };
    if (candidate.packageId !== ap.packageId)
      throw new BadRequestException("packageId mismatch");
    if (typeof candidate.version !== "string")
      throw new BadRequestException("version must be a string");
    if (
      !Array.isArray(candidate.name) ||
      candidate.name.some((entry: unknown) => {
        const record = entry !== null && typeof entry === "object" ? entry : {};
        const value = "value" in record ? record.value : undefined;
        const lang = "lang" in record ? record.lang : undefined;
        return (
          typeof value !== "string" ||
          !value.trim() ||
          typeof lang !== "string" ||
          !/^[a-z]{2}$/.test(lang)
        );
      })
    )
      throw new BadRequestException("name must be language-tagged text");
    if (typeof candidate.status !== "string")
      throw new BadRequestException("status must be a string");
    if (
      ![
        "IN_DEVELOPMENT",
        "DISCONTINUED",
        "RELEASED_PUBLIC",
        "RELEASED_CONFIDENTIAL",
      ].includes(candidate.status)
    )
      throw new BadRequestException("Invalid status");
    if (
      Array.isArray(candidate.units) &&
      !Array.isArray(candidate.assessmentParts)
    ) {
      candidate.assessmentParts = [
        {
          id: "default-assessment-part",
          name: [{ lang: "de", value: "Default Assessment Part" }],
          units: candidate.units,
        },
      ];
    }
    return candidate;
  }

  private async saveFallbackIndex(
    id: string,
    input: Record<string, unknown>,
  ): Promise<Ap> {
    const ap = await this.findById(id);
    ap.apIndex = this.normalizeFallbackIndex(ap, input);
    return this.apRepository.save(ap);
  }
}
