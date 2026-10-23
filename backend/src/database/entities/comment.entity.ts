import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { Acp } from "./acp.entity";
import { User } from "./user.entity";
import { AcpCredential } from "./acp-credential.entity";

export enum CommentTargetType {
  BOOKLET = "BOOKLET",
  UNIT = "UNIT",
  ITEM = "ITEM",
  CODING = "CODING",
  TASK_SEQUENCE = "TASK_SEQUENCE",
}

@Entity("comments")
@Index("IDX_comments_item_target", ["acpId", "unitId", "itemId"])
@Index("IDX_comments_booklet_target", ["acpId", "bookletId"])
@Index("IDX_comments_parent", ["parentCommentId"])
export class Comment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "acp_id" })
  acpId!: string;

  @Column({ name: "user_id", nullable: true })
  userId?: string;

  @Column({ name: "credential_username", nullable: true })
  credentialUsername?: string;

  @Column({ name: "credential_id", type: "uuid", nullable: true })
  credentialId?: string | null;

  @Column({ name: "author_label", type: "varchar", nullable: true })
  authorLabel?: string | null;

  @Column({
    name: "target_type",
    type: "enum",
    enum: CommentTargetType,
  })
  targetType!: CommentTargetType;

  @Column({ name: "target_id" })
  targetId!: string;

  @Column({ name: "booklet_id", type: "varchar", nullable: true })
  bookletId?: string | null;

  @Column({ name: "unit_id", type: "varchar", nullable: true })
  unitId?: string | null;

  @Column({ name: "item_id", type: "varchar", nullable: true })
  itemId?: string | null;

  @Column({ name: "parent_comment_id", type: "uuid", nullable: true })
  parentCommentId?: string | null;

  @Column({ name: "group_id", type: "uuid", nullable: true })
  groupId?: string | null;

  @Column({ name: "category_id", type: "uuid", nullable: true })
  categoryId?: string | null;

  @Column({ name: "comment_text", type: "text" })
  commentText!: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt?: Date | null;

  @Column({ name: "legacy_read_only", type: "boolean", default: false })
  legacyReadOnly!: boolean;

  @ManyToOne(() => Acp, (acp) => acp.comments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  acp!: Acp;

  @ManyToOne(() => User, (user) => user.comments, {
    onDelete: "SET NULL",
    nullable: true,
  })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @ManyToOne(() => AcpCredential, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: "credential_id" })
  credential?: AcpCredential;

  @ManyToOne(() => Comment, (comment) => comment.replies, {
    onDelete: "SET NULL",
    nullable: true,
  })
  @JoinColumn({
    name: "parent_comment_id",
    foreignKeyConstraintName: "FK_comments_parent",
  })
  parentComment?: Comment;

  @OneToMany(() => Comment, (comment) => comment.parentComment)
  replies?: Comment[];
}
