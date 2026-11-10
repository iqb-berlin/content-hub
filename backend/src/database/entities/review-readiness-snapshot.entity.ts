import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Ap } from "./ap.entity";
import type { ReviewReadinessResult } from "../../review/review-readiness.service";

@Entity("review_readiness_snapshots")
export class ReviewReadinessSnapshot {
  @PrimaryColumn({ name: "acp_id", type: "uuid" }) apId!: string;
  @Column({ type: "varchar" }) fingerprint!: string;
  @Column({ type: "jsonb" }) result!: ReviewReadinessResult;
  @ManyToOne(() => Ap, { onDelete: "CASCADE" })
  @JoinColumn({ name: "acp_id" })
  ap!: Ap;
}
