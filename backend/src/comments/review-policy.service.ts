import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AcpAccessConfig,
  Comment,
  CommentTargetType,
} from "../database/entities";

import { ReviewGroup } from "../database/entities/acp-access-config.entity";
import { commentAuthorName } from "./comment-author-name";

export type CommentVisibilityMode = "PRIVATE" | "SHARED" | "GROUP";

export interface CommentActor {
  userId?: string;
  credentialId?: string;
  credentialUsername?: string;
  authorLabel: string;
  isManager: boolean;
  canParticipate?: boolean;
  votingEnabled?: boolean;
  votingTargets?: string[];
  groups?: ReviewGroup[];
  ungroupedShared?: boolean;
}

/** Central visibility boundary shared by threads, mutations, counts and exports. */
@Injectable()
export class ReviewPolicyService {
  constructor(
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
  ) {}

  resolveActor(req: any): CommentActor {
    const credential = req.user?.type === "credential";
    return {
      userId: credential ? undefined : req.user?.sub,
      credentialId: credential ? req.user?.sub : undefined,
      credentialUsername: credential ? req.user?.username : undefined,
      authorLabel:
        commentAuthorName(
          !credential && req.user?.displayName,
          req.user?.username,
        ) || "Unbekannt",
      isManager: this.isManagerRequest(req),
      canParticipate: Boolean(
        req.user?.sub && req.acpCapabilities?.includes("review:participate"),
      ),
    };
  }

  isManagerRequest(req: any): boolean {
    return Boolean(
      req.user?.isAppAdmin || req.acpCapabilities?.includes("review:manage"),
    );
  }

  assertCanParticipateRequest(req: any): void {
    if (
      !req.user?.sub ||
      !req.acpCapabilities?.includes("review:participate")
    ) {
      throw new ForbiddenException("Review-Teilnahme ist nicht erlaubt");
    }
  }

  async assertItemCommentAccess(
    acpId: string,
    actor: CommentActor,
  ): Promise<CommentVisibilityMode> {
    return this.assertCommentAccess(acpId, actor, CommentTargetType.ITEM);
  }

  async assertCommentAccess(
    acpId: string,
    actor: CommentActor,
    targetType: CommentTargetType,
  ): Promise<CommentVisibilityMode> {
    if (!actor.userId && !actor.credentialId) {
      throw new ForbiddenException("Authenticated review access required");
    }
    if (targetType === CommentTargetType.TASK_SEQUENCE) {
      throw new ForbiddenException("Legacy comments are read-only");
    }
    const featureConfig = await this.getFeatureConfig(acpId, actor);
    const targets = this.commentTargets(featureConfig);
    if (
      (!featureConfig.enableCommenting && !actor.isManager) ||
      !this.isTargetEnabled(targets, targetType)
    ) {
      throw new ForbiddenException(
        `${targetType} comments are not enabled for this ACP`,
      );
    }
    return this.visibilityMode(featureConfig);
  }

  async assertItemAndCodingCountAccess(
    acpId: string,
    actor: CommentActor,
  ): Promise<{
    visibilityMode: CommentVisibilityMode;
    targetTypes: CommentTargetType[];
  }> {
    if (!actor.userId && !actor.credentialId) {
      throw new ForbiddenException("Authenticated review access required");
    }
    const featureConfig = await this.getFeatureConfig(acpId, actor);
    const configured = this.commentTargets(featureConfig);
    const targetTypes = [
      CommentTargetType.ITEM,
      CommentTargetType.CODING,
    ].filter((target) => this.isTargetEnabled(configured, target));
    if (!featureConfig.enableCommenting || targetTypes.length === 0) {
      throw new ForbiddenException(
        "Item and coding comments are not enabled for this ACP",
      );
    }
    return {
      visibilityMode: this.visibilityMode(featureConfig),
      targetTypes,
    };
  }

  async isCommentingEnabled(
    acpId: string,
    targetType: CommentTargetType,
  ): Promise<boolean> {
    const featureConfig = await this.getFeatureConfig(acpId);
    if (!featureConfig.enableCommenting) return false;
    const targets = this.commentTargets(featureConfig);
    return this.isTargetEnabled(targets, targetType);
  }

  canViewComment(
    visibilityMode: CommentVisibilityMode,
    actor: CommentActor,
    comment: Comment,
  ): boolean {
    if (actor.isManager) return true;
    if (visibilityMode === "GROUP" && comment.groupId) {
      return Boolean(
        actor.groups?.some((group) => group.id === comment.groupId),
      );
    }
    return (
      visibilityMode === "SHARED" ||
      (visibilityMode === "GROUP" &&
        !comment.groupId &&
        actor.ungroupedShared === true) ||
      this.isOwnedBy(comment, actor)
    );
  }

  assertCanReply(
    visibilityMode: CommentVisibilityMode,
    actor: CommentActor,
    parent: Comment,
  ): void {
    if (!this.canViewComment(visibilityMode, actor, parent)) {
      throw new NotFoundException("Reply target not found for this context");
    }
  }

  assertCanMutate(actor: CommentActor, comment: Comment): void {
    if (!this.isOwnedBy(comment, actor)) {
      throw new ForbiddenException("Only the author may change this comment");
    }
  }

  isOwnedBy(comment: Comment, actor: CommentActor): boolean {
    if (actor.userId && comment.userId) return actor.userId === comment.userId;
    if (actor.credentialId && comment.credentialId) {
      return actor.credentialId === comment.credentialId;
    }
    return false;
  }

  canVote(actor: CommentActor, comment: Comment): boolean {
    return (
      actor.canParticipate === true &&
      actor.votingEnabled === true &&
      Boolean(actor.userId) !== Boolean(actor.credentialId) &&
      this.isTargetEnabled(actor.votingTargets || [], comment.targetType) &&
      !comment.deletedAt &&
      !comment.legacyReadOnly &&
      comment.targetType !== CommentTargetType.TASK_SEQUENCE &&
      !this.isOwnedBy(comment, actor)
    );
  }

  private async getFeatureConfig(
    acpId: string,
    actor?: CommentActor,
  ): Promise<Record<string, unknown>> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (actor) {
      actor.votingTargets = this.commentTargets(config?.featureConfig || {});
      actor.votingEnabled =
        config?.featureConfig?.enableReview === true &&
        config?.featureConfig?.enableCommenting === true &&
        config?.featureConfig?.commentVisibilityMode === "SHARED";
      // Review activation controls the booklet workspace, not existing comments.
      // Participation, target selection and commenting remain separate checks.
      actor.ungroupedShared =
        config?.featureConfig?.ungroupedVisibilityMode === "SHARED";
      actor.groups = (config?.reviewGroups || []).filter(
        (group) =>
          actor.isManager ||
          (!group.archived &&
            group.members.some((member) =>
              member.kind === "user"
                ? member.id === actor.userId
                : member.id === actor.credentialId,
            )),
      );
    }
    return (config?.featureConfig || {}) as Record<string, unknown>;
  }

  async prepareVisibility(
    acpId: string,
    actor: CommentActor,
  ): Promise<CommentVisibilityMode> {
    return this.visibilityMode(await this.getFeatureConfig(acpId, actor));
  }

  private visibilityMode(
    config: Record<string, unknown>,
  ): CommentVisibilityMode {
    return config.commentVisibilityMode === "GROUP"
      ? "GROUP"
      : config.commentVisibilityMode === "SHARED"
        ? "SHARED"
        : "PRIVATE";
  }

  selectGroup(
    mode: CommentVisibilityMode,
    actor: CommentActor,
    requested?: string,
  ): string | undefined {
    if (mode !== "GROUP") {
      if (requested)
        throw new BadRequestException(
          "Gruppen sind nur im Gruppenmodus wählbar",
        );
      return undefined;
    }
    const groups = (actor.groups || []).filter((group) => !group.archived);
    const id =
      requested ||
      (!actor.isManager && groups.length === 1 ? groups[0].id : undefined);
    if (!id || !groups.some((group) => group.id === id)) {
      throw new BadRequestException(
        "Bitte eine verfügbare Review-Gruppe wählen",
      );
    }
    return id;
  }

  private commentTargets(featureConfig: Record<string, unknown>): string[] {
    return Array.isArray(featureConfig.commentTargets)
      ? (featureConfig.commentTargets as string[])
      : [];
  }

  private isTargetEnabled(
    targets: string[],
    targetType: CommentTargetType,
  ): boolean {
    if (targets.length > 0) return targets.includes(targetType);
    return ![CommentTargetType.BOOKLET, CommentTargetType.CODING].includes(
      targetType,
    );
  }
}
