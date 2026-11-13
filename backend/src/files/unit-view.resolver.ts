import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import { performance } from "perf_hooks";
import { ApFile } from "../database/entities";
import { AsyncCacheStatus, AsyncLruCache } from "./async-lru-cache";
import { FileCatalogCache, FileCatalogResult } from "./file-catalog.cache";
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
    apId: string,
    unitId: string,
    explorerStateSignature: string | Promise<string> = "",
  ): Promise<UnitViewResolution> {
    const [catalog, resolvedExplorerStateSignature] = await Promise.all([
      this.fileCatalogCache.get(apId),
      Promise.resolve(explorerStateSignature),
    ]);
    const cacheKey = `${apId}:${unitId}:${this.hashCanonicalValue({
      files: catalog.signature,
      explorerState: resolvedExplorerStateSignature,
    })}`;
    const { value, status } = await this.cache.getOrLoad(cacheKey, () =>
      this.build(apId, unitId, catalog.files),
    );
    return {
      value: structuredClone(value.value),
      cacheStatus: status,
      catalog,
      parseMs: status === "miss" ? value.parseMs : 0,
    };
  }

  invalidate(apId: string): void {
    this.cache.deleteWhere((key) => key.startsWith(`${apId}:`));
  }

  private async build(
    apId: string,
    unitId: string,
    allFiles: ApFile[],
  ): Promise<UnitViewCacheValue> {
    const parseStartedAt = performance.now();
    const xmlFile = allFiles.find(
      (file) => file.originalName.replace(/\.xml$/i, "") === unitId,
    );
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
          downloadUrl: `/api/ap/${apId}/files/${playerFile.id}/download`,
          fileId: playerFile.id,
        });
      }
    }

    this.addDependency(
      dependencies,
      allFiles,
      parsed.definitionRef,
      "UNIT_DEFINITION",
      apId,
    );
    this.addDependency(
      dependencies,
      allFiles,
      parsed.codingSchemeRef,
      "CODING_SCHEME",
      apId,
    );

    if (parsed.metadataRef) {
      const metadataFile = allFiles.find(
        (file) =>
          file.originalName === parsed.metadataRef ||
          file.originalName === `${parsed.metadataRef}.json`,
      );
      if (metadataFile) {
        dependencies.push({
          type: "METADATA",
          originalName: metadataFile.originalName,
          downloadUrl: `/api/ap/${apId}/files/${metadataFile.id}/download`,
          fileId: metadataFile.id,
        });
      }
    }

    return {
      value: {
        id: parsed.unitId,
        name: parsed.unitLabel,
        description: parsed.description,
        dependencies,
      },
      parseMs: performance.now() - parseStartedAt,
    };
  }

  private addDependency(
    dependencies: any[],
    allFiles: ApFile[],
    originalName: string | undefined,
    type: string,
    apId: string,
  ): void {
    if (!originalName) return;
    const file = allFiles.find(
      (candidate) => candidate.originalName === originalName,
    );
    if (!file) return;
    dependencies.push({
      type,
      originalName: file.originalName,
      downloadUrl: `/api/ap/${apId}/files/${file.id}/download`,
      fileId: file.id,
    });
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
