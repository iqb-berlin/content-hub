import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { Acp } from "./acp.entity";
import { AcpSnapshotFile } from "./acp-snapshot-file.entity";

@Entity("acp_snapshots")
export class AcpSnapshot {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id" })
  acpId!: string;

  @Column({ name: "version_number" })
  versionNumber!: number;

  @Column({ name: "acp_index_snapshot", type: "jsonb" })
  acpIndexSnapshot!: Record<string, unknown>;

  @Column({ name: "package_metadata_snapshot", type: "jsonb", nullable: true })
  packageMetadataSnapshot?: {
    name: string;
    description?: string;
    itemProperties: Record<string, Record<string, unknown>>;
  };

  @Column({ type: "text", nullable: true })
  changelog?: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Acp, (acp) => acp.snapshots, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  acp!: Acp;

  @OneToMany(() => AcpSnapshotFile, (sf) => sf.snapshot)
  snapshotFiles!: AcpSnapshotFile[];
}
