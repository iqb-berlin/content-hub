import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Raw, Repository } from "typeorm";
import { validate as isUuid } from "uuid";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import {
  Acp,
  AppSettings,
  ApplicationToken,
  ServerApiAuditLog,
} from "../database/entities";
import { DEFAULT_ACP_INDEX_VERSION } from "../acp/acp-index.utils";
import { ALL_SERVER_API_SCOPE_SET } from "../api/server-api-scopes";
import {
  generateServerApiToken,
  getServerApiTokenDisplayPrefix,
  hashServerApiToken,
} from "../api/server-api-token.util";
import {
  GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
  GEOGEBRA_PLAYER_RESOURCE_BASE,
  GEOGEBRA_REQUIRED_ENTRY,
  getGeoGebraBundleBaseDir,
  getGeoGebraBundleCurrentDir,
} from "./geogebra-bundle.util";

export interface CreateApplicationTokenInput {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  allowedAcpIds?: string[] | null;
}

export interface ListApplicationTokensOptions {
  limit?: number;
  offset?: number;
  allowedAcpId?: string;
}

export interface ApplicationTokenActorConstraints {
  allowedAcpIds?: string[];
  requireExclusiveAcp?: boolean;
  auditAcpId?: string;
  auditPath?: string;
}

export interface ApplicationTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  allowedAcpIds: string[] | null;
  active: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedApplicationTokenResponse extends ApplicationTokenSummary {
  token: string;
}

export interface PaginatedApplicationTokens {
  items: ApplicationTokenSummary[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(AppSettings)
    private readonly settingsRepository: Repository<AppSettings>,
    @InjectRepository(ApplicationToken)
    private readonly applicationTokenRepository: Repository<ApplicationToken>,
    @InjectRepository(ServerApiAuditLog)
    private readonly auditRepository: Repository<ServerApiAuditLog>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
  ) {}

  async getSettings(): Promise<AppSettings> {
    let settings = await this.settingsRepository.findOne({ where: {} });
    if (!settings) {
      settings = this.settingsRepository.create({
        theme: {},
        language: "de",
        defaultAcpIndex: {
          version: DEFAULT_ACP_INDEX_VERSION,
          assessmentParts: [],
        },
        geoGebraBundle: null,
      });
      settings = await this.settingsRepository.save(settings);
    }
    if (settings.geoGebraBundle) {
      settings.geoGebraBundle = {
        ...settings.geoGebraBundle,
        deployScriptUrl: GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
        publicBasePath: GEOGEBRA_PLAYER_RESOURCE_BASE,
      };
    }
    return settings;
  }

  async updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
    const settings = await this.getSettings();
    if (data.theme !== undefined) settings.theme = data.theme;
    if (data.language !== undefined) settings.language = data.language;
    if (data.logoUrl !== undefined) settings.logoUrl = data.logoUrl;
    if (data.landingPageHtml !== undefined)
      settings.landingPageHtml = data.landingPageHtml;
    if (data.imprintHtml !== undefined) settings.imprintHtml = data.imprintHtml;
    if (data.privacyHtml !== undefined) settings.privacyHtml = data.privacyHtml;
    if (data.accessibilityHtml !== undefined)
      settings.accessibilityHtml = data.accessibilityHtml;
    if (data.defaultAcpIndex !== undefined)
      settings.defaultAcpIndex = data.defaultAcpIndex;
    return this.settingsRepository.save(settings);
  }

  async listApplicationTokens(
    options: ListApplicationTokensOptions = {},
  ): Promise<PaginatedApplicationTokens> {
    const limit = this.normalizeApplicationTokenListLimit(options.limit);
    const offset = this.normalizeApplicationTokenListOffset(options.offset);
    const where = options.allowedAcpId
      ? {
          allowedAcpIds: Raw((alias) => `${alias} @> :allowedAcpIds`, {
            allowedAcpIds: JSON.stringify([options.allowedAcpId]),
          }),
        }
      : {};
    const [tokens, total] = await this.applicationTokenRepository.findAndCount({
      where,
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });
    return {
      items: tokens.map((token) => this.toApplicationTokenSummary(token)),
      total,
      limit,
      offset,
    };
  }

  async createApplicationToken(
    data: CreateApplicationTokenInput,
    createdByUserId?: string,
    constraints: ApplicationTokenActorConstraints = {},
  ): Promise<CreatedApplicationTokenResponse> {
    const name = this.normalizeApplicationTokenName(data.name);
    const scopes = this.normalizeApplicationTokenScopes(data.scopes);
    const allowedAcpIds = await this.normalizeApplicationTokenAllowedAcpIds(
      data.allowedAcpIds,
      constraints,
    );
    const expiresAt = this.parseApplicationTokenExpiresAt(data.expiresAt);
    const token = generateServerApiToken();
    const auditPath = constraints.auditPath || "/api/admin/application-tokens";

    let saved: ApplicationToken;
    try {
      saved = await this.applicationTokenRepository.manager.transaction(
        async (manager) => {
          const tokenRepository = manager.getRepository(ApplicationToken);
          const auditRepository = manager.getRepository(ServerApiAuditLog);
          const existing = await tokenRepository.findOne({
            where: { name },
          });
          if (existing) {
            throw new ConflictException(
              `Application token "${name}" already exists`,
            );
          }

          const entity = tokenRepository.create({
            name,
            tokenHash: hashServerApiToken(token),
            tokenPrefix: getServerApiTokenDisplayPrefix(token),
            scopes,
            allowedAcpIds,
            active: true,
            expiresAt,
            lastUsedAt: null,
            createdByUserId: createdByUserId || null,
            revokedByUserId: null,
            revokedAt: null,
          });

          const savedToken = await tokenRepository.save(entity);
          await this.logApplicationTokenAudit({
            action: "application-token.create",
            method: "POST",
            path: auditPath,
            acpId: constraints.auditAcpId,
            actorUserId: createdByUserId,
            token: savedToken,
            details: {
              scopes: savedToken.scopes,
              allowedAcpIds: savedToken.allowedAcpIds || null,
              expiresAt: savedToken.expiresAt?.toISOString() || null,
            },
            auditRepository,
            requireSuccess: true,
          });

          return savedToken;
        },
      );
    } catch (error) {
      if (this.isApplicationTokenNameConflict(error)) {
        throw new ConflictException(
          `Application token "${name}" already exists`,
        );
      }
      throw error;
    }

    return {
      ...this.toApplicationTokenSummary(saved),
      token,
    };
  }

  async revokeApplicationToken(
    id: string,
    revokedByUserId?: string,
    constraints: ApplicationTokenActorConstraints = {},
  ): Promise<ApplicationTokenSummary> {
    const token = await this.applicationTokenRepository.findOne({
      where: { id },
    });
    if (!token) {
      throw new NotFoundException("Application token not found");
    }

    this.assertApplicationTokenActorCanManage(token, constraints);

    if (token.active || !token.revokedAt) {
      token.active = false;
      token.revokedAt = token.revokedAt || new Date();
      token.revokedByUserId = revokedByUserId || token.revokedByUserId || null;
      const saved = await this.applicationTokenRepository.save(token);
      await this.logApplicationTokenAudit({
        action: "application-token.revoke",
        method: "PATCH",
        path:
          constraints.auditPath ||
          `/api/admin/application-tokens/${saved.id}/revoke`,
        acpId: constraints.auditAcpId,
        actorUserId: revokedByUserId,
        token: saved,
      });
      return this.toApplicationTokenSummary(saved);
    }

    return this.toApplicationTokenSummary(token);
  }

  async uploadGeoGebraBundle(
    uploadedFile: Express.Multer.File | undefined,
  ): Promise<AppSettings> {
    if (!uploadedFile) {
      throw new BadRequestException("A GeoGebra ZIP archive is required");
    }

    const fileName = String(uploadedFile.originalname || "").trim();
    if (!fileName.toLowerCase().endsWith(".zip")) {
      throw new BadRequestException(
        "GeoGebra bundle upload must be provided as a ZIP file",
      );
    }

    const JSZip = require("jszip");

    let archive: any;
    try {
      archive = await JSZip.loadAsync(uploadedFile.buffer);
    } catch {
      throw new BadRequestException(
        `ZIP archive "${fileName}" could not be extracted`,
      );
    }

    const bundleEntries = await this.extractGeoGebraBundleEntries(archive);
    if (!bundleEntries.length) {
      throw new BadRequestException(
        `ZIP archive "${fileName}" does not contain any GeoGebra bundle files`,
      );
    }

    const hasDeployScript = bundleEntries.some(
      (entry) => entry.relativePath === GEOGEBRA_REQUIRED_ENTRY,
    );
    if (!hasDeployScript) {
      throw new BadRequestException(
        `ZIP archive "${fileName}" must contain ${GEOGEBRA_REQUIRED_ENTRY}`,
      );
    }

    const baseDir = getGeoGebraBundleBaseDir();
    const currentDir = getGeoGebraBundleCurrentDir();
    const stagingDir = path.join(
      baseDir,
      `staging-${Date.now()}-${crypto.randomUUID()}`,
    );

    await fs.mkdir(stagingDir, { recursive: true });

    try {
      for (const entry of bundleEntries) {
        const targetPath = path.join(
          stagingDir,
          ...entry.relativePath.split("/"),
        );
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, entry.buffer);
      }

      await fs.access(path.join(stagingDir, GEOGEBRA_REQUIRED_ENTRY));
      await this.activateGeoGebraBundle(stagingDir, currentDir);
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw error;
    }

    const settings = await this.getSettings();
    settings.geoGebraBundle = {
      sourceFileName: fileName,
      deployScriptUrl: GEOGEBRA_PLAYER_DEPLOY_SCRIPT_PATH,
      publicBasePath: GEOGEBRA_PLAYER_RESOURCE_BASE,
      checksum: crypto
        .createHash("sha256")
        .update(uploadedFile.buffer)
        .digest("hex"),
      entryCount: bundleEntries.length,
      uploadedAt: new Date().toISOString(),
    };
    return this.settingsRepository.save(settings);
  }

  async deleteGeoGebraBundle(): Promise<AppSettings> {
    await fs.rm(getGeoGebraBundleCurrentDir(), {
      recursive: true,
      force: true,
    });

    const settings = await this.getSettings();
    settings.geoGebraBundle = null;
    return this.settingsRepository.save(settings);
  }

  private async extractGeoGebraBundleEntries(
    archive: any,
  ): Promise<Array<{ relativePath: string; buffer: Buffer }>> {
    const extractedFiles: Array<{ relativePath: string; buffer: Buffer }> = [];
    const seenRelativePaths = new Set<string>();
    const archiveEntries = Object.values(archive.files || {});

    for (const entry of archiveEntries as Array<{
      dir?: boolean;
      name?: string;
    }>) {
      if (entry?.dir) {
        continue;
      }

      const relativePath = this.getGeoGebraArchiveEntryPath(
        String(entry?.name || ""),
      );
      if (!relativePath) {
        continue;
      }

      if (seenRelativePaths.has(relativePath)) {
        throw new BadRequestException(
          `ZIP archive contains duplicate GeoGebra file "${relativePath}"`,
        );
      }

      const zipEntry = archive.file(String(entry?.name || ""));
      if (!zipEntry) {
        continue;
      }

      seenRelativePaths.add(relativePath);
      extractedFiles.push({
        relativePath,
        buffer: Buffer.from(await zipEntry.async("nodebuffer")),
      });
    }

    return extractedFiles;
  }

  private getGeoGebraArchiveEntryPath(entryName: string): string | null {
    const normalizedPath = String(entryName || "")
      .replace(/\\/g, "/")
      .trim()
      .replace(/^\/+/, "");

    if (!normalizedPath || normalizedPath.startsWith("__MACOSX/")) {
      return null;
    }

    const segments = normalizedPath
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (!segments.length || segments.some((segment) => segment === "..")) {
      throw new BadRequestException(
        `ZIP archive contains an invalid entry path "${entryName}"`,
      );
    }

    if (segments[segments.length - 1] === ".DS_Store") {
      return null;
    }

    const geoGebraIndex = segments.indexOf("GeoGebra");
    if (geoGebraIndex === -1 || geoGebraIndex === segments.length - 1) {
      return null;
    }

    return segments.slice(geoGebraIndex).join("/");
  }

  private async activateGeoGebraBundle(
    stagingDir: string,
    currentDir: string,
  ): Promise<void> {
    await fs.mkdir(path.dirname(currentDir), { recursive: true });

    const backupDir = `${currentDir}-backup-${Date.now()}-${crypto.randomUUID()}`;
    let currentMoved = false;

    try {
      await fs.access(currentDir);
      await fs.rename(currentDir, backupDir);
      currentMoved = true;
    } catch {
      currentMoved = false;
    }

    try {
      await fs.rename(stagingDir, currentDir);
    } catch (error) {
      if (currentMoved) {
        await fs.rename(backupDir, currentDir).catch(() => undefined);
      }
      throw error;
    }

    if (currentMoved) {
      await fs.rm(backupDir, { recursive: true, force: true });
    }
  }

  private normalizeApplicationTokenName(name: string): string {
    const normalized = String(name || "").trim();
    if (!normalized) {
      throw new BadRequestException("Application token name is required");
    }
    if (normalized.length > 160) {
      throw new BadRequestException(
        "Application token name must be 160 characters or fewer",
      );
    }
    return normalized;
  }

  private normalizeApplicationTokenListLimit(limitInput?: number): number {
    const parsed = Number(limitInput ?? 50);
    if (!Number.isFinite(parsed)) {
      return 50;
    }
    return Math.max(1, Math.min(Math.trunc(parsed), 200));
  }

  private normalizeApplicationTokenListOffset(offsetInput?: number): number {
    const parsed = Number(offsetInput ?? 0);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.trunc(parsed));
  }

  private normalizeApplicationTokenScopes(scopesInput: unknown): string[] {
    if (!Array.isArray(scopesInput)) {
      throw new BadRequestException("Application token scopes are required");
    }

    const scopes = Array.from(
      new Set<string>(
        scopesInput
          .map((scope: unknown) => String(scope || "").trim())
          .filter((scope: string) => scope.length > 0),
      ),
    );

    if (!scopes.length) {
      throw new BadRequestException(
        "At least one application token scope is required",
      );
    }

    const invalidScopes = scopes.filter(
      (scope) => !ALL_SERVER_API_SCOPE_SET.has(scope),
    );
    if (invalidScopes.length) {
      throw new BadRequestException(
        `Unsupported application token scopes: ${invalidScopes.join(", ")}`,
      );
    }

    return scopes;
  }

  private async normalizeApplicationTokenAllowedAcpIds(
    allowedAcpIdsInput: unknown,
    constraints: ApplicationTokenActorConstraints,
  ): Promise<string[] | null> {
    const normalizedConstraintIds = this.normalizeConstraintAcpIds(
      constraints.allowedAcpIds,
    );

    if (allowedAcpIdsInput === undefined || allowedAcpIdsInput === null) {
      if (normalizedConstraintIds) {
        throw new ForbiddenException(
          "AP managers can only create AP-limited application tokens",
        );
      }
      return null;
    }

    if (!Array.isArray(allowedAcpIdsInput)) {
      throw new BadRequestException("allowedAcpIds must be an array or null");
    }

    const allowedAcpIds = Array.from(
      new Set<string>(
        allowedAcpIdsInput
          .map((acpId: unknown) => String(acpId || "").trim())
          .filter((acpId: string) => acpId.length > 0),
      ),
    );

    if (!allowedAcpIds.length) {
      if (normalizedConstraintIds) {
        throw new ForbiddenException(
          "AP managers can only create AP-limited application tokens",
        );
      }
      return null;
    }

    const invalidIds = allowedAcpIds.filter((acpId) => !isUuid(acpId));
    if (invalidIds.length) {
      throw new BadRequestException(
        `Invalid AP IDs for application token: ${invalidIds.join(", ")}`,
      );
    }

    if (normalizedConstraintIds) {
      const allowedConstraintSet = new Set(normalizedConstraintIds);
      const forbiddenIds = allowedAcpIds.filter(
        (acpId) => !allowedConstraintSet.has(acpId),
      );
      if (forbiddenIds.length) {
        throw new ForbiddenException(
          "Application token can only be limited to APs managed by the current user",
        );
      }
    }

    const existingAcps = await this.acpRepository.find({
      where: { id: In(allowedAcpIds) },
      select: ["id"],
    });
    const existingIds = new Set(existingAcps.map((acp) => acp.id));
    const missingIds = allowedAcpIds.filter((acpId) => !existingIds.has(acpId));
    if (missingIds.length) {
      throw new BadRequestException(
        `Unknown AP IDs for application token: ${missingIds.join(", ")}`,
      );
    }

    return allowedAcpIds;
  }

  private normalizeConstraintAcpIds(acpIds?: string[]): string[] | null {
    if (!acpIds) {
      return null;
    }
    return Array.from(
      new Set(
        acpIds
          .map((acpId) => String(acpId || "").trim())
          .filter((acpId) => acpId.length > 0),
      ),
    );
  }

  private assertApplicationTokenActorCanManage(
    token: ApplicationToken,
    constraints: ApplicationTokenActorConstraints,
  ): void {
    const constraintAcpIds = this.normalizeConstraintAcpIds(
      constraints.allowedAcpIds,
    );
    if (!constraintAcpIds) {
      return;
    }

    const tokenAcpIds = Array.isArray(token.allowedAcpIds)
      ? token.allowedAcpIds
      : null;
    if (!tokenAcpIds?.length) {
      throw new ForbiddenException(
        "AP managers cannot manage global application tokens",
      );
    }

    const constraintSet = new Set(constraintAcpIds);
    const hasAllowedAcp = tokenAcpIds.some((acpId) => constraintSet.has(acpId));
    const isExclusive =
      tokenAcpIds.length === 1 && constraintSet.has(tokenAcpIds[0]);

    if (
      !hasAllowedAcp ||
      (constraints.requireExclusiveAcp !== false && !isExclusive)
    ) {
      throw new ForbiddenException(
        "Application token is not exclusively owned by this AP",
      );
    }
  }

  private parseApplicationTokenExpiresAt(
    expiresAt?: string | null,
  ): Date | null {
    if (!expiresAt) {
      return null;
    }

    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Application token expiresAt is invalid");
    }
    if (parsed <= new Date()) {
      throw new BadRequestException(
        "Application token expiresAt must be in the future",
      );
    }

    return parsed;
  }

  private toApplicationTokenSummary(
    token: ApplicationToken,
  ): ApplicationTokenSummary {
    return {
      id: token.id,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: Array.isArray(token.scopes) ? [...token.scopes] : [],
      allowedAcpIds: Array.isArray(token.allowedAcpIds)
        ? [...token.allowedAcpIds]
        : null,
      active: token.active,
      expiresAt: token.expiresAt || null,
      lastUsedAt: token.lastUsedAt || null,
      createdByUserId: token.createdByUserId || null,
      revokedByUserId: token.revokedByUserId || null,
      revokedAt: token.revokedAt || null,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }

  private isApplicationTokenNameConflict(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const code =
      (error as { code?: string }).code ||
      (error as { driverError?: { code?: string } }).driverError?.code;
    const constraint =
      (error as { constraint?: string }).constraint ||
      (error as { driverError?: { constraint?: string } }).driverError
        ?.constraint;
    const detail =
      (error as { detail?: string }).detail ||
      (error as { driverError?: { detail?: string } }).driverError?.detail ||
      "";

    if (code !== "23505") {
      return false;
    }

    return (
      constraint === "UQ_application_tokens_name" || detail.includes("(name)=")
    );
  }

  private async logApplicationTokenAudit({
    action,
    method,
    path,
    acpId,
    actorUserId,
    token,
    details,
    auditRepository,
    requireSuccess = false,
  }: {
    action: string;
    method: string;
    path: string;
    acpId?: string;
    actorUserId?: string;
    token: ApplicationToken;
    details?: Record<string, unknown>;
    auditRepository?: Repository<ServerApiAuditLog>;
    requireSuccess?: boolean;
  }): Promise<void> {
    const repository = auditRepository || this.auditRepository;

    try {
      await repository.save(
        repository.create({
          clientId: actorUserId ? `admin:${actorUserId}` : "admin:unknown",
          action,
          method,
          path,
          acpId,
          resourceId: token.id,
          success: true,
          details: {
            resourceType: "application-token",
            tokenId: token.id,
            name: token.name,
            tokenPrefix: token.tokenPrefix,
            ...details,
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requireSuccess) {
        throw error;
      }

      this.logger.error(
        `Could not write non-blocking application token audit entry for ${action} on ${token.id}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
