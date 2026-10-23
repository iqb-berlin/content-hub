import { ReviewCommentFilters } from "./review-comment-filters";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ReviewSnapshotInterceptor } from "./review-snapshot.interceptor";
import { Response } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsInt,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UuidParam } from "../common/uuid-param";
import { CommentsService } from "./comments.service";
import { ReviewPolicyService } from "./review-policy.service";
import { ReviewAccessGuard } from "./review-access.guard";
import { CommentTargetType } from "../database/entities";

class CreateItemReviewCommentDto {
  @ApiProperty({ enum: CommentTargetType, required: false })
  @IsOptional()
  @IsEnum(CommentTargetType)
  targetType?: CommentTargetType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bookletId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unitId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  itemId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  commentText!: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}

class VoteDto {
  @ApiProperty({ enum: ["UP", "DOWN"] })
  @IsEnum({ UP: "UP", DOWN: "DOWN" })
  value!: "UP" | "DOWN";
}

class UpdateReviewCommentDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  commentText!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

@ApiTags("Review Comments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ReviewAccessGuard)
@UseInterceptors(ReviewSnapshotInterceptor)
@Controller("acp/:acpId/review/comments")
export class ReviewCommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly reviewPolicy: ReviewPolicyService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get the visible comment thread for one item" })
  async getItemThread(
    @UuidParam("acpId") acpId: string,
    @Query("unitId") unitId: string,
    @Query("itemId") itemId: string,
    @Request() req: any,
    @Query("targetType") rawTargetType?: string,
    @Query("bookletId") bookletId?: string,
  ) {
    const targetType = this.normalizeTargetType(rawTargetType);
    if (targetType !== CommentTargetType.ITEM) {
      return this.commentsService.getReviewThread(
        acpId,
        this.normalizeReviewTarget(targetType, bookletId, unitId, itemId),
        this.reviewPolicy.resolveActor(req),
      );
    }
    const target = this.normalizeItemTarget(unitId, itemId);
    return this.commentsService.getItemThread(
      acpId,
      target.unitId,
      target.itemId,
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Get("visible")
  async visible(@UuidParam("acpId") acpId: string, @Request() req: any) {
    const actor = this.reviewPolicy.resolveActor(req);
    return this.commentsService.findVisibleViews(acpId, actor);
  }

  @Get("export/visible.xlsx")
  async exportVisible(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
    @Res() res: Response,
    @Query() filters?: ReviewCommentFilters,
  ) {
    const buffer = await this.commentsService.exportReviewCommentsXlsx(acpId, {
      ...this.reviewPolicy.resolveActor(req),
      visible: true,
      columnPolicy: req.reviewerColumnPolicy,
      ...(filters && Object.keys(filters).length ? { filters } : {}),
    });
    await req.assertReviewerColumnPolicyCurrent?.();
    this.sendExport(
      res,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `comments-${acpId}-visible.xlsx`,
    );
  }

  @Get("counts")
  @ApiOperation({ summary: "Get visible comment counts for all ACP items" })
  async getItemCommentCounts(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
  ) {
    return this.commentsService.getItemCommentCounts(
      acpId,
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Get("export/mine.csv")
  @ApiOperation({ summary: "Export own review comments as CSV" })
  async exportMineCsv(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
    @Res() res: Response,
    @Query() filters?: ReviewCommentFilters,
  ) {
    const actor = this.reviewPolicy.resolveActor(req);
    const buffer = await this.commentsService.exportReviewCommentsCsv(acpId, {
      ...actor,
      columnPolicy: req.reviewerColumnPolicy,
      ...(filters && Object.keys(filters).length ? { filters } : {}),
    });
    await req.assertReviewerColumnPolicyCurrent?.();
    this.sendExport(
      res,
      buffer,
      "text/csv; charset=utf-8",
      `comments-${acpId}-mine.csv`,
    );
  }

  @Get("export/mine.xlsx")
  @ApiOperation({ summary: "Export own review comments as XLSX" })
  async exportMineXlsx(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
    @Res() res: Response,
    @Query() filters?: ReviewCommentFilters,
  ) {
    const actor = this.reviewPolicy.resolveActor(req);
    const buffer = await this.commentsService.exportReviewCommentsXlsx(acpId, {
      ...actor,
      columnPolicy: req.reviewerColumnPolicy,
      ...(filters && Object.keys(filters).length ? { filters } : {}),
    });
    await req.assertReviewerColumnPolicyCurrent?.();
    this.sendExport(
      res,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `comments-${acpId}-mine.xlsx`,
    );
  }

  @Get("export/all.xlsx")
  @ApiOperation({
    summary: "Export all review comments as XLSX (Manager only)",
  })
  async exportAllXlsx(
    @UuidParam("acpId") acpId: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    if (!this.reviewPolicy.isManagerRequest(req)) {
      throw new ForbiddenException("Manager access required");
    }
    const buffer = await this.commentsService.exportReviewCommentsXlsx(
      acpId,
      req.reviewerColumnPolicy?.restricted
        ? {
            visible: true,
            ...this.reviewPolicy.resolveActor(req),
            columnPolicy: req.reviewerColumnPolicy,
          }
        : undefined,
    );
    await req.assertReviewerColumnPolicyCurrent?.();
    this.sendExport(
      res,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `comments-${acpId}-all.xlsx`,
    );
  }

  @Post()
  @ApiOperation({ summary: "Create an item comment or reply" })
  async createItemComment(
    @UuidParam("acpId") acpId: string,
    @Body() dto: CreateItemReviewCommentDto,
    @Request() req: any,
  ) {
    this.reviewPolicy.assertCanParticipateRequest(req);
    const targetType = this.normalizeTargetType(dto.targetType);
    if (targetType !== CommentTargetType.ITEM) {
      return this.commentsService.createReviewComment(
        acpId,
        {
          ...this.normalizeReviewTarget(
            targetType,
            dto.bookletId,
            dto.unitId,
            dto.itemId,
          ),
          commentText: dto.commentText,
          parentCommentId: dto.parentCommentId,
          groupId: dto.groupId,
          categoryId: dto.categoryId,
        },
        this.reviewPolicy.resolveActor(req),
      );
    }
    const target = this.normalizeItemTarget(dto.unitId, dto.itemId);
    return this.commentsService.createItemComment(
      acpId,
      {
        ...target,
        commentText: dto.commentText,
        parentCommentId: dto.parentCommentId,
        groupId: dto.groupId,
        categoryId: dto.categoryId,
      },
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Put(":commentId/vote")
  async vote(
    @UuidParam("acpId") acpId: string,
    @UuidParam("commentId") commentId: string,
    @Body() dto: VoteDto,
    @Request() req: any,
  ) {
    this.reviewPolicy.assertCanParticipateRequest(req);
    return this.commentsService.setVote(
      acpId,
      commentId,
      dto.value,
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Delete(":commentId/vote")
  async removeVote(
    @UuidParam("acpId") acpId: string,
    @UuidParam("commentId") commentId: string,
    @Request() req: any,
  ) {
    this.reviewPolicy.assertCanParticipateRequest(req);
    return this.commentsService.setVote(
      acpId,
      commentId,
      null,
      this.reviewPolicy.resolveActor(req),
    );
  }

  @Patch(":commentId")
  @ApiOperation({ summary: "Update an own comment with optimistic locking" })
  async updateComment(
    @UuidParam("acpId") acpId: string,
    @UuidParam("commentId") commentId: string,
    @Body() dto: UpdateReviewCommentDto,
    @Request() req: any,
  ) {
    this.reviewPolicy.assertCanParticipateRequest(req);
    return this.commentsService.updateOwnComment(
      acpId,
      commentId,
      dto.commentText,
      dto.version,
      this.reviewPolicy.resolveActor(req),
      dto.categoryId,
    );
  }

  @Delete(":commentId")
  @ApiOperation({ summary: "Delete an own comment" })
  async deleteComment(
    @UuidParam("acpId") acpId: string,
    @UuidParam("commentId") commentId: string,
    @Query("version") rawVersion: string,
    @Request() req: any,
  ) {
    this.reviewPolicy.assertCanParticipateRequest(req);
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException("A valid comment version is required");
    }
    await this.commentsService.deleteOwnComment(
      acpId,
      commentId,
      version,
      this.reviewPolicy.resolveActor(req),
    );
    return { success: true };
  }

  private normalizeTargetType(value: unknown): CommentTargetType {
    const targetType = String(value || CommentTargetType.ITEM).trim();
    if (
      ![
        CommentTargetType.BOOKLET,
        CommentTargetType.UNIT,
        CommentTargetType.ITEM,
        CommentTargetType.CODING,
      ].includes(targetType as CommentTargetType)
    ) {
      throw new BadRequestException("Unsupported review comment target type");
    }
    return targetType as CommentTargetType;
  }

  private normalizeReviewTarget(
    targetType: CommentTargetType,
    bookletId: unknown,
    unitId: unknown,
    itemId: unknown,
  ) {
    if (targetType === CommentTargetType.BOOKLET) {
      const normalizedBookletId = String(bookletId || "").trim();
      if (!normalizedBookletId) {
        throw new BadRequestException("bookletId is required");
      }
      return { targetType, bookletId: normalizedBookletId };
    }
    if (targetType === CommentTargetType.UNIT) {
      const normalizedUnitId = String(unitId || "").trim();
      if (!normalizedUnitId) {
        throw new BadRequestException("unitId is required");
      }
      return { targetType, unitId: normalizedUnitId };
    }
    return { targetType, ...this.normalizeItemTarget(unitId, itemId) };
  }

  private normalizeItemTarget(unitId: unknown, itemId: unknown) {
    const normalizedUnitId = String(unitId || "").trim();
    const normalizedItemId = String(itemId || "").trim();
    if (!normalizedUnitId || !normalizedItemId) {
      throw new BadRequestException("unitId and itemId are required");
    }
    return { unitId: normalizedUnitId, itemId: normalizedItemId };
  }

  private sendExport(
    res: Response,
    buffer: Buffer,
    contentType: string,
    fileName: string,
  ): void {
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
