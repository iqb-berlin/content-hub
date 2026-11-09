import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { performance } from "perf_hooks";
import { ApFile } from "../database/entities";
import { AsyncCacheStatus, AsyncLruCache } from "./async-lru-cache";

export interface FileCatalogSnapshot {
  files: ApFile[];
  signature: string;
}

export interface FileCatalogResult extends FileCatalogSnapshot {
  cacheStatus: AsyncCacheStatus;
  sourceReadMs: number;
  fileSignatureMs: number;
}

@Injectable()
export class FileCatalogCache {
  private readonly cache = new AsyncLruCache<string, FileCatalogSnapshot>(100);

  constructor(
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
  ) {}

  get size(): number {
    return this.cache.size;
  }

  async get(apId: string, manager?: EntityManager): Promise<FileCatalogResult> {
    // Keep in-flight database reads local to the transaction that owns them.
    if (manager)
      return new FileCatalogCache(manager.getRepository(ApFile)).get(apId);
    const totalStartedAt = performance.now();
    const signatureStartedAt = performance.now();
    const revision = await this.loadRevision(apId);
    const fileSignatureMs = performance.now() - signatureStartedAt;
    const cacheKey = `${apId}:${revision.signature}`;

    this.cache.deleteWhere(
      (key) => key.startsWith(`${apId}:`) && key !== cacheKey,
    );
    const { value, status } = await this.cache.getOrLoad(cacheKey, async () => {
      const files = revision.files || (await this.loadFileCatalogRecords(apId));
      return {
        files: structuredClone(files),
        signature: revision.signature,
      };
    });

    return {
      files: structuredClone(value.files),
      signature: value.signature,
      cacheStatus: status,
      sourceReadMs: performance.now() - totalStartedAt,
      fileSignatureMs,
    };
  }

  invalidate(apId: string): void {
    this.cache.deleteWhere((key) => key.startsWith(`${apId}:`));
  }

  private async loadRevision(
    apId: string,
  ): Promise<{ signature: string; files?: ApFile[] }> {
    if (typeof this.fileRepository.query !== "function") {
      const files = await this.loadFileCatalogRecords(apId);
      return {
        signature: buildSourceFileSignature(files),
        files,
      };
    }

    const rows = (await this.fileRepository.query(
      `
        SELECT
          COUNT(*)::text AS count,
          COALESCE(
            md5(
              string_agg(
                concat_ws(
                  chr(31),
                  id::text,
                  original_name,
                  file_path,
                  COALESCE(checksum, ''),
                  file_size::text,
                  uploaded_at::text
                ),
                chr(30) ORDER BY id::text
              )
            ),
            md5('')
          ) AS hash
        FROM acp_files
        WHERE acp_id = $1
      `,
      [apId],
    )) as Array<{ count?: string; hash?: string }>;
    return {
      signature: `${rows[0]?.count || "0"}:${rows[0]?.hash || ""}`,
    };
  }

  private loadFileCatalogRecords(apId: string): Promise<ApFile[]> {
    return this.fileRepository.find({
      where: { apId },
      select: {
        id: true,
        apId: true,
        filePath: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        checksum: true,
        uploadedAt: true,
      },
    });
  }
}

export function buildSourceFileSignature(files: ApFile[]): string {
  return JSON.stringify(
    files
      .map((file) => [
        file.id,
        file.originalName,
        file.filePath,
        file.checksum || "",
        String(file.fileSize || ""),
        file.uploadedAt instanceof Date
          ? file.uploadedAt.toISOString()
          : String(file.uploadedAt || ""),
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}
