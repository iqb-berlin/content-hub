import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { Repository } from "typeorm";
import { AcpFile } from "../database/entities";
import { getUploadRelativePath } from "./relative-path";

@Injectable()
export class FileStorageService {
  private readonly storagePath: string;

  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    configService: ConfigService,
  ) {
    this.storagePath = configService.get<string>(
      "FILE_STORAGE_PATH",
      "./uploads",
    );
  }

  async stageUpload(
    acpId: string,
    uploadedFile: Express.Multer.File,
  ): Promise<AcpFile> {
    const acpDir = path.join(this.storagePath, acpId);
    await fs.mkdir(acpDir, { recursive: true });

    const ext = path.extname(uploadedFile.originalname);
    const filePath = path.join(acpDir, `${crypto.randomUUID()}${ext}`);

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
      acpId,
      filePath,
      originalName: uploadedFile.originalname,
      relativePath: getUploadRelativePath(uploadedFile),
      fileType: uploadedFile.mimetype,
      fileSize: uploadedFile.size,
      checksum,
    });
  }

  async read(file: AcpFile): Promise<Buffer> {
    return fs.readFile(file.filePath);
  }

  async removePhysicalFile(file: Pick<AcpFile, "filePath">): Promise<void> {
    await this.removePath(file.filePath);
  }

  async removePhysicalFiles(
    files: Array<Pick<AcpFile, "filePath">>,
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
