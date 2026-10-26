import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { lastValueFrom, of, take } from "rxjs";
import { FilesController } from "./files.controller";

describe("FilesController", () => {
  let controller: FilesController;
  let filesService: any;
  let unitParserService: any;
  let validationService: any;
  let fileProcessingJobsService: any;
  let itemExplorerStateService: any;

  const baseFile = {
    id: "file-1",
    acpId: "acp-1",
    originalName: "unit-1.xml",
    fileType: "application/xml",
    fileSize: 123,
  };

  beforeEach(() => {
    filesService = {
      getFeatureConfig: jest.fn().mockResolvedValue({
        allowUnitDownload: true,
        allowFileDownload: true,
        enableItemList: true,
        enableUnitView: true,
      }),
      createUnitZip: jest.fn().mockResolvedValue({
        fileName: "unit-1.zip",
        buffer: Buffer.from("unit-zip"),
      }),
      createSequenceZip: jest.fn().mockResolvedValue({
        fileName: "sequence-1.zip",
        buffer: Buffer.from("sequence-zip"),
      }),
      createFilesZip: jest.fn().mockResolvedValue({
        fileName: "acp-acp-1-selected-files.zip",
        buffer: Buffer.from("files-zip"),
      }),
      findByAcp: jest.fn().mockResolvedValue([baseFile]),
      findByIdForAcp: jest.fn().mockResolvedValue(baseFile),
      uploadMultiple: jest.fn().mockResolvedValue([baseFile]),
      preflightUpload: jest.fn().mockResolvedValue({
        canUpload: true,
        selectedFileCount: 1,
        expandedFileCount: 1,
        acceptedFileCount: 1,
        identicalDuplicates: [],
        existingConflicts: [],
        issues: [],
      }),
      deleteAll: jest.fn().mockResolvedValue(undefined),
      deleteForAcp: jest.fn().mockResolvedValue(undefined),
      deleteManyForAcp: jest.fn().mockResolvedValue(["file-1", "file-2"]),
      cleanupReferencesAfterFileMutation: jest.fn().mockResolvedValue({
        cleanupReport: { removed: 1 },
        responseStateCleanup: {
          totalStates: 2,
          deletedStates: 1,
          keptStates: 1,
        },
        validationSummary: { totalFiles: 1 },
      }),
      cleanupOrphanedResponseStates: jest.fn().mockResolvedValue({
        totalStates: 2,
        deletedStates: 1,
        keptStates: 1,
      }),
      getPreviewForAcp: jest.fn().mockResolvedValue({
        fileId: "file-1",
        originalName: "unit-1.xml",
        extension: "xml",
        mode: "structured",
        truncated: false,
      }),
      downloadForAcp: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from("file-body") }),
      getValidationResultForAcp: jest.fn().mockResolvedValue({ valid: true }),
      isUnitDependencyFile: jest.fn().mockResolvedValue(false),
    };

    unitParserService = {
      pruneMissingDependencies: jest.fn().mockResolvedValue({ removed: 1 }),
      validateUnitFiles: jest
        .fn()
        .mockResolvedValue([{ unitId: "u-1", valid: true }]),
      getItemListFromFiles: jest.fn().mockResolvedValue({
        columns: [],
        items: [{ itemId: "item-1" }],
      }),
      recalculatePublishedItemRowNumbers: jest
        .fn()
        .mockResolvedValue({ renumberedCount: 1 }),
      getUnitViewFromFiles: jest.fn().mockResolvedValue({ unitId: "u-1" }),
      syncIndexFromFiles: jest.fn().mockResolvedValue({
        unitsAdded: 1,
        unitsUpdated: 0,
        dependenciesLinked: 0,
        warnings: [],
      }),
    };

    validationService = {
      autoValidateUploadedFiles: jest.fn().mockResolvedValue({
        files: [baseFile],
        summary: { totalFiles: 1 },
      }),
    };

    fileProcessingJobsService = {
      createAndStartJob: jest.fn().mockResolvedValue({
        id: "job-1",
        jobType: "upload-process",
        status: "pending",
      }),
      createAndStartDownloadJob: jest.fn().mockResolvedValue({
        id: "job-download-1",
        jobType: "archive-download",
        status: "pending",
      }),
      getJobSnapshot: jest.fn().mockResolvedValue({
        id: "job-1",
        jobType: "upload-process",
        status: "running",
      }),
      downloadArchive: jest.fn().mockResolvedValue({
        fileName: "acp-acp-1-selected-files.zip",
        buffer: Buffer.from("job-archive"),
      }),
      ensureJobExists: jest.fn().mockResolvedValue(undefined),
      streamJob: jest.fn().mockReturnValue(
        of({
          data: {
            id: "job-1",
            jobType: "upload-process",
            status: "completed",
          },
        }),
      ),
    };

    itemExplorerStateService = {
      getStateForViewer: jest.fn().mockResolvedValue({
        status: "CLEAN",
        version: 4,
        publishedVersion: 3,
        activeState: { itemProperties: {} },
        publishedState: { itemProperties: {} },
      }),
      getItemListStateProjection: jest.fn().mockResolvedValue({
        activeItemProperties: {},
        publishedItemProperties: {},
        activeVersion: 4,
        publishedVersion: 3,
      }),
      getStateVersionForViewer: jest.fn(
        async (_acpId: string, canEdit: boolean) => (canEdit ? 4 : 3),
      ),
      runWithLockedCleanState: jest.fn(
        async (_acpId: string, operation: (state: any, manager: any) => any) =>
          operation(
            {
              status: "CLEAN",
              activeState: { itemProperties: {} },
              publishedState: { itemProperties: {} },
            },
            { id: "transaction-manager" },
          ),
      ),
    };

    controller = new FilesController(
      filesService,
      unitParserService,
      validationService,
      fileProcessingJobsService,
      itemExplorerStateService,
      { resolve: jest.fn(async (req) => req.acpCapabilities || []) } as any,
    );
  });

  it("rejects ZIP requests with both unitId and sequenceId", async () => {
    await expect(
      controller.findAll(
        "acp-1",
        "zip",
        "unit-1",
        "seq-1",
        { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
        {} as any,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects ZIP requests without unitId and sequenceId", async () => {
    await expect(
      controller.findAll(
        "acp-1",
        "zip",
        undefined,
        undefined,
        { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
        {} as any,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects ZIP downloads for non-managers when unit download is disabled", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: false,
      allowFileDownload: true,
      enableItemList: true,
      enableUnitView: true,
    });

    await expect(
      controller.findAll(
        "acp-1",
        "zip",
        "unit-1",
        undefined,
        { acpAccessLevel: "PUBLIC" },
        {} as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("streams unit ZIP downloads with proper headers", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.findAll(
      "acp-1",
      "zip",
      "unit-1",
      undefined,
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      res,
    );

    expect(filesService.createUnitZip).toHaveBeenCalledWith("acp-1", "unit-1");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/zip",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="unit-1.zip"',
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("forwards explicit booklet downloads without changing the legacy download route", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;
    await controller.findAll(
      "acp-1",
      "zip",
      undefined,
      "seq-1",
      {
        acpAccessLevel: "MANAGER",
        acpCapabilities: ["item-explorer:edit"],
        query: { kind: "booklet" },
      },
      res,
    );
    expect(filesService.createSequenceZip).toHaveBeenCalledWith(
      "acp-1",
      "seq-1",
      "booklet",
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("streams sequence ZIP downloads", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.findAll(
      "acp-1",
      "zip",
      undefined,
      "seq-1",
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      res,
    );

    expect(filesService.createSequenceZip).toHaveBeenCalledWith(
      "acp-1",
      "seq-1",
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("rejects file listing for non-managers when disabled", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: false,
      enableItemList: true,
      enableUnitView: true,
    });

    await expect(
      controller.findAll(
        "acp-1",
        undefined,
        undefined,
        undefined,
        { acpAccessLevel: "PUBLIC" },
        {} as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns file listing", async () => {
    const result = await controller.findAll(
      "acp-1",
      undefined,
      undefined,
      undefined,
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      {} as any,
    );

    expect(result).toEqual([baseFile]);
  });

  it("deletes all files and returns cleanup + validation summary", async () => {
    const result = await controller.deleteAll("acp-1");

    expect(filesService.deleteAll).toHaveBeenCalledWith("acp-1");
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).toHaveBeenCalledWith("acp-1");
    expect(result).toEqual({
      message: "All files deleted successfully",
      cleanupReport: { removed: 1 },
      responseStateCleanup: {
        totalStates: 2,
        deletedStates: 1,
        keptStates: 1,
      },
      validationSummary: { totalFiles: 1 },
    });
  });

  it("bulk deletes selected files and returns cleanup + validation summary", async () => {
    const result = await controller.bulkDelete("acp-1", {
      fileIds: ["file-1", "file-2"],
    });

    expect(filesService.deleteManyForAcp).toHaveBeenCalledWith("acp-1", [
      "file-1",
      "file-2",
    ]);
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).toHaveBeenCalledWith("acp-1");
    expect(result).toEqual({
      message: "Files deleted successfully",
      deletedCount: 2,
      deletedFileIds: ["file-1", "file-2"],
      cleanupReport: { removed: 1 },
      responseStateCleanup: {
        totalStates: 2,
        deletedStates: 1,
        keptStates: 1,
      },
      validationSummary: { totalFiles: 1 },
    });
  });

  it("streams ZIP download for selected files", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.bulkDownload(
      "acp-1",
      { fileIds: ["file-1", "file-2"] },
      res,
    );

    expect(filesService.createFilesZip).toHaveBeenCalledWith("acp-1", [
      "file-1",
      "file-2",
    ]);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/zip",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="acp-acp-1-selected-files.zip"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("files-zip"));
  });

  it("downloads all ACP files when no selection is provided", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.bulkDownload("acp-1", {}, res);

    expect(filesService.createFilesZip).toHaveBeenCalledWith(
      "acp-1",
      undefined,
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("files-zip"));
  });

  it("starts an asynchronous ZIP creation job for bulk download", async () => {
    const result = await controller.startBulkDownloadJob(
      "acp-1",
      { fileIds: ["file-1", "file-2"] },
      { user: { sub: "user-1" } },
    );

    expect(
      fileProcessingJobsService.createAndStartDownloadJob,
    ).toHaveBeenCalledWith("acp-1", ["file-1", "file-2"], {
      createdByUserId: "user-1",
    });
    expect(result).toEqual({
      id: "job-download-1",
      jobType: "archive-download",
      status: "pending",
    });
  });

  it("downloads the generated ZIP archive of a completed job", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.downloadJobArchive("acp-1", "job-download-1", res);

    expect(fileProcessingJobsService.downloadArchive).toHaveBeenCalledWith(
      "acp-1",
      "job-download-1",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/zip",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="acp-acp-1-selected-files.zip"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("job-archive"));
  });

  it("validates units and returns validation summary", async () => {
    const result = await controller.validateUnits("acp-1");

    expect(result).toEqual({
      unitResults: [{ unitId: "u-1", valid: true }],
      validationSummary: { totalFiles: 1 },
    });
  });

  it("blocks item list when feature is disabled for non-managers", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: true,
      enableItemList: false,
      enableUnitView: true,
    });

    await expect(
      controller.getItemList("acp-1", { acpAccessLevel: "PUBLIC" }, undefined),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns item list for managers", async () => {
    const result = await controller.getItemList(
      "acp-1",
      {
        acpAccessLevel: "MANAGER",
        acpCapabilities: ["item-explorer:edit"],
      },
      undefined,
    );

    expect(result).toEqual({
      columns: [],
      items: [{ itemId: "item-1" }],
      itemExplorerStateVersion: 4,
    });
    expect(filesService.getFeatureConfig).not.toHaveBeenCalled();
    expect(unitParserService.getItemListFromFiles).toHaveBeenCalledWith(
      "acp-1",
      expect.objectContaining({
        itemPropertiesOverride: {},
        publishedItemPropertiesOverride: {},
        activeStateSignature: "active:4",
        publishedStateSignature: "published:3",
      }),
    );
  });

  it("exposes item-list server timing diagnostics", async () => {
    unitParserService.getItemListFromFiles.mockImplementationOnce(
      async (_acpId: string, options: any) => {
        options.onDiagnostics({
          cacheStatus: "hit",
          rowCacheStatus: "hit",
          fileSignatureMs: 1,
          sourceReadMs: 2,
          rowNumberRevisionMs: 1,
          parseMs: 0,
          rowNumberingMs: 3,
          totalMs: 5,
        });
        return { columns: [], items: [] };
      },
    );
    const res = { setHeader: jest.fn() } as any;

    await controller.getItemList(
      "acp-1",
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      undefined,
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringContaining('cache;desc="hit"'),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringContaining('row-cache;desc="hit"'),
    );
  });

  it("passes the active manager draft to the centrally initialized item list", async () => {
    itemExplorerStateService.getItemListStateProjection.mockResolvedValueOnce({
      activeItemProperties: { draft: {} },
      publishedItemProperties: { published: {} },
      activeVersion: 8,
      publishedVersion: 5,
    });

    await controller.getItemList(
      "acp-1",
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      undefined,
    );

    expect(unitParserService.getItemListFromFiles).toHaveBeenCalledWith(
      "acp-1",
      expect.objectContaining({
        itemPropertiesOverride: { draft: {} },
        publishedItemPropertiesOverride: { published: {} },
        activeStateSignature: "active:8",
        publishedStateSignature: "published:5",
      }),
    );
  });

  it("returns the published state version for a read-only item list", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      enableItemList: true,
    });
    itemExplorerStateService.getItemListStateProjection.mockResolvedValueOnce({
      activeItemProperties: { published: {} },
      publishedItemProperties: { published: {} },
      activeVersion: 5,
      publishedVersion: 5,
    });

    const result = await controller.getItemList(
      "acp-1",
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      "read-only",
    );

    expect(result.itemExplorerStateVersion).toBe(5);
    expect(
      itemExplorerStateService.getItemListStateProjection,
    ).toHaveBeenCalledWith("acp-1", false);
  });

  it.each(["READ_ONLY", "CREDENTIAL"])(
    "uses draft data for explicit %s editors and published data in read-only perspective",
    async (level) => {
      itemExplorerStateService.getItemListStateProjection.mockImplementation(
        async (_id: string, editor: boolean) => ({
          activeItemProperties: editor ? { draft: true } : { published: true },
          publishedItemProperties: { published: true },
          activeVersion: editor ? 4 : 3,
          publishedVersion: 3,
        }),
      );
      const req = {
        acpAccessLevel: level,
        acpCapabilities: ["item-explorer:edit"],
      };
      expect(
        (await controller.getItemList("acp-1", req)).itemExplorerStateVersion,
      ).toBe(4);
      expect(
        (await controller.getItemList("acp-1", req, "read-only"))
          .itemExplorerStateVersion,
      ).toBe(3);
      expect(filesService.getFeatureConfig).not.toHaveBeenCalled();
    },
  );

  it.each(["review:participate", "review:manage"])(
    "allows active %s player access without exposing drafts or arbitrary files",
    async (grant) => {
      const req = { acpAccessLevel: "READ_ONLY", acpCapabilities: [grant] };
      filesService.getFeatureConfig.mockResolvedValue({
        enableReview: true,
        enableUnitView: false,
        allowFileDownload: false,
      });
      await controller.getUnitView("acp-1", "unit-1", req);
      expect(
        itemExplorerStateService.getStateVersionForViewer,
      ).toHaveBeenCalledWith("acp-1", false);
      filesService.isUnitDependencyFile.mockResolvedValue(true);
      const res = { setHeader: jest.fn(), send: jest.fn() } as any;
      await controller.download("acp-1", "file-1", undefined, req, res);
      expect(res.send).toHaveBeenCalledWith(Buffer.from("file-body"));
      filesService.isUnitDependencyFile.mockResolvedValue(false);
      await expect(
        controller.download("acp-1", "file-1", undefined, req, res),
      ).rejects.toThrow(ForbiddenException);
      filesService.getFeatureConfig.mockResolvedValue({
        enableReview: false,
        enableUnitView: false,
        allowFileDownload: false,
      });
      filesService.isUnitDependencyFile.mockResolvedValue(true);
      await expect(
        controller.getUnitView("acp-1", "unit-1", req),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.download("acp-1", "file-1", undefined, req, res),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it("delegates row-number recalculation to the published item-list workflow", async () => {
    const result = await controller.recalculateItemRowNumbers("acp-1");

    expect(result).toEqual({ renumberedCount: 1 });
    expect(
      unitParserService.recalculatePublishedItemRowNumbers,
    ).toHaveBeenCalledWith("acp-1");
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
  });

  it("propagates conflicts from the published row-number workflow", async () => {
    unitParserService.recalculatePublishedItemRowNumbers.mockRejectedValueOnce(
      new ConflictException("Draft pending"),
    );

    await expect(controller.recalculateItemRowNumbers("acp-1")).rejects.toThrow(
      ConflictException,
    );
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
  });

  it("retains explicit explorer access in read-only perspective", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: true,
      enableItemList: false,
      enableUnitView: true,
    });

    await expect(
      controller.getItemList(
        "acp-1",
        { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
        "read-only",
      ),
    ).resolves.toBeDefined();
  });

  it("blocks unit view when feature is disabled for non-managers", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: true,
      enableItemList: true,
      enableUnitView: false,
    });

    await expect(
      controller.getUnitView(
        "acp-1",
        "unit-1",
        { acpAccessLevel: "PUBLIC" },
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("uses default allow=true for unit view when flag is unset", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: false,
      enableItemList: true,
    });

    await expect(
      controller.getUnitView(
        "acp-1",
        "unit-1",
        { acpAccessLevel: "PUBLIC" },
        undefined,
      ),
    ).resolves.toEqual({ unitId: "u-1" });
    const unitViewCall =
      unitParserService.getUnitViewFromFiles.mock.calls.at(-1);
    expect(unitViewCall?.slice(0, 3)).toEqual([
      "acp-1",
      "unit-1",
      expect.any(Function),
    ]);
    await expect(unitViewCall?.[3]).resolves.toBe("published:3");
  });

  it("uses the active Explorer version for manager unit-view caching", async () => {
    await controller.getUnitView(
      "acp-1",
      "unit-1",
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      undefined,
    );

    const unitViewCall =
      unitParserService.getUnitViewFromFiles.mock.calls.at(-1);
    expect(unitViewCall?.slice(0, 3)).toEqual([
      "acp-1",
      "unit-1",
      expect.any(Function),
    ]);
    await expect(unitViewCall?.[3]).resolves.toBe("active:4");
  });

  it("applies read-only perspective checks for managers in unit view", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: true,
      enableItemList: true,
      enableUnitView: false,
    });

    await expect(
      controller.getUnitView(
        "acp-1",
        "unit-1",
        { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
        "read-only",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks file metadata for non-managers when file download is disabled", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: true,
      allowFileDownload: false,
      enableItemList: true,
      enableUnitView: true,
    });

    await expect(
      controller.findOne("acp-1", "file-1", { acpAccessLevel: "PUBLIC" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("uploads files with conflict strategy and returns stored file metadata", async () => {
    const payload = await controller.upload(
      "acp-1",
      [{ originalname: "unit-1.xml" } as any],
      "overwrite",
    );

    expect(filesService.uploadMultiple).toHaveBeenCalledWith(
      "acp-1",
      [{ originalname: "unit-1.xml" }],
      { conflictStrategy: "overwrite" },
    );
    expect(payload).toEqual({
      files: [baseFile],
    });
  });

  it("preflights files without storing them", async () => {
    const files = [{ originalname: "bundle.zip" } as any];

    const payload = await controller.preflightUpload(
      "acp-1",
      files,
      "overwrite",
    );

    expect(filesService.preflightUpload).toHaveBeenCalledWith("acp-1", files, {
      conflictStrategy: "overwrite",
    });
    expect(payload.canUpload).toBe(true);
    expect(filesService.uploadMultiple).not.toHaveBeenCalled();
  });

  it("starts upload processing as background job", async () => {
    const result = await controller.processUpload(
      "acp-1",
      { fileIds: ["file-1"], runCleanup: true },
      { user: { sub: "user-1" } },
    );

    expect(fileProcessingJobsService.createAndStartJob).toHaveBeenCalledWith(
      "acp-1",
      ["file-1"],
      {
        createdByUserId: "user-1",
        runCleanup: true,
      },
    );
    expect(result).toEqual({
      id: "job-1",
      jobType: "upload-process",
      status: "pending",
    });
  });

  it("returns processing job snapshot", async () => {
    await expect(
      controller.getProcessingJob("acp-1", "job-1"),
    ).resolves.toEqual({
      id: "job-1",
      jobType: "upload-process",
      status: "running",
    });
    expect(fileProcessingJobsService.getJobSnapshot).toHaveBeenCalledWith(
      "acp-1",
      "job-1",
    );
  });

  it("streams processing job events", async () => {
    const stream = await controller.streamProcessingJob("acp-1", "job-1");

    await expect(lastValueFrom(stream.pipe(take(1)))).resolves.toEqual({
      data: {
        id: "job-1",
        jobType: "upload-process",
        status: "completed",
      },
    });
    expect(fileProcessingJobsService.ensureJobExists).toHaveBeenCalledWith(
      "acp-1",
      "job-1",
    );
    expect(fileProcessingJobsService.streamJob).toHaveBeenCalledWith("job-1");
  });

  it("syncs index from files", async () => {
    await expect(controller.syncIndex("acp-1")).resolves.toEqual({
      unitsAdded: 1,
      unitsUpdated: 0,
      dependenciesLinked: 0,
      warnings: [],
    });
  });

  it("returns preview data for managers", async () => {
    await expect(
      controller.getPreview("acp-1", "file-1", {
        acpAccessLevel: "MANAGER",
        acpCapabilities: ["item-explorer:edit"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        fileId: "file-1",
        mode: "structured",
      }),
    );

    expect(filesService.getPreviewForAcp).toHaveBeenCalledWith(
      "acp-1",
      "file-1",
    );
  });

  it("blocks preview access when file download and unit view access are disabled", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: false,
      allowFileDownload: false,
      enableItemList: true,
      enableUnitView: false,
    });
    filesService.isUnitDependencyFile.mockResolvedValueOnce(false);

    await expect(
      controller.getPreview("acp-1", "file-1", { acpAccessLevel: "PUBLIC" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks file download when all relevant features are disabled", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: false,
      allowFileDownload: false,
      enableItemList: true,
      enableUnitView: false,
    });
    filesService.isUnitDependencyFile.mockResolvedValueOnce(false);

    await expect(
      controller.download(
        "acp-1",
        "file-1",
        undefined,
        { acpAccessLevel: "PUBLIC" },
        {
          setHeader: jest.fn(),
          send: jest.fn(),
        } as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows unit-view based file downloads for dependencies", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: false,
      allowFileDownload: false,
      enableItemList: true,
      enableUnitView: true,
    });
    filesService.isUnitDependencyFile.mockResolvedValueOnce(true);
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.download(
      "acp-1",
      "file-1",
      undefined,
      { acpAccessLevel: "PUBLIC" },
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="unit-1.xml"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("file-body"));
  });

  it("allows dependency downloads when unit view flag is unset", async () => {
    filesService.getFeatureConfig.mockResolvedValueOnce({
      allowUnitDownload: false,
      allowFileDownload: false,
      enableItemList: true,
    });
    filesService.isUnitDependencyFile.mockResolvedValueOnce(true);
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.download(
      "acp-1",
      "file-1",
      undefined,
      { acpAccessLevel: "PUBLIC" },
      res,
    );

    expect(res.send).toHaveBeenCalledWith(Buffer.from("file-body"));
  });

  it("downloads files for managers without feature checks", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.download(
      "acp-1",
      "file-1",
      undefined,
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      res,
    );

    expect(filesService.getFeatureConfig).not.toHaveBeenCalled();
    expect(filesService.downloadForAcp).toHaveBeenCalledWith("acp-1", "file-1");
  });

  it("returns 304 for a matching private file ETag", async () => {
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as any;

    await controller.download(
      "acp-1",
      "file-1",
      undefined,
      {
        acpAccessLevel: "MANAGER",
        acpCapabilities: ["item-explorer:edit"],
        headers: { "if-none-match": '"file-1-123-"' },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.end).toHaveBeenCalled();
    expect(filesService.downloadForAcp).not.toHaveBeenCalled();
  });

  it.each([['W/"file-1-123-"'], ['"different", W/"file-1-123-"'], ["*"]])(
    "returns 304 for If-None-Match value %s",
    async (ifNoneMatch) => {
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
      } as any;

      await controller.download(
        "acp-1",
        "file-1",
        undefined,
        {
          acpAccessLevel: "MANAGER",
          acpCapabilities: ["item-explorer:edit"],
          headers: { "if-none-match": ifNoneMatch },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(304);
      expect(res.end).toHaveBeenCalled();
      expect(filesService.downloadForAcp).not.toHaveBeenCalled();
    },
  );

  it("supports inline disposition for previews", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.download(
      "acp-1",
      "file-1",
      "inline",
      { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'inline; filename="unit-1.xml"',
    );
  });

  it("rejects invalid content disposition", async () => {
    await expect(
      controller.download(
        "acp-1",
        "file-1",
        "sideways",
        { acpAccessLevel: "MANAGER", acpCapabilities: ["item-explorer:edit"] },
        { setHeader: jest.fn(), send: jest.fn() } as any,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("deletes a single file and returns cleanup + validation summary", async () => {
    const result = await controller.delete("acp-1", "file-1");

    expect(filesService.deleteForAcp).toHaveBeenCalledWith("acp-1", "file-1");
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).toHaveBeenCalledWith("acp-1");
    expect(result).toEqual({
      message: "File deleted successfully",
      cleanupReport: { removed: 1 },
      responseStateCleanup: {
        totalStates: 2,
        deletedStates: 1,
        keptStates: 1,
      },
      validationSummary: { totalFiles: 1 },
    });
  });

  it("returns per-file validation results", async () => {
    await expect(controller.getValidation("acp-1", "file-1")).resolves.toEqual({
      valid: true,
    });
    expect(filesService.getValidationResultForAcp).toHaveBeenCalledWith(
      "acp-1",
      "file-1",
    );
  });
});
