import { AcpCapabilitiesService } from "../auth/capabilities/acp-capabilities.service";
import { UpdateCapabilitiesDto } from "./dto/acp.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { parseCredentialFile } from "./credential-file";
import { profileGrants } from "../auth/capabilities/acp-capabilities";
import { ExplorerEditGuard } from "../auth/capabilities/explorer-access.guard";
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Query,
  UseGuards,
  Request,
  Res,
  Header,
  Logger,
  ForbiddenException,
  DefaultValuePipe,
  ParseEnumPipe,
} from "@nestjs/common";
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";
import { Response } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { AcpService } from "./acp.service";
import {
  CreateAcpDto,
  UpdateAcpDto,
  AssignRoleDto,
  UpdateAccessConfigDto,
  UploadCredentialsDto,
  CredentialUploadMode,
  UpdateMetadataColumnsDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  PatchItemExplorerDraftDto,
  VersionedItemExplorerActionDto,
} from "./dto/acp.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { AdminService } from "../admin/admin.service";
import { ALL_SERVER_API_SCOPES } from "../api/server-api-scopes";
import { UuidParam } from "../common/uuid-param";

class CreateAcpApplicationTokenDto {
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
}

@ApiTags("ACP Management")
@Controller("acp")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AcpController {
  private readonly logger = new Logger(AcpController.name);

  constructor(
    private readonly acpService: AcpService,
    private readonly itemExplorerStateService: ItemExplorerStateService,
    private readonly adminService: AdminService,
    private readonly capabilities: AcpCapabilitiesService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List all ACPs accessible to the current user" })
  async findAll(@Request() req: any) {
    if (req.user.isAppAdmin) {
      return this.acpService.findAll();
    }
    return this.acpService.findByUser(req.user.sub);
  }

  @Get(":id")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Get ACP by ID" })
  async findOne(@UuidParam("id") id: string) {
    return this.acpService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("APP_ADMIN")
  @ApiOperation({ summary: "Create a new ACP (Admin only)" })
  async create(@Body() dto: CreateAcpDto) {
    return this.acpService.create(dto);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({
    summary: "Update ACP name/description (ACP Manager or Admin only)",
  })
  async update(@UuidParam("id") id: string, @Body() dto: UpdateAcpDto) {
    return this.acpService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("APP_ADMIN")
  @ApiOperation({ summary: "Delete ACP (Admin only)" })
  async delete(@UuidParam("id") id: string) {
    return this.acpService.delete(id);
  }

  // ACP-Index endpoints
  @Get(":id/index")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Get ACP-Index" })
  async getIndex(@UuidParam("id") id: string) {
    return this.acpService.getIndex(id);
  }

  @Put(":id/index")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Update ACP-Index" })
  async updateIndex(
    @UuidParam("id") id: string,
    @Body() index: Record<string, unknown>,
  ) {
    return this.acpService.updateIndex(id, index);
  }

  @Post(":id/index/import")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Import ACP-Index from JSON (replaces existing)" })
  async importIndex(
    @UuidParam("id") id: string,
    @Body() index: Record<string, unknown>,
  ) {
    return this.acpService.importIndex(id, index);
  }

  @Delete(":id/index")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Reset ACP-Index to defaults" })
  async deleteIndex(@UuidParam("id") id: string) {
    return this.acpService.deleteIndex(id);
  }

  @Get(":id/index/export")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @Header("Content-Type", "application/json")
  @ApiOperation({ summary: "Export ACP-Index as JSON file download" })
  async exportIndex(@UuidParam("id") id: string, @Res() res: Response) {
    const index = await this.acpService.getIndex(id);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="acp-index-${id}.json"`,
    );
    res.json(index);
  }

  @Get(":id/assignable-users")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({
    summary: "List users that can be assigned read access by ACP managers",
  })
  async getAssignableUsers(@UuidParam("id") id: string) {
    return this.acpService.getAssignableUsers(id);
  }

  // Role management
  @Get(":id/roles")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "List role assignments for ACP" })
  async getRoles(@UuidParam("id") id: string) {
    return this.acpService.getRoles(id);
  }

  @Post(":id/roles")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({
    summary: "Assign user role for ACP (ACP Manager can assign READ_ONLY only)",
  })
  async assignRole(
    @UuidParam("id") id: string,
    @Body() dto: AssignRoleDto,
    @Request() req: any,
  ) {
    // If user is not App Admin, they can only assign READ_ONLY role
    if (!req.user?.isAppAdmin && dto.role === "ACP_MANAGER") {
      throw new ForbiddenException(
        "Only Application Admins can assign ACP_MANAGER role",
      );
    }
    return this.acpService.assignRole(id, dto);
  }

  @Patch(":id/roles/:userId/capabilities")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  async updateRoleCapabilities(
    @UuidParam("id") id: string,
    @UuidParam("userId") userId: string,
    @Body() dto: UpdateCapabilitiesDto,
  ) {
    return this.acpService.updateRoleCapabilities(id, userId, dto.capabilities);
  }

  @Delete(":id/roles/:userId")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({
    summary: "Remove user role for ACP (ACP Manager can remove READ_ONLY only)",
  })
  async removeRole(
    @UuidParam("id") id: string,
    @UuidParam("userId") userId: string,
    @Request() req: any,
  ) {
    // If user is not App Admin, check if they're removing an ACP_MANAGER role (which is forbidden)
    if (!req.user?.isAppAdmin) {
      const roles = await this.acpService.getRoles(id);
      const roleToRemove = roles.find((r) => r.userId === userId);
      if (roleToRemove?.role === "ACP_MANAGER") {
        throw new ForbiddenException(
          "Only Application Admins can remove ACP_MANAGER role",
        );
      }
    }
    return this.acpService.removeRole(id, userId);
  }

  @Get(":id/application-tokens")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "List application tokens limited to this ACP" })
  async listApplicationTokens(
    @UuidParam("id") id: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.adminService.listApplicationTokens({
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      offset: offset === undefined ? undefined : Number.parseInt(offset, 10),
      allowedAcpId: id,
    });
  }

  @Post(":id/application-tokens")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Create an application token limited to this ACP" })
  async createApplicationToken(
    @UuidParam("id") id: string,
    @Body() dto: CreateAcpApplicationTokenDto,
    @Request() req: any,
  ) {
    return this.adminService.createApplicationToken(
      {
        ...dto,
        allowedAcpIds: [id],
      },
      req?.user?.sub,
      {
        allowedAcpIds: [id],
        auditAcpId: id,
        auditPath: `/api/acp/${id}/application-tokens`,
      },
    );
  }

  @Patch(":id/application-tokens/:tokenId/revoke")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({
    summary: "Revoke an application token exclusively limited to this ACP",
  })
  async revokeApplicationToken(
    @UuidParam("id") id: string,
    @UuidParam("tokenId") tokenId: string,
    @Request() req: any,
  ) {
    return this.adminService.revokeApplicationToken(tokenId, req?.user?.sub, {
      allowedAcpIds: [id],
      requireExclusiveAcp: true,
      auditAcpId: id,
      auditPath: `/api/acp/${id}/application-tokens/${tokenId}/revoke`,
    });
  }

  // Access configuration
  @Get(":id/access")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Get access configuration for ACP" })
  async getAccessConfig(@UuidParam("id") id: string) {
    return this.withoutReviewInternals(
      await this.acpService.getAccessConfig(id),
    );
  }

  @Put(":id/access")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Update access configuration for ACP" })
  async updateAccessConfig(
    @UuidParam("id") id: string,
    @Body() dto: UpdateAccessConfigDto,
    @Request() req: any,
  ) {
    if (dto.featureConfig) {
      const current = await this.acpService.getAccessConfig(id);
      // Compare effective defaults: the access form materializes optional fields
      // even when only an unrelated package setting has changed.
      const reviewSettings = (config: Record<string, any> = {}) => ({
        enableReview: config.enableReview === true,
        enableCommenting: config.enableCommenting ?? false,
        commentTargets: Array.isArray(config.commentTargets)
          ? [...new Set(config.commentTargets)].sort()
          : [],
        commentVisibilityMode: ["SHARED", "GROUP"].includes(
          config.commentVisibilityMode,
        )
          ? config.commentVisibilityMode
          : "PRIVATE",
      });
      if (
        JSON.stringify(reviewSettings(current?.featureConfig)) !==
        JSON.stringify(reviewSettings(dto.featureConfig))
      ) {
        await this.capabilities.assert(req, "review:manage");
      }
    }
    return this.withoutReviewInternals(
      await this.acpService.updateAccessConfig(id, dto),
    );
  }

  @Post(":id/access/credentials")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Upload credentials list for ACP" })
  async uploadCredentials(
    @UuidParam("id") id: string,
    @Query(
      "mode",
      new DefaultValuePipe("replace"),
      new ParseEnumPipe(CredentialUploadMode),
    )
    mode: `${CredentialUploadMode}` = "replace",
    @Body() dto: UploadCredentialsDto,
  ) {
    const result = await this.acpService.uploadCredentials(
      id,
      dto.credentials,
      mode,
      dto.profile || dto.capabilities
        ? profileGrants(dto.profile, dto.capabilities)
        : undefined,
    );
    return {
      message: `Credentials processed: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`,
      ...result,
    };
  }

  @Post(":id/access/credentials/file")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 1024 * 1024 } }),
  )
  async importCredentialFile(
    @UuidParam("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query("mode") mode: "replace" | "append" | "upsert" = "append",
    @Query("preview") preview?: string,
    @Body() body?: { profile?: string; capabilities?: string },
  ) {
    if (!file?.buffer) throw new BadRequestException("Zugangsliste fehlt");
    let custom: unknown = [];
    try {
      custom = JSON.parse(body?.capabilities || "[]");
    } catch {
      throw new BadRequestException("Ungültige Berechtigungen");
    }
    if (!body?.profile)
      throw new BadRequestException("Berechtigungsprofil fehlt");
    const grants = profileGrants(body.profile, custom);
    const entries = parseCredentialFile(file.buffer);
    if (!["replace", "append", "upsert"].includes(mode))
      throw new BadRequestException("Ungültiger Importmodus");
    if (preview === "true") {
      const existing = await this.acpService.getCredentials(id);
      const names = new Set(entries.map((e) => e.username));
      const changes = entries.map((e) => {
        const old = existing.find((c) => c.username === e.username);
        return {
          username: e.username,
          action: old ? (mode === "append" ? "skip" : "update") : "add",
          before: old?.capabilities || [],
          after: old && mode === "append" ? old.capabilities || [] : grants,
        };
      });
      return {
        changes,
        removed:
          mode === "replace"
            ? existing
                .filter((c) => !names.has(c.username))
                .map((c) => c.username)
            : [],
      };
    }
    return this.acpService.uploadCredentials(id, entries, mode, grants);
  }

  @Get(":id/access/credentials")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Get credentials list for ACP" })
  async getCredentials(@UuidParam("id") id: string) {
    return this.acpService.getCredentials(id);
  }

  @Delete(":id/access/credentials/:credentialId")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Delete a credential from ACP" })
  async deleteCredential(
    @UuidParam("id") id: string,
    @UuidParam("credentialId") credentialId: string,
  ) {
    await this.acpService.deleteCredential(id, credentialId);
    return { message: "Credential deleted successfully" };
  }

  @Post(":id/access/credentials/single")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Create a single credential for ACP" })
  async createCredential(
    @UuidParam("id") id: string,
    @Body() dto: CreateCredentialDto,
  ) {
    return this.acpService.createCredential(id, dto);
  }

  @Patch(":id/access/credentials/:credentialId")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({ summary: "Update a credential" })
  async updateCredential(
    @UuidParam("id") id: string,
    @UuidParam("credentialId") credentialId: string,
    @Body() dto: UpdateCredentialDto,
  ) {
    return this.acpService.updateCredential(id, credentialId, dto);
  }

  @Put(":id/metadata-columns")
  @UseGuards(RolesGuard)
  @Roles("ACP_MANAGER")
  @ApiOperation({
    summary: "Update metadata column visibility and order (ACP Manager only)",
  })
  async updateMetadataColumns(
    @UuidParam("id") id: string,
    @Body() dto: UpdateMetadataColumnsDto,
    @Request() req: any,
  ) {
    this.logger.log(
      `Updating metadata columns for ACP ${id} by user ${req.user?.sub}`,
      {
        userRoles: req.user?.roles,
        userAcpRoles: req.user?.acpRoles,
        dto,
      },
    );

    try {
      const result = await this.acpService.updateMetadataColumns(id, dto);
      this.logger.log(`Successfully updated metadata columns for ACP ${id}`);
      return this.withoutReviewInternals(result);
    } catch (error) {
      this.logger.error(
        `Failed to update metadata columns for ACP ${id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @Patch(":id/item-explorer/draft")
  @UseGuards(ExplorerEditGuard)
  @ApiOperation({
    summary: "Patch Item Explorer draft state (ACP Manager or Admin)",
  })
  async patchItemExplorerDraft(
    @UuidParam("id") id: string,
    @Body() dto: PatchItemExplorerDraftDto,
    @Request() req: any,
  ) {
    const actor = this.itemExplorerStateService.resolveActor(req?.user, id);
    return this.itemExplorerStateService.patchDraft(
      id,
      (dto.patch || {}) as any,
      {
        actor,
        changeType: dto.changeType,
        baseVersion: dto.baseVersion,
      },
    );
  }

  @Post(":id/item-explorer/draft/save")
  @UseGuards(ExplorerEditGuard)
  @ApiOperation({ summary: "Publish Item Explorer draft state" })
  async saveItemExplorerDraft(
    @UuidParam("id") id: string,
    @Body() dto: VersionedItemExplorerActionDto,
    @Request() req: any,
  ) {
    const actor = this.itemExplorerStateService.resolveActor(req?.user, id);
    return this.itemExplorerStateService.saveDraft(id, {
      actor,
      baseVersion: dto.baseVersion,
    });
  }

  @Post(":id/item-explorer/draft/discard")
  @UseGuards(ExplorerEditGuard)
  @ApiOperation({
    summary: "Discard Item Explorer draft state and reset to published",
  })
  async discardItemExplorerDraft(
    @UuidParam("id") id: string,
    @Body() dto: VersionedItemExplorerActionDto,
    @Request() req: any,
  ) {
    const actor = this.itemExplorerStateService.resolveActor(req?.user, id);
    return this.itemExplorerStateService.discardDraft(id, {
      actor,
      baseVersion: dto.baseVersion,
    });
  }

  @Get(":id/item-explorer/changes")
  @UseGuards(ExplorerEditGuard)
  @ApiOperation({ summary: "List Item Explorer change log entries" })
  async getItemExplorerChanges(
    @UuidParam("id") id: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = parseInt(limit || "", 10);
    return this.itemExplorerStateService.listChanges(
      id,
      Number.isNaN(parsedLimit) ? 100 : parsedLimit,
    );
  }
  private withoutReviewInternals<T extends Record<string, unknown> | object>(
    config: T,
  ) {
    const {
      reviewGroups: _groups,
      reviewRevision: _revision,
      reviewConfigVersion: _version,
      ...visible
    } = config as T & {
      reviewGroups?: unknown;
      reviewRevision?: unknown;
      reviewConfigVersion?: unknown;
    };
    return visible;
  }
}
