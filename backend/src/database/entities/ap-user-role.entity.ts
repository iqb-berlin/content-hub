import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";
import { Ap } from "./ap.entity";
import { apRoleStorage } from "../ap-storage";

export enum ApRole {
  AP_MANAGER = "AP_MANAGER",
  READ_ONLY = "READ_ONLY",
}

@Entity("acp_user_roles")
export class ApUserRole {
  @Column({ type: "jsonb", default: [] })
  capabilities!: string[];

  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id" })
  userId!: string;

  @Column({ name: "acp_id" })
  apId!: string;

  @Column({
    type: "enum",
    enum: ["ACP_MANAGER", "READ_ONLY"],
    transformer: apRoleStorage,
  })
  role!: ApRole;

  @ManyToOne(() => User, (user) => user.apRoles, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @ManyToOne(() => Ap, (ap) => ap.userRoles, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;
}
