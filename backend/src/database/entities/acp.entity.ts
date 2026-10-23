import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { AcpUserRole } from "./acp-user-role.entity";
import { AcpFile } from "./acp-file.entity";
import { AcpSnapshot } from "./acp-snapshot.entity";
import { AcpAccessConfig } from "./acp-access-config.entity";
import { Comment } from "./comment.entity";

@Entity("acp")
export class Acp {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "package_id", unique: true })
  packageId!: string;

  @Column()
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ name: "acp_index", type: "jsonb", default: {} })
  acpIndex!: Record<string, unknown>;

  @Column({ name: "acp_index_schema_id", nullable: true })
  acpIndexSchemaId?: string;

  @Column({ name: "acp_index_validation_status", default: "UNKNOWN" })
  acpIndexValidationStatus!: string;

  @Column({
    name: "acp_index_validation_report",
    type: "jsonb",
    nullable: true,
  })
  acpIndexValidationReport?: Record<string, unknown>;

  @Column({ name: "item_properties", type: "jsonb", default: {} })
  itemProperties!: Record<string, Record<string, any>>;

  @Column({ type: "jsonb", default: {} })
  settings!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @OneToMany(() => AcpUserRole, (role) => role.acp)
  userRoles!: AcpUserRole[];

  @OneToMany(() => AcpFile, (file) => file.acp)
  files!: AcpFile[];

  @OneToMany(() => AcpSnapshot, (snapshot) => snapshot.acp)
  snapshots!: AcpSnapshot[];

  @OneToMany(() => AcpAccessConfig, (config) => config.acp)
  accessConfigs!: AcpAccessConfig[];

  @OneToMany(() => Comment, (comment) => comment.acp)
  comments!: Comment[];
}
