import { IsString, IsNotEmpty, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CredentialLoginDto {
  @ApiProperty({ description: "AP ID to access" })
  @IsUUID("all")
  acpId!: string;

  @ApiProperty({ example: "reviewer1" })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ example: "reviewpass" })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class OidcCallbackDto {
  @ApiProperty({ description: "ID token from OIDC provider" })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
