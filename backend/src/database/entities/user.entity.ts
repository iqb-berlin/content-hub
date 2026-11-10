import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { ApUserRole } from "./ap-user-role.entity";
import { Comment } from "./comment.entity";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ name: "display_name", nullable: true })
  displayName?: string;

  @Column({ name: "is_app_admin", default: false })
  isAppAdmin!: boolean;

  @Column({ name: "oidc_sub", nullable: true, unique: true })
  oidcSub?: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @OneToMany(() => ApUserRole, (role) => role.user)
  apRoles!: ApUserRole[];

  @OneToMany(() => Comment, (comment) => comment.user)
  comments!: Comment[];
}
