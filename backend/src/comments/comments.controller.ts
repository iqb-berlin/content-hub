import { ReviewAccessGuard } from "./review-access.guard";
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Request,
  Res,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { Response } from "express";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { CommentsService } from "./comments.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CommentTargetType } from "../database/entities";
import { IsString, IsNotEmpty, IsEnum, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { UuidParam } from "../common/uuid-param";
import { ReviewPolicyService } from "./review-policy.service";

export class CreateCommentDto {
  @ApiProperty({ enum: CommentTargetType })
  @IsEnum(CommentTargetType)
  targetType!: CommentTargetType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  commentText!: string;
}

@ApiTags("Comments")
@Controller("acp/:acpId/comments")
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly reviewPolicy: ReviewPolicyService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, ReviewAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all comments for an AP (Manager only)" })
  async findAll(@UuidParam("acpId") acpId: string, @Request() req: any) {
    this.assertManagerAccess(req);
    return this.commentsService.findByAcp(acpId);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard, ReviewAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List my comments for an AP" })
  async findMine(@UuidParam("acpId") acpId: string, @Request() req: any) {
    if (req.user.type === "credential") {
      return this.commentsService.findByCredential(
        acpId,
        req.user.sub,
        this.reviewPolicy.resolveActor(req),
      );
    }
    return this.commentsService.findByUser(
      acpId,
      req.user.sub,
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, ReviewAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a comment" })
  async create(
    @UuidParam("acpId") acpId: string,
    @Body() dto: CreateCommentDto,
    @Request() req: any,
  ) {
    this.reviewPolicy.assertCanParticipateRequest(req);
    if (dto.targetId === acpId) {
      throw new BadRequestException("Comment target ID must not be the AP ID");
    }

    return this.commentsService.createLegacyCompatibleComment(
      acpId,
      {
        targetType: dto.targetType,
        targetId: dto.targetId,
        commentText: dto.commentText,
      },
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Delete()
  @UseGuards(JwtAuthGuard, ReviewAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Delete unresolved legacy task-sequence comments for an AP (Manager only)",
  })
  async deleteLegacyComments(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
  ) {
    this.assertManagerAccess(req);
    const result =
      await this.commentsService.deleteUnreferencedLegacyByAcp(acpId);
    return {
      message: `${result.deletedCount} legacy comments deleted; ${result.retainedCount} comments retained`,
      ...result,
      scope: "UNRESOLVED_LEGACY_TASK_SEQUENCE",
    };
  }

  @Get("export")
  @UseGuards(JwtAuthGuard, ReviewAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Export comments as JSON" })
  async exportComments(@UuidParam("acpId") acpId: string, @Request() req: any) {
    if (this.reviewPolicy.isManagerRequest(req)) {
      return this.commentsService.exportComments(acpId);
    }
    if (req.user.type === "credential") {
      return this.commentsService.exportCommentsByCredential(
        acpId,
        req.user.sub,
      );
    }
    return this.commentsService.exportComments(acpId, req.user.sub);
  }

  @Get("export.xlsx")
  @UseGuards(JwtAuthGuard, ReviewAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Export comments as XLSX" })
  async exportCommentsXlsx(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    let buffer: Buffer;
    let fileSuffix = "all";

    if (this.reviewPolicy.isManagerRequest(req)) {
      buffer = await this.commentsService.exportCommentsXlsx(acpId);
    } else if (req.user.type === "credential") {
      fileSuffix = req.user.username || "mine";
      buffer = await this.commentsService.exportCommentsXlsxByCredential(
        acpId,
        req.user.sub,
      );
    } else {
      fileSuffix = req.user.username || "mine";
      buffer = await this.commentsService.exportCommentsXlsx(
        acpId,
        req.user.sub,
      );
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="comments-${acpId}-${fileSuffix}.xlsx"`,
    );
    res.send(buffer);
  }

  private assertManagerAccess(req: any): void {
    if (!this.reviewPolicy.isManagerRequest(req)) {
      throw new ForbiddenException("Manager access required");
    }
  }
}
