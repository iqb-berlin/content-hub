import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { assertUuidParam } from "../common/uuid-param";
import { Acp, AcpFile } from "../database/entities";
import { FileStorageService } from "./file-storage.service";
import { UploadPreflightService } from "./upload-preflight.service";
import type { UploadPreflightReport } from "./upload-preflight.service";

export type UploadConflictStrategy = "reject" | "overwrite" | "keep-both";

export interface UploadMultipleOptions {
  conflictStrategy?: string;
  expandArchives?: boolean;
}

@Injectable()
export class FileMutationService {
  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    private readonly dataSource: DataSource,
    private readonly uploadPreflightService: UploadPreflightService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async upload(
    acpId: string,
    uploadedFile: Express.Multer.File,
  ): Promise<AcpFile> {
    await this.getAcpOrFail(acpId);
    const stagedFile = await this.fileStorageService.stageUpload(
      acpId,
      uploadedFile,
    );

    try {
      return await this.fileRepository.save(stagedFile);
    } catch (error) {
      await this.fileStorageService.removePhysicalFile(stagedFile);
      throw error;
    }
  }

  async uploadMultiple(
    acpId: string,
    files: Express.Multer.File[],
    options: UploadMultipleOptions = {},
  ): Promise<AcpFile[]> {
    const conflictStrategy = this.resolveConflictStrategy(
      options.conflictStrategy,
    );
    if (!files?.length) {
      throw new BadRequestException("At least one file is required");
    }

    const prepared = await this.uploadPreflightService.prepare(acpId, files, {
      conflictStrategy,
      expandArchives: options.expandArchives,
      semanticScope: this.containsArchive(files) ? "complete" : "partial",
    });
    this.uploadPreflightService.assertCanUpload(prepared.report);
    const filesToPersist = prepared.files;

    const stagedFiles: AcpFile[] = [];
    try {
      for (const file of filesToPersist) {
        stagedFiles.push(
          await this.fileStorageService.stageUpload(acpId, file),
        );
      }
    } catch (error) {
      await this.fileStorageService.removePhysicalFiles(stagedFiles);
      throw error;
    }

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const acpRepository = manager.getRepository(Acp);
        const lockedAcp = await acpRepository.findOne({
          where: { id: acpId },
          lock: { mode: "pessimistic_write" },
        });
        if (!lockedAcp) {
          throw new NotFoundException(`ACP with ID ${acpId} not found`);
        }

        const repository = manager.getRepository(AcpFile);
        const existingFiles = await repository.find({
          where: { acpId },
          order: { originalName: "ASC" },
        });
        const existingByName = this.groupByNormalizedName(existingFiles);
        this.assertNoRejectedConflicts(
          filesToPersist,
          existingByName,
          conflictStrategy,
        );

        const replacedFiles =
          conflictStrategy === "overwrite"
            ? this.collectOverwriteMatches(filesToPersist, existingByName)
            : [];
        const savedFiles = await repository.save(stagedFiles);
        if (replacedFiles.length) {
          await repository.remove(replacedFiles);
        }
        return { savedFiles, replacedFiles };
      });

      await this.fileStorageService.removePhysicalFiles(result.replacedFiles);
      return result.savedFiles;
    } catch (error) {
      await this.fileStorageService.removePhysicalFiles(stagedFiles);
      throw error;
    }
  }

  async preflightUpload(
    acpId: string,
    files: Express.Multer.File[],
    options: UploadMultipleOptions = {},
  ): Promise<UploadPreflightReport> {
    const conflictStrategy = this.resolveConflictStrategy(
      options.conflictStrategy,
    );
    const prepared = await this.uploadPreflightService.prepare(acpId, files, {
      conflictStrategy,
      expandArchives: options.expandArchives,
      semanticScope: "complete",
    });
    return prepared.report;
  }

  private assertNoRejectedConflicts(
    files: Express.Multer.File[],
    existingByName: Map<string, AcpFile[]>,
    conflictStrategy: UploadConflictStrategy,
  ): void {
    if (conflictStrategy !== "reject") {
      return;
    }

    const conflicts = new Set<string>();
    for (const file of files) {
      if (existingByName.has(this.normalizeFileName(file.originalname))) {
        conflicts.add(file.originalname);
      }
    }
    if (conflicts.size) {
      this.throwConflict(conflicts);
    }
  }

  private throwConflict(conflicts: Set<string>): never {
    throw new ConflictException({
      message:
        "File conflicts detected. Resolve duplicates by skipping or uploading with conflictStrategy=overwrite.",
      conflicts: Array.from(conflicts).sort((a, b) => a.localeCompare(b)),
    });
  }

  private collectOverwriteMatches(
    files: Express.Multer.File[],
    existingByName: Map<string, AcpFile[]>,
  ): AcpFile[] {
    const matches = new Map<string, AcpFile>();
    for (const file of files) {
      for (const match of existingByName.get(
        this.normalizeFileName(file.originalname),
      ) || []) {
        matches.set(match.id, match);
      }
    }
    return Array.from(matches.values());
  }

  private groupByNormalizedName(files: AcpFile[]): Map<string, AcpFile[]> {
    const grouped = new Map<string, AcpFile[]>();
    for (const file of files) {
      const key = this.normalizeFileName(file.originalName);
      if (!key) {
        continue;
      }
      const bucket = grouped.get(key) || [];
      bucket.push(file);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  private resolveConflictStrategy(input?: string): UploadConflictStrategy {
    const strategy = (input || "reject").trim().toLowerCase();
    if (
      strategy === "reject" ||
      strategy === "overwrite" ||
      strategy === "keep-both"
    ) {
      return strategy;
    }
    throw new BadRequestException(
      "Invalid conflictStrategy. Expected one of: reject, overwrite, keep-both",
    );
  }

  private normalizeFileName(fileName: string): string {
    return String(fileName || "")
      .trim()
      .toLowerCase();
  }

  private containsArchive(files: Express.Multer.File[]): boolean {
    return files.some((file) => {
      const name = String(file?.originalname || "")
        .trim()
        .toLowerCase();
      const mimeType = String(file?.mimetype || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      return (
        name.endsWith(".zip") ||
        mimeType === "application/zip" ||
        mimeType === "application/x-zip-compressed"
      );
    });
  }

  private async getAcpOrFail(acpId: string): Promise<Acp> {
    assertUuidParam(acpId, "ACP ID");
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }
    return acp;
  }
}
