import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { AcpSnapshot } from "./acp-snapshot.entity";

@Entity("acp_snapshot_files")
export class AcpSnapshotFile {
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

  @Column({ nullable: true })
  checksum?: string;

  @Column({ name: "file_size", type: "bigint" })
  fileSize!: number;

  @ManyToOne(() => AcpSnapshot, (snapshot) => snapshot.snapshotFiles, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "snapshot_id" })
  snapshot!: AcpSnapshot;
}
