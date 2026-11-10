import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Request,
  UseGuards,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  IsBoolean,
  IsInt,
  IsIn,
  IsOptional,
  Min,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  ValidateIf,
  IsUUID,
  IsString,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { randomUUID } from "crypto";
import {
  Comment,
  ApAccessConfig,
  ApCredential,
  ApUserRole,
} from "../database/entities";
import { ApAccessGuard } from "../auth/guards/ap-access.guard";
import { ApCapabilitiesService } from "../auth/capabilities/ap-capabilities.service";
import {
  hasCapability,
  isExplorerAvailable,
} from "../auth/capabilities/ap-capabilities";
import { UuidParam } from "../common/uuid-param";
import { ReviewManifestService } from "./review-manifest.service";
import { ReviewReadinessService } from "./review-readiness.service";

class ReviewMemberDto {
  @IsIn(["user", "credential"]) kind!: "user" | "credential";
  @IsUUID() id!: string;
}
class ReviewGroupDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(120) name!: string;
  @IsBoolean() archived!: boolean;
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ReviewMemberDto)
  members!: ReviewMemberDto[];
}
class CommentCategoryDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(120) name!: string;
  @IsBoolean() archived!: boolean;
}
class ReviewConfigDto {
  @IsBoolean() enableReview!: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  hideReviewMetadata?: boolean;
  @IsOptional() @IsBoolean() hideReviewDeveloperNames?: boolean;
  @IsInt() @Min(1) configVersion!: number;
  @IsIn(["PRIVATE", "SHARED", "GROUP"]) visibilityMode!:
    | "PRIVATE"
    | "SHARED"
    | "GROUP";
  @IsOptional() @IsBoolean() confirmExistingComments?: boolean;
  @IsOptional() @IsBoolean() confirmReadinessWarnings?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReviewGroupDto)
  groups?: ReviewGroupDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  deletedGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CommentCategoryDto)
  categories?: CommentCategoryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  deletedCategoryIds?: string[];
}
@Controller("view/ap/:apId")
@UseGuards(ApAccessGuard)
export class ReviewController {
  constructor(
    private readonly capabilities: ApCapabilitiesService,
    private readonly manifest: ReviewManifestService,
    @InjectRepository(ApAccessConfig)
    private readonly configs: Repository<ApAccessConfig>,
    private readonly readiness: ReviewReadinessService,
  ) {}

  @Get("capabilities")
  async getCapabilities(@UuidParam("apId") apId: string, @Request() req: any) {
    const grants = await this.capabilities.resolve(req);
    const config = await this.configs.findOne({ where: { apId } });
    const explorerAvailable = isExplorerAvailable(req, config?.featureConfig);
    return {
      capabilities: grants,
      canViewUnit:
        req?.apAccessLevel === "ADMIN" ||
        req?.apAccessLevel === "MANAGER" ||
        config?.featureConfig?.enableUnitView !== false ||
        (config?.featureConfig?.enableReview === true &&
          Boolean(req?.user?.sub) &&
          (grants.includes("review:participate") ||
            grants.includes("review:manage"))),
      canViewExplorer:
        explorerAvailable &&
        (hasCapability(grants, "item-explorer:view") ||
          (config?.accessModel === "PUBLIC" &&
            config.featureConfig?.enableItemList !== false)),
      canEditExplorer:
        explorerAvailable && hasCapability(grants, "item-explorer:edit"),
      canReview:
        grants.includes("review:manage") ||
        (config?.featureConfig?.enableReview === true &&
          grants.includes("review:participate")),
      canManageReview: grants.includes("review:manage"),
      enableReview: config?.featureConfig?.enableReview === true,
    };
  }

  @Put("review/config")
  async configure(
    @UuidParam("apId") apId: string,
    @Body() dto: ReviewConfigDto,
    @Request() req: any,
  ) {
    await this.capabilities.assert(req, "review:manage");
    const current = await this.configs.findOne({ where: { apId } });
    if (!current) throw new ForbiddenException("AP-Konfiguration fehlt");
    if (dto.enableReview && current.featureConfig.enableReview !== true) {
      const readiness = await this.readiness.check(apId);
      if (readiness.stale || readiness.status === "BLOCKED") {
        throw new BadRequestException({
          code: "REVIEW_NOT_READY",
          message: readiness.stale
            ? "Das Paket wurde während der Prüfung geändert. Bitte erneut prüfen."
            : "Der Review kann wegen technischer Blocker nicht aktiviert werden.",
          readiness,
        });
      }
      if (
        readiness.status === "WARNING" &&
        dto.confirmReadinessWarnings !== true
      ) {
        throw new BadRequestException({
          code: "REVIEW_WARNINGS_REQUIRE_CONFIRMATION",
          message:
            "Die Review-Bereitschaft enthält Warnungen, die bestätigt werden müssen.",
          readiness,
        });
      }
    }
    return this.configs.manager.transaction(async (manager) => {
      const config = await manager.findOne(ApAccessConfig, {
        where: { apId },
        lock: { mode: "pessimistic_write" },
      });
      if (!config) throw new ForbiddenException("AP-Konfiguration fehlt");
      if (config.reviewConfigVersion !== dto.configVersion)
        throw new ConflictException(
          "Die Review-Konfiguration wurde geändert. Bitte neu laden.",
        );
      const previousMode =
        config.featureConfig.commentVisibilityMode || "PRIVATE";
      if (
        dto.visibilityMode === "SHARED" &&
        previousMode !== "SHARED" &&
        dto.confirmExistingComments !== true
      ) {
        throw new BadRequestException(
          "Die Freigabe aller bestehenden Kommentare muss ausdrücklich bestätigt werden",
        );
      }
      if (dto.groups) {
        const previous = config.reviewGroups || [];
        const ids = new Set<string>();
        const next = [];
        for (const group of dto.groups) {
          const name = group.name.trim();
          if (!name) throw new BadRequestException("Gruppenname fehlt");
          if (group.id && !previous.some((entry) => entry.id === group.id))
            throw new BadRequestException("Unbekannte Review-Gruppe");
          const id = group.id || randomUUID();
          if (ids.has(id))
            throw new BadRequestException("Doppelte Review-Gruppe");
          ids.add(id);
          const previousMembers =
            previous.find((entry) => entry.id === id)?.members || [];
          const members = [];
          for (const member of group.members) {
            const exists =
              member.kind === "user"
                ? await manager.findOne(ApUserRole, {
                    where: { apId, userId: member.id },
                  })
                : await manager.findOne(ApCredential, {
                    where: { accessConfigId: config.id, id: member.id },
                  });
            if (!exists) {
              // Deleted AP identities may still occur in saved group JSON.
              // Drop historical references, but reject invalid new assignments.
              if (
                previousMembers.some(
                  (entry) =>
                    entry.kind === member.kind && entry.id === member.id,
                )
              )
                continue;
              throw new BadRequestException(
                "Gruppenmitglied gehört nicht zu diesem AP",
              );
            }
            members.push(member);
          }
          next.push({ ...group, id, name, members });
        }
        for (const group of previous.filter((entry) => !ids.has(entry.id))) {
          if (!dto.deletedGroupIds?.includes(group.id))
            throw new BadRequestException(
              "Löschen der Gruppe muss bestätigt werden.",
            );
          // Comment writes acquire this same AP config lock before choosing a group.
          // Include soft-deleted comments: their historical references must survive.
          if (
            await manager.count(Comment, {
              where: { apId, groupId: group.id },
            })
          ) {
            throw new BadRequestException(
              "Die Gruppe enthält Kommentare und kann nur archiviert werden.",
            );
          }
        }
        config.reviewGroups = next;
      }
      if (dto.categories) {
        const previous = config.commentCategories || [];
        const ids = new Set<string>();
        const names = new Set<string>();
        const next = dto.categories.map((category) => {
          const name = category.name.trim();
          if (!name) throw new BadRequestException("Kategoriename fehlt");
          if (
            category.id &&
            !previous.some((entry) => entry.id === category.id)
          )
            throw new BadRequestException("Unbekannte Kommentarkategorie");
          const id = category.id || randomUUID();
          if (ids.has(id) || names.has(name.toLowerCase()))
            throw new BadRequestException("Doppelte Kommentarkategorie");
          ids.add(id);
          names.add(name.toLowerCase());
          return { id, name, archived: category.archived };
        });
        for (const category of previous.filter((entry) => !ids.has(entry.id))) {
          if (!dto.deletedCategoryIds?.includes(category.id))
            throw new BadRequestException(
              "Löschen der Kategorie muss bestätigt werden.",
            );
          // Comment writes hold the same AP lock. Historical assignments,
          // including soft-deleted comments, must survive category management.
          if (
            await manager.count(Comment, {
              where: { apId, categoryId: category.id },
            })
          )
            throw new BadRequestException(
              "Die Kategorie enthält Kommentare und kann nur archiviert werden.",
            );
        }
        config.commentCategories = next;
      }
      if (dto.visibilityMode === "GROUP" && previousMode !== "GROUP") {
        config.featureConfig.ungroupedVisibilityMode = previousMode;
      }
      config.featureConfig = {
        ...config.featureConfig,
        enableReview: dto.enableReview,
        ...(dto.hideReviewMetadata !== undefined
          ? { hideReviewMetadata: dto.hideReviewMetadata }
          : {}),
        ...(dto.hideReviewDeveloperNames !== undefined
          ? { hideReviewDeveloperNames: dto.hideReviewDeveloperNames }
          : {}),
        commentVisibilityMode: dto.visibilityMode,
      };
      config.reviewConfigVersion += 1;
      config.reviewRevision = (BigInt(config.reviewRevision) + 1n).toString();
      await manager.save(config);
      return this.configView(config);
    });
  }

  @Get("review/readiness")
  async lastReadiness(@UuidParam("apId") apId: string, @Request() req: any) {
    await this.capabilities.assert(req, "review:manage");
    return this.readiness.getLast(apId);
  }

  @Post("review/readiness")
  async checkReadiness(@UuidParam("apId") apId: string, @Request() req: any) {
    await this.capabilities.assert(req, "review:manage");
    return this.readiness.check(apId);
  }

  @Get("review/config")
  async getConfig(@UuidParam("apId") apId: string, @Request() req: any) {
    await this.capabilities.assert(req, "review:manage");
    const config = await this.configs.findOne({ where: { apId } });
    if (!config) throw new ForbiddenException("AP-Konfiguration fehlt");
    return this.configView(config);
  }

  @Get("review/members")
  async getMembers(@UuidParam("apId") apId: string, @Request() req: any) {
    await this.capabilities.assert(req, "review:manage");
    const config = await this.configs.findOne({ where: { apId } });
    if (!config) throw new ForbiddenException("AP-Konfiguration fehlt");
    const users = await this.configs.manager.find(ApUserRole, {
      where: { apId },
      relations: ["user"],
    });
    const credentials = await this.configs.manager.find(ApCredential, {
      where: { accessConfigId: config.id },
    });
    return [
      ...users.map((role) => ({
        kind: "user",
        id: role.userId,
        label: role.user.displayName || role.user.username,
      })),
      ...credentials.map((credential) => ({
        kind: "credential",
        id: credential.id,
        label: credential.username,
      })),
    ];
  }

  private configView(config: ApAccessConfig) {
    return {
      enableReview: config.featureConfig.enableReview === true,
      hideReviewMetadata: config.featureConfig.hideReviewMetadata === true,
      hideReviewDeveloperNames:
        config.featureConfig.hideReviewDeveloperNames === true,
      visibilityMode: config.featureConfig.commentVisibilityMode || "PRIVATE",
      configVersion: config.reviewConfigVersion,
      groups: config.reviewGroups || [],
      categories: config.commentCategories || [],
    };
  }

  @Get("review")
  async getReview(@UuidParam("apId") apId: string, @Request() req: any) {
    const access = await this.getCapabilities(apId, req);
    if (!access.canReview)
      throw new ForbiddenException("Review ist deaktiviert oder nicht erlaubt");
    return this.manifest.getManifest(apId);
  }
}
