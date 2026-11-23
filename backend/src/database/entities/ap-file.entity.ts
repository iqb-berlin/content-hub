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

  @Column({ name: "relative_path" })
  relativePath!: string;

  @Column({ name: "file_type", nullable: true })
  fileType?: string;

  @Column({ name: "file_size", type: "bigint" })
  fileSize!: number;

  @Column({ nullable: true })
  checksum?: string;

  @Column({
    name: "validation_result",
    type: "jsonb",
    nullable: true,
    transformer: {
      to: (result: unknown) => result,
      from: (result: Record<string, unknown> | null) => {
        // Through 0.7.0 the package-wide issues were copied into every file result.
        if (!Array.isArray(result?.issues)) return result;
        const issues = result.issues.filter(
          (issue) => issue?.scope !== "semantic",
        );
        if (issues.length === result.issues.length) return result;
        return {
          ...result,
          issues,
          valid: !issues.some((issue) => issue?.severity === "error"),
        };
      },
    },
  })
  validationResult?: Record<string, unknown>;

  @CreateDateColumn({ name: "uploaded_at" })
  uploadedAt!: Date;

  @ManyToOne(() => Ap, (ap) => ap.files, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;
}
