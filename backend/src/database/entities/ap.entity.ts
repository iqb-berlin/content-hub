import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { ApUserRole } from "./ap-user-role.entity";
import { ApFile } from "./ap-file.entity";
import { ApSnapshot } from "./ap-snapshot.entity";
import { ApAccessConfig } from "./ap-access-config.entity";
import { Comment } from "./comment.entity";

@Entity("acp")
export class Ap {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "package_id", unique: true })
  packageId!: string;

  @Column()
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ name: "acp_index", type: "jsonb", default: {} })
  apIndex!: Record<string, unknown>;

  @Column({ name: "item_properties", type: "jsonb", default: {} })
  itemProperties!: Record<string, Record<string, any>>;

  @Column({ type: "jsonb", default: {} })
  settings!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @OneToMany(() => ApUserRole, (role) => role.ap)
  userRoles!: ApUserRole[];

  @OneToMany(() => ApFile, (file) => file.ap)
  files!: ApFile[];

  @OneToMany(() => ApSnapshot, (snapshot) => snapshot.ap)
  snapshots!: ApSnapshot[];

  @OneToMany(() => ApAccessConfig, (config) => config.ap)
  accessConfigs!: ApAccessConfig[];

  @OneToMany(() => Comment, (comment) => comment.ap)
  comments!: Comment[];
}
