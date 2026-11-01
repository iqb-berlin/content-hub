import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Acp, AcpFile } from "../database/entities";
import { FilesService } from "../files/files.service";
import { SnapshotsService } from "../snapshots/snapshots.service";
import { assertUuidParam } from "../common/uuid-param";

export type ConflictStrategy = "reject" | "overwrite" | "merge";
export type IndexUpdateStrategy = "overwrite" | "merge";
export type FileConflictStrategy = "reject" | "overwrite" | "keep-both";
export type AllowedAcpIds = string[] | null | undefined;

export interface ServerImportAcpPayload {
  packageId: string;
  name: string;
  description?: string;
  acpIndex: Record<string, any>;
  expectedUpdatedAt?: string;
}

export interface ReplaceCodingSchemeOptions {
  changelog?: string;
  expectedUpdatedAt?: string;
  sourceClientId?: string;
}

@Injectable()
export class ServerApiService {
  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    private readonly filesService: FilesService,
    private readonly snapshotsService: SnapshotsService,
  ) {}

  /**
   * List all ACPs available for server-to-server transfer.
   */
  async listAcps(allowedAcpIds?: AllowedAcpIds): Promise<
    {
      id: string;
      packageId: string;
      name: string;
      version: string;
      updatedAt: string;
    }[]
  > {
    const acps = await this.acpRepository.find({
      where: this.getAllowedAcpWhere(allowedAcpIds),
      order: { updatedAt: "DESC" },
    });
    return acps.map((acp) => ({
      id: acp.id,
      packageId: acp.packageId,
      name: acp.name,
      version: (acp.acpIndex as any)?.version || "0.0.0",
      updatedAt: acp.updatedAt.toISOString(),
    }));
  }

  /**
   * Get full ACP data for transfer (ACP-Index + file list).
   */
  async getAcpTransferData(
    acpId: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<any> {
    this.assertAcpAllowed(acpId, allowedAcpIds);
    const acp = await this.getAcpOrFail(acpId);
    const files = await this.listFiles(acpId, allowedAcpIds);

    return {
      id: acp.id,
      packageId: acp.packageId,
      name: acp.name,
      description: acp.description,
      updatedAt: acp.updatedAt.toISOString(),
      acpIndex: acp.acpIndex,
      files,
    };
  }

  async getAcpIndex(
    acpId: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<{
    acpId: string;
    packageId: string;
    updatedAt: string;
    acpIndex: Record<string, unknown>;
  }> {
    this.assertAcpAllowed(acpId, allowedAcpIds);
    const acp = await this.getAcpOrFail(acpId);
    return {
      acpId: acp.id,
      packageId: acp.packageId,
      updatedAt: acp.updatedAt.toISOString(),
      acpIndex: (acp.acpIndex || {}) as Record<string, unknown>,
    };
  }

  async updateAcpIndex(
    acpId: string,
    acpIndex: Record<string, any>,
    strategyInput?: string,
    expectedUpdatedAt?: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<{
    acpId: string;
    packageId: string;
    updatedAt: string;
    conflictStrategy: IndexUpdateStrategy;
  }> {
    if (!acpIndex || typeof acpIndex !== "object" || Array.isArray(acpIndex)) {
      throw new BadRequestException("acpIndex must be an object");
    }

    this.assertAcpAllowed(acpId, allowedAcpIds);
    const acp = await this.getAcpOrFail(acpId);
    this.assertExpectedUpdatedAt(acp, expectedUpdatedAt);

    const strategy = this.resolveIndexUpdateStrategy(strategyInput);
    acp.acpIndex =
      strategy === "merge"
        ? this.deepMergeObjects(acp.acpIndex as Record<string, any>, acpIndex)
        : acpIndex;

    const saved = await this.acpRepository.save(acp);
    return {
      acpId: saved.id,
      packageId: saved.packageId,
      updatedAt: saved.updatedAt.toISOString(),
      conflictStrategy: strategy,
    };
  }

  async listFiles(
    acpId: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<
    Array<{
      id: string;
      originalName: string;
      fileType?: string;
      fileSize: number;
      checksum?: string;
      uploadedAt: string;
      downloadUrl: string;
    }>
  > {
    this.assertAcpAllowed(acpId, allowedAcpIds);
    await this.getAcpOrFail(acpId);
    const files = await this.fileRepository.find({
      where: { acpId },
      order: { originalName: "ASC" },
    });
    return files.map((file) => this.toTransferFileMeta(file));
  }

  async getFile(
    acpId: string,
    fileId: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<{
    id: string;
    originalName: string;
    fileType?: string;
    fileSize: number;
    checksum?: string;
    uploadedAt: string;
    downloadUrl: string;
  }> {
    this.assertAcpAllowed(acpId, allowedAcpIds);
    this.assertValidAcpId(acpId);
    assertUuidParam(fileId, "File ID");

    const file = await this.fileRepository.findOne({
      where: { id: fileId, acpId },
    });
    if (!file) {
      throw new NotFoundException("File not found");
    }
    return this.toTransferFileMeta(file);
  }

  async downloadFile(
    acpId: string,
    fileId: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<{ buffer: Buffer; file: AcpFile }> {
    this.assertAcpAllowed(acpId, allowedAcpIds);
    await this.getAcpOrFail(acpId);
    assertUuidParam(fileId, "File ID");
    return this.filesService.downloadForAcp(acpId, fileId);
  }

  async uploadFiles(
    acpId: string,
    files: Express.Multer.File[],
    conflictStrategyInput?: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<
    Array<{
      id: string;
      originalName: string;
      fileType?: string;
      fileSize: number;
      checksum?: string;
      uploadedAt: string;
      downloadUrl: string;
    }>
  > {
    this.assertAcpAllowed(acpId, allowedAcpIds);
    await this.getAcpOrFail(acpId);

    const conflictStrategy = this.resolveFileConflictStrategy(
      conflictStrategyInput,
    );
    if (!files?.length) {
      throw new BadRequestException("At least one file is required");
    }

    const existingFiles = await this.fileRepository.find({ where: { acpId } });
    const existingNames = new Set(
      existingFiles.map((file) => this.normalizeFileName(file.originalName)),
    );
    const uploaded = await this.filesService.uploadMultiple(acpId, files, {
      conflictStrategy,
    });
    const deletedAny =
      conflictStrategy === "overwrite" &&
      uploaded.some((file) =>
        existingNames.has(this.normalizeFileName(file.originalName)),
      );

    if (deletedAny) {
      await this.filesService.cleanupReferencesAfterFileMutation(acpId, {
        skipValidation: true,
      });
    }

    return uploaded.map((file) => this.toTransferFileMeta(file));
  }

  async replaceCodingSchemeFiles(
    acpId: string,
    files: Express.Multer.File[],
    options: ReplaceCodingSchemeOptions = {},
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<{
    acpId: string;
    packageId: string;
    updatedAt: string;
    replacedFiles: Array<{
      id: string;
      originalName: string;
      fileType?: string;
      fileSize: number;
      checksum?: string;
      uploadedAt: string;
      downloadUrl: string;
    }>;
    snapshot: {
      id: string;
      versionNumber: number;
      changelog?: string;
      createdAt: string;
    };
  }> {
    if (!files?.length) {
      throw new BadRequestException("At least one file is required");
    }

    this.assertAcpAllowed(acpId, allowedAcpIds);
    const acp = await this.getAcpOrFail(acpId);
    this.assertExpectedUpdatedAt(acp, options.expectedUpdatedAt);

    const existingFiles = await this.fileRepository.find({ where: { acpId } });
    const existingByLowerName = new Map<string, AcpFile[]>();
    for (const existing of existingFiles) {
      const key = existing.originalName.toLowerCase();
      const bucket = existingByLowerName.get(key) || [];
      bucket.push(existing);
      existingByLowerName.set(key, bucket);
    }

    const seenIncoming = new Set<string>();
    const replacementPlan: Array<{
      incoming: Express.Multer.File;
      canonicalName: string;
    }> = [];

    for (const incoming of files) {
      const incomingName = String(incoming?.originalname || "").trim();
      if (!incomingName) {
        throw new BadRequestException("All files must include a filename");
      }
      if (!this.isVocsFileName(incomingName)) {
        throw new BadRequestException(
          `Only coding scheme files (.vocs) can be replaced here: ${incomingName}`,
        );
      }

      const lookupKey = incomingName.toLowerCase();
      if (seenIncoming.has(lookupKey)) {
        throw new BadRequestException(
          `Duplicate coding scheme in request: ${incomingName}`,
        );
      }
      seenIncoming.add(lookupKey);

      const matches = existingByLowerName.get(lookupKey) || [];
      if (!matches.length) {
        throw new NotFoundException(
          `Coding scheme "${incomingName}" does not exist in AP and cannot be replaced`,
        );
      }

      replacementPlan.push({
        incoming,
        canonicalName: matches[0].originalName,
      });
    }

    const uploadPayloads = replacementPlan.map(
      (plan) =>
        ({
          ...plan.incoming,
          originalname: plan.canonicalName,
        }) as Express.Multer.File,
    );
    const replacedFiles = await this.filesService.uploadMultiple(
      acpId,
      uploadPayloads,
      {
        conflictStrategy: "overwrite",
        expandArchives: false,
      },
    );

    await this.filesService.cleanupReferencesAfterFileMutation(acpId, {
      skipValidation: true,
    });

    const resolvedChangelog = this.resolveCodingSchemeChangelog(
      options.changelog,
      replacedFiles.map((file) => file.originalName),
      options.sourceClientId,
    );
    const snapshot = await this.snapshotsService.create(
      acpId,
      resolvedChangelog,
    );
    acp.updatedAt = new Date();
    const savedAcp = await this.acpRepository.save(acp);

    return {
      acpId: savedAcp.id,
      packageId: savedAcp.packageId,
      updatedAt: savedAcp.updatedAt.toISOString(),
      replacedFiles: replacedFiles.map((file) => this.toTransferFileMeta(file)),
      snapshot: {
        id: snapshot.id,
        versionNumber: snapshot.versionNumber,
        changelog: snapshot.changelog,
        createdAt: snapshot.createdAt.toISOString(),
      },
    };
  }

  /**
   * Receive ACP data from an external application.
   * Creates or updates an ACP with configurable conflict strategy.
   */
  async receiveAcp(
    data: ServerImportAcpPayload,
    conflictStrategyInput?: string,
    allowedAcpIds?: AllowedAcpIds,
  ): Promise<{
    acp: Acp;
    operation: "created" | "updated";
    conflictStrategy: ConflictStrategy;
  }> {
    if (!data.packageId || !data.packageId.trim()) {
      throw new BadRequestException("packageId is required");
    }
    if (!data.name || !data.name.trim()) {
      throw new BadRequestException("name is required");
    }
    if (
      !data.acpIndex ||
      typeof data.acpIndex !== "object" ||
      Array.isArray(data.acpIndex)
    ) {
      throw new BadRequestException("acpIndex must be an object");
    }

    const conflictStrategy = this.resolveConflictStrategy(
      conflictStrategyInput,
    );

    let acp = await this.acpRepository.findOne({
      where: { packageId: data.packageId },
    });
    if (this.isAcpRestricted(allowedAcpIds)) {
      if (!acp) {
        throw new ForbiddenException(
          "AP-limited tokens cannot create new APs through server import",
        );
      }
      this.assertAcpAllowed(acp.id, allowedAcpIds);
    }
    if (!acp) {
      acp = this.acpRepository.create({
        packageId: data.packageId,
        name: data.name,
        description: data.description || "",
        acpIndex: data.acpIndex,
        settings: {},
      });
      const saved = await this.acpRepository.save(acp);
      return { acp: saved, operation: "created", conflictStrategy };
    }

    this.assertExpectedUpdatedAt(acp, data.expectedUpdatedAt);

    if (conflictStrategy === "reject") {
      throw new ConflictException(
        `AP with packageId \"${data.packageId}\" already exists. Use conflictStrategy=overwrite or conflictStrategy=merge.`,
      );
    }

    acp.name = data.name;
    if (data.description !== undefined) {
      acp.description = data.description;
    }

    acp.acpIndex =
      conflictStrategy === "merge"
        ? this.deepMergeObjects(
            acp.acpIndex as Record<string, any>,
            data.acpIndex,
          )
        : data.acpIndex;

    const saved = await this.acpRepository.save(acp);
    return { acp: saved, operation: "updated", conflictStrategy };
  }

  private getAllowedAcpWhere(
    allowedAcpIds?: AllowedAcpIds,
  ): { id: any } | Record<string, never> {
    return this.isAcpRestricted(allowedAcpIds)
      ? { id: In(allowedAcpIds as string[]) }
      : {};
  }

  private assertAcpAllowed(acpId: string, allowedAcpIds?: AllowedAcpIds): void {
    this.assertValidAcpId(acpId);
    if (!this.isAcpRestricted(allowedAcpIds)) {
      return;
    }
    if (!(allowedAcpIds as string[]).includes(acpId)) {
      throw new ForbiddenException(
        "Application token is not allowed to access this AP",
      );
    }
  }

  private isAcpRestricted(allowedAcpIds?: AllowedAcpIds): boolean {
    return Array.isArray(allowedAcpIds) && allowedAcpIds.length > 0;
  }

  private async getAcpOrFail(acpId: string): Promise<Acp> {
    this.assertValidAcpId(acpId);

    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`AP with ID ${acpId} not found`);
    }
    return acp;
  }

  private assertValidAcpId(acpId: string): void {
    assertUuidParam(acpId, "AP ID");
  }

  private toTransferFileMeta(file: AcpFile): {
    id: string;
    originalName: string;
    fileType?: string;
    fileSize: number;
    checksum?: string;
    uploadedAt: string;
    downloadUrl: string;
  } {
    return {
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      fileSize: Number(file.fileSize),
      checksum: file.checksum,
      uploadedAt: file.uploadedAt.toISOString(),
      downloadUrl: `/api/server/acp/${file.acpId}/files/${file.id}/download`,
    };
  }

  private assertExpectedUpdatedAt(acp: Acp, expectedUpdatedAt?: string): void {
    if (!expectedUpdatedAt) {
      return;
    }

    const parsed = new Date(expectedUpdatedAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        "expectedUpdatedAt must be a valid ISO timestamp",
      );
    }

    if (acp.updatedAt.toISOString() !== parsed.toISOString()) {
      throw new ConflictException(
        "AP was modified since the expected version timestamp",
      );
    }
  }

  private resolveConflictStrategy(value?: string): ConflictStrategy {
    switch ((value || "reject").trim().toLowerCase()) {
      case "reject":
        return "reject";
      case "overwrite":
        return "overwrite";
      case "merge":
        return "merge";
      default:
        throw new BadRequestException(
          "conflictStrategy must be one of: reject, overwrite, merge",
        );
    }
  }

  private resolveIndexUpdateStrategy(value?: string): IndexUpdateStrategy {
    switch ((value || "overwrite").trim().toLowerCase()) {
      case "overwrite":
        return "overwrite";
      case "merge":
        return "merge";
      default:
        throw new BadRequestException(
          "strategy must be one of: overwrite, merge",
        );
    }
  }

  private resolveFileConflictStrategy(value?: string): FileConflictStrategy {
    switch ((value || "keep-both").trim().toLowerCase()) {
      case "reject":
        return "reject";
      case "overwrite":
        return "overwrite";
      case "keep-both":
        return "keep-both";
      default:
        throw new BadRequestException(
          "conflictStrategy must be one of: reject, overwrite, keep-both",
        );
    }
  }

  private normalizeFileName(fileName: string): string {
    return String(fileName || "")
      .trim()
      .toLowerCase();
  }

  private deepMergeObjects(
    base: Record<string, any>,
    incoming: Record<string, any>,
  ): Record<string, any> {
    const result: Record<string, any> = {
      ...(this.isRecord(base) ? base : {}),
    };

    for (const [key, incomingValue] of Object.entries(incoming || {})) {
      const baseValue = result[key];

      if (this.isRecord(baseValue) && this.isRecord(incomingValue)) {
        result[key] = this.deepMergeObjects(baseValue, incomingValue);
      } else {
        result[key] = incomingValue;
      }
    }

    return result;
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private isVocsFileName(fileName: string): boolean {
    return fileName.trim().toLowerCase().endsWith(".vocs");
  }

  private resolveCodingSchemeChangelog(
    changelogInput: string | undefined,
    fileNames: string[],
    sourceClientId?: string,
  ): string {
    const explicit = (changelogInput || "").trim();
    if (explicit) {
      return explicit;
    }

    const fileList = fileNames.length ? fileNames.join(", ") : "unknown .vocs";
    const sourceSuffix = sourceClientId ? ` via ${sourceClientId}` : "";
    return `Kodierschema ersetzt${sourceSuffix}: ${fileList}`;
  }
}
