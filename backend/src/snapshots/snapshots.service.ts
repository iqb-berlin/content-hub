import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs/promises";
import * as path from "path";
import { Ap, ApSnapshot, ApSnapshotFile, ApFile } from "../database/entities";
import { assertUuidParam } from "../common/uuid-param";

@Injectable()
export class SnapshotsService {
  private readonly storagePath: string;

  constructor(
    @InjectRepository(ApSnapshot)
    private readonly snapshotRepository: Repository<ApSnapshot>,
    @InjectRepository(ApSnapshotFile)
    private readonly snapshotFileRepository: Repository<ApSnapshotFile>,
    @InjectRepository(Ap)
    private readonly apRepository: Repository<Ap>,
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
    private readonly configService: ConfigService,
  ) {
    this.storagePath = this.configService.get<string>(
      "FILE_STORAGE_PATH",
      "./uploads",
    );
  }

  async findByAp(apId: string): Promise<ApSnapshot[]> {
    await this.getApOrFail(apId);
    return this.snapshotRepository.find({
      where: { apId },
      order: { versionNumber: "DESC" },
    });
  }

  async findById(id: string): Promise<ApSnapshot> {
    const snapshot = await this.snapshotRepository.findOne({
      where: { id },
      relations: ["snapshotFiles"],
    });
    if (!snapshot) {
      throw new NotFoundException(`Snapshot with ID ${id} not found`);
    }
    return snapshot;
  }

  async findByIdInAp(apId: string, snapshotId: string): Promise<ApSnapshot> {
    const snapshot = await this.findById(snapshotId);
    if (snapshot.apId !== apId) {
      throw new NotFoundException(
        `Snapshot with ID ${snapshotId} not found for AP ${apId}`,
      );
    }
    return snapshot;
  }

  async delete(snapshotId: string): Promise<void> {
    const snapshot = await this.findById(snapshotId);
    const snapshotApId = snapshot.apId;
    const snapshotEntityId = snapshot.id;

    if (!snapshotApId || !snapshotEntityId) {
      throw new NotFoundException(
        `Snapshot with ID ${snapshotId} is missing required metadata`,
      );
    }

    await this.snapshotRepository.remove(snapshot);

    const snapshotDir = path.join(
      this.storagePath,
      snapshotApId,
      "snapshots",
      snapshotEntityId,
    );
    const restoreDir = path.join(
      this.storagePath,
      snapshotApId,
      "snapshot-restore",
      snapshotEntityId,
    );

    await Promise.allSettled([
      fs.rm(snapshotDir, { recursive: true, force: true }),
      fs.rm(restoreDir, { recursive: true, force: true }),
    ]);
  }

  async create(apId: string, changelog?: string): Promise<ApSnapshot> {
    const ap = await this.getApOrFail(apId);

    // Determine next version number
    const latestSnapshot = await this.snapshotRepository.findOne({
      where: { apId },
      order: { versionNumber: "DESC" },
    });
    const nextVersion = latestSnapshot ? latestSnapshot.versionNumber + 1 : 1;

    // Create snapshot
    const snapshot = this.snapshotRepository.create({
      apId,
      versionNumber: nextVersion,
      apIndexSnapshot: { ...ap.apIndex },
      changelog,
    });
    const savedSnapshot = await this.snapshotRepository.save(snapshot);

    // Persist file state for this snapshot so restore stays independent
    // from future file deletions or replacements in the active AP.
    const files = await this.fileRepository.find({ where: { apId } });
    const snapshotFiles: ApSnapshotFile[] = [];
    for (const [index, file] of files.entries()) {
      const snapshotFilePath = await this.persistSnapshotFile(
        apId,
        savedSnapshot.id,
        file,
        index,
      );
      snapshotFiles.push(
        this.snapshotFileRepository.create({
          snapshotId: savedSnapshot.id,
          filePath: snapshotFilePath,
          originalName: file.originalName,
          checksum: file.checksum,
          fileSize: file.fileSize,
        }),
      );
    }
    if (snapshotFiles.length > 0) {
      await this.snapshotFileRepository.save(snapshotFiles);
    }

    return this.findById(savedSnapshot.id);
  }

  async restore(snapshotId: string): Promise<Ap> {
    const snapshot = await this.findById(snapshotId);
    const ap = await this.apRepository.findOne({
      where: { id: snapshot.apId },
    });
    if (!ap) {
      throw new NotFoundException("AP not found");
    }

    // Restore AP-Index
    ap.apIndex = { ...snapshot.apIndexSnapshot };
    await this.apRepository.save(ap);

    // Resolve all file data first; only mutate DB state after all files
    // are restorable to avoid partial restores.
    const restoredFiles: ApFile[] = [];
    if (snapshot.snapshotFiles?.length) {
      for (const sf of snapshot.snapshotFiles) {
        const { filePath, fileSize } = await this.resolveRestoredFilePath(
          ap.id,
          snapshot.id,
          sf,
        );
        restoredFiles.push(
          this.fileRepository.create({
            apId: ap.id,
            filePath,
            originalName: sf.originalName,
            fileSize: fileSize ?? sf.fileSize,
            checksum: sf.checksum,
          }),
        );
      }
    }
    await this.fileRepository.delete({ apId: snapshot.apId });
    if (restoredFiles.length) {
      await this.fileRepository.save(restoredFiles);
    }

    return ap;
  }

  private async resolveRestoredFilePath(
    apId: string,
    snapshotId: string,
    snapshotFile: ApSnapshotFile,
  ): Promise<{ filePath: string; fileSize?: number }> {
    try {
      await fs.access(snapshotFile.filePath);
    } catch {
      throw new NotFoundException(
        `Snapshot file "${snapshotFile.originalName}" is missing on disk and cannot be restored`,
      );
    }

    try {
      const targetDir = path.join(
        this.storagePath,
        apId,
        "snapshot-restore",
        snapshotId,
      );
      await fs.mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, snapshotFile.originalName);
      await fs.copyFile(snapshotFile.filePath, targetPath);
      const stats = await fs.stat(targetPath);
      return { filePath: targetPath, fileSize: Number(stats.size) };
    } catch {
      throw new NotFoundException(
        `Snapshot file "${snapshotFile.originalName}" could not be copied for restore`,
      );
    }
  }

  private async persistSnapshotFile(
    apId: string,
    snapshotId: string,
    file: ApFile,
    index: number,
  ): Promise<string> {
    const snapshotDir = path.join(
      this.storagePath,
      apId,
      "snapshots",
      snapshotId,
    );
    await fs.mkdir(snapshotDir, { recursive: true });
    const sourceBaseName = path.basename(file.filePath) || file.originalName;
    const snapshotFilePath = path.join(
      snapshotDir,
      `${index}-${sourceBaseName}`,
    );

    try {
      await fs.copyFile(file.filePath, snapshotFilePath);
      return snapshotFilePath;
    } catch {
      // Fall back to previous behavior if copy fails unexpectedly.
      return file.filePath;
    }
  }

  async diff(snapshotId: string): Promise<Record<string, unknown>> {
    const snapshot = await this.findById(snapshotId);

    // Find direct previous snapshot (highest version lower than current).
    const previousSnapshot = await this.snapshotRepository.findOne({
      where: {
        apId: snapshot.apId,
        versionNumber: LessThan(snapshot.versionNumber),
      },
      order: { versionNumber: "DESC" },
      relations: ["snapshotFiles"],
    });

    if (!previousSnapshot) {
      return { message: "No previous snapshot to compare with" };
    }

    // Compare file lists
    const currentFiles = snapshot.snapshotFiles || [];
    const previousFiles = previousSnapshot.snapshotFiles || [];

    const currentChecksums = new Map(
      currentFiles.map((f) => [f.originalName, f.checksum]),
    );
    const previousChecksums = new Map(
      previousFiles.map((f) => [f.originalName, f.checksum]),
    );

    const added = currentFiles
      .filter((f) => !previousChecksums.has(f.originalName))
      .map((f) => f.originalName);
    const removed = previousFiles
      .filter((f) => !currentChecksums.has(f.originalName))
      .map((f) => f.originalName);
    const modified = currentFiles
      .filter(
        (f) =>
          previousChecksums.has(f.originalName) &&
          previousChecksums.get(f.originalName) !== f.checksum,
      )
      .map((f) => f.originalName);

    return {
      snapshotId,
      comparedWith: previousSnapshot.id,
      added,
      removed,
      modified,
      unchanged: currentFiles.length - added.length - modified.length,
    };
  }

  async diffWithCurrent(snapshotId: string): Promise<Record<string, unknown>> {
    const snapshot = await this.findById(snapshotId);
    const ap = await this.apRepository.findOne({
      where: { id: snapshot.apId },
    });
    if (!ap) {
      throw new NotFoundException(`AP with ID ${snapshot.apId} not found`);
    }

    const snapshotFiles = snapshot.snapshotFiles || [];
    const currentFiles = await this.fileRepository.find({
      where: { apId: snapshot.apId },
    });

    const snapshotChecksums = new Map(
      snapshotFiles.map((file) => [file.originalName, file.checksum]),
    );
    const currentChecksums = new Map(
      currentFiles.map((file) => [file.originalName, file.checksum]),
    );

    const added = currentFiles
      .filter((file) => !snapshotChecksums.has(file.originalName))
      .map((file) => file.originalName);
    const removed = snapshotFiles
      .filter((file) => !currentChecksums.has(file.originalName))
      .map((file) => file.originalName);
    const modified = currentFiles
      .filter(
        (file) =>
          snapshotChecksums.has(file.originalName) &&
          snapshotChecksums.get(file.originalName) !== file.checksum,
      )
      .map((file) => file.originalName);
    const unchanged = currentFiles.filter(
      (file) =>
        snapshotChecksums.has(file.originalName) &&
        snapshotChecksums.get(file.originalName) === file.checksum,
    ).length;

    return {
      snapshotId,
      comparedWith: "current",
      indexChanged:
        JSON.stringify(snapshot.apIndexSnapshot || {}) !==
        JSON.stringify(ap.apIndex || {}),
      added,
      removed,
      modified,
      unchanged,
    };
  }

  private async getApOrFail(apId: string): Promise<Ap> {
    assertUuidParam(apId, "AP ID");
    const ap = await this.apRepository.findOne({ where: { id: apId } });
    if (!ap) {
      throw new NotFoundException(`AP with ID ${apId} not found`);
    }
    return ap;
  }
}
