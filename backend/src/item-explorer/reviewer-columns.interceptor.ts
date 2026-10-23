import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { mergeMap, of } from "rxjs";
import { AcpCapabilitiesService } from "../auth/capabilities/acp-capabilities.service";
import { FilesService } from "../files/files.service";
import { ItemExplorerStateService } from "./item-explorer-state.service";
import { ReviewerColumnPolicy } from "./reviewer-column-policy";

/** Apply the published information boundary after access guards, before handlers.
 * Binary exports consume the same request policy before serialization.
 */
@Injectable()
export class ReviewerColumnsInterceptor implements NestInterceptor {
  constructor(
    private readonly states: ItemExplorerStateService,
    private readonly capabilities: AcpCapabilitiesService,
    private readonly files: FilesService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const controller = context.getClass().name;
    const handler = context.getHandler().name;
    // Only browser-facing ACP controllers. Integration tokens retain their own policy.
    if (
      ![
        "FilesController",
        "ItemsController",
        "ViewsController",
        "AcpController",
        "ReviewController",
        "ReviewCommentsController",
      ].includes(controller)
    )
      return next.handle();
    if (
      controller === "AcpController" &&
      handler === "findAll" &&
      !req.user?.isAppAdmin
    ) {
      return next.handle().pipe(
        mergeMap(async (acps: any[]) =>
          Promise.all(
            acps.map(async (acp) => {
              const policy = await this.states.getPublishedColumnPolicy(acp.id);
              return policy.projectResponse(acp);
            }),
          ),
        ),
      );
    }
    const acpId = req.params.acpId || req.params.id;
    if (!acpId) return next.handle();
    const grants =
      req.acpCapabilities || (await this.capabilities.resolve(req));
    const preview =
      req.query?.perspective === "read-only" ||
      req.body?.perspective === "read-only";
    const bypass =
      !preview &&
      (req.user?.isAppAdmin ||
        ["ADMIN", "MANAGER"].includes(req.acpAccessLevel) ||
        grants.includes("item-explorer:edit") ||
        (controller === "AcpController" &&
          req.user?.acpRoles?.some(
            (role: any) => role.acpId === acpId && role.role === "ACP_MANAGER",
          )));
    const policy = bypass
      ? new ReviewerColumnPolicy()
      : await this.states.getPublishedColumnPolicy(acpId);
    req.reviewerColumnPolicy = policy;
    req.assertReviewerColumnPolicyCurrent = () =>
      this.states.assertColumnPolicyCurrent(acpId, policy);
    if (!policy.restricted) return next.handle();
    context
      .switchToHttp()
      .getResponse()
      .setHeader("Cache-Control", "private, no-store");

    if (
      (controller === "ViewsController" &&
        ["getAcpIndex", "exportAcpIndex"].includes(handler)) ||
      (controller === "AcpController" &&
        ["getIndex", "exportIndex"].includes(handler))
    ) {
      this.denyRawData();
    }
    if (controller === "FilesController") {
      if (
        [
          "findAll",
          "findOne",
          "getValidation",
          "validateUnits",
          "downloadJobArchive",
          "bulkDownload",
          "startBulkDownloadJob",
        ].includes(handler)
      )
        this.denyRawData();
      if (["download", "getPreview"].includes(handler)) {
        const file = await this.files.findByIdForAcp(acpId, req.params.fileId);
        // Only runtime dependencies with known formats are safe to serve unchanged.
        // VOMD, XML, generic JSON and archives can contain unreleased metadata.
        if (
          !/\.(html|voud|vocs)$/i.test(file.originalName) ||
          !(await this.files.isRuntimeDependencyFile(acpId, file.originalName))
        )
          this.denyRawData();
      }
    }
    if (
      controller === "ViewsController" &&
      handler === "exportAllPersonalItemDataCsv"
    )
      this.denyRawData();
    if (controller === "ItemsController") {
      if (
        handler === "getItems" &&
        (req.query?.filter ||
          (req.query?.sortBy && !policy.allowsField(req.query.sortBy)))
      ) {
        throw new ForbiddenException(
          "Filter oder Sortierung verwenden nicht freigegebene Informationen",
        );
      }
      if (handler === "getItemTags" && !policy.allows("system:tags"))
        return of({});
    }
    return next.handle().pipe(
      mergeMap(async (response) => {
        if (response !== undefined)
          await this.states.assertColumnPolicyCurrent(acpId, policy);
        if (
          controller === "ItemsController" &&
          ["getResponseState", "getResponseStateWithFallback"].includes(handler)
        )
          return response;
        if (controller === "ReviewController" && handler === "getReview") {
          return policy.projectReviewManifest(response);
        }
        if (
          controller === "ViewsController" &&
          handler === "getSequence" &&
          req.query?.kind === "booklet"
        ) {
          return response == null
            ? response
            : policy.projectReviewBooklet(response);
        }
        if (
          controller === "ViewsController" &&
          ["getSequences", "getSequence"].includes(handler)
        ) {
          return policy.projectResponse(response, "sequences");
        }
        if (controller === "FilesController" && handler === "getUnitView") {
          return policy.projectResponse(response, "units");
        }
        if (
          controller === "ViewsController" &&
          ["getUnit", "getUnits"].includes(handler)
        ) {
          return policy.projectResponse(response, "units");
        }
        return policy.projectResponse(response);
      }),
    );
  }

  private denyRawData(): never {
    throw new ForbiddenException(
      "Dieser Rohdatenzugriff ist wegen der veröffentlichten Spaltenfreigabe gesperrt",
    );
  }
}
