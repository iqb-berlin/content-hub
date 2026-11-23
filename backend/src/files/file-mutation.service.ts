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
import { Ap, ApFile } from "../database/entities";
import { ArchiveExpansionService } from "./archive-expansion.service";
import { FileStorageService } from "./file-storage.service";
import { getUploadRelativePath, normalizeRelativePath } from "./relative-path";

export type UploadConflictStrategy = "reject" | "overwrite" | "keep-both";
type UploadConflictDecision = "replace" | "skip";

export interface UploadMultipleOptions {
  conflictStrategy?: string;
  conflictDecisions?: string;
  expandArchives?: boolean;
  relativePaths?: string[];
}

@Injectable()
export class FileMutationService {
  constructor(
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
    @InjectRepository(Ap)
    private readonly apRepository: Repository<Ap>,
    private readonly dataSource: DataSource,
    private readonly archiveExpansionService: ArchiveExpansionService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async upload(
    apId: string,
    uploadedFile: Express.Multer.File,
  ): Promise<ApFile> {
    const [saved] = await this.uploadMultiple(apId, [uploadedFile], {
      expandArchives: false,
    });
    return saved;
  }

  async uploadMultiple(
    apId: string,
    files: Express.Multer.File[],
    options: UploadMultipleOptions = {},
  ): Promise<ApFile[]> {
    const conflictStrategy = this.resolveConflictStrategy(
      options.conflictStrategy,
    );
    const decisions = this.parseConflictDecisions(options.conflictDecisions);
    if (!files?.length) {
      throw new BadRequestException("At least one file is required");
    }

    await this.getApOrFail(apId);
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
    // Previously, ZIP conflicts were confirmed using just the basename. Honor
    // an explicit old decision only when it identifies one incoming path.
    if (decisions.size) {
      const pathsByName = new Map<string, Set<string>>();
      for (const file of normalizedFiles) {
        const key = this.normalizeFileName(file.originalname);
        const paths = pathsByName.get(key) || new Set<string>();
        paths.add(this.normalizeFileName(getUploadRelativePath(file)));
        pathsByName.set(key, paths);
      }
      for (const file of normalizedFiles) {
        const key = this.normalizeFileName(file.originalname);
        if (
          decisions.has(key) &&
          pathsByName.get(key)?.size === 1 &&
          !decisions.has(this.normalizeFileName(getUploadRelativePath(file)))
        ) {
          (
            file as Express.Multer.File & { relativePath: string }
          ).relativePath = normalizeRelativePath(file.originalname);
        }
      }
    }
    const filesToPersist = this.resolveIncomingFiles(
      normalizedFiles,
      conflictStrategy,
      decisions,
    );
    if (!filesToPersist.length) {
      return [];
    }
    if (conflictStrategy === "reject") {
      const existingFiles = await this.fileRepository.find({
        where: { apId },
        order: { relativePath: "ASC" },
      });
      this.assertNoRejectedConflicts(
        filesToPersist,
        this.groupByNormalizedName(existingFiles),
        conflictStrategy,
        decisions,
      );
    }

    const stagedFiles: ApFile[] = [];
    try {
      for (const file of filesToPersist) {
        stagedFiles.push(await this.fileStorageService.stageUpload(apId, file));
      }
    } catch (error) {
      await this.fileStorageService.removePhysicalFiles(stagedFiles);
      throw error;
    }

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const apRepository = manager.getRepository(Ap);
        const lockedAp = await apRepository.findOne({
          where: { id: apId },
          lock: { mode: "pessimistic_write" },
        });
        if (!lockedAp) {
          throw new NotFoundException(`AP with ID ${apId} not found`);
        }
        this.assertEditable(lockedAp);

        const repository = manager.getRepository(ApFile);
        const existingFiles = await repository.find({
          where: { apId },
          order: { relativePath: "ASC" },
        });
        const existingByName = this.groupByNormalizedName(existingFiles);
        this.assertNoRejectedConflicts(
          filesToPersist,
          existingByName,
          conflictStrategy,
          decisions,
        );
        if (conflictStrategy === "keep-both") {
          this.ensureKeepBothPaths(stagedFiles, existingFiles);
        }

        const replacedFiles = this.collectOverwriteMatches(
          filesToPersist.filter(
            (file) =>
              conflictStrategy === "overwrite" ||
              decisions.get(
                this.normalizeFileName(getUploadRelativePath(file)),
              ) === "replace",
          ),
          existingByName,
        );
        if (replacedFiles.length) {
          await repository.remove(replacedFiles);
        }
        const savedFiles = await repository.save(stagedFiles);
        lockedAp.updatedAt = new Date();
        await apRepository.save(lockedAp);
        return { savedFiles, replacedFiles };
      });

      await this.fileStorageService.removePhysicalFiles(result.replacedFiles);
      return result.savedFiles;
    } catch (error) {
      await this.fileStorageService.removePhysicalFiles(stagedFiles);
      throw error;
    }
  }

  async deleteMultiple(apId: string, fileIds: string[]): Promise<ApFile[]> {
    await this.getApOrFail(apId);
    const normalizedIds = Array.from(new Set(fileIds));
    const deletedFiles = await this.dataSource.transaction(async (manager) => {
      const apRepository = manager.getRepository(Ap);
      const ap = await apRepository.findOne({
        where: { id: apId },
        lock: { mode: "pessimistic_write" },
      });
      if (!ap) throw new NotFoundException(`AP with ID ${apId} not found`);
      this.assertEditable(ap);

      const repository = manager.getRepository(ApFile);
      const files = await repository.find({
        where: { apId, id: In(normalizedIds) },
      });
      if (files.length !== normalizedIds.length) {
        throw new NotFoundException(
          "One or more files were not found in the AP",
        );
      }
      await repository.remove(files);
      ap.updatedAt = new Date();
      await apRepository.save(ap);
      return files;
    });
    await this.fileStorageService.removePhysicalFiles(deletedFiles);
    return deletedFiles;
  }

  private resolveIncomingFiles(
    files: Express.Multer.File[],
    conflictStrategy: UploadConflictStrategy,
    decisions: Map<string, UploadConflictDecision>,
  ): Express.Multer.File[] {
    const byName = new Map<string, Express.Multer.File[]>();

    for (const file of files) {
      const name = getUploadRelativePath(file);
      const key = this.normalizeFileName(name);
      if (!key) {
        throw new BadRequestException("All files must include a filename");
      }
      if (decisions.get(key) === "skip") {
        continue;
      }
      const bucket = byName.get(key) || [];
      bucket.push(file);
      byName.set(key, bucket);
    }

    return Array.from(byName.entries()).flatMap(([key, bucket]) =>
      conflictStrategy === "overwrite" || decisions.get(key) === "replace"
        ? bucket.slice(-1)
        : bucket,
    );
  }

  private assertNoRejectedConflicts(
    files: Express.Multer.File[],
    existingByName: Map<string, ApFile[]>,
    conflictStrategy: UploadConflictStrategy,
    decisions: Map<string, UploadConflictDecision>,
  ): void {
    if (conflictStrategy !== "reject") {
      return;
    }

    const conflicts = new Set<string>();
    const seen = new Set<string>();
    for (const file of files) {
      const relativePath = getUploadRelativePath(file);
      const key = this.normalizeFileName(relativePath);
      if (decisions.get(key) === "replace") {
        continue;
      }
      if (existingByName.has(key) || seen.has(key)) {
        conflicts.add(relativePath);
      }
      seen.add(key);
    }
    if (conflicts.size) {
      this.throwConflict(conflicts);
    }
  }

  private parseConflictDecisions(
    input?: string,
  ): Map<string, UploadConflictDecision> {
    const decisions = new Map<string, UploadConflictDecision>();
    if (input === undefined) {
      return decisions;
    }
    const invalid = () =>
      new BadRequestException(
        "conflictDecisions must be a JSON array of unique { fileName, decision: replace | skip } entries",
      );
    let entries: unknown;
    if (typeof input !== "string") {
      throw invalid();
    }
    try {
      entries = JSON.parse(input);
    } catch {
      throw invalid();
    }
    if (!Array.isArray(entries)) {
      throw invalid();
    }
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.fileName !== "string" ||
        !entry.fileName.trim() ||
        (entry.decision !== "replace" && entry.decision !== "skip")
      ) {
        throw invalid();
      }
      const key = this.normalizeFileName(entry.fileName);
      if (decisions.has(key)) {
        throw invalid();
      }
      decisions.set(key, entry.decision);
    }
    return decisions;
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
    existingByName: Map<string, ApFile[]>,
  ): ApFile[] {
    const matches = new Map<string, ApFile>();
    for (const file of files) {
      for (const match of existingByName.get(
        this.normalizeFileName(getUploadRelativePath(file)),
      ) || []) {
        matches.set(match.id, match);
      }
    }
    return Array.from(matches.values());
  }

  private groupByNormalizedName(files: ApFile[]): Map<string, ApFile[]> {
    const grouped = new Map<string, ApFile[]>();
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

  private ensureKeepBothPaths(incoming: ApFile[], existing: ApFile[]): void {
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

  private async getApOrFail(apId: string): Promise<Ap> {
    assertUuidParam(apId, "AP ID");
    const ap = await this.apRepository.findOne({ where: { id: apId } });
    if (!ap) {
      throw new NotFoundException(`AP with ID ${apId} not found`);
    }
    this.assertEditable(ap);
    return ap;
  }

  private assertEditable(ap: Ap): void {
    if (
      ap.apIndex?.status === "RELEASED_PUBLIC" ||
      ap.apIndex?.status === "RELEASED_CONFIDENTIAL"
    ) {
      throw new ConflictException(
        "Published AP must be reopened before files can be changed",
      );
    }
  }
}
