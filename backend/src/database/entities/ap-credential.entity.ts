import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { ApAccessConfig } from "./ap-access-config.entity";

@Entity("acp_credentials")
@Index("IDX_acp_credentials_unique_username", ["accessConfigId", "username"], {
  unique: true,
})
export class ApCredential {
  @Column({ type: "jsonb", default: [] })
  capabilities!: string[];

  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "access_config_id" })
  accessConfigId!: string;

  @Column()
  username!: string;

  @Column({ name: "password_hash" })
  passwordHash!: string;

  @ManyToOne(() => ApAccessConfig, (config) => config.credentials, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "access_config_id" })
  accessConfig!: ApAccessConfig;
}
