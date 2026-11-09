import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OidcAuthGuard } from "../auth/guards/oidc-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ALL_SERVER_API_SCOPES } from "../api/server-api-scopes";
import { UuidParam } from "../common/uuid-param";

class CreateApplicationTokenDto {
  @ApiProperty({ description: "Human-readable application name" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: "Allowed server API scopes",
    enum: ALL_SERVER_API_SCOPES,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scopes!: string[];

  @ApiPropertyOptional({
    description: "Optional expiration timestamp (ISO 8601)",
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      "Optional AP IDs this token is allowed to access. Omit or pass null for a global token.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  allowedApIds?: string[] | null;
}

@ApiTags("Administration")
@Controller("admin")
@UseGuards(JwtAuthGuard, OidcAuthGuard, RolesGuard)
@Roles("APP_ADMIN")
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("settings")
  @ApiOperation({ summary: "Get application settings" })
  async getSettings() {
    return this.adminService.getSettings();
  }

  @Put("settings")
  @ApiOperation({ summary: "Update application settings" })
  async updateSettings(@Body() data: Record<string, unknown>) {
    return this.adminService.updateSettings(data as any);
  }

  @Get("application-tokens")
  @ApiOperation({ summary: "List application tokens" })
  async listApplicationTokens(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("allowedApId") allowedApId?: string,
  ) {
    return this.adminService.listApplicationTokens({
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      offset: offset === undefined ? undefined : Number.parseInt(offset, 10),
      allowedApId,
    });
  }

  @Post("application-tokens")
  @ApiOperation({ summary: "Create an application token" })
  async createApplicationToken(
    @Body() data: CreateApplicationTokenDto,
    @Req() req: any,
  ) {
    return this.adminService.createApplicationToken(data, req?.user?.sub);
  }

  @Patch("application-tokens/:id/revoke")
  @ApiOperation({ summary: "Revoke an application token" })
  async revokeApplicationToken(@UuidParam("id") id: string, @Req() req: any) {
    return this.adminService.revokeApplicationToken(id, req?.user?.sub);
  }

  @Post("settings/geogebra-bundle")
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload the shared GeoGebra asset bundle" })
  async uploadGeoGebraBundle(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.adminService.uploadGeoGebraBundle(file);
  }

  @Delete("settings/geogebra-bundle")
  @ApiOperation({ summary: "Remove the shared GeoGebra asset bundle" })
  async deleteGeoGebraBundle() {
    return this.adminService.deleteGeoGebraBundle();
  }
}
