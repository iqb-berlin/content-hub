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
import { IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";
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

class ServerImportApDto {
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
    description: "AP index payload",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  apIndex!: Record<string, any>;

  @ApiPropertyOptional({
    description: "Optimistic concurrency check (ISO timestamp)",
  })
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;
}

class UpdateIndexDto {
  @ApiProperty({
    description: "AP index payload",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  apIndex!: Record<string, any>;

  @ApiPropertyOptional({
    description: "Optimistic concurrency check (ISO timestamp)",
  })
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;
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
      allowedApIds: client.allowedApIds,
    };
  }

  @Get("ap")
  @ServerApiScopes("ap.read")
  @ServerApiAudit("ap.list", "ap")
  @ApiOperation({ summary: "List all APs for server transfer" })
  async listAps(@Req() req?: AuthenticatedServerApiRequest) {
    return this.serverApiService.listAps(req?.serverApiClient?.allowedApIds);
  }

  @Get("ap/:apId")
  @ServerApiScopes("transfer.read")
  @ServerApiAudit("ap.transfer.read", "ap")
  @ApiOperation({ summary: "Get full AP transfer payload (index + files)" })
  async getAp(
    @UuidParam("apId") apId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getApTransferData(
      apId,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Get("ap/:apId/export")
  @ServerApiScopes("transfer.read")
  @ServerApiAudit("ap.transfer.export", "ap")
  @ApiOperation({ summary: "Export full AP transfer payload (index + files)" })
  async exportAp(
    @UuidParam("apId") apId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getApTransferData(
      apId,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Get("ap/:apId/index")
  @ServerApiScopes("index.read")
  @ServerApiAudit("ap.index.read", "ap-index")
  @ApiOperation({ summary: "Get only AP index payload" })
  async getApIndex(
    @UuidParam("apId") apId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getApIndex(
      apId,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Put("ap/:apId/index")
  @ServerApiScopes("index.write")
  @ServerApiAudit("ap.index.write", "ap-index")
  @ApiOperation({ summary: "Update AP index payload with conflict strategy" })
  @ApiQuery({
    name: "strategy",
    required: false,
    description: "overwrite | merge",
  })
  async updateApIndex(
    @UuidParam("apId") apId: string,
    @Body() body: UpdateIndexDto,
    @Query("strategy") strategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.updateApIndex(
      apId,
      body.apIndex,
      strategy,
      body.expectedUpdatedAt,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Get("ap/:apId/files")
  @ServerApiScopes("files.read")
  @ServerApiAudit("ap.files.list", "file")
  @ApiOperation({ summary: "List transfer-relevant file metadata for an AP" })
  async listFiles(
    @UuidParam("apId") apId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.listFiles(
      apId,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Get("ap/:apId/files/:fileId")
  @ServerApiScopes("files.read")
  @ServerApiAudit("ap.files.read", "file")
  @ApiOperation({ summary: "Get transfer metadata of one file" })
  async getFile(
    @UuidParam("apId") apId: string,
    @UuidParam("fileId") fileId: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.getFile(
      apId,
      fileId,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Get("ap/:apId/files/:fileId/download")
  @ServerApiScopes("files.read")
  @ServerApiAudit("ap.files.download", "file")
  @ApiOperation({ summary: "Download one AP file for transfer" })
  async downloadFile(
    @UuidParam("apId") apId: string,
    @UuidParam("fileId") fileId: string,
    @Res() res: Response,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    const { buffer, file } = await this.serverApiService.downloadFile(
      apId,
      fileId,
      req?.serverApiClient?.allowedApIds,
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.originalName}"`,
    );
    res.setHeader("Content-Type", file.fileType || "application/octet-stream");
    res.send(buffer);
  }

  @Post("ap/:apId/files/upload")
  @ServerApiScopes("files.write")
  @ServerApiAudit("ap.files.upload", "file")
  @ApiOperation({ summary: "Upload files to AP for partial transfer" })
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
    @UuidParam("apId") apId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Query("conflictStrategy") conflictStrategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.uploadFiles(
      apId,
      files,
      conflictStrategy,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Post("ap/:apId/coding-schemes/replace")
  @ServerApiScopes("files.write")
  @ServerApiAudit("ap.coding-schemes.replace", "file")
  @ApiOperation({
    summary:
      "Replace existing .vocs coding schemes and create a new AP snapshot version",
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
    @UuidParam("apId") apId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: ReplaceCodingSchemeDto,
    @Req() req: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.replaceCodingSchemeFiles(
      apId,
      files,
      {
        changelog: body.changelog,
        expectedUpdatedAt: body.expectedUpdatedAt,
        sourceClientId: req?.serverApiClient?.id,
      },
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Post("ap/import")
  @ServerApiScopes("transfer.write")
  @ServerApiAudit("ap.transfer.import", "ap")
  @ApiOperation({
    summary: "Import AP payload (create or update) with conflict strategy",
  })
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | merge",
  })
  async importAp(
    @Body() body: ServerImportApDto,
    @Query("conflictStrategy") conflictStrategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.receiveAp(
      body,
      conflictStrategy,
      req?.serverApiClient?.allowedApIds,
    );
  }

  @Post("ap")
  @ServerApiScopes("transfer.write")
  @ServerApiAudit("ap.transfer.import.legacy", "ap")
  @ApiOperation({
    summary: "Legacy import endpoint (alias for /server/ap/import)",
  })
  @ApiQuery({
    name: "conflictStrategy",
    required: false,
    description: "reject | overwrite | merge",
  })
  async receiveAp(
    @Body() body: ServerImportApDto,
    @Query("conflictStrategy") conflictStrategy?: string,
    @Req() req?: AuthenticatedServerApiRequest,
  ) {
    return this.serverApiService.receiveAp(
      body,
      conflictStrategy,
      req?.serverApiClient?.allowedApIds,
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
      req?.serverApiClient?.allowedApIds,
    );
  }
}
