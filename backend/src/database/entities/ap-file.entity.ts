import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from "typeorm";
import { Ap } from "./ap.entity";

@Entity("acp_files")
export class ApFile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id" })
  apId!: string;

  @Column({ name: "file_path" })
  filePath!: string;

  @Column({ name: "original_name" })
  originalName!: string;

  @Column({ name: "file_type", nullable: true })
  fileType?: string;

  @Column({ name: "file_size", type: "bigint" })
  fileSize!: number;

  @Column({ nullable: true })
  checksum?: string;

  @Column({ name: "validation_result", type: "jsonb", nullable: true })
  validationResult?: Record<string, unknown>;

  @CreateDateColumn({ name: "uploaded_at" })
  uploadedAt!: Date;

  @ManyToOne(() => Ap, (ap) => ap.files, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;
}
