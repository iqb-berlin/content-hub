import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Ap } from "./ap.entity";
import {
  FileProcessingJobPhase,
  FileProcessingJobStatus,
  FileProcessingJobType,
} from "../../files/file-processing-progress";

@Entity("acp_file_processing_jobs")
export class ApFileProcessingJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id" })
  apId!: string;

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  createdByUserId?: string | null;

  @Column({
    name: "job_type",
    type: "varchar",
    length: 32,
    default: "upload-process",
  })
  jobType!: FileProcessingJobType;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: FileProcessingJobStatus;

  @Column({ type: "varchar", length: 64, default: "queued" })
  phase!: FileProcessingJobPhase;

  @Column({
    name: "phase_label",
    type: "varchar",
    length: 160,
    default: "Wartet",
  })
  phaseLabel!: string;

  @Column({ type: "text", nullable: true })
  message?: string | null;

  @Column({ name: "phase_current", type: "integer", default: 0 })
  phaseCurrent!: number;

  @Column({ name: "phase_total", type: "integer", default: 0 })
  phaseTotal!: number;

  @Column({ name: "uploaded_file_count", type: "integer", default: 0 })
  uploadedFileCount!: number;

  @Column({ name: "uploaded_file_ids", type: "jsonb", default: () => "'[]'" })
  uploadedFileIds!: string[];

  @Column({ name: "run_cleanup", type: "boolean", default: false })
  runCleanup!: boolean;

  @Column({ name: "sync_report", type: "jsonb", nullable: true })
  syncReport?: Record<string, unknown> | null;

  @Column({ name: "validation_summary", type: "jsonb", nullable: true })
  validationSummary?: Record<string, unknown> | null;

  @Column({ name: "cleanup_report", type: "jsonb", nullable: true })
  cleanupReport?: Record<string, unknown> | null;

  @Column({ name: "response_state_cleanup", type: "jsonb", nullable: true })
  responseStateCleanup?: Record<string, unknown> | null;

  @Column({
    name: "archive_file_name",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  archiveFileName?: string | null;

  @Column({ name: "archive_file_path", type: "text", nullable: true })
  archiveFilePath?: string | null;

  @Column({ type: "text", nullable: true })
  error?: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @Column({ name: "started_at", type: "timestamp", nullable: true })
  startedAt?: Date | null;

  @Column({ name: "finished_at", type: "timestamp", nullable: true })
  finishedAt?: Date | null;

  @ManyToOne(() => Ap, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;
}
