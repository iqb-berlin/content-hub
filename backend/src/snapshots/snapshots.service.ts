import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import * as fs from "fs/promises";
import * as path from "path";
import {
  Acp,
  AcpSnapshot,
  AcpSnapshotFile,
  AcpFile,
} from "../database/entities";
import { assertUuidParam } from "../common/uuid-param";

@Injectable()
export class SnapshotsService {
  private readonly storagePath: string;

  constructor(
    @InjectRepository(AcpSnapshot)
    private readonly snapshotRepository: Repository<AcpSnapshot>,
    @InjectRepository(AcpSnapshotFile)
    private readonly snapshotFileRepository: Repository<AcpSnapshotFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.storagePath = this.configService.get<string>(
      "FILE_STORAGE_PATH",
      "./uploads",
    );
  }

  async findByAcp(acpId: string): Promise<AcpSnapshot[]> {
    await this.getAcpOrFail(acpId);
    return this.snapshotRepository.find({
      where: { acpId },
      order: { versionNumber: "DESC" },
    });
  }

  async findById(id: string): Promise<AcpSnapshot> {
    const snapshot = await this.snapshotRepository.findOne({
      where: { id },
      relations: ["snapshotFiles"],
    });
    if (!snapshot) {
      throw new NotFoundException(`Snapshot with ID ${id} not found`);
    }
    return snapshot;
  }

  async findByIdInAcp(acpId: string, snapshotId: string): Promise<AcpSnapshot> {
    const snapshot = await this.findById(snapshotId);
    if (snapshot.acpId !== acpId) {
      throw new NotFoundException(
        `Snapshot with ID ${snapshotId} not found for ACP ${acpId}`,
      );
    }
    return snapshot;
  }

  async delete(snapshotId: string): Promise<void> {
    const snapshot = await this.findById(snapshotId);
    const snapshotAcpId = snapshot.acpId;
    const snapshotEntityId = snapshot.id;

    if (!snapshotAcpId || !snapshotEntityId) {
      throw new NotFoundException(
        `Snapshot with ID ${snapshotId} is missing required metadata`,
      );
    }

    await this.snapshotRepository.remove(snapshot);

    const snapshotDir = path.join(
      this.storagePath,
      snapshotAcpId,
      "snapshots",
      snapshotEntityId,
    );
    const restoreDir = path.join(
      this.storagePath,
      snapshotAcpId,
      "snapshot-restore",
      snapshotEntityId,
    );

    await Promise.allSettled([
      fs.rm(snapshotDir, { recursive: true, force: true }),
      fs.rm(restoreDir, { recursive: true, force: true }),
    ]);
  }

  async create(acpId: string, changelog?: string): Promise<AcpSnapshot> {
    const acp = await this.getAcpOrFail(acpId);

    // Determine next version number
    const latestSnapshot = await this.snapshotRepository.findOne({
      where: { acpId },
      order: { versionNumber: "DESC" },
    });
    const nextVersion = latestSnapshot ? latestSnapshot.versionNumber + 1 : 1;

    // Create snapshot
    const snapshot = this.snapshotRepository.create({
      acpId,
      versionNumber: nextVersion,
      acpIndexSnapshot: { ...acp.acpIndex },
      changelog,
    });
    const savedSnapshot = await this.snapshotRepository.save(snapshot);

    // Persist file state for this snapshot so restore stays independent
    // from future file deletions or replacements in the active ACP.
    const files = await this.fileRepository.find({ where: { acpId } });
    const snapshotFiles: AcpSnapshotFile[] = [];
    for (const [index, file] of files.entries()) {
      const snapshotFilePath = await this.persistSnapshotFile(
        acpId,
        savedSnapshot.id,
        file,
        index,
      );
      snapshotFiles.push(
        this.snapshotFileRepository.create({
          snapshotId: savedSnapshot.id,
          filePath: snapshotFilePath,
          originalName: file.originalName,
          relativePath: file.relativePath || file.originalName,
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

  async restore(snapshotId: string): Promise<Acp> {
    const snapshot = await this.findById(snapshotId);
    const acp = await this.acpRepository.findOne({
      where: { id: snapshot.acpId },
    });
    if (!acp) {
      throw new NotFoundException("ACP not found");
    }

    // Resolve all file data first; only mutate DB state after all files
    // are restorable to avoid partial restores.
    const restoredFiles: AcpFile[] = [];
    if (snapshot.snapshotFiles?.length) {
      for (const sf of snapshot.snapshotFiles) {
        const { filePath, fileSize } = await this.resolveRestoredFilePath(
          acp.id,
          snapshot.id,
          sf,
        );
        restoredFiles.push(
          this.fileRepository.create({
            acpId: acp.id,
            filePath,
            originalName: sf.originalName,
            relativePath: sf.relativePath || sf.originalName,
            fileSize: fileSize ?? sf.fileSize,
            checksum: sf.checksum,
          }),
        );
      }
    }
    const restoredIndex = {
      ...snapshot.acpIndexSnapshot,
      status: "IN_DEVELOPMENT",
    };
    let restoredAcp: Acp;
    let indexService: any;
    try {
      const { AcpIndexService } = require("../acp/acp-index.service");
      indexService = this.moduleRef.get(AcpIndexService, {
        strict: false,
      });
      restoredAcp = await indexService.saveCandidate(
        acp.id,
        restoredIndex,
        acp.updatedAt.toISOString(),
      );
    } catch (error) {
      if (error?.constructor?.name !== "UnknownElementException") throw error;
      acp.acpIndex = restoredIndex;
      restoredAcp = await this.acpRepository.save(acp);
    }

    await this.fileRepository.delete({ acpId: snapshot.acpId });
    if (restoredFiles.length) {
      await this.fileRepository.save(restoredFiles);
    }
    if (indexService) {
      await indexService.validateStoredIndex(acp.id, {
        external: false,
        persist: true,
      });
    }

    return restoredAcp;
  }

  private async resolveRestoredFilePath(
    acpId: string,
    snapshotId: string,
    snapshotFile: AcpSnapshotFile,
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
        acpId,
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
    acpId: string,
    snapshotId: string,
    file: AcpFile,
    index: number,
  ): Promise<string> {
    const snapshotDir = path.join(
      this.storagePath,
      acpId,
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
        acpId: snapshot.acpId,
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
    const acp = await this.acpRepository.findOne({
      where: { id: snapshot.acpId },
    });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${snapshot.acpId} not found`);
    }

    const snapshotFiles = snapshot.snapshotFiles || [];
    const currentFiles = await this.fileRepository.find({
      where: { acpId: snapshot.acpId },
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
        JSON.stringify(snapshot.acpIndexSnapshot || {}) !==
        JSON.stringify(acp.acpIndex || {}),
      added,
      removed,
      modified,
      unchanged,
    };
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
