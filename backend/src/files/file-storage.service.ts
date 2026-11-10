import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { Repository } from "typeorm";
import { ApFile } from "../database/entities";

@Injectable()
export class FileStorageService {
  private readonly storagePath: string;

  constructor(
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
    configService: ConfigService,
  ) {
    this.storagePath = configService.get<string>(
      "FILE_STORAGE_PATH",
      "./uploads",
    );
  }

  async stageUpload(
    apId: string,
    uploadedFile: Express.Multer.File,
  ): Promise<ApFile> {
    const apDir = path.join(this.storagePath, apId);
    await fs.mkdir(apDir, { recursive: true });

    const ext = path.extname(uploadedFile.originalname);
    const filePath = path.join(apDir, `${crypto.randomUUID()}${ext}`);

    try {
      await fs.writeFile(filePath, uploadedFile.buffer);
    } catch (error) {
      await this.removePath(filePath);
      throw error;
    }

    const checksum = crypto
      .createHash("sha256")
      .update(uploadedFile.buffer)
      .digest("hex");

    return this.fileRepository.create({
      apId,
      filePath,
      originalName: uploadedFile.originalname,
      fileType: uploadedFile.mimetype,
      fileSize: uploadedFile.size,
      checksum,
    });
  }

  async read(file: ApFile): Promise<Buffer> {
    return fs.readFile(file.filePath);
  }

  async removePhysicalFile(file: Pick<ApFile, "filePath">): Promise<void> {
    await this.removePath(file.filePath);
  }

  async removePhysicalFiles(
    files: Array<Pick<ApFile, "filePath">>,
  ): Promise<void> {
    for (const file of files) {
      await this.removePhysicalFile(file);
    }
  }

  private async removePath(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // Missing files and best-effort rollback cleanup are safe to ignore.
    }
  }
}
