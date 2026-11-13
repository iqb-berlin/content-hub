import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Ap, ApFile } from "../database/entities";
import { FilesService } from "../files/files.service";
import { SnapshotsService } from "../snapshots/snapshots.service";
import { assertUuidParam } from "../common/uuid-param";

export type ConflictStrategy = "reject" | "overwrite" | "merge";
export type IndexUpdateStrategy = "overwrite" | "merge";
export type FileConflictStrategy = "reject" | "overwrite" | "keep-both";
export type AllowedApIds = string[] | null | undefined;

export interface ServerImportApPayload {
  packageId: string;
  name: string;
  description?: string;
  apIndex: Record<string, any>;
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
    @InjectRepository(Ap)
    private readonly apRepository: Repository<Ap>,
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
    private readonly filesService: FilesService,
    private readonly snapshotsService: SnapshotsService,
  ) {}

  /**
   * List all APs available for server-to-server transfer.
   */
  async listAps(allowedApIds?: AllowedApIds): Promise<
    {
      id: string;
      packageId: string;
      name: string;
      version: string;
      updatedAt: string;
    }[]
  > {
    const aps = await this.apRepository.find({
      where: this.getAllowedApWhere(allowedApIds),
      order: { updatedAt: "DESC" },
    });
    return aps.map((ap) => ({
      id: ap.id,
      packageId: ap.packageId,
      name: ap.name,
      version: (ap.apIndex as any)?.version || "0.0.0",
      updatedAt: ap.updatedAt.toISOString(),
    }));
  }

  /**
   * Get full AP data for transfer (AP-Index + file list).
   */
  async getApTransferData(
    apId: string,
    allowedApIds?: AllowedApIds,
  ): Promise<any> {
    this.assertApAllowed(apId, allowedApIds);
    const ap = await this.getApOrFail(apId);
    const files = await this.listFiles(apId, allowedApIds);

    return {
      id: ap.id,
      packageId: ap.packageId,
      name: ap.name,
      description: ap.description,
      updatedAt: ap.updatedAt.toISOString(),
      apIndex: ap.apIndex,
      files,
    };
  }

  async getApIndex(
    apId: string,
    allowedApIds?: AllowedApIds,
  ): Promise<{
    apId: string;
    packageId: string;
    updatedAt: string;
    apIndex: Record<string, unknown>;
  }> {
    this.assertApAllowed(apId, allowedApIds);
    const ap = await this.getApOrFail(apId);
    return {
      apId: ap.id,
      packageId: ap.packageId,
      updatedAt: ap.updatedAt.toISOString(),
      apIndex: (ap.apIndex || {}) as Record<string, unknown>,
    };
  }

  async updateApIndex(
    apId: string,
    apIndex: Record<string, any>,
    strategyInput?: string,
    expectedUpdatedAt?: string,
    allowedApIds?: AllowedApIds,
  ): Promise<{
    apId: string;
    packageId: string;
    updatedAt: string;
    conflictStrategy: IndexUpdateStrategy;
  }> {
    if (!apIndex || typeof apIndex !== "object" || Array.isArray(apIndex)) {
      throw new BadRequestException("apIndex must be an object");
    }

    this.assertApAllowed(apId, allowedApIds);
    const ap = await this.getApOrFail(apId);
    this.assertExpectedUpdatedAt(ap, expectedUpdatedAt);

    const strategy = this.resolveIndexUpdateStrategy(strategyInput);
    ap.apIndex =
      strategy === "merge"
        ? this.deepMergeObjects(ap.apIndex as Record<string, any>, apIndex)
        : apIndex;

    const saved = await this.apRepository.save(ap);
    return {
      apId: saved.id,
      packageId: saved.packageId,
      updatedAt: saved.updatedAt.toISOString(),
      conflictStrategy: strategy,
    };
  }

  async listFiles(
    apId: string,
    allowedApIds?: AllowedApIds,
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
    this.assertApAllowed(apId, allowedApIds);
    await this.getApOrFail(apId);
    const files = await this.fileRepository.find({
      where: { apId },
      order: { originalName: "ASC" },
    });
    return files.map((file) => this.toTransferFileMeta(file));
  }

  async getFile(
    apId: string,
    fileId: string,
    allowedApIds?: AllowedApIds,
  ): Promise<{
    id: string;
    originalName: string;
    fileType?: string;
    fileSize: number;
    checksum?: string;
    uploadedAt: string;
    downloadUrl: string;
  }> {
    this.assertApAllowed(apId, allowedApIds);
    this.assertValidApId(apId);
    assertUuidParam(fileId, "File ID");

    const file = await this.fileRepository.findOne({
      where: { id: fileId, apId },
    });
    if (!file) {
      throw new NotFoundException("File not found");
    }
    return this.toTransferFileMeta(file);
  }

  async downloadFile(
    apId: string,
    fileId: string,
    allowedApIds?: AllowedApIds,
  ): Promise<{ buffer: Buffer; file: ApFile }> {
    this.assertApAllowed(apId, allowedApIds);
    await this.getApOrFail(apId);
    assertUuidParam(fileId, "File ID");
    return this.filesService.downloadForAp(apId, fileId);
  }

  async uploadFiles(
    apId: string,
    files: Express.Multer.File[],
    conflictStrategyInput?: string,
    allowedApIds?: AllowedApIds,
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
    this.assertApAllowed(apId, allowedApIds);
    await this.getApOrFail(apId);

    const conflictStrategy = this.resolveFileConflictStrategy(
      conflictStrategyInput,
    );
    if (!files?.length) {
      throw new BadRequestException("At least one file is required");
    }

    const existingFiles = await this.fileRepository.find({ where: { apId } });
    const existingNames = new Set(
      existingFiles.map((file) => this.normalizeFileName(file.originalName)),
    );
    const uploaded = await this.filesService.uploadMultiple(apId, files, {
      conflictStrategy,
    });
    const deletedAny =
      conflictStrategy === "overwrite" &&
      uploaded.some((file) =>
        existingNames.has(this.normalizeFileName(file.originalName)),
      );

    if (deletedAny) {
      await this.filesService.cleanupReferencesAfterFileMutation(apId, {
        skipValidation: true,
      });
    }

    return uploaded.map((file) => this.toTransferFileMeta(file));
  }

  async replaceCodingSchemeFiles(
    apId: string,
    files: Express.Multer.File[],
    options: ReplaceCodingSchemeOptions = {},
    allowedApIds?: AllowedApIds,
  ): Promise<{
    apId: string;
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

    this.assertApAllowed(apId, allowedApIds);
    const ap = await this.getApOrFail(apId);
    this.assertExpectedUpdatedAt(ap, options.expectedUpdatedAt);

    const existingFiles = await this.fileRepository.find({ where: { apId } });
    const existingByLowerName = new Map<string, ApFile[]>();
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
      apId,
      uploadPayloads,
      {
        conflictStrategy: "overwrite",
        expandArchives: false,
      },
    );

    await this.filesService.cleanupReferencesAfterFileMutation(apId, {
      skipValidation: true,
    });

    const resolvedChangelog = this.resolveCodingSchemeChangelog(
      options.changelog,
      replacedFiles.map((file) => file.originalName),
      options.sourceClientId,
    );
    const snapshot = await this.snapshotsService.create(
      apId,
      resolvedChangelog,
    );
    ap.updatedAt = new Date();
    const savedAp = await this.apRepository.save(ap);

    return {
      apId: savedAp.id,
      packageId: savedAp.packageId,
      updatedAt: savedAp.updatedAt.toISOString(),
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
   * Receive AP data from an external application.
   * Creates or updates an AP with configurable conflict strategy.
   */
  async receiveAp(
    data: ServerImportApPayload,
    conflictStrategyInput?: string,
    allowedApIds?: AllowedApIds,
  ): Promise<{
    ap: Ap;
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
      !data.apIndex ||
      typeof data.apIndex !== "object" ||
      Array.isArray(data.apIndex)
    ) {
      throw new BadRequestException("apIndex must be an object");
    }

    const conflictStrategy = this.resolveConflictStrategy(
      conflictStrategyInput,
    );

    let ap = await this.apRepository.findOne({
      where: { packageId: data.packageId },
    });
    if (this.isApRestricted(allowedApIds)) {
      if (!ap) {
        throw new ForbiddenException(
          "AP-limited tokens cannot create new APs through server import",
        );
      }
      this.assertApAllowed(ap.id, allowedApIds);
    }
    if (!ap) {
      ap = this.apRepository.create({
        packageId: data.packageId,
        name: data.name,
        description: data.description || "",
        apIndex: data.apIndex,
        settings: {},
      });
      const saved = await this.apRepository.save(ap);
      return { ap: saved, operation: "created", conflictStrategy };
    }

    this.assertExpectedUpdatedAt(ap, data.expectedUpdatedAt);

    if (conflictStrategy === "reject") {
      throw new ConflictException(
        `AP with packageId \"${data.packageId}\" already exists. Use conflictStrategy=overwrite or conflictStrategy=merge.`,
      );
    }

    ap.name = data.name;
    if (data.description !== undefined) {
      ap.description = data.description;
    }

    ap.apIndex =
      conflictStrategy === "merge"
        ? this.deepMergeObjects(ap.apIndex as Record<string, any>, data.apIndex)
        : data.apIndex;

    const saved = await this.apRepository.save(ap);
    return { ap: saved, operation: "updated", conflictStrategy };
  }

  private getAllowedApWhere(
    allowedApIds?: AllowedApIds,
  ): { id: any } | Record<string, never> {
    return this.isApRestricted(allowedApIds)
      ? { id: In(allowedApIds as string[]) }
      : {};
  }

  private assertApAllowed(apId: string, allowedApIds?: AllowedApIds): void {
    this.assertValidApId(apId);
    if (!this.isApRestricted(allowedApIds)) {
      return;
    }
    if (!(allowedApIds as string[]).includes(apId)) {
      throw new ForbiddenException(
        "Application token is not allowed to access this AP",
      );
    }
  }

  private isApRestricted(allowedApIds?: AllowedApIds): boolean {
    return Array.isArray(allowedApIds) && allowedApIds.length > 0;
  }

  private async getApOrFail(apId: string): Promise<Ap> {
    this.assertValidApId(apId);

    const ap = await this.apRepository.findOne({ where: { id: apId } });
    if (!ap) {
      throw new NotFoundException(`AP with ID ${apId} not found`);
    }
    return ap;
  }

  private assertValidApId(apId: string): void {
    assertUuidParam(apId, "AP ID");
  }

  private toTransferFileMeta(file: ApFile): {
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
      downloadUrl: `/api/server/ap/${file.apId}/files/${file.id}/download`,
    };
  }

  private assertExpectedUpdatedAt(ap: Ap, expectedUpdatedAt?: string): void {
    if (!expectedUpdatedAt) {
      return;
    }

    const parsed = new Date(expectedUpdatedAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        "expectedUpdatedAt must be a valid ISO timestamp",
      );
    }

    if (ap.updatedAt.toISOString() !== parsed.toISOString()) {
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
