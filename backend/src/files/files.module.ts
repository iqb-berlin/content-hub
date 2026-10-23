import { ReviewManifestModule } from "../review/review-manifest.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MulterModule } from "@nestjs/platform-express";
import { FilesService } from "./files.service";
import { FilesController } from "./files.controller";
import { UnitParserService } from "./unit-parser.service";
import {
  AcpFile,
  AcpFileProcessingJob,
  Acp,
  AcpUserRole,
  AcpAccessConfig,
  ItemResponseState,
  AcpItemRowNumber,
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ValidationModule } from "../validation/validation.module";
import { FileProcessingJobsService } from "./file-processing-jobs.service";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { ItemRowNumberingService } from "./item-row-numbering.service";
import { ArchiveExpansionService } from "./archive-expansion.service";
import { FileMutationService } from "./file-mutation.service";
import { FileStorageService } from "./file-storage.service";
import { FileCatalogCache } from "./file-catalog.cache";
import { ItemListParser } from "./item-list.parser";
import { NumberedItemListCache } from "./numbered-item-list.cache";
import { UnitViewResolver } from "./unit-view.resolver";
import { AcpModule } from "../acp/acp.module";
import { SnapshotsModule } from "../snapshots/snapshots.module";
import { IndexGenerationService } from "./index-generation.service";
import { IndexGenerationController } from "./index-generation.controller";

const MAX_UPLOAD_FILE_SIZE_BYTES = 512 * 1024 * 1024;

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AcpFile,
      AcpFileProcessingJob,
      Acp,
      AcpUserRole,
      AcpAccessConfig,
      ItemResponseState,
      AcpItemRowNumber,
    ]),
    MulterModule.register({
      limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES }, // 512MB
    }),
    AuthModule,
    ValidationModule,
    ReviewManifestModule,
    ItemExplorerModule,
    AcpModule,
    SnapshotsModule,
  ],
  controllers: [FilesController, IndexGenerationController],
  providers: [
    FilesService,
    ArchiveExpansionService,
    FileMutationService,
    FileStorageService,
    FileCatalogCache,
    ItemListParser,
    NumberedItemListCache,
    UnitViewResolver,
    UnitParserService,
    FileProcessingJobsService,
    ItemRowNumberingService,
    IndexGenerationService,
  ],
  exports: [
    FilesService,
    FileCatalogCache,
    UnitParserService,
    FileProcessingJobsService,
    ItemRowNumberingService,
  ],
})
export class FilesModule {}
