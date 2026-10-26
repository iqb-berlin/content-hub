import {
  BadRequestException,
  Body,
  ForbiddenException,
  Controller,
  Get,
  Logger,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Request,
  Res,
  Sse,
} from "@nestjs/common";
import { Response } from "express";
import { performance } from "perf_hooks";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiQuery,
} from "@nestjs/swagger";
import { FilesService } from "./files.service";
import {
  ItemExplorerLoadDiagnostics,
  UnitParserService,
} from "./unit-parser.service";
import { ValidationService } from "../validation/validation.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AcpAccessGuard } from "../auth/guards/acp-access.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { FileProcessingJobsService } from "./file-processing-jobs.service";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { AcpCapabilitiesService } from "../auth/capabilities/acp-capabilities.service";
import { hasCapability } from "../auth/capabilities/acp-capabilities";
import {
  ExplorerReadGuard,
  ExplorerEditGuard,
} from "../auth/capabilities/explorer-access.guard";
import { UuidParam } from "../common/uuid-param";

@ApiTags("ACP Files")
@Controller("acp/:acpId/files")
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly unitParserService: UnitParserService,
    private readonly validationService: ValidationService,
    private readonly fileProcessingJobsService: FileProcessingJobsService,
    private readonly itemExplorerStateService: ItemExplorerStateService,
    private readonly capabilities: AcpCapabilitiesService,
  ) {}

  @Get()
  @UseGuards(AcpAccessGuard)
  @ApiOperation({ summary: "List all files for an ACP" })
  async findAll(
    @UuidParam("acpId") acpId: string,
    @Query("format") format?: string,
    @Query("unitId") unitId?: string,
    @Query("sequenceId") sequenceId?: string,
    @Request() req?: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const isManager =
      req?.acpAccessLevel === "MANAGER" || req?.acpAccessLevel === "ADMIN";
    const featureConfig = await this.filesService.getFeatureConfig(acpId);

    if (format === "zip") {
      if (unitId && sequenceId) {
        throw new BadRequestException(
          "Please provide either unitId or sequenceId, not both",
        );
      }

      if (!unitId && !sequenceId) {
        throw new BadRequestException(
          "ZIP download requires unitId or sequenceId",
        );
      }
      if (!isManager && !featureConfig.allowUnitDownload) {
        throw new ForbiddenException(
          "Unit download is not enabled for this ACP",
        );
      }

      const archive = unitId
        ? await this.filesService.createUnitZip(acpId, unitId)
        : req?.query?.kind === "booklet"
          ? await this.filesService.createSequenceZip(
              acpId,
              sequenceId!,
              "booklet",
            )
          : await this.filesService.createSequenceZip(acpId, sequenceId!);

      res?.setHeader("Content-Type", "application/zip");
      res?.setHeader(
        "Content-Disposition",
        `attachment; filename="${archive.fileName}"`,
      );
      res?.send(archive.buffer);
      return;
    }

    if (!isManager && !featureConfig.allowFileDownload) {
      throw new ForbiddenException("File listing is not enabled for this ACP");
    }

    return this.filesService.findByAcp(acpId);
  }

  @Delete("all")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete all files for an ACP" })
  async deleteAll(@UuidParam("acpId") acpId: string) {
    await this.filesService.deleteAll(acpId);
    const cleanupResult =
      await this.filesService.cleanupReferencesAfterFileMutation(acpId);
    return {
      message: "All files deleted successfully",
      cleanupReport: cleanupResult.cleanupReport,
      responseStateCleanup: cleanupResult.responseStateCleanup,
      validationSummary: cleanupResult.validationSummary,
    };
  }

  @Get("validate-units")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Validate completeness of all unit files" })
  async validateUnits(@UuidParam("acpId") acpId: string) {
    const files = await this.filesService.findByAcp(acpId);
    const [unitResults, validationRun] = await Promise.all([
      this.unitParserService.validateUnitFiles(acpId),
      this.validationService.autoValidateUploadedFiles(acpId, files),
    ]);

    return {
      unitResults,
      validationSummary: validationRun.summary,
    };
  }

  @Get("item-list")
  @UseGuards(ExplorerReadGuard)
  @ApiOperation({ summary: "Extract item list with metadata from .vomd files" })
  async getItemList(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
    @Query("perspective") perspective?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const startedAt = performance.now();
    const isManager = this.isManagerViewContext(req, perspective);
    if (!hasCapability(req.acpCapabilities || [], "item-explorer:view")) {
      const featureConfig = await this.filesService.getFeatureConfig(acpId);
      if (featureConfig.enableItemList === false) {
        throw new ForbiddenException("Item list is not enabled for this ACP");
      }
    }
    const explorerStateStartedAt = performance.now();
    const explorerState =
      await this.itemExplorerStateService.getItemListStateProjection(
        acpId,
        isManager,
      );
    const explorerStateMs = performance.now() - explorerStateStartedAt;
    let diagnostics: ItemExplorerLoadDiagnostics | undefined;
    const itemList = await this.unitParserService.getItemListFromFiles(acpId, {
      itemPropertiesOverride: explorerState.activeItemProperties,
      publishedItemPropertiesOverride: explorerState.publishedItemProperties,
      activeStateSignature: isManager
        ? `active:${explorerState.activeVersion}`
        : `published:${explorerState.activeVersion}`,
      publishedStateSignature: `published:${explorerState.publishedVersion}`,
      onDiagnostics: (value) => {
        diagnostics = { ...value, explorerStateMs };
      },
    });
    this.attachItemExplorerTiming(
      res,
      "item-list",
      diagnostics,
      performance.now() - startedAt,
      acpId,
    );
    return {
      ...itemList,
      itemExplorerStateVersion: explorerState.activeVersion,
    };
  }

  @Post("item-list/renumber")
  @UseGuards(ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Recalculate stable Item Explorer row numbers",
  })
  async recalculateItemRowNumbers(@UuidParam("acpId") acpId: string) {
    return this.unitParserService.recalculatePublishedItemRowNumbers(acpId);
  }

  @Get("unit-view/:unitId")
  @UseGuards(AcpAccessGuard)
  @ApiOperation({
    summary: "Get unit view data from uploaded files (player, definition)",
  })
  async getUnitView(
    @UuidParam("acpId") acpId: string,
    @Param("unitId") unitId: string,
    @Request() req: any,
    @Query("perspective") perspective?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    await this.capabilities.resolve(req);
    const startedAt = performance.now();
    const isManager = this.isManagerViewContext(req, perspective);
    if (!isManager) {
      const featureConfig = await this.filesService.getFeatureConfig(acpId);
      if (
        featureConfig.enableUnitView === false &&
        !this.canUseReview(req, featureConfig)
      ) {
        throw new ForbiddenException("Unit view is not enabled for this ACP");
      }
    }
    const explorerStateStartedAt = performance.now();
    const explorerStateResolution = this.itemExplorerStateService
      .getStateVersionForViewer(acpId, isManager)
      .then((version) => ({
        signature: isManager ? `active:${version}` : `published:${version}`,
        durationMs: performance.now() - explorerStateStartedAt,
      }));
    let diagnostics: ItemExplorerLoadDiagnostics | undefined;
    const unitView = await this.unitParserService.getUnitViewFromFiles(
      acpId,
      unitId,
      (value) => {
        diagnostics = value;
      },
      explorerStateResolution.then(({ signature }) => signature),
    );
    const { durationMs: explorerStateMs } = await explorerStateResolution;
    diagnostics = diagnostics
      ? { ...diagnostics, explorerStateMs }
      : diagnostics;
    this.attachItemExplorerTiming(
      res,
      "unit-view",
      diagnostics,
      performance.now() - startedAt,
      acpId,
    );
    return unitView;
  }

  @Get("jobs/:jobId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get file processing job status" })
  async getProcessingJob(
    @UuidParam("acpId") acpId: string,
    @UuidParam("jobId") jobId: string,
  ) {
    return this.fileProcessingJobsService.getJobSnapshot(acpId, jobId);
  }

  @Sse("jobs/:jobId/events")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Stream file processing job progress" })
  async streamProcessingJob(
    @UuidParam("acpId") acpId: string,
    @UuidParam("jobId") jobId: string,
  ) {
    await this.fileProcessingJobsService.ensureJobExists(acpId, jobId);
    return this.fileProcessingJobsService.streamJob(jobId);
  }

  @Get("jobs/:jobId/archive")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Download generated ZIP archive for a completed file job",
  })
  async downloadJobArchive(
    @UuidParam("acpId") acpId: string,
    @UuidParam("jobId") jobId: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const archive = await this.fileProcessingJobsService.downloadArchive(
      acpId,
      jobId,
    );
    res?.setHeader("Content-Type", "application/zip");
    res?.setHeader("Content-Length", String(archive.buffer.length));
    res?.setHeader(
      "Content-Disposition",
      `attachment; filename="${archive.fileName}"`,
    );
    res?.send(archive.buffer);
  }

  @Get(":fileId")
  @UseGuards(AcpAccessGuard)
  @ApiOperation({ summary: "Get file metadata" })
  async findOne(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
    @Request() req: any,
  ) {
    const isManager =
      req?.acpAccessLevel === "MANAGER" || req?.acpAccessLevel === "ADMIN";
    if (!isManager) {
      const featureConfig = await this.filesService.getFeatureConfig(acpId);
      if (!featureConfig.allowFileDownload) {
        throw new ForbiddenException(
          "File metadata access is not enabled for this ACP",
        );
      }
    }
    return this.filesService.findByIdForAcp(acpId, fileId);
  }

  @Get(":fileId/preview")
  @UseGuards(AcpAccessGuard)
  @ApiOperation({ summary: "Get preview data for a file" })
  async getPreview(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
    @Request() req: any,
  ) {
    const file = await this.filesService.findByIdForAcp(acpId, fileId);
    await this.ensureFileContentAccess(acpId, file.originalName, req);
    return this.filesService.getPreviewForAcp(acpId, fileId);
  }

  @Post("upload")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @UseInterceptors(FilesInterceptor("files", 100))
  @ApiConsumes("multipart/form-data")
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | keep-both",
  })
  @ApiOperation({ summary: "Upload files to ACP" })
  async upload(
    @UuidParam("acpId") acpId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Query("conflictStrategy") conflictStrategy?: string,
  ) {
    return {
      files: await this.filesService.uploadMultiple(acpId, files, {
        conflictStrategy,
      }),
    };
  }

  @Post("upload-preflight")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @UseInterceptors(FilesInterceptor("files", 2000))
  @ApiConsumes("multipart/form-data")
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | keep-both",
  })
  @ApiOperation({ summary: "Validate an upload without persisting files" })
  async preflightUpload(
    @UuidParam("acpId") acpId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Query("conflictStrategy") conflictStrategy?: string,
  ) {
    return this.filesService.preflightUpload(acpId, files, {
      conflictStrategy,
    });
  }

  @Post("bulk-download")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Download all or selected ACP files as ZIP archive",
  })
  async bulkDownload(
    @UuidParam("acpId") acpId: string,
    @Body() body: { fileIds?: string[] } = {},
    @Res({ passthrough: true }) res?: Response,
  ) {
    const archive = await this.filesService.createFilesZip(acpId, body.fileIds);
    res?.setHeader("Content-Type", "application/zip");
    res?.setHeader("Content-Length", String(archive.buffer.length));
    res?.setHeader(
      "Content-Disposition",
      `attachment; filename="${archive.fileName}"`,
    );
    res?.send(archive.buffer);
  }

  @Post("bulk-download/jobs")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Start ZIP creation job for all or selected ACP files",
  })
  async startBulkDownloadJob(
    @UuidParam("acpId") acpId: string,
    @Body() body: { fileIds?: string[] } = {},
    @Request() req?: any,
  ) {
    return this.fileProcessingJobsService.createAndStartDownloadJob(
      acpId,
      body.fileIds || [],
      { createdByUserId: req?.user?.sub || null },
    );
  }

  @Post("process-upload")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Start processing for freshly uploaded ACP files" })
  async processUpload(
    @UuidParam("acpId") acpId: string,
    @Body() body: { fileIds?: string[]; runCleanup?: boolean },
    @Request() req: any,
  ) {
    return this.fileProcessingJobsService.createAndStartJob(
      acpId,
      body.fileIds || [],
      {
        createdByUserId: req?.user?.sub || null,
        runCleanup: !!body.runCleanup,
      },
    );
  }

  @Post("bulk-delete")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete multiple files for an ACP" })
  async bulkDelete(
    @UuidParam("acpId") acpId: string,
    @Body() body: { fileIds?: string[] },
  ) {
    const deletedFileIds = await this.filesService.deleteManyForAcp(
      acpId,
      body.fileIds || [],
    );
    const cleanupResult =
      await this.filesService.cleanupReferencesAfterFileMutation(acpId);

    return {
      message: "Files deleted successfully",
      deletedCount: deletedFileIds.length,
      deletedFileIds,
      cleanupReport: cleanupResult.cleanupReport,
      responseStateCleanup: cleanupResult.responseStateCleanup,
      validationSummary: cleanupResult.validationSummary,
    };
  }

  @Post("sync-index")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Synchronize ACP-Index from uploaded unit files (non-destructive merge)",
  })
  async syncIndex(@UuidParam("acpId") acpId: string) {
    return this.unitParserService.syncIndexFromFiles(acpId);
  }

  @Get(":fileId/download")
  @UseGuards(AcpAccessGuard)
  @ApiQuery({
    name: "disposition",
    required: false,
    description: "attachment | inline",
  })
  @ApiOperation({ summary: "Download a file" })
  async download(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
    @Query("disposition") disposition: string | undefined,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const startedAt = performance.now();
    const file = await this.filesService.findByIdForAcp(acpId, fileId);
    await this.ensureFileContentAccess(acpId, file.originalName, req);

    const etagValue = String(
      file.checksum ||
        `${file.id}-${file.fileSize}-${file.uploadedAt?.toISOString?.() || ""}`,
    ).replace(/["\\]/g, "");
    const etag = `"${etagValue}"`;
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("ETag", etag);
    if (this.matchesIfNoneMatch(req?.headers?.["if-none-match"], etag)) {
      res.setHeader(
        "Server-Timing",
        `file-download;dur=${(performance.now() - startedAt).toFixed(1)}, cache;desc="not-modified"`,
      );
      res.status(304).end();
      return;
    }

    const fileReadStartedAt = performance.now();
    const { buffer } = await this.filesService.downloadForAcp(acpId, fileId);
    const fileReadMs = performance.now() - fileReadStartedAt;
    const resolvedDisposition = this.resolveDisposition(disposition);
    res.setHeader(
      "Content-Disposition",
      `${resolvedDisposition}; filename="${file.originalName}"`,
    );
    res.setHeader("Content-Type", file.fileType || "application/octet-stream");
    const totalMs = performance.now() - startedAt;
    res.setHeader(
      "Server-Timing",
      `file-read;dur=${fileReadMs.toFixed(1)}, file-download;dur=${totalMs.toFixed(1)}, cache;desc="miss"`,
    );
    if (totalMs > 1500) {
      this.logger.warn(
        JSON.stringify({
          event: "item-explorer-slow-load",
          phase: "file-download",
          acpId,
          durationMs: Math.round(totalMs),
        }),
      );
    }
    res.send(buffer);
  }

  @Delete(":fileId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a file" })
  async delete(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
  ) {
    await this.filesService.deleteForAcp(acpId, fileId);
    const cleanupResult =
      await this.filesService.cleanupReferencesAfterFileMutation(acpId);
    return {
      message: "File deleted successfully",
      cleanupReport: cleanupResult.cleanupReport,
      responseStateCleanup: cleanupResult.responseStateCleanup,
      validationSummary: cleanupResult.validationSummary,
    };
  }

  @Get(":fileId/validation")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get validation result for a file" })
  async getValidation(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
  ) {
    return this.filesService.getValidationResultForAcp(acpId, fileId);
  }

  private async ensureFileContentAccess(
    acpId: string,
    originalName: string,
    req: any,
  ): Promise<void> {
    const isManager =
      req?.acpAccessLevel === "MANAGER" || req?.acpAccessLevel === "ADMIN";
    if (isManager) {
      return;
    }

    const featureConfig = await this.filesService.getFeatureConfig(acpId);
    const isDependency = req.reviewerColumnPolicy?.restricted
      ? await this.filesService.isRuntimeDependencyFile(acpId, originalName)
      : await this.filesService.isUnitDependencyFile(acpId, originalName);
    await this.capabilities.resolve(req);
    const canDownloadForView =
      isDependency &&
      (featureConfig.enableUnitView !== false ||
        this.canUseReview(req, featureConfig));

    if (!featureConfig.allowFileDownload && !canDownloadForView) {
      throw new ForbiddenException("File download is not enabled for this ACP");
    }
  }

  private canUseReview(req: any, config: Record<string, any>): boolean {
    const grants = req?.acpCapabilities || [];
    return (
      config.enableReview === true &&
      (hasCapability(grants, "review:participate") ||
        hasCapability(grants, "review:manage"))
    );
  }

  private isManagerViewContext(req: any, perspective?: string): boolean {
    if (!hasCapability(req?.acpCapabilities || [], "item-explorer:edit")) {
      return false;
    }

    const normalizedPerspective = String(perspective || "editor")
      .trim()
      .toLowerCase();

    return normalizedPerspective !== "read-only";
  }

  private attachItemExplorerTiming(
    res: Response | undefined,
    phase: "item-list" | "unit-view",
    diagnostics: ItemExplorerLoadDiagnostics | undefined,
    totalMs: number,
    acpId: string,
  ): void {
    const cacheStatus = diagnostics?.cacheStatus || "miss";
    res?.setHeader(
      "Server-Timing",
      [
        `file-signature;dur=${(diagnostics?.fileSignatureMs || 0).toFixed(1)}`,
        `explorer-state;dur=${(diagnostics?.explorerStateMs || 0).toFixed(1)}`,
        `source-read;dur=${(diagnostics?.sourceReadMs || 0).toFixed(1)}`,
        `parse;dur=${(diagnostics?.parseMs || 0).toFixed(1)}`,
        `row-revision;dur=${(diagnostics?.rowNumberRevisionMs || 0).toFixed(1)}`,
        `row-numbering;dur=${(diagnostics?.rowNumberingMs || 0).toFixed(1)}`,
        `${phase};dur=${totalMs.toFixed(1)}`,
        `cache;desc="${cacheStatus}"`,
        `row-cache;desc="${diagnostics?.rowCacheStatus || "miss"}"`,
      ].join(", "),
    );
    if (totalMs <= 1500) return;

    this.logger.warn(
      JSON.stringify({
        event: "item-explorer-slow-load",
        phase,
        acpId,
        durationMs: Math.round(totalMs),
        cacheStatus,
      }),
    );
  }

  private matchesIfNoneMatch(headerValue: unknown, etag: string): boolean {
    const rawHeader = Array.isArray(headerValue)
      ? headerValue.join(",")
      : typeof headerValue === "string"
        ? headerValue
        : "";
    if (!rawHeader) return false;

    const currentOpaqueTag = etag.replace(/^W\//, "");
    const entityTagPattern = /(?:^|,)\s*(\*|(?:W\/)?"[^"]*")\s*(?=,|$)/g;
    let match: RegExpExecArray | null;
    while ((match = entityTagPattern.exec(rawHeader)) !== null) {
      const candidate = match[1];
      if (candidate === "*") return true;
      if (candidate.replace(/^W\//, "") === currentOpaqueTag) return true;
    }
    return false;
  }

  private resolveDisposition(
    disposition: string | undefined,
  ): "attachment" | "inline" {
    const normalized = String(disposition || "attachment")
      .trim()
      .toLowerCase();

    if (normalized === "attachment" || normalized === "inline") {
      return normalized;
    }

    throw new BadRequestException(
      'Invalid disposition. Expected "attachment" or "inline".',
    );
  }
}
