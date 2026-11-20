import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
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
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    private readonly configService: ConfigService,
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
      relationLoadStrategy: "query",
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

  async create(
    acpId: string,
    changelog?: string,
    expectedUpdatedAt?: string,
  ): Promise<AcpSnapshot> {
    assertUuidParam(acpId, "acpId");
    let snapshotDir: string | undefined;
    try {
      return await this.acpRepository.manager.transaction(async (manager) => {
        const acp = await manager.getRepository(Acp).findOne({
          where: { id: acpId },
          lock: { mode: "pessimistic_write" },
        });
        if (!acp) throw new NotFoundException("ACP not found");
        if (
          expectedUpdatedAt &&
          acp.updatedAt.toISOString() !== expectedUpdatedAt
        )
          throw new ConflictException("ACP has changed since preview");
        const snapshots = manager.getRepository(AcpSnapshot);
        const latest = await snapshots.findOne({
          where: { acpId },
          order: { versionNumber: "DESC" },
        });
        const snapshot = await snapshots.save(
          snapshots.create({
            acpId,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            acpIndexSnapshot: acp.acpIndex,
            packageMetadataSnapshot: {
              name: acp.name,
              description: acp.description,
              itemProperties: acp.itemProperties,
            },
            changelog,
          }),
        );
        const files = await manager
          .getRepository(AcpFile)
          .find({ where: { acpId } });
        snapshotDir = path.join(
          this.storagePath,
          acpId,
          "snapshots",
          snapshot.id,
        );
        if (files.length) await fs.mkdir(snapshotDir, { recursive: true });
        const snapshotFiles = manager.getRepository(AcpSnapshotFile);
        snapshot.snapshotFiles = [];
        for (const [index, file] of files.entries()) {
          const filePath = path.join(
            snapshotDir,
            `${index}-${path.basename(file.filePath)}`,
          );
          await fs.copyFile(file.filePath, filePath);
          snapshot.snapshotFiles.push(
            snapshotFiles.create({
              snapshotId: snapshot.id,
              filePath,
              originalName: file.originalName,
              relativePath: file.relativePath || file.originalName,
              checksum: file.checksum,
              fileType: file.fileType,
              validationResult: file.validationResult,
              fileSize: file.fileSize,
            }),
          );
        }
        if (snapshot.snapshotFiles.length)
          await snapshotFiles.save(snapshot.snapshotFiles, { chunk: 500 });
        return snapshot;
      });
    } catch (error) {
      if (snapshotDir)
        await fs.rm(snapshotDir, { recursive: true, force: true });
      throw error;
    }
  }

  async restore(snapshotId: string): Promise<Acp> {
    const snapshot = await this.findById(snapshotId);
    const copied: string[] = [];
    try {
      return await this.acpRepository.manager.transaction(async (manager) => {
        const packages = manager.getRepository(Acp);
        const acp = await packages.findOne({
          where: { id: snapshot.acpId },
          lock: { mode: "pessimistic_write" },
        });
        if (!acp) throw new NotFoundException("ACP not found");
        const released = (status: unknown) =>
          status === "RELEASED_PUBLIC" || status === "RELEASED_CONFIDENTIAL";
        if (released(acp.acpIndex.status))
          throw new ConflictException(
            "Published ACP must be reopened before it can be changed",
          );
        const files = manager.getRepository(AcpFile);
        const restoredFiles: AcpFile[] = [];
        const activeDir = path.join(this.storagePath, acp.id);
        if (snapshot.snapshotFiles?.length)
          await fs.mkdir(activeDir, { recursive: true });
        for (const sf of snapshot.snapshotFiles || []) {
          const filePath = path.join(
            activeDir,
            randomUUID() + path.extname(sf.originalName),
          );
          copied.push(filePath);
          try {
            await fs.copyFile(sf.filePath, filePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              throw new NotFoundException(
                `Snapshot file "${sf.originalName}" is missing on disk and cannot be restored`,
              );
            throw error;
          }
          restoredFiles.push(
            files.create({
              acpId: acp.id,
              filePath,
              originalName: sf.originalName,
              relativePath: sf.relativePath || sf.originalName,
              checksum: sf.checksum,
              fileSize: sf.fileSize,
              fileType: sf.fileType,
              validationResult: sf.validationResult,
            }),
          );
        }
        acp.acpIndex = { ...snapshot.acpIndexSnapshot };
        // Publication is a separate operation even when restoring an old release.
        if (released(acp.acpIndex.status))
          acp.acpIndex.status = "IN_DEVELOPMENT";
        if (snapshot.packageMetadataSnapshot) {
          const metadata = snapshot.packageMetadataSnapshot;
          acp.name = metadata.name;
          acp.description = metadata.description;
          acp.itemProperties = metadata.itemProperties;
        } else if (Array.isArray(acp.acpIndex.name)) {
          const german = acp.acpIndex.name.find(
            (entry) => entry?.lang === "de",
          );
          if (typeof german?.value === "string") acp.name = german.value;
        }
        acp.acpIndexValidationReport = null;
        acp.acpIndexValidationStatus = "UNKNOWN";
        await files.delete({ acpId: acp.id });
        if (restoredFiles.length)
          await files.save(restoredFiles, { chunk: 500 });
        return packages.save(acp);
      });
    } catch (error) {
      await Promise.allSettled(
        copied.map((filePath) => fs.rm(filePath, { force: true })),
      );
      throw error;
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
      relationLoadStrategy: "query",
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
