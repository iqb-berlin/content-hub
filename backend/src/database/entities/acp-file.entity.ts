import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from "typeorm";
import { Acp } from "./acp.entity";

@Entity("acp_files")
export class AcpFile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id" })
  acpId!: string;

  @Column({ name: "file_path" })
  filePath!: string;

  @Column({ name: "original_name" })
  originalName!: string;

  @Column({ name: "relative_path" })
  relativePath!: string;

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

  @ManyToOne(() => Acp, (acp) => acp.files, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  acp!: Acp;
}
