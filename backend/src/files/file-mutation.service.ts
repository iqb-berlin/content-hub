import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import * as crypto from "crypto";
import { assertUuidParam } from "../common/uuid-param";
import { Acp, AcpFile } from "../database/entities";
import { ArchiveExpansionService } from "./archive-expansion.service";
import { FileStorageService } from "./file-storage.service";
import { getUploadRelativePath, normalizeRelativePath } from "./relative-path";

export type UploadConflictStrategy = "reject" | "overwrite" | "keep-both";

export interface UploadMultipleOptions {
  conflictStrategy?: string;
  expandArchives?: boolean;
  relativePaths?: string[];
}

@Injectable()
export class FileMutationService {
  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    private readonly dataSource: DataSource,
    private readonly archiveExpansionService: ArchiveExpansionService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async upload(
    acpId: string,
    uploadedFile: Express.Multer.File,
  ): Promise<AcpFile> {
    const [saved] = await this.uploadMultiple(acpId, [uploadedFile], {
      expandArchives: false,
    });
    return saved;
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

    await this.getAcpOrFail(acpId);
    if (options.relativePaths) {
      if (options.relativePaths.length !== files.length) {
        throw new BadRequestException(
          "relativePaths must have the same number of entries as files",
        );
      }
      files.forEach((file, index) => {
        (file as Express.Multer.File & { relativePath?: string }).relativePath =
          normalizeRelativePath(options.relativePaths![index]);
      });
    }
    const normalizedFiles =
      options.expandArchives === false
        ? files
        : await this.archiveExpansionService.expand(files);
    const filesToPersist = this.resolveIncomingFiles(
      normalizedFiles,
      conflictStrategy,
    );
    if (conflictStrategy === "reject") {
      const existingFiles = await this.fileRepository.find({
        where: { acpId },
        order: { relativePath: "ASC" },
      });
      this.assertNoRejectedConflicts(
        filesToPersist,
        this.groupByNormalizedName(existingFiles),
        conflictStrategy,
      );
    }

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
        this.assertEditable(lockedAcp);

        const repository = manager.getRepository(AcpFile);
        const existingFiles = await repository.find({
          where: { acpId },
          order: { relativePath: "ASC" },
        });
        const existingByName = this.groupByNormalizedName(existingFiles);
        this.assertNoRejectedConflicts(
          filesToPersist,
          existingByName,
          conflictStrategy,
        );
        if (conflictStrategy === "keep-both") {
          this.ensureKeepBothPaths(stagedFiles, existingFiles);
        }

        const replacedFiles =
          conflictStrategy === "overwrite"
            ? this.collectOverwriteMatches(filesToPersist, existingByName)
            : [];
        if (replacedFiles.length) {
          await repository.remove(replacedFiles);
        }
        const savedFiles = await repository.save(stagedFiles);
        lockedAcp.updatedAt = new Date();
        await acpRepository.save(lockedAcp);
        return { savedFiles, replacedFiles };
      });

      await this.fileStorageService.removePhysicalFiles(result.replacedFiles);
      return result.savedFiles;
    } catch (error) {
      await this.fileStorageService.removePhysicalFiles(stagedFiles);
      throw error;
    }
  }

  async deleteMultiple(acpId: string, fileIds: string[]): Promise<AcpFile[]> {
    await this.getAcpOrFail(acpId);
    const normalizedIds = Array.from(new Set(fileIds));
    const deletedFiles = await this.dataSource.transaction(async (manager) => {
      const acpRepository = manager.getRepository(Acp);
      const acp = await acpRepository.findOne({
        where: { id: acpId },
        lock: { mode: "pessimistic_write" },
      });
      if (!acp) throw new NotFoundException(`ACP with ID ${acpId} not found`);
      this.assertEditable(acp);

      const repository = manager.getRepository(AcpFile);
      const files = await repository.find({
        where: { acpId, id: In(normalizedIds) },
      });
      if (files.length !== normalizedIds.length) {
        throw new NotFoundException(
          "One or more files were not found in the ACP",
        );
      }
      await repository.remove(files);
      acp.updatedAt = new Date();
      await acpRepository.save(acp);
      return files;
    });
    await this.fileStorageService.removePhysicalFiles(deletedFiles);
    return deletedFiles;
  }

  private resolveIncomingFiles(
    files: Express.Multer.File[],
    conflictStrategy: UploadConflictStrategy,
  ): Express.Multer.File[] {
    const byName = new Map<string, Express.Multer.File>();
    const duplicates = new Set<string>();

    for (const file of files) {
      const name = getUploadRelativePath(file);
      const key = this.normalizeFileName(name);
      if (!key) {
        throw new BadRequestException("All files must include a filename");
      }
      if (byName.has(key)) {
        duplicates.add(name);
      }
      byName.set(key, file);
    }

    if (conflictStrategy === "reject" && duplicates.size) {
      this.throwConflict(duplicates);
    }
    if (conflictStrategy === "overwrite") {
      return Array.from(byName.values());
    }
    return files;
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
      const relativePath = getUploadRelativePath(file);
      if (existingByName.has(this.normalizeFileName(relativePath))) {
        conflicts.add(relativePath);
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
        this.normalizeFileName(getUploadRelativePath(file)),
      ) || []) {
        matches.set(match.id, match);
      }
    }
    return Array.from(matches.values());
  }

  private groupByNormalizedName(files: AcpFile[]): Map<string, AcpFile[]> {
    const grouped = new Map<string, AcpFile[]>();
    for (const file of files) {
      const key = this.normalizeFileName(
        file.relativePath || file.originalName,
      );
      if (!key) {
        continue;
      }
      const bucket = grouped.get(key) || [];
      bucket.push(file);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  private ensureKeepBothPaths(incoming: AcpFile[], existing: AcpFile[]): void {
    const occupied = new Set(
      existing.map((file) =>
        this.normalizeFileName(file.relativePath || file.originalName),
      ),
    );
    for (const file of incoming) {
      let candidate = file.relativePath || file.originalName;
      if (occupied.has(this.normalizeFileName(candidate))) {
        candidate = `duplicates/${crypto.randomUUID()}/${candidate}`;
      }
      file.relativePath = candidate;
      occupied.add(this.normalizeFileName(candidate));
    }
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

  private async getAcpOrFail(acpId: string): Promise<Acp> {
    assertUuidParam(acpId, "ACP ID");
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }
    this.assertEditable(acp);
    return acp;
  }

  private assertEditable(acp: Acp): void {
    if (
      acp.acpIndex?.status === "RELEASED_PUBLIC" ||
      acp.acpIndex?.status === "RELEASED_CONFIDENTIAL"
    ) {
      throw new ConflictException(
        "Published ACP must be reopened before files can be changed",
      );
    }
  }
}
