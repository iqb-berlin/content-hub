import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import { Response } from "express";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ServerApiService } from "./server-api.service";
import { ServerApiAuditService } from "./server-api-audit.service";
import { ServerApiAuthGuard } from "./server-api-auth.guard";
import { ServerApiScopes } from "./server-api-scopes.decorator";
import { ServerApiAudit } from "./server-api-audit.decorator";
import { ServerApiAuditInterceptor } from "./server-api-audit.interceptor";
import { ALL_SERVER_API_SCOPES, ServerApiScope } from "./server-api-scopes";
import { UuidParam } from "../common/uuid-param";
import {
  AuthenticatedServerApiRequest,
  ServerApiCapabilities,
} from "./server-api.types";
import { ServerApiCapabilitiesDto } from "./dto/server-api-capabilities.dto";

class ServerImportAcpDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  packageId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "ACP index payload",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  acpIndex!: Record<string, any>;

  @ApiPropertyOptional({
    description: "Optimistic concurrency check (ISO timestamp)",
  })
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}

class UpdateIndexDto {
  @ApiProperty({
    description: "ACP index payload",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  acpIndex!: Record<string, any>;

  @ApiProperty({
    description: "Optimistic concurrency check (ISO timestamp)",
  })
  @IsDateString()
  expectedUpdatedAt!: string;
}

class ReplaceCodingSchemeDto {
  @ApiPropertyOptional({
    description: "Snapshot changelog entry for the coding scheme replacement",
  })
  @IsOptional()
  @IsString()
  changelog?: string;

  @ApiPropertyOptional({
    description: "Optimistic concurrency check (ISO timestamp)",
  })
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;
}

@ApiTags("Server API")
@Controller("server")
@UseGuards(ServerApiAuthGuard)
@UseInterceptors(ServerApiAuditInterceptor)
@ApiBearerAuth()
export class ServerApiController {
  constructor(
    private readonly serverApiService: ServerApiService,
    private readonly serverApiAuditService: ServerApiAuditService,
  ) {}

  @Get("capabilities")
  @ServerApiScopes()
  @ServerApiAudit("server.capabilities.read", "server-api-client")
  @ApiOperation({
    summary: "Inspect the authenticated integration token capabilities",
  })
  @ApiOkResponse({ type: ServerApiCapabilitiesDto })
  getCapabilities(
    @Req() req: AuthenticatedServerApiRequest,
  ): ServerApiCapabilities {
    const client = req.serverApiClient;
    const grantedScopes = new Set<string>(client.scopes);
    const capabilities = Object.fromEntries(
      ALL_SERVER_API_SCOPES.map((scope) => [scope, grantedScopes.has(scope)]),
    ) as Record<ServerApiScope, boolean>;

    return {
      clientId: client.id,
      scopes: [...client.scopes],
      capabilities,
      allowedAcpIds: client.allowedAcpIds,
    };
  }

  @Get("acp")
  @ServerApiScopes("acp.read")
  @ServerApiAudit("acp.list", "acp")
  @ApiOperation({ summary: "List all ACPs for server transfer" })
  async listAcps(@Req() req?: AuthenticatedServerApiRequest) {
    return this.serverApiService.listAcps(req?.serverApiClient?.allowedAcpIds);
  }

  @Get("acp/:acpId")
  @ServerApiScopes("transfer.read")
  @ServerApiAudit("acp.transfer.read", "acp")
  @ApiOperation({ summary: "Get full ACP transfer payload (index + files)" })
  async getAcp(
    @UuidParam("acpId") acpId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getAcpTransferData(
      acpId,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Get("acp/:acpId/export")
  @ServerApiScopes("transfer.read")
  @ServerApiAudit("acp.transfer.export", "acp")
  @ApiOperation({ summary: "Export full ACP transfer payload (index + files)" })
  async exportAcp(
    @UuidParam("acpId") acpId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getAcpTransferData(
      acpId,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Get("acp/:acpId/index")
  @ServerApiScopes("index.read")
  @ServerApiAudit("acp.index.read", "acp-index")
  @ApiOperation({ summary: "Get only ACP index payload" })
  async getAcpIndex(
    @UuidParam("acpId") acpId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getAcpIndex(
      acpId,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Put("acp/:acpId/index")
  @ServerApiScopes("index.write")
  @ServerApiAudit("acp.index.write", "acp-index")
  @ApiOperation({ summary: "Update ACP index payload with conflict strategy" })
  @ApiQuery({
    name: "strategy",
    required: false,
    description: "overwrite | merge",
  })
  async updateAcpIndex(
    @UuidParam("acpId") acpId: string,
    @Body() body: UpdateIndexDto,
    @Query("strategy") strategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.updateAcpIndex(
      acpId,
      body.acpIndex,
      strategy,
      body.expectedUpdatedAt,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Get("acp/:acpId/files")
  @ServerApiScopes("files.read")
  @ServerApiAudit("acp.files.list", "file")
  @ApiOperation({ summary: "List transfer-relevant file metadata for an ACP" })
  async listFiles(
    @UuidParam("acpId") acpId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.listFiles(
      acpId,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Get("acp/:acpId/files/:fileId")
  @ServerApiScopes("files.read")
  @ServerApiAudit("acp.files.read", "file")
  @ApiOperation({ summary: "Get transfer metadata of one file" })
  async getFile(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getFile(
      acpId,
      fileId,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Get("acp/:acpId/files/:fileId/download")
  @ServerApiScopes("files.read")
  @ServerApiAudit("acp.files.download", "file")
  @ApiOperation({ summary: "Download one ACP file for transfer" })
  async downloadFile(
    @UuidParam("acpId") acpId: string,
    @UuidParam("fileId") fileId: string,
    @Res() res: Response,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    const { buffer, file } = await this.serverApiService.downloadFile(
      acpId,
      fileId,
      req?.serverApiClient?.allowedAcpIds,
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.originalName}"`,
    );
    res.setHeader("Content-Type", file.fileType || "application/octet-stream");
    res.send(buffer);
  }

  @Post("acp/:acpId/files/upload")
  @ServerApiScopes("files.write")
  @ServerApiAudit("acp.files.upload", "file")
  @ApiOperation({ summary: "Upload files to ACP for partial transfer" })
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | keep-both",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
        },
      },
      required: ["files"],
    },
  })
  @UseInterceptors(FilesInterceptor("files", 100))
  async uploadFiles(
    @UuidParam("acpId") acpId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Query("conflictStrategy") conflictStrategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.uploadFiles(
      acpId,
      files,
      conflictStrategy,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Post("acp/:acpId/coding-schemes/replace")
  @ServerApiScopes("files.write")
  @ServerApiAudit("acp.coding-schemes.replace", "file")
  @ApiOperation({
    summary:
      "Replace existing .vocs coding schemes and create a new ACP snapshot version",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
          description:
            "Existing .vocs files that should be replaced by filename",
        },
        changelog: {
          type: "string",
          description: "Optional changelog entry for the generated snapshot",
        },
        expectedUpdatedAt: {
          type: "string",
          description: "Optional optimistic concurrency timestamp (ISO)",
        },
      },
      required: ["files"],
    },
  })
  @UseInterceptors(FilesInterceptor("files", 100))
  async replaceCodingSchemes(
    @UuidParam("acpId") acpId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: ReplaceCodingSchemeDto,
    @Req() req: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.replaceCodingSchemeFiles(
      acpId,
      files,
      {
        changelog: body.changelog,
        expectedUpdatedAt: body.expectedUpdatedAt,
        sourceClientId: req?.serverApiClient?.id,
      },
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Post("acp/import")
  @ServerApiScopes("transfer.write")
  @ServerApiAudit("acp.transfer.import", "acp")
  @ApiOperation({
    summary: "Import ACP payload (create or update) with conflict strategy",
  })
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | merge",
  })
  async importAcp(
    @Body() body: ServerImportAcpDto,
    @Query("conflictStrategy") conflictStrategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.receiveAcp(
      body,
      conflictStrategy,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Post("acp")
  @ServerApiScopes("transfer.write")
  @ServerApiAudit("acp.transfer.import.legacy", "acp")
  @ApiOperation({
    summary: "Legacy import endpoint (alias for /server/acp/import)",
  })
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | merge",
  })
  async receiveAcp(
    @Body() body: ServerImportAcpDto,
    @Query("conflictStrategy") conflictStrategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.receiveAcp(
      body,
      conflictStrategy,
      req?.serverApiClient?.allowedAcpIds,
    );
  }

  @Get("audit")
  @ServerApiScopes("audit.read")
  @ServerApiAudit("server.audit.read", "audit")
  @ApiOperation({ summary: "Read server API audit logs" })
  async getAuditLogs(
    @Query("limit") limit?: string,
    @Query("action") action?: string,
    @Query("clientId") clientId?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    const parsedLimit = Number.parseInt(limit || "100", 10);
    return this.serverApiAuditService.list(
      Number.isNaN(parsedLimit) ? 100 : parsedLimit,
      action,
      clientId,
      req?.serverApiClient?.allowedAcpIds,
    );
  }
}
