import type { IndexSyncReport } from "./unit-parser.service";
import type { AutoValidationSummary } from "../validation/validation.service";

export type FileProcessingJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type FileProcessingJobType = "upload-process" | "archive-download";

export type FileProcessingJobPhase =
  | "queued"
  | "sync-index"
  | "zip-files"
  | "validate-files"
  | "validate-semantic"
  | "cleanup-overwrite"
  | "completed"
  | "failed";

export interface FileProcessingProgressReporter {
  startPhase(
    phase: FileProcessingJobPhase,
    total: number,
    options?: { phaseLabel?: string; message?: string | null },
  ): Promise<void>;
  advance(options?: { delta?: number; message?: string | null }): Promise<void>;
  setMessage(message: string | null): Promise<void>;
  completePhase(message?: string | null): Promise<void>;
}

export interface FileProcessingCleanupReport {
  unitsUpdated: number;
  dependenciesRemoved: number;
  bookletsUpdated: number;
  bookletDefinitionsRemoved: number;
  indexUpdated: boolean;
}

export interface FileProcessingResponseStateCleanup {
  totalStates: number;
  deletedStates: number;
  keptStates: number;
}

export interface FileProcessingJobSnapshot {
  id: string;
  apId: string;
  jobType: FileProcessingJobType;
  status: FileProcessingJobStatus;
  phase: FileProcessingJobPhase;
  phaseLabel: string;
  message: string | null;
  phaseCurrent: number;
  phaseTotal: number;
  uploadedFileCount: number;
  archiveFileName?: string | null;
  syncReport?: IndexSyncReport | null;
  validationSummary?: AutoValidationSummary | null;
  cleanupReport?: FileProcessingCleanupReport | null;
  responseStateCleanup?: FileProcessingResponseStateCleanup | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}
