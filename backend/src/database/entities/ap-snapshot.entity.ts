import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { Ap } from "./ap.entity";
import { ApSnapshotFile } from "./ap-snapshot-file.entity";

@Entity("acp_snapshots")
export class ApSnapshot {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id" })
  apId!: string;

  @Column({ name: "version_number" })
  versionNumber!: number;

  @Column({ name: "acp_index_snapshot", type: "jsonb" })
  apIndexSnapshot!: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  changelog?: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Ap, (ap) => ap.snapshots, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;

  @OneToMany(() => ApSnapshotFile, (sf) => sf.snapshot)
  snapshotFiles!: ApSnapshotFile[];
}
