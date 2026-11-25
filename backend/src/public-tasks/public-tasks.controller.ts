import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UuidParam } from "../common/uuid-param";
import {
  CreatePublicTaskDto,
  PreviewPublicTaskDto,
  SetPublicTaskPublicationDto,
} from "./public-tasks.dto";
import { PublicTasksService } from "./public-tasks.service";

@ApiTags("Public tasks")
@Controller("ap/:apId/publications")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("AP_MANAGER")
export class PublicTaskManagementController {
  constructor(private readonly tasks: PublicTasksService) {}

  @Get() list(@UuidParam("apId") apId: string) {
    return this.tasks.list(apId);
  }
  @Get("units") units(@UuidParam("apId") apId: string) {
    return this.tasks.units(apId);
  }
  @Post("preview") preview(
    @UuidParam("apId") apId: string,
    @Body() dto: PreviewPublicTaskDto,
  ) {
    return this.tasks.preview(apId, dto);
  }
  @Post() create(
    @UuidParam("apId") apId: string,
    @Body() dto: CreatePublicTaskDto,
  ) {
    return this.tasks.create(apId, dto);
  }
  @Put(":publicationId") setPublished(
    @UuidParam("apId") apId: string,
    @UuidParam("publicationId") id: string,
    @Body() dto: SetPublicTaskPublicationDto,
  ) {
    return this.tasks.setPublished(apId, id, dto.published);
  }
}

@ApiTags("Public tasks")
@Controller("public-tasks")
export class PublicTasksController {
  constructor(private readonly tasks: PublicTasksService) {}

  @Get(":publicationId")
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  @ApiOperation({
    summary:
      "Read a deliberately published, immutable task snapshot without signing in",
  })
  get(@UuidParam("publicationId") id: string) {
    return this.tasks.getPublic(id);
  }
}
