import { apRoleStorage } from "../ap-storage";
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Ap } from "./ap.entity";
import { User } from "./user.entity";

export type ItemExplorerDraftStatus = "CLEAN" | "DIRTY";

@Entity("acp_item_explorer_state")
export class ApItemExplorerState {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id", type: "uuid", unique: true })
  apId!: string;

  @Column({ name: "published_state", type: "jsonb", default: {} })
  publishedState!: Record<string, unknown>;

  @Column({ name: "draft_state", type: "jsonb", default: {} })
  draftState!: Record<string, unknown>;

  @Column({ name: "status", type: "varchar", default: "CLEAN" })
  status!: ItemExplorerDraftStatus;

  @Column({ name: "version", type: "int", default: 1 })
  version!: number;

  @Column({ name: "published_version", type: "int", default: 1 })
  publishedVersion!: number;

  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true })
  updatedByUserId?: string | null;

  @Column({ name: "updated_by_username", type: "varchar", nullable: true })
  updatedByUsername?: string | null;

  @Column({
    name: "updated_by_role",
    type: "varchar",
    nullable: true,
    transformer: apRoleStorage,
  })
  updatedByRole?: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => Ap, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "updated_by_user_id" })
  updatedByUser?: User;
}
