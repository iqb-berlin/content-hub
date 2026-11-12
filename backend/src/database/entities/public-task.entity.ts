import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export interface PublicTaskSnapshot {
  version: 1;
  unitId: string;
  title: string;
  description: string;
  copyrightNotice: string;
  publicComments: string;
  playerHtml: string;
  definition: string;
  codingScheme: Record<string, unknown>;
  metadata: { label: string; entries: { label: string; value: string }[] }[];
}

@Entity("public_tasks")
export class PublicTask {
  @PrimaryGeneratedColumn("uuid") id!: string;

  // Deliberately no cascading relation: published links survive source deletion.
  @Index("IDX_public_tasks_source_ap")
  @Column({ name: "source_ap_id", type: "uuid" })
  sourceApId!: string;

  @Column({ type: "jsonb", select: false }) snapshot!: PublicTaskSnapshot;

  @Column() title!: string;
  @Column({ name: "unit_id" }) unitId!: string;
  @Column({ default: true }) published!: boolean;
  @CreateDateColumn({ name: "created_at" }) createdAt!: Date;
}
