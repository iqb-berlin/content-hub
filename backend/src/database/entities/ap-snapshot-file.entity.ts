import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { ApSnapshot } from "./ap-snapshot.entity";

@Entity("acp_snapshot_files")
export class ApSnapshotFile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "snapshot_id" })
  snapshotId!: string;

  @Column({ name: "file_path" })
  filePath!: string;

  @Column({ name: "original_name" })
  originalName!: string;

  @Column({ name: "relative_path" })
  relativePath!: string;

  @Column({ name: "file_type", nullable: true })
  fileType?: string;

  @Column({ name: "validation_result", type: "jsonb", nullable: true })
  validationResult?: Record<string, unknown>;

  @Column({ nullable: true })
  checksum?: string;

  @Column({ name: "file_size", type: "bigint" })
  fileSize!: number;

  @ManyToOne(() => ApSnapshot, (snapshot) => snapshot.snapshotFiles, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "snapshot_id" })
  snapshot!: ApSnapshot;
}
