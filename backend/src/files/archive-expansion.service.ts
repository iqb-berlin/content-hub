import { BadRequestException, Injectable } from "@nestjs/common";
import * as path from "path";
import { normalizeRelativePath } from "./relative-path";

@Injectable()
export class ArchiveExpansionService {
  async expand(files: Express.Multer.File[]): Promise<Express.Multer.File[]> {
    const expandedFiles: Express.Multer.File[] = [];

    for (const file of files) {
      const incomingName = String(file?.originalname || "").trim();
      if (!incomingName) {
        throw new BadRequestException("All files must include a filename");
      }

      if (!this.isZipUpload(file)) {
        expandedFiles.push(file);
        continue;
      }

      const extractedFiles = await this.extractZipEntries(file);
      if (!extractedFiles.length) {
        throw new BadRequestException(
          `ZIP archive "${incomingName}" does not contain any uploadable files`,
        );
      }

      expandedFiles.push(...extractedFiles);
    }

    return expandedFiles;
  }

  private isZipUpload(file: Express.Multer.File): boolean {
    const fileName = String(file?.originalname || "")
      .trim()
      .toLowerCase();
    const mimeType = String(file?.mimetype || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return (
      fileName.endsWith(".zip") ||
      mimeType === "application/zip" ||
      mimeType === "application/x-zip-compressed"
    );
  }

  private async extractZipEntries(
    uploadedZip: Express.Multer.File,
  ): Promise<Express.Multer.File[]> {
    const JSZip = require("jszip");

    let archive: any;
    try {
      archive = await JSZip.loadAsync(uploadedZip.buffer);
    } catch {
      throw new BadRequestException(
        `ZIP archive "${uploadedZip.originalname}" could not be extracted`,
      );
    }

    const extractedFiles: Express.Multer.File[] = [];
    const archiveEntries = Object.values(archive.files || {});

    for (const entry of archiveEntries as Array<{
      dir?: boolean;
      name?: string;
      unsafeOriginalName?: string;
    }>) {
      if (entry?.dir) {
        continue;
      }

      const originalEntryName = String(
        entry?.unsafeOriginalName || entry?.name || "",
      );
      const relativePath = normalizeRelativePath(originalEntryName);
      const extractedName = this.getArchiveEntryFileName(relativePath);
      if (
        !extractedName ||
        this.shouldSkipArchiveEntry(originalEntryName, extractedName)
      ) {
        continue;
      }

      const zipEntry = archive.file(String(entry?.name || originalEntryName));
      if (!zipEntry) {
        continue;
      }

      const buffer = Buffer.from(await zipEntry.async("nodebuffer"));
      extractedFiles.push({
        ...uploadedZip,
        originalname: extractedName,
        mimetype: this.inferMimeTypeFromFileName(extractedName),
        size: buffer.length,
        buffer,
        relativePath,
      } as Express.Multer.File & { relativePath: string });
    }

    return extractedFiles;
  }

  private getArchiveEntryFileName(entryName: string): string {
    const normalizedPath = String(entryName || "")
      .replace(/\\/g, "/")
      .trim();
    return path.posix.basename(normalizedPath).trim();
  }

  private shouldSkipArchiveEntry(
    entryName: string,
    extractedName: string,
  ): boolean {
    const normalizedPath = String(entryName || "")
      .replace(/\\/g, "/")
      .trim();
    if (!normalizedPath) {
      return true;
    }

    if (normalizedPath.startsWith("__MACOSX/")) {
      return true;
    }

    return extractedName === ".DS_Store";
  }

  private inferMimeTypeFromFileName(fileName: string): string {
    const extension = path
      .extname(String(fileName || ""))
      .slice(1)
      .toLowerCase();

    switch (extension) {
      case "xml":
        return "application/xml";
      case "json":
      case "voud":
      case "vomd":
      case "vocs":
        return "application/json";
      case "html":
      case "htm":
        return "text/html";
      case "csv":
        return "text/csv";
      case "tsv":
        return "text/tab-separated-values";
      case "txt":
      case "md":
      case "log":
      case "yml":
      case "yaml":
      case "ini":
      case "properties":
        return "text/plain";
      case "pdf":
        return "application/pdf";
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      case "svg":
      case "svgz":
        return "image/svg+xml";
      case "bmp":
        return "image/bmp";
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "ogg":
        return "audio/ogg";
      case "m4a":
        return "audio/mp4";
      case "aac":
        return "audio/aac";
      case "mp4":
        return "video/mp4";
      case "webm":
        return "video/webm";
      case "mov":
        return "video/quicktime";
      case "m4v":
        return "video/x-m4v";
      case "ogv":
        return "video/ogg";
      default:
        return "application/octet-stream";
    }
  }
}
