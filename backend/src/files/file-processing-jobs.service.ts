import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { ReplaySubject, Observable, map } from "rxjs";
import * as fs from "fs/promises";
import { ApFile, ApFileProcessingJob } from "../database/entities";
import { FilesService } from "./files.service";
import { UnitParserService } from "./unit-parser.service";
import { ValidationService } from "../validation/validation.service";
import {
  FileProcessingJobPhase,
  FileProcessingJobSnapshot,
  FileProcessingProgressReporter,
} from "./file-processing-progress";

@Injectable()
export class FileProcessingJobsService {
  private readonly logger = new Logger(FileProcessingJobsService.name);
  private readonly streams = new Map<
    string,
    ReplaySubject<FileProcessingJobSnapshot>
  >();
  private readonly runningJobs = new Set<string>();

  constructor(
    @InjectRepository(ApFileProcessingJob)
    private readonly jobRepository: Repository<ApFileProcessingJob>,
    @InjectRepository(ApFile)
    private readonly fileRepository: Repository<ApFile>,
    private readonly filesService: FilesService,
    private readonly unitParserService: UnitParserService,
    private readonly validationService: ValidationService,
  ) {}

  async createAndStartJob(
    apId: string,
    uploadedFileIds: string[],
    options: { createdByUserId?: string | null; runCleanup?: boolean } = {},
  ): Promise<FileProcessingJobSnapshot> {
    const normalizedIds = Array.from(
      new Set(
        uploadedFileIds
          .map((fileId) => String(fileId || "").trim())
          .filter((fileId) => fileId.length > 0),
      ),
    );

    if (!normalizedIds.length) {
      throw new BadRequestException(
        "At least one uploaded file ID is required to start processing",
      );
    }

    await this.ensureNoActiveJob(apId);
    const files = await this.fileRepository.find({
      where: {
        apId,
        id: In(normalizedIds),
      },
    });

    if (files.length !== normalizedIds.length) {
      throw new BadRequestException(
        "Some uploaded files could not be found for processing",
      );
    }

    let job = this.jobRepository.create({
      apId,
      createdByUserId: options.createdByUserId || null,
      jobType: "upload-process",
      status: "pending",
      phase: "queued",
      phaseLabel: "Wartet auf Verarbeitung",
      message: "Verarbeitungsjob wurde erstellt.",
      phaseCurrent: 0,
      phaseTotal: 0,
      uploadedFileCount: normalizedIds.length,
      uploadedFileIds: normalizedIds,
      runCleanup: !!options.runCleanup,
      error: null,
    });
    job = await this.jobRepository.save(job);
    this.emit(job);
    this.runJob(job.id).catch((error: unknown) => {
      this.logger.error("Failed to persist processing job status", error);
      this.ensureStream(job.id).error(error);
    });
    return this.toSnapshot(job);
  }

  async createAndStartDownloadJob(
    apId: string,
    fileIds: string[],
    options: { createdByUserId?: string | null } = {},
  ): Promise<FileProcessingJobSnapshot> {
    const normalizedIds = Array.from(
      new Set(
        (fileIds || [])
          .map((fileId) => String(fileId || "").trim())
          .filter((fileId) => fileId.length > 0),
      ),
    );

    await this.ensureNoActiveJob(apId);

    let fileCount = 0;
    if (normalizedIds.length) {
      const files = await this.fileRepository.find({
        where: {
          apId,
          id: In(normalizedIds),
        },
      });

      if (files.length !== normalizedIds.length) {
        throw new BadRequestException(
          "Some selected files could not be found for archive creation",
        );
      }
      fileCount = files.length;
    } else {
      fileCount = await this.fileRepository.count({ where: { apId } });
      if (!fileCount) {
        throw new BadRequestException(
          "At least one file is required to create an archive",
        );
      }
    }

    let job = this.jobRepository.create({
      apId,
      createdByUserId: options.createdByUserId || null,
      jobType: "archive-download",
      status: "pending",
      phase: "queued",
      phaseLabel: "Wartet auf ZIP-Erstellung",
      message: "Download-Job wurde erstellt.",
      phaseCurrent: 0,
      phaseTotal: 0,
      uploadedFileCount: fileCount,
      uploadedFileIds: normalizedIds,
      runCleanup: false,
      archiveFileName: null,
      archiveFilePath: null,
      error: null,
    });
    job = await this.jobRepository.save(job);
    this.emit(job);
    this.runJob(job.id).catch((error: unknown) => {
      this.logger.error("Failed to persist processing job status", error);
      this.ensureStream(job.id).error(error);
    });
    return this.toSnapshot(job);
  }

  async getJobSnapshot(
    apId: string,
    jobId: string,
  ): Promise<FileProcessingJobSnapshot> {
    const job = await this.getJobForAp(apId, jobId);
    return this.toSnapshot(job);
  }

  async ensureJobExists(apId: string, jobId: string): Promise<void> {
    await this.getJobForAp(apId, jobId);
  }

  streamJob(jobId: string): Observable<MessageEvent> {
    const stream = this.ensureStream(jobId);
    return stream.asObservable().pipe(map((data) => ({ data })));
  }

  async downloadArchive(
    apId: string,
    jobId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const job = await this.getJobForAp(apId, jobId);
    if (job.jobType !== "archive-download") {
      throw new BadRequestException(
        "The requested job does not provide an archive",
      );
    }
    if (
      job.status !== "completed" ||
      !job.archiveFilePath ||
      !job.archiveFileName
    ) {
      throw new ConflictException("The ZIP archive is not ready yet");
    }

    try {
      const buffer = await fs.readFile(job.archiveFilePath);
      return {
        buffer,
        fileName: job.archiveFileName,
      };
    } catch {
      throw new NotFoundException("Generated ZIP archive could not be found");
    }
  }

  private async runJob(jobId: string): Promise<void> {
    if (this.runningJobs.has(jobId)) {
      return;
    }
    this.runningJobs.add(jobId);

    let job = await this.getJob(jobId);
    const persist = async (
      patch: Partial<ApFileProcessingJob>,
    ): Promise<ApFileProcessingJob> => {
      Object.assign(job, patch);
      job = await this.jobRepository.save(job);
      this.emit(job);
      return job;
    };

    const reporter = this.createProgressReporter(persist);

    try {
      await persist({
        status: "running",
        startedAt: job.startedAt || new Date(),
        message:
          job.jobType === "archive-download"
            ? "ZIP-Erstellung wird gestartet."
            : "Verarbeitungsjob wird gestartet.",
      });

      if (job.jobType === "archive-download") {
        const archive = await this.filesService.createFilesZipArchive(
          job.apId,
          job.uploadedFileIds || [],
          reporter,
        );

        await persist({
          status: "completed",
          phase: "completed",
          phaseLabel: "ZIP bereit",
          message: "Das ZIP-Archiv kann jetzt heruntergeladen werden.",
          archiveFileName: archive.fileName,
          archiveFilePath: archive.filePath,
          error: null,
          finishedAt: new Date(),
        });
      } else {
        const uploadedFiles = await this.loadUploadedFiles(job);
        const syncReport = await this.unitParserService.syncIndexFromFiles(
          job.apId,
          reporter,
        );
        const validationRun =
          await this.validationService.autoValidateUploadedFiles(
            job.apId,
            uploadedFiles,
            reporter,
          );

        let cleanupResult:
          | Awaited<
              ReturnType<FilesService["cleanupReferencesAfterFileMutation"]>
            >
          | undefined;
        if (job.runCleanup) {
          cleanupResult =
            await this.filesService.cleanupReferencesAfterFileMutation(
              job.apId,
              { skipValidation: true },
              reporter,
            );
        }

        await persist({
          status: "completed",
          phase: "completed",
          phaseLabel: "Abgeschlossen",
          message: "Upload-Verarbeitung abgeschlossen.",
          syncReport: syncReport as unknown as Record<string, unknown>,
          validationSummary: validationRun.summary as unknown as Record<
            string,
            unknown
          >,
          cleanupReport: cleanupResult?.cleanupReport
            ? (cleanupResult.cleanupReport as unknown as Record<
                string,
                unknown
              >)
            : null,
          responseStateCleanup: cleanupResult?.responseStateCleanup
            ? (cleanupResult.responseStateCleanup as unknown as Record<
                string,
                unknown
              >)
            : null,
          error: null,
          finishedAt: new Date(),
        });
      }
      this.ensureStream(job.id).complete();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Upload-Verarbeitung fehlgeschlagen.";
      this.logger.error(
        `Processing job ${jobId} failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await persist({
        status: "failed",
        phase: "failed",
        phaseLabel: "Fehlgeschlagen",
        message,
        error: message,
        finishedAt: new Date(),
      });
      this.ensureStream(job.id).complete();
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  private async ensureNoActiveJob(apId: string): Promise<void> {
    const existing = await this.jobRepository.findOne({
      where: {
        apId,
        status: In(["pending", "running"]),
      },
      order: { createdAt: "DESC" },
    });

    if (existing) {
      throw new ConflictException(
        "A file processing job is already running for this AP",
      );
    }
  }

  private async loadUploadedFiles(job: ApFileProcessingJob): Promise<ApFile[]> {
    const files = await this.fileRepository.find({
      where: {
        apId: job.apId,
        id: In(job.uploadedFileIds || []),
      },
      order: { originalName: "ASC" },
    });
    const filesById = new Map(files.map((file) => [file.id, file]));
    const orderedFiles = (job.uploadedFileIds || [])
      .map((fileId) => filesById.get(fileId))
      .filter((file): file is ApFile => !!file);

    if (orderedFiles.length !== (job.uploadedFileIds || []).length) {
      throw new BadRequestException(
        "Uploaded files are incomplete and cannot be processed",
      );
    }

    return orderedFiles;
  }

  private createProgressReporter(
    persist: (
      patch: Partial<ApFileProcessingJob>,
    ) => Promise<ApFileProcessingJob>,
  ): FileProcessingProgressReporter {
    let currentPhase: FileProcessingJobPhase = "queued";
    let current = 0;
    let total = 0;

    return {
      startPhase: async (phase, phaseTotal, options) => {
        currentPhase = phase;
        current = 0;
        total = Math.max(phaseTotal, 0);
        await persist({
          phase,
          phaseLabel: options?.phaseLabel || this.getPhaseLabel(phase),
          message: options?.message || null,
          phaseCurrent: 0,
          phaseTotal: total,
        });
      },
      advance: async (options) => {
        const delta = Math.max(options?.delta ?? 1, 0);
        current =
          total > 0 ? Math.min(total, current + delta) : current + delta;
        await persist({
          phase: currentPhase,
          phaseCurrent: current,
          phaseTotal: total,
          message: options?.message === undefined ? undefined : options.message,
        });
      },
      setMessage: async (message) => {
        await persist({
          phase: currentPhase,
          message,
          phaseCurrent: current,
          phaseTotal: total,
        });
      },
      completePhase: async (message) => {
        current = total;
        await persist({
          phase: currentPhase,
          phaseCurrent: total,
          phaseTotal: total,
          message: message === undefined ? undefined : message,
        });
      },
    };
  }

  private getPhaseLabel(phase: FileProcessingJobPhase): string {
    switch (phase) {
      case "sync-index":
        return "AP-Index wird synchronisiert";
      case "zip-files":
        return "ZIP wird erstellt";
      case "validate-files":
        return "Dateien werden validiert";
      case "validate-semantic":
        return "AP-Semantik wird geprüft";
      case "cleanup-overwrite":
        return "Bereinigung nach Ersetzen läuft";
      case "completed":
        return "Abgeschlossen";
      case "failed":
        return "Fehlgeschlagen";
      case "queued":
      default:
        return "Wartet auf Verarbeitung";
    }
  }

  private async getJob(jobId: string): Promise<ApFileProcessingJob> {
    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Processing job ${jobId} not found`);
    }
    return job;
  }

  private async getJobForAp(
    apId: string,
    jobId: string,
  ): Promise<ApFileProcessingJob> {
    const job = await this.getJob(jobId);
    if (job.apId !== apId) {
      throw new NotFoundException(
        `Processing job ${jobId} not found for AP ${apId}`,
      );
    }
    return job;
  }

  private ensureStream(
    jobId: string,
  ): ReplaySubject<FileProcessingJobSnapshot> {
    const existing = this.streams.get(jobId);
    if (existing) {
      return existing;
    }

    const next = new ReplaySubject<FileProcessingJobSnapshot>(1);
    this.streams.set(jobId, next);
    // bootstrapStream forwards lookup failures to the stream itself.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void this.bootstrapStream(jobId, next);
    return next;
  }

  private async bootstrapStream(
    jobId: string,
    stream: ReplaySubject<FileProcessingJobSnapshot>,
  ): Promise<void> {
    try {
      const job = await this.getJob(jobId);
      stream.next(this.toSnapshot(job));
      if (job.status === "completed" || job.status === "failed") {
        stream.complete();
      }
    } catch (error) {
      stream.error(error);
    }
  }

  private emit(job: ApFileProcessingJob): void {
    this.ensureStream(job.id).next(this.toSnapshot(job));
  }

  private toSnapshot(job: ApFileProcessingJob): FileProcessingJobSnapshot {
    return {
      id: job.id,
      apId: job.apId,
      jobType: job.jobType,
      status: job.status,
      phase: job.phase,
      phaseLabel: job.phaseLabel,
      message: job.message || null,
      phaseCurrent: Number(job.phaseCurrent || 0),
      phaseTotal: Number(job.phaseTotal || 0),
      uploadedFileCount: Number(job.uploadedFileCount || 0),
      archiveFileName: job.archiveFileName || null,
      syncReport: (job.syncReport as any) || null,
      validationSummary: (job.validationSummary as any) || null,
      cleanupReport: (job.cleanupReport as any) || null,
      responseStateCleanup: (job.responseStateCleanup as any) || null,
      error: job.error || null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    };
  }
}
