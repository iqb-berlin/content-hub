import { ConflictException, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import { performance } from "perf_hooks";
import * as path from "path";
import { AcpFile } from "../database/entities";
import { AsyncCacheStatus, AsyncLruCache } from "./async-lru-cache";
import { FileCatalogCache, FileCatalogResult } from "./file-catalog.cache";
import { normalizePartId } from "./relative-path";
import { findPlayerFile, parseUnitXml } from "./unit-file-parsing";

interface UnitViewCacheValue {
  value: any;
  parseMs: number;
}

export interface UnitViewResolution {
  value: any;
  cacheStatus: AsyncCacheStatus;
  catalog: FileCatalogResult;
  parseMs: number;
}

@Injectable()
export class UnitViewResolver {
  private readonly logger = new Logger(UnitViewResolver.name);
  private readonly cache = new AsyncLruCache<string, UnitViewCacheValue>(100);

  constructor(private readonly fileCatalogCache: FileCatalogCache) {}

  get size(): number {
    return this.cache.size;
  }

  async resolve(
    acpId: string,
    unitId: string,
    explorerStateSignature: string | Promise<string> = "",
    partId?: string,
  ): Promise<UnitViewResolution> {
    const [catalog, resolvedExplorerStateSignature] = await Promise.all([
      this.fileCatalogCache.get(acpId),
      Promise.resolve(explorerStateSignature),
    ]);
    const cacheKey = `${acpId}:${partId || "legacy"}:${unitId}:${this.hashCanonicalValue(
      {
        files: catalog.signature,
        explorerState: resolvedExplorerStateSignature,
      },
    )}`;
    const { value, status } = await this.cache.getOrLoad(cacheKey, () =>
      this.build(acpId, unitId, catalog.files, partId),
    );
    return {
      value: structuredClone(value.value),
      cacheStatus: status,
      catalog,
      parseMs: status === "miss" ? value.parseMs : 0,
    };
  }

  invalidate(acpId: string): void {
    this.cache.deleteWhere((key) => key.startsWith(`${acpId}:`));
  }

  private async build(
    acpId: string,
    unitId: string,
    allFiles: AcpFile[],
    partId?: string,
  ): Promise<UnitViewCacheValue> {
    const parseStartedAt = performance.now();
    const matchingXmlFiles = allFiles.filter(
      (file) => file.originalName.replace(/\.xml$/i, "") === unitId,
    );
    if (!partId && matchingXmlFiles.length > 1) {
      throw new ConflictException({
        message: `Unit ${unitId} exists in multiple assessment parts`,
        possibleParts: matchingXmlFiles
          .map((file) =>
            this.partFromUnitPath(file.relativePath || file.originalName),
          )
          .filter(Boolean),
      });
    }
    const xmlFile = partId
      ? matchingXmlFiles.find(
          (file) =>
            this.partFromUnitPath(file.relativePath || file.originalName) ===
            normalizePartId(partId),
        )
      : matchingXmlFiles.length === 1
        ? matchingXmlFiles[0]
        : undefined;
    if (!xmlFile) {
      return { value: null, parseMs: performance.now() - parseStartedAt };
    }

    const xmlContent = await fs.readFile(xmlFile.filePath, "utf-8");
    if (!xmlContent.includes("<Unit")) {
      return { value: null, parseMs: performance.now() - parseStartedAt };
    }
    const parsed = parseUnitXml(xmlContent, xmlFile.originalName, this.logger);
    if (!parsed) {
      return { value: null, parseMs: performance.now() - parseStartedAt };
    }

    const dependencies: any[] = [];
    const unitDirectory = path.posix.dirname(
      xmlFile.relativePath || xmlFile.originalName,
    );
    const playerFileName = findPlayerFile(
      parsed.playerRef,
      allFiles.map((file) => file.originalName),
    );
    if (playerFileName) {
      const playerFile = allFiles.find(
        (file) => file.originalName === playerFileName,
      );
      if (playerFile) {
        dependencies.push({
          type: "PLAYER",
          originalName: playerFile.originalName,
          downloadUrl: `/api/acp/${acpId}/files/${playerFile.id}/download`,
          fileId: playerFile.id,
        });
      }
    }

    this.addDependency(
      dependencies,
      allFiles,
      parsed.definitionRef,
      "UNIT_DEFINITION",
      acpId,
      unitDirectory,
    );
    this.addDependency(
      dependencies,
      allFiles,
      parsed.codingSchemeRef,
      "CODING_SCHEME",
      acpId,
      unitDirectory,
    );

    if (parsed.metadataRef) {
      const metadataFile =
        this.findDependencyFile(allFiles, parsed.metadataRef, unitDirectory) ||
        this.findDependencyFile(
          allFiles,
          `${parsed.metadataRef}.json`,
          unitDirectory,
        );
      if (metadataFile) {
        dependencies.push({
          type: "METADATA",
          originalName: metadataFile.originalName,
          downloadUrl: `/api/acp/${acpId}/files/${metadataFile.id}/download`,
          fileId: metadataFile.id,
        });
      }
    }

    return {
      value: {
        id: parsed.unitId,
        ...(partId ? { partId: normalizePartId(partId) } : {}),
        name: parsed.unitLabel,
        description: parsed.description,
        dependencies,
      },
      parseMs: performance.now() - parseStartedAt,
    };
  }

  private addDependency(
    dependencies: any[],
    allFiles: AcpFile[],
    originalName: string | undefined,
    type: string,
    acpId: string,
    unitDirectory: string,
  ): void {
    if (!originalName) return;
    const file = this.findDependencyFile(allFiles, originalName, unitDirectory);
    if (!file) return;
    dependencies.push({
      type,
      originalName: file.originalName,
      downloadUrl: `/api/acp/${acpId}/files/${file.id}/download`,
      fileId: file.id,
    });
  }

  private findDependencyFile(
    allFiles: AcpFile[],
    originalName: string,
    unitDirectory: string,
  ): AcpFile | undefined {
    const relativePath = path.posix.normalize(
      path.posix.join(unitDirectory === "." ? "" : unitDirectory, originalName),
    );
    const local = allFiles.find(
      (candidate) =>
        (candidate.relativePath || candidate.originalName) === relativePath,
    );
    if (local) return local;
    const matches = allFiles.filter(
      (candidate) => candidate.originalName === originalName,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private partFromUnitPath(relativePath: string): string {
    const segments = relativePath.split("/");
    const unitsIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === "units",
    );
    return unitsIndex >= 0 && segments[unitsIndex + 1]
      ? normalizePartId(segments[unitsIndex + 1])
      : "";
  }

  private hashCanonicalValue(value: unknown): string {
    return createHash("sha256")
      .update(
        JSON.stringify(value, (_key, nestedValue) => {
          if (
            nestedValue &&
            typeof nestedValue === "object" &&
            !Array.isArray(nestedValue)
          ) {
            return Object.fromEntries(
              Object.entries(nestedValue).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            );
          }
          return nestedValue;
        }),
      )
      .digest("hex");
  }
}
