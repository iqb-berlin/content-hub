import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UuidParam } from "../common/uuid-param";
import {
  IndexGenerationOptions,
  IndexGenerationService,
} from "./index-generation.service";

class IndexGenerationOptionsDto implements IndexGenerationOptions {
  @IsOptional()
  @IsObject()
  partAssignments?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  omittedUnitPaths?: string[];
}

class ApplyIndexGenerationDto extends IndexGenerationOptionsDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  sourceRevision!: string;

  @IsDateString()
  expectedUpdatedAt!: string;
}

@ApiTags("ACP Index Generation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ACP_MANAGER")
@Controller("files/:acpId/index-generation")
export class IndexGenerationController {
  constructor(private readonly generationService: IndexGenerationService) {}

  @Post("preview")
  @ApiOperation({ summary: "Preview an ACP index generated from files" })
  preview(
    @UuidParam("acpId") acpId: string,
    @Body() options: IndexGenerationOptionsDto = {},
  ) {
    return this.generationService.preview(acpId, options || {});
  }

  @Post("apply")
  @ApiOperation({
    summary: "Apply an unchanged, snapshot-backed generation preview",
  })
  apply(
    @UuidParam("acpId") acpId: string,
    @Body() input: ApplyIndexGenerationDto,
  ) {
    return this.generationService.apply(acpId, input);
  }
}
