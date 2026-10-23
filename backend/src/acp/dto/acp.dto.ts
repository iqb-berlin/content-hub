import { ACP_CAPABILITIES } from "../../auth/capabilities/acp-capabilities";
import { IsIn, ArrayUnique } from "class-validator";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsDateString,
  IsArray,
  ValidateNested,
  MinLength,
  Matches,
  IsInt,
  Min,
  IsUUID,
  IsEnum,
  IsBoolean,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { AcpRole } from "../../database/entities/acp-user-role.entity";
import { AccessModel } from "../../database/entities/acp-access-config.entity";

const STRONG_CREDENTIAL_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
const STRONG_CREDENTIAL_PASSWORD_MESSAGE =
  "Password must be at least 12 characters long and include uppercase, lowercase, number, and special character.";

export class CreateAcpDto {
  @ApiProperty({ example: "vera-2026-math" })
  @IsString()
  @IsNotEmpty()
  packageId!: string;

  @ApiProperty({ example: "VERA 2026 Mathematics" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateAcpDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;
}

export class AssignRoleDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ACP_CAPABILITIES, { each: true })
  capabilities?: string[];

  @ApiProperty()
  @IsUUID("all")
  userId!: string;

  @ApiProperty({ enum: AcpRole })
  @IsEnum(AcpRole)
  role!: `${AcpRole}`;
}

export class UpdateAccessConfigDto {
  @ApiProperty({ enum: AccessModel })
  @IsEnum(AccessModel)
  accessModel!: `${AccessModel}`;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  allowRegistered?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  featureConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsDateString()
  @IsOptional()
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsDateString()
  @IsOptional()
  validUntil?: string | null;
}

export class UpdateMetadataColumnsDto {
  @ApiProperty({
    type: [String],
    description: "List of metadata column IDs to display",
  })
  @IsArray()
  @IsString({ each: true })
  visibleColumns!: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "Order of metadata columns",
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  columnOrder?: string[];
}

export class CredentialEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @Matches(STRONG_CREDENTIAL_PASSWORD_REGEX, {
    message: STRONG_CREDENTIAL_PASSWORD_MESSAGE,
  })
  password!: string;
}

export class UploadCredentialsDto {
  @IsOptional()
  @IsIn(["REVIEW_ONLY", "ITEM_EXPLORER_ONLY", "BOTH", "CUSTOM"])
  profile?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ACP_CAPABILITIES, { each: true })
  capabilities?: string[];

  @ApiProperty({ type: [CredentialEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CredentialEntryDto)
  credentials!: CredentialEntryDto[];
}

export class CreateCredentialDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ACP_CAPABILITIES, { each: true })
  capabilities?: string[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @Matches(STRONG_CREDENTIAL_PASSWORD_REGEX, {
    message: STRONG_CREDENTIAL_PASSWORD_MESSAGE,
  })
  password!: string;
}

export class UpdateCredentialDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ACP_CAPABILITIES, { each: true })
  capabilities?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional()
  @IsString()
  @MinLength(12)
  @Matches(STRONG_CREDENTIAL_PASSWORD_REGEX, {
    message: STRONG_CREDENTIAL_PASSWORD_MESSAGE,
  })
  @IsOptional()
  password?: string;
}

export class CreateSnapshotDto {
  @ApiPropertyOptional({
    description: "Changelog text describing changes since last snapshot",
  })
  @IsString()
  @IsOptional()
  changelog?: string;
}

export class ItemExplorerMetadataColumnsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  visible?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  order?: string[];
}

export class PatchItemExplorerDraftDto {
  @ApiPropertyOptional({ description: "Optimistic lock base version" })
  @IsInt()
  @Min(1)
  @IsOptional()
  baseVersion?: number;

  @ApiProperty({ description: "Change type for audit log" })
  @IsString()
  @IsNotEmpty()
  changeType!: string;

  @ApiPropertyOptional({
    description: "Partial draft patch",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  patch?: Record<string, unknown>;
}

export class VersionedItemExplorerActionDto {
  @ApiPropertyOptional({ description: "Optimistic lock base version" })
  @IsInt()
  @Min(1)
  @IsOptional()
  baseVersion?: number;
}

export class CredentialResponseDto {
  capabilities?: string[];

  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;
}

export enum CredentialUploadMode {
  replace = "replace",
  append = "append",
  upsert = "upsert",
}

export class UpdateCapabilitiesDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(ACP_CAPABILITIES, { each: true })
  capabilities!: string[];
}
