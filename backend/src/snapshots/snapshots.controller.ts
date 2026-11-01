import { Controller, Get, Post, Delete, Body, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { SnapshotsService } from "./snapshots.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CreateSnapshotDto } from "../acp/dto/acp.dto";
import { UuidParam } from "../common/uuid-param";

@ApiTags("AP Snapshots")
@Controller("acp/:acpId/snapshots")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ACP_MANAGER")
@ApiBearerAuth()
export class SnapshotsController {
  constructor(private readonly snapshotsService: SnapshotsService) {}

  @Get()
  @ApiOperation({ summary: "List all snapshots for an AP" })
  async findAll(@UuidParam("acpId") acpId: string) {
    return this.snapshotsService.findByAcp(acpId);
  }

  @Get(":snapshotId")
  @ApiOperation({ summary: "Get snapshot details" })
  async findOne(
    @UuidParam("acpId") acpId: string,
    @UuidParam("snapshotId") snapshotId: string,
  ) {
    return this.snapshotsService.findByIdInAcp(acpId, snapshotId);
  }

  @Post()
  @ApiOperation({ summary: "Create a new snapshot" })
  async create(
    @UuidParam("acpId") acpId: string,
    @Body() dto: CreateSnapshotDto,
  ) {
    return this.snapshotsService.create(acpId, dto.changelog);
  }

  @Post(":snapshotId/restore")
  @ApiOperation({ summary: "Restore AP to a snapshot" })
  async restore(
    @UuidParam("acpId") acpId: string,
    @UuidParam("snapshotId") snapshotId: string,
  ) {
    await this.snapshotsService.findByIdInAcp(acpId, snapshotId);
    return this.snapshotsService.restore(snapshotId);
  }

  @Get(":snapshotId/diff")
  @ApiOperation({ summary: "Compare snapshot with previous" })
  async diff(
    @UuidParam("acpId") acpId: string,
    @UuidParam("snapshotId") snapshotId: string,
  ) {
    await this.snapshotsService.findByIdInAcp(acpId, snapshotId);
    return this.snapshotsService.diff(snapshotId);
  }

  @Get(":snapshotId/diff/current")
  @ApiOperation({ summary: "Compare snapshot with current AP state" })
  async diffWithCurrent(
    @UuidParam("acpId") acpId: string,
    @UuidParam("snapshotId") snapshotId: string,
  ) {
    await this.snapshotsService.findByIdInAcp(acpId, snapshotId);
    return this.snapshotsService.diffWithCurrent(snapshotId);
  }

  @Delete(":snapshotId")
  @ApiOperation({ summary: "Delete snapshot" })
  async delete(
    @UuidParam("acpId") acpId: string,
    @UuidParam("snapshotId") snapshotId: string,
  ) {
    await this.snapshotsService.findByIdInAcp(acpId, snapshotId);
    await this.snapshotsService.delete(snapshotId);
    return { message: "Snapshot deleted successfully" };
  }
}
