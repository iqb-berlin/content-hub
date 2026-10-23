import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("acp_external_resource_cache")
export class AcpExternalResourceCache {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  url!: string;

  @Column({ nullable: true })
  etag?: string;

  @Column({ name: "last_modified", nullable: true })
  lastModified?: string;

  @Column({ type: "jsonb", nullable: true })
  payload?: Record<string, unknown>;

  @Column({ default: "unavailable" })
  status!: string;

  @Column({ name: "last_success_at", type: "timestamptz", nullable: true })
  lastSuccessAt?: Date;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError?: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
