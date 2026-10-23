import {
  ReviewCommentFilters,
  matchesReviewFilters,
} from "./review-comment-filters";
import { CommentCategory } from "../database/entities/acp-access-config.entity";
import { ReviewerColumnPolicy } from "../item-explorer/reviewer-column-policy";
import { commentAuthorName } from "./comment-author-name";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  Repository,
} from "typeorm";
import { createHash } from "crypto";
import {
  Acp,
  AcpAccessConfig,
  Comment,
  CommentTargetType,
} from "../database/entities";
import { UnitParserService } from "../files/unit-parser.service";
import { FileCatalogCache } from "../files/file-catalog.cache";
import { getAssessmentParts, getIndexUnits } from "../acp/acp-index.utils";
import { extractLabelText } from "../files/unit-file-parsing";
import { ReviewManifestService } from "../review/review-manifest.service";
import {
  CommentActor,
  CommentVisibilityMode,
  ReviewPolicyService,
} from "./review-policy.service";

export { CommentActor, CommentVisibilityMode } from "./review-policy.service";

export interface CommentVoteState {
  upvotes: number;
  downvotes: number;
  myVote: "UP" | "DOWN" | null;
  canVote: boolean;
}

export interface CommentView extends CommentVoteState {
  id: string;
  acpId: string;
  targetType: CommentTargetType;
  targetId: string;
  bookletId: string | null;
  unitId: string | null;
  itemId: string | null;
  parentCommentId: string | null;
  parentVisible: boolean;
  groupId: string | null;
  groupName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  commentText: string;
  authorLabel: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  isOwn: boolean;
  isDeleted: boolean;
  legacyReadOnly: boolean;
}

export interface CommentThreadSnapshot {
  target: ReviewCommentTarget;
  revision: string;
  visibilityMode: CommentVisibilityMode;
  comments: CommentView[];
  groups: { id: string; name: string; archived: boolean }[];
  defaultGroupId: string | null;
  categories: CommentCategory[];
}

export interface ItemCommentCount {
  unitId: string;
  itemId: string;
  count: number;
  codingCount: number;
}

export interface ItemCommentCountsSnapshot {
  revision: string;
  counts: ItemCommentCount[];
}

export interface ReviewCommentExportActor {
  filters?: ReviewCommentFilters;
  columnPolicy?: ReviewerColumnPolicy;
  visible?: boolean;
  isManager?: boolean;
  authorLabel?: string;
  userId?: string;
  credentialId?: string;
}

export interface ReviewCommentTarget {
  targetType: CommentTargetType;
  bookletId?: string;
  unitId?: string;
  itemId?: string;
}

interface ResolvedReviewCommentTarget extends ReviewCommentTarget {
  targetId: string;
  legacyTargetIds: string[];
}

interface ItemTargetResolution {
  unitId: string;
  itemId: string;
  legacyTargetIds: string[];
}

interface ItemCatalogEntry {
  unitId: string;
  itemId: string;
  unitLabel: string;
  itemLabel: string;
  unitOrder: number;
  itemOrder: number;
}

interface ReviewBookletCatalogEntry {
  bookletId: string;
  bookletLabel: string;
  bookletOrder: number;
}

interface ReviewUnitCatalogEntry {
  unitId: string;
  unitLabel: string;
  unitOrder: number;
}

interface ReviewExportTarget {
  level: string;
  levelOrder: number;
  bookletId: string;
  bookletLabel: string;
  bookletOrder: number;
  unitId: string;
  unitLabel: string;
  unitOrder: number;
  itemId: string;
  itemLabel: string;
  itemOrder: number;
}

@Injectable()
export class CommentsService {
  private inTransaction = false;
  private transactionManager?: EntityManager;

  private async transaction<T>(
    acpId: string,
    operation: (service: CommentsService) => Promise<T>,
  ): Promise<T> {
    return this.commentRepository.manager.transaction(async (manager) => {
      await manager.findOne(AcpAccessConfig, {
        where: { acpId },
        lock: { mode: "pessimistic_write" },
      });
      const scoped = new CommentsService(
        manager.getRepository(Comment),
        new ReviewPolicyService(manager.getRepository(AcpAccessConfig)),
        this.unitParserService,
        this.fileCatalogCache,
        manager.getRepository(Acp),
        this.reviewManifestService,
      );
      scoped.inTransaction = true;
      scoped.transactionManager = manager;

      return operation(scoped);
    });
  }

  private readonly itemCatalogCache = new Map<
    string,
    Promise<ItemCatalogEntry[]>
  >();
  private readonly maxItemCatalogCacheEntries = 100;

  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    private readonly reviewPolicy: ReviewPolicyService,
    private readonly unitParserService: UnitParserService,
    private readonly fileCatalogCache: FileCatalogCache,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    private readonly reviewManifestService: ReviewManifestService,
  ) {}

  async findVisible(acpId: string, actor: CommentActor): Promise<Comment[]> {
    const mode = await this.reviewPolicy.prepareVisibility(acpId, actor);
    const comments = await this.findByAcp(acpId);
    return comments.filter((comment) =>
      this.reviewPolicy.canViewComment(mode, actor, comment),
    );
  }

  async findVisibleViews(
    acpId: string,
    actor: CommentActor,
  ): Promise<CommentView[]> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.findVisibleViews(acpId, actor),
      );
    const comments = await this.findVisible(acpId, actor);
    const votes = await this.getVoteStates(acpId, comments, actor);
    const ids = new Set(comments.map((comment) => comment.id));
    return comments.map((comment) => ({
      ...this.toCommentView(comment, actor, ids),
      ...votes.get(comment.id),
    }));
  }

  async findByAcp(acpId: string): Promise<Comment[]> {
    return this.commentRepository.find({
      where: { acpId, deletedAt: IsNull() },
      relations: ["user"],
      order: { createdAt: "DESC" },
    });
  }

  async findByUser(
    acpId: string,
    userId: string,
    requestActor?: CommentActor,
  ): Promise<Comment[]> {
    const actor: CommentActor = requestActor || {
      userId,
      isManager: false,
      authorLabel: "",
    };
    const mode = await this.reviewPolicy.prepareVisibility(acpId, actor);
    const comments = await this.commentRepository.find({
      where: { acpId, userId, deletedAt: IsNull() },
      relations: ["user"],
      order: { createdAt: "DESC" },
    });
    return comments.filter(
      (comment) =>
        mode !== "GROUP" ||
        this.reviewPolicy.canViewComment(mode, actor, comment),
    );
  }

  async findByCredential(
    acpId: string,
    credentialId: string,
    requestActor?: CommentActor,
  ): Promise<Comment[]> {
    const actor: CommentActor = requestActor || {
      credentialId,
      isManager: false,
      authorLabel: "",
    };
    const mode = await this.reviewPolicy.prepareVisibility(acpId, actor);
    const comments = await this.commentRepository.find({
      where: { acpId, credentialId, deletedAt: IsNull() },
      relations: ["user"],
      order: { createdAt: "DESC" },
    });
    return comments.filter(
      (comment) =>
        mode !== "GROUP" ||
        this.reviewPolicy.canViewComment(mode, actor, comment),
    );
  }

  async create(data: {
    acpId: string;
    userId?: string;
    credentialId?: string;
    credentialUsername?: string;
    authorLabel?: string;
    targetType: CommentTargetType;
    targetId: string;
    bookletId?: string;
    unitId?: string;
    itemId?: string;
    parentCommentId?: string;
    groupId?: string;
    categoryId?: string | null;
    commentText: string;
  }): Promise<Comment> {
    const commentText = this.normalizeCommentText(data.commentText);
    const comment = this.commentRepository.create({
      ...data,
      commentText,
      version: 1,
    });
    return this.commentRepository.save(comment);
  }

  async getItemThread(
    acpId: string,
    unitId: string,
    itemId: string,
    actor: CommentActor,
  ): Promise<CommentThreadSnapshot> {
    return this.getReviewThread(
      acpId,
      { targetType: CommentTargetType.ITEM, unitId, itemId },
      actor,
    );
  }

  async getReviewThread(
    acpId: string,
    input: ReviewCommentTarget,
    actor: CommentActor,
  ): Promise<CommentThreadSnapshot> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.getReviewThread(acpId, input, actor),
      );
    const visibilityMode = await this.reviewPolicy.assertCommentAccess(
      acpId,
      actor,
      input.targetType,
    );
    const target = await this.resolveReviewTarget(acpId, input);
    const comments = await this.commentRepository.find({
      where: this.threadWhere(acpId, target),
      relations: ["user"],
      order: { createdAt: "ASC" },
    });

    const visibleComments = comments.filter(
      (comment) =>
        !comment.deletedAt &&
        this.reviewPolicy.canViewComment(visibilityMode, actor, comment),
    );
    const requiredDeletedParentIds = new Set(
      visibleComments
        .map((comment) => comment.parentCommentId)
        .filter((id): id is string => Boolean(id)),
    );
    const deletedParents = comments.filter(
      (comment) =>
        Boolean(comment.deletedAt) &&
        requiredDeletedParentIds.has(comment.id) &&
        (visibilityMode !== "GROUP" ||
          this.reviewPolicy.canViewComment(visibilityMode, actor, comment)),
    );
    const responseComments = [...visibleComments, ...deletedParents].sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
    const responseIds = new Set(responseComments.map((comment) => comment.id));
    const defaultGroupId =
      visibilityMode === "GROUP" &&
      !actor.isManager &&
      actor.groups?.length === 1 &&
      !actor.groups[0].archived
        ? actor.groups[0].id
        : null;

    const votes = await this.getVoteStates(acpId, responseComments, actor);
    const views = responseComments.map((comment) => ({
      ...this.toCommentView(comment, actor, responseIds),
      ...votes.get(comment.id),
    }));
    return {
      target: {
        targetType: target.targetType,
        ...(target.bookletId ? { bookletId: target.bookletId } : {}),
        ...(target.unitId ? { unitId: target.unitId } : {}),
        ...(target.itemId ? { itemId: target.itemId } : {}),
      },
      revision: createHash("sha256")
        .update(
          JSON.stringify([
            visibilityMode,
            defaultGroupId,
            actor.categories || [],
            views,
            (actor.groups || []).map(({ id, name, archived }) => ({
              id,
              name,
              archived,
            })),
          ]),
        )
        .digest("hex"),
      visibilityMode,
      defaultGroupId,
      groups: (actor.groups || []).map(({ id, name, archived }) => ({
        id,
        name,
        archived,
      })),
      comments: views,
      categories: actor.categories || [],
    };
  }

  private async getVoteStates(
    acpId: string,
    comments: Comment[],
    actor: CommentActor,
  ): Promise<Map<string, CommentVoteState>> {
    const mode = await this.reviewPolicy.prepareVisibility(acpId, actor);
    const states = new Map<string, CommentVoteState>(
      comments.map((comment) => [
        comment.id,
        { upvotes: 0, downvotes: 0, myVote: null, canVote: false },
      ]),
    );
    const visible = comments.filter(
      (comment) =>
        !comment.deletedAt &&
        comment.acpId === acpId &&
        this.reviewPolicy.canViewComment(mode, actor, comment),
    );
    if (mode !== "SHARED" || !visible.length) return states;
    const rows = await this.commentRepository.query(
      `SELECT comment_id,
      COUNT(*) FILTER (WHERE value = 'UP')::int AS upvotes,
      COUNT(*) FILTER (WHERE value = 'DOWN')::int AS downvotes,
      MAX(value) FILTER (WHERE user_id = $2::uuid OR credential_id = $3::uuid) AS my_vote
      FROM comment_votes WHERE comment_id = ANY($1::uuid[]) GROUP BY comment_id`,
      [
        visible.map((comment) => comment.id),
        actor.userId || null,
        actor.credentialId || null,
      ],
    );
    const byId = new Map<
      string,
      { upvotes: number; downvotes: number; my_vote: "UP" | "DOWN" | null }
    >(rows.map((row: any) => [row.comment_id, row]));
    for (const comment of visible) {
      const row = byId.get(comment.id);
      states.set(comment.id, {
        upvotes: row?.upvotes || 0,
        downvotes: row?.downvotes || 0,
        myVote: row?.my_vote || null,
        canVote: this.reviewPolicy.canVote(actor, comment),
      });
    }
    return states;
  }

  async setVote(
    acpId: string,
    commentId: string,
    value: "UP" | "DOWN" | null,
    actor: CommentActor,
  ): Promise<CommentVoteState> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.setVote(acpId, commentId, value, actor),
      );
    const mode = await this.reviewPolicy.prepareVisibility(acpId, actor);
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, acpId },
    });
    if (
      !comment ||
      comment.deletedAt ||
      !this.reviewPolicy.canViewComment(mode, actor, comment)
    )
      throw new NotFoundException("Comment not found");
    if (!this.reviewPolicy.canVote(actor, comment))
      throw new ForbiddenException(
        "Nur fremde Kommentare im aktiven geteilten Review können bewertet werden",
      );
    await this.reviewPolicy.assertCommentAccess(
      acpId,
      actor,
      comment.targetType,
    );
    await this.assertStoredTargetExists(acpId, comment);
    if (value !== null && value !== "UP" && value !== "DOWN")
      throw new BadRequestException("Vote must be UP or DOWN");
    const column = actor.userId ? "user_id" : "credential_id";
    const identity = actor.userId || actor.credentialId;
    if (value === null) {
      await this.commentRepository.query(
        `DELETE FROM comment_votes WHERE comment_id = $1 AND ${column} = $2`,
        [commentId, identity],
      );
    } else {
      await this.commentRepository.query(
        `INSERT INTO comment_votes (comment_id, ${column}, value) VALUES ($1, $2, $3)
        ON CONFLICT (comment_id, ${column}) WHERE ${column} IS NOT NULL
        DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE comment_votes.value IS DISTINCT FROM EXCLUDED.value`,
        [commentId, identity, value],
      );
    }
    return (await this.getVoteStates(acpId, [comment], actor)).get(commentId)!;
  }

  async getItemCommentCounts(
    acpId: string,
    actor: CommentActor,
  ): Promise<ItemCommentCountsSnapshot> {
    const { visibilityMode, targetTypes } =
      await this.reviewPolicy.assertItemAndCodingCountAccess(acpId, actor);
    const commentWhere: FindOptionsWhere<Comment>[] = targetTypes.map(
      (targetType) => ({
        acpId,
        targetType,
        deletedAt: IsNull(),
        ...(visibilityMode === "PRIVATE" && !actor.isManager
          ? actor.userId
            ? { userId: actor.userId }
            : { credentialId: actor.credentialId }
          : {}),
      }),
    );
    const [comments, catalog] = await Promise.all([
      this.commentRepository.find({
        where: commentWhere,
      }),
      this.getItemCatalog(acpId),
    ]);
    const catalogByKey = new Map(
      catalog.map((entry) => [
        this.itemCatalogKey(entry.unitId, entry.itemId),
        entry,
      ]),
    );
    const legacyTargets = this.buildLegacyItemTargets(catalog);

    const counts = new Map<string, number>();
    const codingCounts = new Map<string, number>();
    for (const comment of comments) {
      if (!this.reviewPolicy.canViewComment(visibilityMode, actor, comment)) {
        continue;
      }
      let key =
        comment.unitId && comment.itemId
          ? this.itemCatalogKey(comment.unitId, comment.itemId)
          : "";
      if (!key && comment.unitId == null) {
        const target = legacyTargets.get(comment.targetId);
        key = target ? this.itemCatalogKey(target.unitId, target.itemId) : "";
      }
      if (!key || !catalogByKey.has(key)) continue;
      const targetCounts =
        comment.targetType === CommentTargetType.CODING ? codingCounts : counts;
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    }

    // Zero counts retain the complete canonical catalog for client-side alias resolution.
    const result = catalog
      .map((entry) => ({
        unitId: entry.unitId,
        itemId: entry.itemId,
        count: counts.get(this.itemCatalogKey(entry.unitId, entry.itemId)) || 0,
        codingCount:
          codingCounts.get(this.itemCatalogKey(entry.unitId, entry.itemId)) ||
          0,
      }))
      .sort(
        (left, right) =>
          left.unitId.localeCompare(right.unitId, undefined, {
            numeric: true,
          }) ||
          left.itemId.localeCompare(right.itemId, undefined, { numeric: true }),
      );
    return {
      revision: createHash("sha256")
        .update(JSON.stringify([visibilityMode, result]))
        .digest("hex"),
      counts: result,
    };
  }

  async createItemComment(
    acpId: string,
    input: {
      unitId: string;
      itemId: string;
      commentText: string;
      parentCommentId?: string;
      groupId?: string;
      categoryId?: string | null;
    },
    actor: CommentActor,
  ): Promise<CommentView> {
    return this.createReviewComment(
      acpId,
      { ...input, targetType: CommentTargetType.ITEM },
      actor,
    );
  }

  async createReviewComment(
    acpId: string,
    input: ReviewCommentTarget & {
      commentText: string;
      parentCommentId?: string;
      groupId?: string;
      categoryId?: string | null;
    },
    actor: CommentActor,
  ): Promise<CommentView> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.createReviewComment(acpId, input, actor),
      );
    const visibilityMode = await this.reviewPolicy.assertCommentAccess(
      acpId,
      actor,
      input.targetType,
    );
    const target = await this.resolveReviewTarget(acpId, input);

    let parentCommentId: string | undefined;
    let groupId: string | undefined;
    if (input.parentCommentId) {
      const parent = await this.commentRepository.findOne({
        where: { id: input.parentCommentId, acpId },
      });
      if (!parent || parent.deletedAt || !this.matchesTarget(parent, target)) {
        throw new NotFoundException("Reply target not found for this context");
      }
      this.reviewPolicy.assertCanReply(visibilityMode, actor, parent);
      parentCommentId = parent.parentCommentId || parent.id;
      groupId = parent.groupId || undefined;
      if (input.groupId && input.groupId !== groupId)
        throw new BadRequestException("Antworten behalten die Thread-Gruppe");
      if (
        groupId &&
        actor.groups?.some((group) => group.id === groupId && group.archived)
      )
        throw new BadRequestException("Diese Review-Gruppe ist archiviert");
    }

    if (!parentCommentId)
      groupId = this.reviewPolicy.selectGroup(
        visibilityMode,
        actor,
        input.groupId,
      );

    const categoryId = this.reviewPolicy.selectCategory(
      actor,
      input.categoryId,
    );
    const comment = await this.create({
      categoryId,
      groupId,
      acpId,
      userId: actor.userId,
      credentialId: actor.credentialId,
      credentialUsername: actor.credentialUsername,
      authorLabel: actor.authorLabel,
      targetType: target.targetType,
      targetId: target.targetId,
      bookletId: target.bookletId,
      unitId: target.unitId,
      itemId: target.itemId,
      parentCommentId,
      commentText: input.commentText,
    });
    return this.toCommentView(comment, actor, new Set([comment.id]));
  }

  async createLegacyCompatibleComment(
    acpId: string,
    input: {
      targetType: CommentTargetType;
      targetId: string;
      commentText: string;
    },
    actor: CommentActor,
  ): Promise<CommentView> {
    if (input.targetType === CommentTargetType.TASK_SEQUENCE) {
      throw new BadRequestException(
        "TASK_SEQUENCE is read-only; use a canonical BOOKLET target",
      );
    }
    if (input.targetType === CommentTargetType.BOOKLET) {
      return this.createReviewComment(
        acpId,
        {
          targetType: input.targetType,
          bookletId: input.targetId,
          commentText: input.commentText,
        },
        actor,
      );
    }
    if (input.targetType === CommentTargetType.UNIT) {
      return this.createReviewComment(
        acpId,
        {
          targetType: input.targetType,
          unitId: input.targetId,
          commentText: input.commentText,
        },
        actor,
      );
    }
    if (input.targetType === CommentTargetType.CODING) {
      throw new BadRequestException(
        "CODING comments require unitId and itemId on the review API",
      );
    }
    const catalog = await this.getItemCatalog(acpId);
    const candidates = catalog.filter(
      (entry) =>
        entry.itemId === input.targetId ||
        this.legacyItemTargetId(entry.unitId, entry.itemId) === input.targetId,
    );
    if (candidates.length !== 1) {
      throw new BadRequestException(
        candidates.length
          ? "Item target is ambiguous; unitId is required"
          : "Item not found in this ACP",
      );
    }
    return this.createReviewComment(
      acpId,
      {
        targetType: CommentTargetType.ITEM,
        unitId: candidates[0].unitId,
        itemId: candidates[0].itemId,
        commentText: input.commentText,
      },
      actor,
    );
  }

  async updateOwnComment(
    acpId: string,
    commentId: string,
    commentText: string,
    version: number,
    actor: CommentActor,
    categoryId?: string | null,
  ): Promise<CommentView> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.updateOwnComment(
          acpId,
          commentId,
          commentText,
          version,
          actor,
          categoryId,
        ),
      );
    const current = await this.findMutableComment(acpId, commentId, actor);
    await this.reviewPolicy.assertCommentAccess(
      acpId,
      actor,
      current.targetType,
    );
    const normalizedCommentText = this.normalizeCommentText(commentText);
    if (current.version !== version) {
      throw await this.versionConflict(current, actor);
    }
    await this.assertStoredTargetExists(acpId, current);

    const selectedCategoryId = this.reviewPolicy.selectCategory(
      actor,
      categoryId,
      current.categoryId,
    );
    const updatedAt = new Date();
    const result = await this.commentRepository.update(
      { id: commentId, acpId, version, deletedAt: IsNull() },
      {
        categoryId: selectedCategoryId,
        commentText: normalizedCommentText,
        updatedAt,
        version: version + 1,
      },
    );
    if (!result.affected) {
      const latest = await this.commentRepository.findOne({
        where: { id: commentId, acpId },
        relations: ["user"],
      });
      if (!latest) throw new NotFoundException("Comment not found");
      throw await this.versionConflict(latest, actor);
    }

    const votes = await this.getVoteStates(acpId, [current], actor);
    return {
      ...this.toCommentView(
        {
          ...current,
          categoryId: selectedCategoryId,
          commentText: normalizedCommentText,
          updatedAt,
          version: version + 1,
        },
        actor,
        new Set([commentId]),
      ),
      ...votes.get(commentId),
    };
  }

  async deleteOwnComment(
    acpId: string,
    commentId: string,
    version: number,
    actor: CommentActor,
  ): Promise<void> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.deleteOwnComment(acpId, commentId, version, actor),
      );
    const current = await this.findMutableComment(acpId, commentId, actor);
    await this.reviewPolicy.assertCommentAccess(
      acpId,
      actor,
      current.targetType,
    );
    if (current.version !== version) {
      throw await this.versionConflict(current, actor);
    }
    await this.assertStoredTargetExists(acpId, current);
    const result = await this.commentRepository.update(
      { id: commentId, acpId, version, deletedAt: IsNull() },
      {
        commentText: "",
        deletedAt: new Date(),
        updatedAt: new Date(),
        version: version + 1,
      },
    );
    if (!result.affected) {
      const latest = await this.commentRepository.findOne({
        where: { id: commentId, acpId },
      });
      if (!latest) throw new NotFoundException("Comment not found");
      throw await this.versionConflict(latest, actor);
    }
  }

  async deleteUnreferencedLegacyByAcp(
    acpId: string,
  ): Promise<{ deletedCount: number; retainedCount: number }> {
    const result = await this.commentRepository
      .createQueryBuilder()
      .delete()
      .from(Comment)
      .where('"acp_id" = :acpId', { acpId })
      .andWhere('"target_type" = :legacyTargetType', {
        legacyTargetType: CommentTargetType.TASK_SEQUENCE,
      })
      .andWhere('"legacy_read_only" = true')
      .andWhere('"parent_comment_id" IS NULL')
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM "comments" child WHERE child."parent_comment_id" = "comments"."id")',
      )
      .execute();
    const retainedCount = await this.commentRepository.count({
      where: { acpId },
    });
    return {
      deletedCount: result.affected || 0,
      retainedCount,
    };
  }

  async exportComments(acpId: string, userId?: string): Promise<any[]> {
    const { comments, categories } = await this.getExportSnapshot(
      acpId,
      userId ? { userId, isManager: false, authorLabel: "" } : undefined,
    );
    return comments.map((comment) =>
      this.toExportRow(comment, false, categories),
    );
  }

  async exportCommentsByCredential(
    acpId: string,
    credentialId: string,
  ): Promise<any[]> {
    const { comments, categories } = await this.getExportSnapshot(acpId, {
      credentialId,
      isManager: false,
      authorLabel: "",
    });
    return comments.map((comment) =>
      this.toExportRow(comment, true, categories),
    );
  }

  private async getExportSnapshot(
    acpId: string,
    actor?: CommentActor & { visible?: boolean },
  ): Promise<{ comments: Comment[]; categories: CommentCategory[] }> {
    if (!this.inTransaction)
      return this.transaction(acpId, (service) =>
        service.getExportSnapshot(acpId, actor),
      );
    // Keep labels and assignments from the same state while category writes
    // wait on the shared ACP lock. Release it before catalog/file rendering.
    const comments = actor?.visible
      ? await this.findVisible(acpId, actor)
      : actor?.credentialId
        ? await this.findByCredential(acpId, actor.credentialId, actor)
        : actor?.userId
          ? await this.findByUser(acpId, actor.userId, actor)
          : await this.findByAcp(acpId);
    const categories = await this.reviewPolicy.getCommentCategories(acpId);
    return { comments, categories };
  }

  async exportCommentsXlsx(acpId: string, userId?: string): Promise<Buffer> {
    const data = await this.exportComments(acpId, userId);
    return this.buildXlsxBuffer(data);
  }

  async exportCommentsXlsxByCredential(
    acpId: string,
    credentialId: string,
  ): Promise<Buffer> {
    const data = await this.exportCommentsByCredential(acpId, credentialId);
    return this.buildXlsxBuffer(data);
  }

  async exportReviewCommentsCsv(
    acpId: string,
    actor: ReviewCommentExportActor,
  ): Promise<Buffer> {
    const data = await this.getReviewExportRows(acpId, actor);
    const headers = this.reviewExportHeaders(false, actor.columnPolicy);
    const lines = [
      headers.map((header) => this.quoteCsvField(header.label)).join(";"),
      ...data.map((row) =>
        headers.map((header) => this.quoteCsvField(row[header.key])).join(";"),
      ),
    ];
    return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
  }

  async exportReviewCommentsXlsx(
    acpId: string,
    actor?: ReviewCommentExportActor,
  ): Promise<Buffer> {
    const data = await this.getReviewExportRows(acpId, actor);
    return this.buildReviewXlsxBuffer(
      data,
      !actor || actor.visible === true,
      actor?.columnPolicy,
    );
  }

  private toExportRow(
    comment: Comment,
    preferCredential = false,
    categories: CommentCategory[] = [],
  ): Record<string, unknown> {
    return {
      groupId: comment.groupId || "",
      targetType: comment.targetType,
      targetId: comment.targetId,
      unitId: comment.unitId || "",
      itemId: comment.itemId || "",
      threadId: comment.parentCommentId || comment.id,
      parentCommentId: comment.parentCommentId || "",
      categoryId: comment.categoryId || "",
      category:
        categories.find((category) => category.id === comment.categoryId)
          ?.name || "",
      comment: comment.commentText,
      author: preferCredential
        ? commentAuthorName(
            comment.authorLabel,
            comment.credential?.username,
            comment.credentialUsername,
          ) || this.resolveAuthorLabel(comment)
        : this.resolveAuthorLabel(comment),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: (comment.updatedAt || comment.createdAt).toISOString(),
    };
  }

  private async buildXlsxBuffer(data: any[]): Promise<Buffer> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "IQB ContentPool";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Kommentare");
    sheet.columns = [
      { header: "Review-Gruppe (ID)", key: "groupId", width: 38 },
      { header: "Zieltyp", key: "targetType", width: 18 },
      { header: "Ziel-ID", key: "targetId", width: 25 },
      { header: "Unit-ID", key: "unitId", width: 22 },
      { header: "Item-ID", key: "itemId", width: 22 },
      { header: "Thread-ID", key: "threadId", width: 38 },
      { header: "Antwort auf", key: "parentCommentId", width: 38 },
      { header: "Kategorie (ID)", key: "categoryId", width: 38 },
      { header: "Kategorie", key: "category", width: 24 },
      { header: "Kommentar", key: "comment", width: 50 },
      { header: "Autor", key: "author", width: 20 },
      { header: "Erstellt", key: "createdAt", width: 22 },
      { header: "Geändert", key: "updatedAt", width: 22 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A5276" },
    };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    for (const row of data) sheet.addRow(row);
    sheet.getColumn("comment").alignment = {
      vertical: "top",
      wrapText: true,
    };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async getReviewExportRows(
    acpId: string,
    actor?: ReviewCommentExportActor,
  ): Promise<Array<Record<string, string>>> {
    if (actor && !actor.userId && !actor.credentialId) {
      throw new ForbiddenException("A stable review identity is required");
    }
    const requestActor = actor
      ? {
          ...actor,
          isManager: actor.isManager === true,
          authorLabel: actor.authorLabel || "",
        }
      : undefined;
    const [{ comments, categories }, itemCatalog, acp, manifest] =
      await Promise.all([
        this.getExportSnapshot(acpId, requestActor),
        this.getItemCatalog(acpId),
        this.acpRepository.findOne({ where: { id: acpId } }),
        this.reviewManifestService.getManifest(acpId, this.transactionManager),
      ]);
    const bookletCatalog = this.buildReviewBookletCatalog(acp?.acpIndex);
    manifest.booklets.forEach((booklet, bookletOrder) => {
      bookletCatalog.set(booklet.id, {
        bookletId: booklet.id,
        bookletLabel: booklet.name || booklet.id,
        bookletOrder,
      });
    });
    const unitCatalog = this.buildReviewUnitCatalog(acp?.acpIndex, itemCatalog);
    // ACP-wide targets occur only once, ordered by their first booklet use.
    const orderedUnitIds = new Set<string>();
    for (const booklet of manifest.booklets) {
      for (const unit of booklet.units) orderedUnitIds.add(unit.id);
    }
    for (const unitId of unitCatalog.keys()) orderedUnitIds.add(unitId);
    let unitOrder = 0;
    for (const unitId of orderedUnitIds) {
      const unit = unitCatalog.get(unitId);
      if (unit) unit.unitOrder = unitOrder++;
    }
    const resolved = comments
      .filter((comment) =>
        matchesReviewFilters(
          comment,
          this.resolveAuthorLabel(comment),
          actor?.filters,
        ),
      )
      .map((comment) => ({
        comment,
        target: this.resolveReviewExportTarget(
          comment,
          itemCatalog,
          bookletCatalog,
          unitCatalog,
        ),
      }));
    const sorted = resolved.sort((left, right) => {
      return (
        Number(Boolean(left.comment.legacyReadOnly)) -
          Number(Boolean(right.comment.legacyReadOnly)) ||
        left.target.levelOrder - right.target.levelOrder ||
        left.target.bookletOrder - right.target.bookletOrder ||
        left.target.unitOrder - right.target.unitOrder ||
        left.target.itemOrder - right.target.itemOrder ||
        left.comment.createdAt.getTime() - right.comment.createdAt.getTime() ||
        left.comment.id.localeCompare(right.comment.id)
      );
    });
    const visibleIds = new Set(comments.map((comment) => comment.id));
    const missingParentIds = [
      ...new Set(
        comments
          .map((comment) => comment.parentCommentId)
          .filter(
            (id): id is string => typeof id === "string" && !visibleIds.has(id),
          ),
      ),
    ];
    if (missingParentIds.length) {
      // Personal exports omit foreign roots; all exports omit deleted roots.
      // Resolve references separately without exporting their text or authors.
      const parents = await this.commentRepository.find({
        where: { acpId, id: In(missingParentIds) },
        select: ["id", "userId", "credentialId", "groupId", "deletedAt"],
      });
      const mode = requestActor
        ? await this.reviewPolicy.prepareVisibility(acpId, requestActor)
        : "SHARED";
      for (const parent of parents) {
        if (
          !requestActor ||
          this.reviewPolicy.canViewComment(mode, requestActor, parent) ||
          // Match the neutral tombstones exposed by the thread endpoint.
          (parent.deletedAt && mode !== "GROUP")
        )
          visibleIds.add(parent.id);
      }
    }
    return sorted.map(({ comment, target }) => ({
      groupId: comment.groupId || "",
      level: target.level,
      bookletId: target.bookletId,
      bookletLabel: target.bookletLabel,
      unitId: target.unitId,
      unitLabel: target.unitLabel,
      itemId: target.itemId,
      itemLabel: target.itemLabel,
      threadId:
        comment.parentCommentId && visibleIds.has(comment.parentCommentId)
          ? comment.parentCommentId
          : comment.id,
      parentCommentId:
        comment.parentCommentId && visibleIds.has(comment.parentCommentId)
          ? comment.parentCommentId
          : "",
      categoryId: comment.categoryId || "",
      category:
        categories.find((category) => category.id === comment.categoryId)
          ?.name || "",
      comment: comment.commentText,
      author: this.resolveAuthorLabel(comment),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: (comment.updatedAt || comment.createdAt).toISOString(),
      legacyReadOnly: comment.legacyReadOnly ? "Ja" : "Nein",
    }));
  }

  private reviewExportHeaders(
    includeAuthor: boolean,
    policy?: ReviewerColumnPolicy,
  ) {
    const headers = [
      { key: "groupId", label: "Review-Gruppe (ID)", width: 38 },
      { key: "level", label: "Ebene", width: 18 },
      { key: "bookletId", label: "Booklet-ID", width: 24 },
      { key: "bookletLabel", label: "Booklet-Bezeichnung", width: 32 },
      { key: "unitId", label: "Unit-ID", width: 24 },
      { key: "unitLabel", label: "Unit-Bezeichnung", width: 32 },
      { key: "itemId", label: "Item-ID", width: 24 },
      { key: "itemLabel", label: "Item-Bezeichnung", width: 32 },
      { key: "threadId", label: "Thread-ID", width: 38 },
      { key: "parentCommentId", label: "Antwort auf", width: 38 },
      { key: "categoryId", label: "Kategorie (ID)", width: 38 },
      { key: "category", label: "Kategorie", width: 24 },
      { key: "comment", label: "Kommentar", width: 55 },
      { key: "createdAt", label: "Erstellt", width: 22 },
      { key: "updatedAt", label: "Geändert", width: 22 },
      {
        key: "legacyReadOnly",
        label: "Legacy schreibgeschützt",
        width: 24,
      },
    ];
    if (includeAuthor) {
      headers.splice(10, 0, { key: "author", label: "Autor", width: 22 });
    }
    return headers.filter(
      (header) =>
        !policy?.restricted ||
        (["bookletId", "bookletLabel"].includes(header.key)
          ? policy.allows("metadata:booklet")
          : header.key === "unitLabel"
            ? policy.allows("system:unitLabel")
            : header.key === "itemLabel"
              ? false
              : true),
    );
  }

  private quoteCsvField(value: unknown): string {
    const raw = String(value ?? "");
    const spreadsheetSafe = /^[\t\r]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
  }

  private async buildReviewXlsxBuffer(
    data: Array<Record<string, string>>,
    includeAuthor: boolean,
    policy?: ReviewerColumnPolicy,
  ): Promise<Buffer> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "IQB ContentPool";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Kommentare", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const headers = this.reviewExportHeaders(includeAuthor, policy);
    sheet.columns = headers.map((header) => ({
      header: header.label,
      key: header.key,
      width: header.width,
    }));
    const headerRow = sheet.getRow(1);
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A5276" },
    };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    for (const row of data) sheet.addRow(row);
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, sheet.rowCount), column: headers.length },
    };
    sheet.getColumn("comment").alignment = {
      vertical: "top",
      wrapText: true,
    };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async isCommentingEnabled(
    acpId: string,
    targetType: CommentTargetType,
  ): Promise<boolean> {
    return this.reviewPolicy.isCommentingEnabled(acpId, targetType);
  }

  private async resolveReviewTarget(
    acpId: string,
    input: ReviewCommentTarget,
  ): Promise<ResolvedReviewCommentTarget> {
    if (input.targetType === CommentTargetType.TASK_SEQUENCE) {
      throw new BadRequestException(
        "TASK_SEQUENCE is only supported for legacy comments",
      );
    }
    if (input.targetType === CommentTargetType.BOOKLET) {
      const bookletId = String(input.bookletId || "").trim();
      if (!bookletId) throw new BadRequestException("bookletId is required");
      const manifest = await this.reviewManifestService.getManifest(
        acpId,
        this.transactionManager,
      );
      const booklet = manifest.booklets.find(
        (entry) => entry.id === bookletId && !entry.legacy,
      );
      if (!booklet) {
        throw new NotFoundException("Canonical booklet not found in this ACP");
      }
      return {
        targetType: CommentTargetType.BOOKLET,
        targetId: booklet.id,
        bookletId: booklet.id,
        legacyTargetIds: [],
      };
    }
    if (input.targetType === CommentTargetType.UNIT) {
      const unitId = String(input.unitId || "").trim();
      if (!unitId) throw new BadRequestException("unitId is required");
      const manifest = await this.reviewManifestService.getManifest(
        acpId,
        this.transactionManager,
      );
      if (!manifest.units.some((entry) => entry.id === unitId)) {
        throw new NotFoundException("Unit not found in this ACP");
      }
      return {
        targetType: CommentTargetType.UNIT,
        targetId: unitId,
        unitId,
        legacyTargetIds: [unitId],
      };
    }
    if (
      input.targetType !== CommentTargetType.ITEM &&
      input.targetType !== CommentTargetType.CODING
    ) {
      throw new BadRequestException("Unsupported review comment target");
    }
    const unitId = String(input.unitId || "").trim();
    const itemId = String(input.itemId || "").trim();
    if (!unitId || !itemId) {
      throw new BadRequestException("unitId and itemId are required");
    }
    const itemTarget = await this.resolveItemTarget(acpId, unitId, itemId);
    if (input.targetType === CommentTargetType.CODING) {
      const itemList = await this.unitParserService.getItemListFromFiles(
        acpId,
        {},
        this.transactionManager,
      );
      if (!itemList.codingSchemes?.[itemTarget.unitId]) {
        throw new NotFoundException(
          "Coding scheme not found for this item in this ACP",
        );
      }
    }
    return {
      targetType: input.targetType,
      targetId: this.legacyItemTargetId(itemTarget.unitId, itemTarget.itemId),
      unitId: itemTarget.unitId,
      itemId: itemTarget.itemId,
      legacyTargetIds:
        input.targetType === CommentTargetType.ITEM
          ? itemTarget.legacyTargetIds
          : [],
    };
  }

  private threadWhere(
    acpId: string,
    target: ResolvedReviewCommentTarget,
  ): FindOptionsWhere<Comment>[] {
    if (target.targetType === CommentTargetType.BOOKLET) {
      return [
        {
          acpId,
          targetType: CommentTargetType.BOOKLET,
          bookletId: target.bookletId,
        },
        {
          acpId,
          targetType: CommentTargetType.TASK_SEQUENCE,
          bookletId: target.bookletId,
        },
      ];
    }
    if (target.targetType === CommentTargetType.UNIT) {
      return [
        {
          acpId,
          targetType: CommentTargetType.UNIT,
          unitId: target.unitId,
        },
        {
          acpId,
          targetType: CommentTargetType.UNIT,
          targetId: target.targetId,
          unitId: IsNull(),
        },
      ];
    }
    return [
      {
        acpId,
        targetType: target.targetType,
        unitId: target.unitId,
        itemId: target.itemId,
      },
      ...target.legacyTargetIds.map((targetId) => ({
        acpId,
        targetType: target.targetType,
        targetId,
        unitId: IsNull(),
      })),
    ];
  }

  private async resolveItemTarget(
    acpId: string,
    unitId: string,
    requestedItemId: string,
  ): Promise<ItemTargetResolution> {
    const catalog = await this.getItemCatalog(acpId);
    const unitItems = catalog.filter((item) => item.unitId === unitId);
    const exactMatches = unitItems.filter(
      (item) => item.itemId === requestedItemId,
    );
    const matches = exactMatches.length
      ? exactMatches
      : unitItems.filter(
          (item) =>
            this.legacyItemTargetId(item.unitId, item.itemId) ===
            requestedItemId,
        );
    if (matches.length === 0) {
      throw new NotFoundException("Item not found in this ACP");
    }
    if (matches.length > 1) {
      throw new BadRequestException("Item ID is ambiguous in this unit");
    }

    const target = matches[0];
    const legacyTargetId = this.legacyItemTargetId(
      target.unitId,
      target.itemId,
    );
    const legacyTargetIsUnique =
      this.buildLegacyItemTargets(catalog).get(legacyTargetId) === target;

    return {
      ...target,
      legacyTargetIds: legacyTargetIsUnique ? [legacyTargetId] : [],
    };
  }

  private buildLegacyItemTargets(
    catalog: ItemCatalogEntry[],
  ): Map<string, ItemCatalogEntry> {
    const owners = new Map<string, Set<ItemCatalogEntry>>();
    for (const entry of catalog) {
      for (const alias of [
        entry.itemId,
        this.legacyItemTargetId(entry.unitId, entry.itemId),
      ]) {
        const entries = owners.get(alias) || new Set<ItemCatalogEntry>();
        entries.add(entry);
        owners.set(alias, entries);
      }
    }
    const targets = new Map<string, ItemCatalogEntry>();
    for (const entry of catalog) {
      const legacyId = this.legacyItemTargetId(entry.unitId, entry.itemId);
      if (owners.get(legacyId)?.size === 1) targets.set(legacyId, entry);
    }
    return targets;
  }

  private async getItemCatalog(acpId: string): Promise<ItemCatalogEntry[]> {
    const [fileCatalog, acp] = await Promise.all([
      this.fileCatalogCache.get(acpId, this.transactionManager),
      this.acpRepository.findOne({ where: { id: acpId } }),
    ]);
    const cacheKey = `${acpId}:${fileCatalog.signature}:${
      acp?.updatedAt?.toISOString() || "missing"
    }`;
    this.deleteStaleItemCatalogEntries(acpId, cacheKey);

    let catalogPromise = this.itemCatalogCache.get(cacheKey);
    if (!catalogPromise) {
      catalogPromise = this.buildItemCatalog(acpId, acp);
      if (this.itemCatalogCache.size >= this.maxItemCatalogCacheEntries) {
        const oldestKey = this.itemCatalogCache.keys().next().value as
          | string
          | undefined;
        if (oldestKey) this.itemCatalogCache.delete(oldestKey);
      }
      this.itemCatalogCache.set(cacheKey, catalogPromise);
    }

    try {
      return await catalogPromise;
    } catch (error) {
      this.itemCatalogCache.delete(cacheKey);
      throw error;
    }
  }

  private async buildItemCatalog(
    acpId: string,
    acp: Acp | null,
  ): Promise<ItemCatalogEntry[]> {
    const itemList = await this.unitParserService.getItemListFromFiles(
      acpId,
      {},
      this.transactionManager,
    );
    const indexEntries: ItemCatalogEntry[] = [];
    const indexUnits = getIndexUnits(acp?.acpIndex);
    for (const [unitOrder, unit] of indexUnits.entries()) {
      const indexUnitId = String(unit?.id || "").trim();
      const unitLabel =
        extractLabelText(unit?.name || unit?.label) ||
        String(unit?.description || indexUnitId).trim();
      const items = Array.isArray(unit?.items) ? unit.items : [];
      for (const [itemOrder, item] of items.entries()) {
        const itemId = String(item?.id || "").trim();
        indexEntries.push({
          unitId: indexUnitId,
          itemId,
          unitLabel,
          itemLabel:
            extractLabelText(item?.name || item?.label) ||
            String(item?.description || itemId).trim(),
          unitOrder,
          itemOrder,
        });
      }
    }
    const entries = [...indexEntries];
    const indexUnitOrders = new Map(
      indexUnits.map((unit, unitOrder) => [
        String(unit?.id || "").trim(),
        unitOrder,
      ]),
    );
    const indexAliases = new Map<string, ItemCatalogEntry | null>();
    for (const indexEntry of indexEntries) {
      for (const alias of [
        indexEntry.itemId,
        this.legacyItemTargetId(indexEntry.unitId, indexEntry.itemId),
      ]) {
        const aliasKey = this.itemCatalogKey(indexEntry.unitId, alias);
        indexAliases.set(
          aliasKey,
          indexAliases.has(aliasKey) ? null : indexEntry,
        );
      }
    }
    const parsedUnitOrders = new Map<string, number>();
    for (const [parsedOrder, item] of (itemList.items || []).entries()) {
      const parsedEntry = {
        unitId: String(item.unitId || "").trim(),
        itemId: String(item.itemId || "").trim(),
        unitLabel: String(item.unitLabel || item.unitId || "").trim(),
        itemLabel: String(item.description || item.itemId || "").trim(),
        unitOrder: 0,
        itemOrder: Number.isFinite(item.rowNumber)
          ? Number(item.rowNumber)
          : parsedOrder,
      };
      if (!parsedUnitOrders.has(parsedEntry.unitId)) {
        parsedUnitOrders.set(
          parsedEntry.unitId,
          indexUnits.length + parsedUnitOrders.size,
        );
      }
      parsedEntry.unitOrder =
        indexUnitOrders.get(parsedEntry.unitId) ??
        parsedUnitOrders.get(parsedEntry.unitId)!;
      const aliasKey = this.itemCatalogKey(
        parsedEntry.unitId,
        parsedEntry.itemId,
      );
      const indexEntry = indexAliases.get(aliasKey);
      if (indexAliases.has(aliasKey)) {
        if (
          indexEntry &&
          (!indexEntry.unitLabel || indexEntry.unitLabel === indexEntry.unitId)
        ) {
          indexEntry.unitLabel = parsedEntry.unitLabel;
        }
        if (
          indexEntry &&
          (!indexEntry.itemLabel || indexEntry.itemLabel === indexEntry.itemId)
        ) {
          indexEntry.itemLabel = parsedEntry.itemLabel;
        }
      } else {
        entries.push(parsedEntry);
      }
    }

    const unique = new Map<string, ItemCatalogEntry>();
    for (const entry of entries) {
      if (!entry.unitId || !entry.itemId) continue;
      const key = this.itemCatalogKey(entry.unitId, entry.itemId);
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, entry);
      } else {
        existing.unitOrder = Math.min(existing.unitOrder, entry.unitOrder);
        existing.itemOrder = Math.min(existing.itemOrder, entry.itemOrder);
        if (!existing.unitLabel) existing.unitLabel = entry.unitLabel;
        if (!existing.itemLabel) existing.itemLabel = entry.itemLabel;
      }
    }
    return [...unique.values()];
  }

  private buildReviewUnitCatalog(
    index: unknown,
    itemCatalog: ItemCatalogEntry[],
  ): Map<string, ReviewUnitCatalogEntry> {
    const catalog = new Map<string, ReviewUnitCatalogEntry>();
    for (const [unitOrder, unit] of getIndexUnits(index).entries()) {
      const unitId = String(unit?.id || "").trim();
      if (!unitId || catalog.has(unitId)) continue;
      catalog.set(unitId, {
        unitId,
        unitLabel:
          extractLabelText(unit?.name || unit?.label) ||
          String(unit?.description || unitId).trim(),
        unitOrder,
      });
    }
    for (const entry of itemCatalog) {
      if (catalog.has(entry.unitId)) continue;
      catalog.set(entry.unitId, {
        unitId: entry.unitId,
        unitLabel: entry.unitLabel,
        unitOrder: entry.unitOrder,
      });
    }
    return catalog;
  }

  private buildReviewBookletCatalog(
    index: unknown,
  ): Map<string, ReviewBookletCatalogEntry> {
    const catalog = new Map<string, ReviewBookletCatalogEntry>();
    let bookletOrder = 0;
    for (const part of getAssessmentParts(index)) {
      for (const module of Array.isArray(part?.bookletModules)
        ? part.bookletModules
        : []) {
        const bookletId = String(module?.id || "").trim();
        if (!bookletId || catalog.has(bookletId)) continue;
        catalog.set(bookletId, {
          bookletId,
          bookletLabel:
            extractLabelText(module?.name || module?.label) || bookletId,
          bookletOrder: bookletOrder++,
        });
      }
    }
    return catalog;
  }

  private resolveReviewExportTarget(
    comment: Comment,
    itemCatalog: ItemCatalogEntry[],
    bookletCatalog: Map<string, ReviewBookletCatalogEntry>,
    unitCatalog: Map<string, ReviewUnitCatalogEntry>,
  ): ReviewExportTarget {
    const fallbackOrder = Number.MAX_SAFE_INTEGER;
    if (
      comment.targetType === CommentTargetType.TASK_SEQUENCE ||
      comment.targetType === CommentTargetType.BOOKLET
    ) {
      const bookletId = comment.bookletId || comment.targetId;
      const booklet = bookletCatalog.get(bookletId);
      return {
        level:
          comment.targetType === CommentTargetType.BOOKLET
            ? "Booklet"
            : "Booklet (Legacy)",
        levelOrder: 0,
        bookletId,
        bookletLabel: booklet?.bookletLabel || bookletId,
        bookletOrder: booklet?.bookletOrder ?? fallbackOrder,
        unitId: "",
        unitLabel: "",
        unitOrder: fallbackOrder,
        itemId: "",
        itemLabel: "",
        itemOrder: fallbackOrder,
      };
    }

    const unitId =
      comment.unitId ||
      (comment.targetType === CommentTargetType.UNIT ? comment.targetId : "");
    let itemEntry: ItemCatalogEntry | undefined;
    if (
      comment.targetType === CommentTargetType.ITEM ||
      comment.targetType === CommentTargetType.CODING
    ) {
      const itemId = comment.itemId || "";
      if (unitId && itemId) {
        itemEntry = itemCatalog.find(
          (entry) => entry.unitId === unitId && entry.itemId === itemId,
        );
      } else {
        const candidates = itemCatalog.filter(
          (entry) =>
            entry.itemId === comment.targetId ||
            this.legacyItemTargetId(entry.unitId, entry.itemId) ===
              comment.targetId,
        );
        if (candidates.length === 1) itemEntry = candidates[0];
      }
    }
    const resolvedUnitId = itemEntry?.unitId || unitId;
    const unitEntry = unitCatalog.get(resolvedUnitId);
    const resolvedItemId =
      itemEntry?.itemId ||
      (comment.targetType === CommentTargetType.ITEM ||
      comment.targetType === CommentTargetType.CODING
        ? comment.itemId || comment.targetId
        : "");
    return {
      level:
        comment.targetType === CommentTargetType.UNIT
          ? "Unit"
          : comment.targetType === CommentTargetType.CODING
            ? "Kodierung"
            : "Item",
      levelOrder: 1,
      bookletId: "",
      bookletLabel: "",
      bookletOrder: fallbackOrder,
      unitId: resolvedUnitId,
      unitLabel: unitEntry?.unitLabel || itemEntry?.unitLabel || resolvedUnitId,
      unitOrder: unitEntry?.unitOrder ?? itemEntry?.unitOrder ?? fallbackOrder,
      itemId: resolvedItemId,
      itemLabel:
        comment.targetType === CommentTargetType.ITEM ||
        comment.targetType === CommentTargetType.CODING
          ? itemEntry?.itemLabel || resolvedItemId
          : "",
      itemOrder:
        comment.targetType === CommentTargetType.UNIT
          ? -1
          : (itemEntry?.itemOrder ?? fallbackOrder),
    };
  }

  private deleteStaleItemCatalogEntries(
    acpId: string,
    currentKey: string,
  ): void {
    const prefix = `${acpId}:`;
    for (const key of this.itemCatalogCache.keys()) {
      if (key.startsWith(prefix) && key !== currentKey) {
        this.itemCatalogCache.delete(key);
      }
    }
  }

  private itemCatalogKey(unitId: string, itemId: string): string {
    return `${unitId}\u0000${itemId}`;
  }

  private async findMutableComment(
    acpId: string,
    commentId: string,
    actor: CommentActor,
  ): Promise<Comment> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, acpId },
      relations: ["user"],
    });
    const mode = await this.reviewPolicy.prepareVisibility(acpId, actor);
    if (
      !comment ||
      comment.deletedAt ||
      !this.reviewPolicy.canViewComment(mode, actor, comment)
    ) {
      throw new NotFoundException("Comment not found");
    }
    if (
      comment.targetType === CommentTargetType.TASK_SEQUENCE ||
      comment.legacyReadOnly
    ) {
      throw new ForbiddenException("Legacy comments are read-only");
    }
    this.reviewPolicy.assertCanMutate(actor, comment);
    return comment;
  }

  private matchesItemTarget(
    comment: Comment,
    target: ItemTargetResolution,
  ): boolean {
    if (comment.targetType !== CommentTargetType.ITEM) return false;
    if (comment.unitId || comment.itemId) {
      return (
        comment.unitId === target.unitId && comment.itemId === target.itemId
      );
    }
    return target.legacyTargetIds.includes(comment.targetId);
  }

  private matchesTarget(
    comment: Comment,
    target: ResolvedReviewCommentTarget,
  ): boolean {
    if (comment.targetType !== target.targetType) return false;
    if (target.targetType === CommentTargetType.BOOKLET) {
      return (comment.bookletId || comment.targetId) === target.bookletId;
    }
    if (target.targetType === CommentTargetType.UNIT) {
      return (comment.unitId || comment.targetId) === target.unitId;
    }
    if (target.targetType === CommentTargetType.ITEM) {
      if (!target.unitId || !target.itemId) return false;
      return this.matchesItemTarget(comment, {
        unitId: target.unitId,
        itemId: target.itemId,
        legacyTargetIds: target.legacyTargetIds,
      });
    }
    return comment.unitId === target.unitId && comment.itemId === target.itemId;
  }

  private async assertStoredTargetExists(
    acpId: string,
    comment: Comment,
  ): Promise<void> {
    await this.resolveReviewTarget(acpId, {
      targetType: comment.targetType,
      bookletId: comment.bookletId || undefined,
      unitId:
        comment.unitId ||
        (comment.targetType === CommentTargetType.UNIT
          ? comment.targetId
          : undefined),
      itemId: comment.itemId || undefined,
    });
  }

  private legacyItemTargetId(unitId: string, itemId: string): string {
    return `${unitId}_${itemId}`;
  }

  private toCommentView(
    comment: Comment,
    actor: CommentActor,
    visibleIds: Set<string>,
  ): CommentView {
    const deleted = Boolean(comment.deletedAt);
    return {
      id: comment.id,
      acpId: comment.acpId,
      targetType: comment.targetType,
      targetId: comment.targetId,
      bookletId: comment.bookletId || null,
      unitId: comment.unitId || null,
      itemId: comment.itemId || null,
      parentCommentId: comment.parentCommentId || null,
      categoryId: deleted ? null : comment.categoryId || null,
      categoryName: deleted
        ? null
        : actor.categories?.find(
            (category) => category.id === comment.categoryId,
          )?.name || null,
      groupId: comment.groupId || null,
      groupName:
        actor.groups?.find((group) => group.id === comment.groupId)?.name ||
        null,
      parentVisible:
        !comment.parentCommentId || visibleIds.has(comment.parentCommentId),
      commentText: deleted ? "" : comment.commentText,
      authorLabel: deleted ? "Gelöscht" : this.resolveAuthorLabel(comment),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: (comment.updatedAt || comment.createdAt).toISOString(),
      version: comment.version || 1,
      isOwn:
        !deleted &&
        !comment.legacyReadOnly &&
        this.reviewPolicy.isOwnedBy(comment, actor),
      isDeleted: deleted,
      legacyReadOnly: Boolean(comment.legacyReadOnly),
      upvotes: 0,
      downvotes: 0,
      myVote: null,
      canVote: false,
    };
  }

  private resolveAuthorLabel(comment: Comment): string {
    if (comment.credentialId) {
      return (
        commentAuthorName(
          comment.authorLabel,
          comment.credential?.username,
          comment.credentialUsername,
        ) || "Unknown"
      );
    }
    return (
      commentAuthorName(
        comment.user?.displayName,
        comment.user?.username,
        comment.authorLabel,
        comment.credential?.username,
        comment.credentialUsername,
      ) || "Unknown"
    );
  }

  private normalizeCommentText(commentText: string): string {
    const normalized = String(commentText || "").trim();
    if (!normalized) {
      throw new BadRequestException("Comment text is required");
    }
    if (normalized.length > 10_000) {
      throw new BadRequestException(
        "Comment text must not exceed 10000 characters",
      );
    }
    return normalized;
  }

  private async versionConflict(
    comment: Comment,
    actor: CommentActor,
  ): Promise<ConflictException> {
    const votes = await this.getVoteStates(comment.acpId, [comment], actor);
    return new ConflictException({
      code: "COMMENT_VERSION_CONFLICT",
      message:
        "Der Kommentar wurde zwischenzeitlich geändert. Der aktuelle Stand wurde neu geladen.",
      current: {
        ...this.toCommentView(comment, actor, new Set([comment.id])),
        ...votes.get(comment.id),
      },
    });
  }
}
