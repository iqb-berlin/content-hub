import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from "typeorm";

export interface GeoGebraBundleSettings {
  sourceFileName: string;
  deployScriptUrl: string;
  publicBasePath: string;
  checksum: string;
  entryCount: number;
  uploadedAt: string;
}

@Entity("app_settings")
export class AppSettings {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "jsonb", default: {} })
  theme!: Record<string, unknown>;

  @Column({ default: "de" })
  language!: string;

  @Column({ name: "logo_url", nullable: true })
  logoUrl?: string;

  @Column({ name: "landing_page_html", type: "text", nullable: true })
  landingPageHtml?: string;

  @Column({ name: "imprint_html", type: "text", nullable: true })
  imprintHtml?: string;

  @Column({ name: "privacy_html", type: "text", nullable: true })
  privacyHtml?: string;

  @Column({ name: "accessibility_html", type: "text", nullable: true })
  accessibilityHtml?: string;

  @Column({ name: "default_acp_index", type: "jsonb", default: {} })
  defaultApIndex!: Record<string, unknown>;

  @Column({ name: "geogebra_bundle", type: "jsonb", nullable: true })
  geoGebraBundle?: GeoGebraBundleSettings | null;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
