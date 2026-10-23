import { normalizeGrants } from "../auth/capabilities/acp-capabilities";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
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
import { normalizeFeatureConfig } from "./feature-config.utils";
import { AcpIndexService } from "./acp-index.service";

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
    @Optional() private readonly acpIndexService?: AcpIndexService,
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

    const acp = this.acpRepository.create({
      packageId: dto.packageId,
      name: dto.name,
      description: dto.description,
      acpIndex: {},
      acpIndexSchemaId: "acp-index@0.6",
      acpIndexValidationStatus: "CONFORMANT",
    });

    acp.acpIndex =
      this.acpIndexService?.createEmptyIndex(acp) ||
      this.createFallbackIndex(acp);

    const savedAcp = await this.acpRepository.save(acp);
    await this.createDefaultAccessConfig(savedAcp.id, false);
    return savedAcp;
  }

  async update(id: string, dto: UpdateAcpDto): Promise<Acp> {
    const acp = await this.findById(id);
    if (
      acp.acpIndex?.status === "RELEASED_PUBLIC" ||
      acp.acpIndex?.status === "RELEASED_CONFIDENTIAL"
    ) {
      throw new ConflictException(
        "Published ACP must be reopened before it can be changed",
      );
    }
    if (dto.name !== undefined) {
      const localizedNames = Array.isArray(acp.acpIndex?.name)
        ? [...(acp.acpIndex.name as Array<{ lang: string; value: string }>)]
        : [];
      const germanIndex = localizedNames.findIndex(
        (entry) => entry?.lang === "de",
      );
      if (germanIndex >= 0)
        localizedNames[germanIndex] = { lang: "de", value: dto.name };
      else localizedNames.push({ lang: "de", value: dto.name });
      const candidate = { ...acp.acpIndex, name: localizedNames };
      if (this.acpIndexService) {
        return this.acpIndexService.saveCandidate(
          id,
          candidate,
          acp.updatedAt.toISOString(),
          { name: dto.name, description: dto.description },
        );
      }
      acp.name = dto.name;
      acp.acpIndex = candidate;
    }
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
    return acp.acpIndex;
  }

  async updateIndex(
    id: string,
    index: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ): Promise<Record<string, unknown>> {
    const saved = this.acpIndexService
      ? await this.acpIndexService.saveCandidate(id, index, expectedUpdatedAt)
      : await this.saveFallbackIndex(id, index);
    return saved.acpIndex;
  }

  async importIndex(
    id: string,
    indexJson: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ): Promise<Record<string, unknown>> {
    const saved = this.acpIndexService
      ? await this.acpIndexService.saveCandidate(
          id,
          indexJson,
          expectedUpdatedAt,
        )
      : await this.saveFallbackIndex(id, indexJson);
    return saved.acpIndex;
  }

  async deleteIndex(
    id: string,
    expectedUpdatedAt?: string,
  ): Promise<Record<string, unknown>> {
    const acp = await this.findById(id);

    let candidate =
      this.acpIndexService?.createEmptyIndex(acp) ||
      this.createFallbackIndex(acp);
    if (!this.acpIndexService) {
      const settings = await this.settingsRepository.findOne({ where: {} });
      candidate = this.normalizeFallbackIndex(acp, {
        ...(settings?.defaultAcpIndex || {}),
        ...candidate,
      });
    }
    const saved = this.acpIndexService
      ? await this.acpIndexService.saveCandidate(
          id,
          candidate,
          expectedUpdatedAt,
        )
      : await this.saveFallbackIndex(id, candidate);
    return saved.acpIndex;
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

  private createFallbackIndex(
    acp: Pick<Acp, "packageId" | "name" | "description">,
  ): Record<string, unknown> {
    return {
      packageId: acp.packageId,
      version: "0.5.0",
      name: [{ lang: "de", value: acp.name || acp.packageId }],
      ...(acp.description
        ? { description: [{ lang: "de", value: acp.description }] }
        : {}),
      status: "IN_DEVELOPMENT",
    };
  }

  private normalizeFallbackIndex(
    acp: Acp,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new BadRequestException("ACP index must be an object");
    const candidate = { ...this.createFallbackIndex(acp), ...input };
    if (candidate.packageId !== acp.packageId)
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
  ): Promise<Acp> {
    const acp = await this.findById(id);
    acp.acpIndex = this.normalizeFallbackIndex(acp, input);
    return this.acpRepository.save(acp);
  }
}
