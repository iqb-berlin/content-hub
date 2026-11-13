import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { apScopeStorage } from "../ap-storage";

@Entity("application_tokens")
export class ApplicationToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, length: 160 })
  name!: string;

  @Column({ name: "token_hash", unique: true, length: 64 })
  tokenHash!: string;

  @Column({ name: "token_prefix", length: 32 })
  tokenPrefix!: string;

  @Column({
    type: "jsonb",
    default: () => "'[]'::jsonb",
    transformer: apScopeStorage,
  })
  scopes!: string[];

  @Column({ name: "allowed_acp_ids", type: "jsonb", nullable: true })
  allowedApIds?: string[] | null;

  @Column({ default: true })
  active!: boolean;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt?: Date | null;

  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt?: Date | null;

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  createdByUserId?: string | null;

  @Column({ name: "revoked_by_user_id", type: "uuid", nullable: true })
  revokedByUserId?: string | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
