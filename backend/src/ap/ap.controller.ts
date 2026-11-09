import { ApCapabilitiesService } from "../auth/capabilities/ap-capabilities.service";
import { UpdateCapabilitiesDto } from "./dto/ap.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { parseCredentialFile } from "./credential-file";
import { profileGrants } from "../auth/capabilities/ap-capabilities";
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
import { ApService } from "./ap.service";
import {
  CreateApDto,
  UpdateApDto,
  AssignRoleDto,
  UpdateAccessConfigDto,
  UploadCredentialsDto,
  CredentialUploadMode,
  UpdateMetadataColumnsDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  PatchItemExplorerDraftDto,
  VersionedItemExplorerActionDto,
} from "./dto/ap.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { AdminService } from "../admin/admin.service";
import { ALL_SERVER_API_SCOPES } from "../api/server-api-scopes";
import { UuidParam } from "../common/uuid-param";

class CreateApApplicationTokenDto {
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

@ApiTags("AP Management")
@Controller("ap")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApController {
  private readonly logger = new Logger(ApController.name);

  constructor(
    private readonly apService: ApService,
    private readonly itemExplorerStateService: ItemExplorerStateService,
    private readonly adminService: AdminService,
    private readonly capabilities: ApCapabilitiesService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List all APs accessible to the current user" })
  async findAll(@Request() req: any) {
    if (req.user.isAppAdmin) {
      return this.apService.findAll();
    }
    return this.apService.findByUser(req.user.sub);
  }

  @Get(":id")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Get AP by ID" })
  async findOne(@UuidParam("id") id: string) {
    return this.apService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("APP_ADMIN")
  @ApiOperation({ summary: "Create a new AP (Admin only)" })
  async create(@Body() dto: CreateApDto) {
    return this.apService.create(dto);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({
    summary: "Update AP name/description (AP Manager or Admin only)",
  })
  async update(@UuidParam("id") id: string, @Body() dto: UpdateApDto) {
    return this.apService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("APP_ADMIN")
  @ApiOperation({ summary: "Delete AP (Admin only)" })
  async delete(@UuidParam("id") id: string) {
    return this.apService.delete(id);
  }

  // AP-Index endpoints
  @Get(":id/index")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Get AP-Index" })
  async getIndex(@UuidParam("id") id: string) {
    return this.apService.getIndex(id);
  }

  @Put(":id/index")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Update AP-Index" })
  async updateIndex(
    @UuidParam("id") id: string,
    @Body() index: Record<string, unknown>,
  ) {
    return this.apService.updateIndex(id, index);
  }

  @Post(":id/index/import")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Import AP-Index from JSON (replaces existing)" })
  async importIndex(
    @UuidParam("id") id: string,
    @Body() index: Record<string, unknown>,
  ) {
    return this.apService.importIndex(id, index);
  }

  @Delete(":id/index")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Reset AP-Index to defaults" })
  async deleteIndex(@UuidParam("id") id: string) {
    return this.apService.deleteIndex(id);
  }

  @Get(":id/index/export")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @Header("Content-Type", "application/json")
  @ApiOperation({ summary: "Export AP-Index as JSON file download" })
  async exportIndex(@UuidParam("id") id: string, @Res() res: Response) {
    const index = await this.apService.getIndex(id);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ap-index-${id}.json"`,
    );
    res.json(index);
  }

  @Get(":id/assignable-users")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({
    summary: "List users that can be assigned read access by AP managers",
  })
  async getAssignableUsers(@UuidParam("id") id: string) {
    return this.apService.getAssignableUsers(id);
  }

  // Role management
  @Get(":id/roles")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "List role assignments for AP" })
  async getRoles(@UuidParam("id") id: string) {
    return this.apService.getRoles(id);
  }

  @Post(":id/roles")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({
    summary: "Assign user role for AP (AP Manager can assign READ_ONLY only)",
  })
  async assignRole(
    @UuidParam("id") id: string,
    @Body() dto: AssignRoleDto,
    @Request() req: any,
  ) {
    // If user is not App Admin, they can only assign READ_ONLY role
    if (!req.user?.isAppAdmin && dto.role === "AP_MANAGER") {
      throw new ForbiddenException(
        "Only Application Admins can assign AP_MANAGER role",
      );
    }
    return this.apService.assignRole(id, dto);
  }

  @Patch(":id/roles/:userId/capabilities")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  async updateRoleCapabilities(
    @UuidParam("id") id: string,
    @UuidParam("userId") userId: string,
    @Body() dto: UpdateCapabilitiesDto,
  ) {
    return this.apService.updateRoleCapabilities(id, userId, dto.capabilities);
  }

  @Delete(":id/roles/:userId")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({
    summary: "Remove user role for AP (AP Manager can remove READ_ONLY only)",
  })
  async removeRole(
    @UuidParam("id") id: string,
    @UuidParam("userId") userId: string,
    @Request() req: any,
  ) {
    // If user is not App Admin, check if they're removing an AP_MANAGER role (which is forbidden)
    if (!req.user?.isAppAdmin) {
      const roles = await this.apService.getRoles(id);
      const roleToRemove = roles.find((r) => r.userId === userId);
      if (roleToRemove?.role === "AP_MANAGER") {
        throw new ForbiddenException(
          "Only Application Admins can remove AP_MANAGER role",
        );
      }
    }
    return this.apService.removeRole(id, userId);
  }

  @Get(":id/application-tokens")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "List application tokens limited to this AP" })
  async listApplicationTokens(
    @UuidParam("id") id: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.adminService.listApplicationTokens({
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      offset: offset === undefined ? undefined : Number.parseInt(offset, 10),
      allowedApId: id,
    });
  }

  @Post(":id/application-tokens")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Create an application token limited to this AP" })
  async createApplicationToken(
    @UuidParam("id") id: string,
    @Body() dto: CreateApApplicationTokenDto,
    @Request() req: any,
  ) {
    return this.adminService.createApplicationToken(
      {
        ...dto,
        allowedApIds: [id],
      },
      req?.user?.sub,
      {
        allowedApIds: [id],
        auditApId: id,
        auditPath: `/api/ap/${id}/application-tokens`,
      },
    );
  }

  @Patch(":id/application-tokens/:tokenId/revoke")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({
    summary: "Revoke an application token exclusively limited to this AP",
  })
  async revokeApplicationToken(
    @UuidParam("id") id: string,
    @UuidParam("tokenId") tokenId: string,
    @Request() req: any,
  ) {
    return this.adminService.revokeApplicationToken(tokenId, req?.user?.sub, {
      allowedApIds: [id],
      requireExclusiveAp: true,
      auditApId: id,
      auditPath: `/api/ap/${id}/application-tokens/${tokenId}/revoke`,
    });
  }

  // Access configuration
  @Get(":id/access")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Get access configuration for AP" })
  async getAccessConfig(@UuidParam("id") id: string) {
    return this.withoutReviewInternals(
      await this.apService.getAccessConfig(id),
    );
  }

  @Put(":id/access")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Update access configuration for AP" })
  async updateAccessConfig(
    @UuidParam("id") id: string,
    @Body() dto: UpdateAccessConfigDto,
    @Request() req: any,
  ) {
    if (dto.featureConfig) {
      const current = await this.apService.getAccessConfig(id);
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
      await this.apService.updateAccessConfig(id, dto),
    );
  }

  @Post(":id/access/credentials")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Upload credentials list for AP" })
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
    const result = await this.apService.uploadCredentials(
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
  @Roles("AP_MANAGER")
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
      const existing = await this.apService.getCredentials(id);
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
    return this.apService.uploadCredentials(id, entries, mode, grants);
  }

  @Get(":id/access/credentials")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Get credentials list for AP" })
  async getCredentials(@UuidParam("id") id: string) {
    return this.apService.getCredentials(id);
  }

  @Delete(":id/access/credentials/:credentialId")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Delete a credential from AP" })
  async deleteCredential(
    @UuidParam("id") id: string,
    @UuidParam("credentialId") credentialId: string,
  ) {
    await this.apService.deleteCredential(id, credentialId);
    return { message: "Credential deleted successfully" };
  }

  @Post(":id/access/credentials/single")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Create a single credential for AP" })
  async createCredential(
    @UuidParam("id") id: string,
    @Body() dto: CreateCredentialDto,
  ) {
    return this.apService.createCredential(id, dto);
  }

  @Patch(":id/access/credentials/:credentialId")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({ summary: "Update a credential" })
  async updateCredential(
    @UuidParam("id") id: string,
    @UuidParam("credentialId") credentialId: string,
    @Body() dto: UpdateCredentialDto,
  ) {
    return this.apService.updateCredential(id, credentialId, dto);
  }

  @Put(":id/metadata-columns")
  @UseGuards(RolesGuard)
  @Roles("AP_MANAGER")
  @ApiOperation({
    summary: "Update metadata column visibility and order (AP Manager only)",
  })
  async updateMetadataColumns(
    @UuidParam("id") id: string,
    @Body() dto: UpdateMetadataColumnsDto,
    @Request() req: any,
  ) {
    this.logger.log(
      `Updating metadata columns for AP ${id} by user ${req.user?.sub}`,
      {
        userRoles: req.user?.roles,
        userApRoles: req.user?.apRoles,
        dto,
      },
    );

    try {
      const result = await this.apService.updateMetadataColumns(id, dto);
      this.logger.log(`Successfully updated metadata columns for AP ${id}`);
      return this.withoutReviewInternals(result);
    } catch (error) {
      this.logger.error(
        `Failed to update metadata columns for AP ${id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @Patch(":id/item-explorer/draft")
  @UseGuards(ExplorerEditGuard)
  @ApiOperation({
    summary: "Patch Item Explorer draft state (AP Manager or Admin)",
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
