import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { CommentTargetType } from "../database/entities/comment.entity";

export class ReviewCommentFilters {
  @IsOptional() @IsString() @MaxLength(500) q?: string;
  @IsOptional() @IsString() @MaxLength(200) author?: string;
  @IsOptional() @IsString() @MaxLength(100) groupId?: string;
  @IsOptional() @IsString() @MaxLength(100) categoryId?: string;
  @IsOptional() @IsEnum(CommentTargetType) targetType?: CommentTargetType;
}

export function matchesReviewFilters(
  comment: {
    commentText: string;
    targetType: string;
    groupId?: string | null;
    categoryId?: string | null;
  },
  author: string,
  filters: ReviewCommentFilters = {},
): boolean {
  return (
    (!filters.q?.trim() ||
      comment.commentText
        .toLowerCase()
        .includes(filters.q.trim().toLowerCase())) &&
    (!filters.author || author === filters.author) &&
    (!filters.targetType || comment.targetType === filters.targetType) &&
    (!filters.categoryId ||
      (filters.categoryId === "uncategorized"
        ? !comment.categoryId
        : comment.categoryId === filters.categoryId)) &&
    (!filters.groupId ||
      (filters.groupId === "ungrouped"
        ? !comment.groupId
        : comment.groupId === filters.groupId))
  );
}
