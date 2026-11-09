import {
  ExplorerReadGuard,
  ExplorerEditGuard,
} from "../auth/capabilities/explorer-access.guard";
import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Delete,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Body,
  Request,
  Put,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiConsumes,
  ApiBody,
  ApiProperty,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { ItemsService } from "./items.service";
import { ItemResponseStateService } from "./item-response-state.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { IsObject } from "class-validator";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { UuidParam } from "../common/uuid-param";

type ItemParameterImportKind = "item-parameters" | "empirical-difficulty";
type ItemParameterImportTarget = "draft" | "published";

interface ItemParameterImportCommand {
  apId: string;
  fileBuffer: Buffer;
  kind: ItemParameterImportKind;
  target: ItemParameterImportTarget;
  baseVersion?: number;
  confirmWarnings?: boolean;
  user?: unknown;
}

class SaveItemTagsDto {
  @ApiProperty({
    description: "Map of item UUID to tag list",
    type: "object",
    additionalProperties: { type: "array", items: { type: "string" } },
  })
  @IsObject()
  tags!: Record<string, string[]>;
}

@ApiTags("Items")
@Controller("ap/:apId/items")
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly stateService: ItemResponseStateService,
    private readonly itemExplorerStateService: ItemExplorerStateService,
  ) {}

  @Get()
  @UseGuards(ExplorerReadGuard)
  @ApiOperation({
    summary: "List all items in an AP (with optional filter/sort)",
  })
  @ApiQuery({ name: "filter", required: false })
  @ApiQuery({ name: "sortBy", required: false })
  @ApiQuery({ name: "sortDir", required: false, enum: ["asc", "desc"] })
  async getItems(
    @UuidParam("apId") apId: string,
    @Query("filter") filter?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: "asc" | "desc",
    @Request() req?: any,
  ) {
    await this.assertCanReadItemList(apId, req);
    return this.itemsService.getFilteredItems(apId, filter, sortBy, sortDir);
  }

  @Get("tags")
  @UseGuards(JwtAuthGuard, ExplorerReadGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get persisted item tags for an AP" })
  async getItemTags(@UuidParam("apId") apId: string, @Request() req: any) {
    const isManager = req.user?.isAppAdmin || req.apAccessLevel === "MANAGER";
    if (
      !req.apCapabilities?.includes("item-explorer:edit") &&
      !isManager &&
      !(await this.itemsService.canUseItemTags(apId))
    ) {
      throw new ForbiddenException("Item tags are not enabled for this AP");
    }
    return this.itemsService.getItemTags(apId);
  }

  @Put("tags")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Persist item tags for an AP" })
  async saveItemTags(
    @UuidParam("apId") apId: string,
    @Body() dto: SaveItemTagsDto,
    @Request() req: any,
  ) {
    const isManager = req.user?.isAppAdmin || req.apAccessLevel === "MANAGER";
    if (
      !req.apCapabilities?.includes("item-explorer:edit") &&
      !isManager &&
      !(await this.itemsService.canUseItemTags(apId))
    ) {
      throw new ForbiddenException("Item tags are not enabled for this AP");
    }
    const actor = this.itemExplorerStateService.resolveActor(req?.user, apId);
    const result = await this.itemExplorerStateService.publishTagsImmediately(
      apId,
      dto.tags || {},
      {
        actor,
        changeType: "REPLACE_ITEM_TAGS",
      },
    );
    return result.tags;
  }

  @Get(":itemId")
  @UseGuards(ExplorerReadGuard)
  @ApiOperation({ summary: "Get a single item by ID" })
  async getItem(
    @UuidParam("apId") apId: string,
    @Param("itemId") itemId: string,
    @Request() req?: any,
  ) {
    await this.assertCanReadItemList(apId, req);
    return this.itemsService.getItem(apId, itemId);
  }

  @Post("upload-item-parameters")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Upload a wide CSV with empirical and additional item parameters",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadItemParameters(
    @UuidParam("apId") apId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query("draft") draft?: string,
    @Query("baseVersion") baseVersion?: string,
    @Request() req?: any,
    @Query("confirmWarnings") confirmWarnings?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("A CSV file is required");
    }
    return this.runItemParameterImport({
      apId,
      fileBuffer: file.buffer,
      kind: "item-parameters",
      target: draft === "true" ? "draft" : "published",
      baseVersion: this.parseBaseVersion(baseVersion),
      confirmWarnings: confirmWarnings === "true",
      user: req?.user,
    });
  }

  @Post("upload-empirical-difficulty")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Upload a CSV to match empirical item difficulties",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadEmpiricalDifficulties(
    @UuidParam("apId") apId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query("draft") draft?: string,
    @Query("baseVersion") baseVersion?: string,
    @Request() req?: any,
    @Query("confirmWarnings") confirmWarnings?: string,
  ) {
    return this.runItemParameterImport({
      apId,
      fileBuffer: file.buffer,
      kind: "empirical-difficulty",
      target: draft === "true" ? "draft" : "published",
      baseVersion: this.parseBaseVersion(baseVersion),
      confirmWarnings: confirmWarnings === "true",
      user: req?.user,
    });
  }

  @Delete("empirical-difficulty")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Clear all empirical difficulties for an AP" })
  async clearEmpiricalDifficulties(
    @UuidParam("apId") apId: string,
    @Query("draft") draft?: string,
    @Query("baseVersion") baseVersion?: string,
    @Request() req?: any,
  ) {
    const draftMode = draft === "true";
    const parsedBaseVersion = parseInt(baseVersion || "", 10);

    if (!draftMode) {
      const currentState =
        await this.itemExplorerStateService.getStateForViewer(apId, true);
      this.assertCleanExplorerStateForDirectWrite(currentState.status);
      const clearResult = await this.itemsService.clearEmpiricalDifficulties(
        apId,
        {
          persist: false,
          itemPropertiesOverride: currentState.publishedState.itemProperties,
        },
      );
      if (
        JSON.stringify(clearResult.nextItemProperties) !==
        JSON.stringify(currentState.publishedState.itemProperties)
      ) {
        const actor = this.itemExplorerStateService.resolveActor(
          req?.user,
          apId,
        );
        await this.itemExplorerStateService.publishItemPropertiesImmediately(
          apId,
          clearResult.nextItemProperties as Record<
            string,
            Record<string, unknown>
          >,
          {
            actor,
            changeType: "CLEAR_EMPIRICAL_DIFFICULTY",
            baseVersion: currentState.version,
          },
        );
      }
      return clearResult;
    }

    const currentState = await this.itemExplorerStateService.getStateForViewer(
      apId,
      true,
    );
    const clearResult = await this.itemsService.clearEmpiricalDifficulties(
      apId,
      {
        persist: false,
        itemPropertiesOverride: currentState.draftState.itemProperties,
      },
    );

    const actor = this.itemExplorerStateService.resolveActor(req?.user, apId);
    const explorerState = await this.itemExplorerStateService.patchDraft(
      apId,
      {
        itemProperties: clearResult.nextItemProperties as Record<
          string,
          Record<string, unknown>
        >,
      },
      {
        actor,
        changeType: "CLEAR_EMPIRICAL_DIFFICULTY",
        baseVersion: Number.isNaN(parsedBaseVersion)
          ? undefined
          : parsedBaseVersion,
      },
    );

    return {
      success: true,
      explorerState,
    };
  }

  @Get("response-state/all")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get all response states for an AP (Manager only)",
  })
  async getAllResponseStates(
    @UuidParam("apId") apId: string,
    @Request() _req: any,
  ) {
    return this.stateService.getAllStatesForAp(apId, true);
  }

  // Response State Endpoints

  @Post(":itemId/response-state")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Save response state for an item (Manager only)" })
  async saveResponseState(
    @UuidParam("apId") apId: string,
    @Param("itemId") itemId: string,
    @Body()
    body: {
      unitId: string;
      rowKey?: string;
      responseData: Record<string, any>;
    },
    @Request() _req: any,
  ) {
    return this.stateService.saveResponseState(
      apId,
      itemId,
      body.unitId,
      body.responseData,
      true,
      body.rowKey,
    );
  }

  @Get(":itemId/response-state")
  @UseGuards(ExplorerReadGuard)
  @ApiOperation({ summary: "Get response state for an item" })
  async getResponseState(
    @UuidParam("apId") apId: string,
    @Param("itemId") itemId: string,
    @Query("unitId") unitId?: string,
    @Query("rowKey") rowKey?: string,
  ) {
    if (!unitId) {
      throw new BadRequestException('Query parameter "unitId" is required.');
    }
    const state = await this.stateService.getResponseState(
      apId,
      itemId,
      unitId,
      rowKey,
    );
    return state || { state: null };
  }

  @Post(":itemId/response-state/with-fallback")
  @UseGuards(ExplorerReadGuard)
  @ApiOperation({
    summary:
      "Get response state for an item with fallback to previous items in same unit",
  })
  async getResponseStateWithFallback(
    @UuidParam("apId") apId: string,
    @Param("itemId") itemId: string,
    @Body()
    body: {
      unitId: string;
      rowKey?: string;
      itemList: { itemId: string; unitId: string; rowKey?: string }[];
    },
  ) {
    return this.stateService.getResponseStateWithFallback(
      apId,
      itemId,
      body.unitId,
      body.itemList,
      body.rowKey,
    );
  }

  @Delete(":itemId/response-state")
  @UseGuards(JwtAuthGuard, ExplorerEditGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete response state for an item (Manager only)" })
  async deleteResponseState(
    @UuidParam("apId") apId: string,
    @Param("itemId") itemId: string,
    @Query("unitId") unitId: string | undefined,
    @Request() _req: any,
    @Query("rowKey") rowKey?: string,
  ) {
    if (!unitId) {
      throw new BadRequestException('Query parameter "unitId" is required.');
    }
    return this.stateService.deleteResponseState(
      apId,
      itemId,
      unitId,
      true,
      rowKey,
    );
  }

  private async runItemParameterImport(command: ItemParameterImportCommand) {
    const currentState = await this.itemExplorerStateService.getStateForViewer(
      command.apId,
      true,
    );
    if (command.target === "published") {
      this.assertCleanExplorerStateForDirectWrite(currentState.status);
    }

    const itemProperties =
      command.target === "draft"
        ? currentState.draftState.itemProperties
        : currentState.publishedState.itemProperties;
    const uploadResult =
      command.kind === "empirical-difficulty"
        ? await this.itemsService.uploadEmpiricalDifficulties(
            command.apId,
            command.fileBuffer,
            {
              persist: false,
              itemPropertiesOverride: itemProperties,
              ...(command.confirmWarnings ? { confirmWarnings: true } : {}),
            },
          )
        : await this.itemsService.uploadItemParameters(
            command.apId,
            command.fileBuffer,
            {
              persist: false,
              itemPropertiesOverride: itemProperties,
              ...(command.confirmWarnings ? { confirmWarnings: true } : {}),
            },
          );
    if (uploadResult.requiresConfirmation) {
      return {
        updated: uploadResult.updated,
        failed: uploadResult.failed,
        successes: uploadResult.successes,
        warnings: uploadResult.warnings,
        requiresConfirmation: true,
      };
    }
    const importedEmpiricalDifficulty =
      command.kind === "empirical-difficulty"
        ? uploadResult.updated > 0
        : this.hasImportedEmpiricalDifficulty(uploadResult.successes);
    const actor = this.itemExplorerStateService.resolveActor(
      command.user,
      command.apId,
    );
    const changeType =
      command.kind === "empirical-difficulty"
        ? "CSV_UPLOAD_EMPIRICAL_DIFFICULTY"
        : "CSV_UPLOAD_ITEM_PARAMETERS";

    if (command.target === "published") {
      if (uploadResult.updated > 0) {
        await this.itemExplorerStateService.publishItemPropertiesImmediately(
          command.apId,
          uploadResult.nextItemProperties,
          {
            actor,
            changeType,
            baseVersion: currentState.version,
          },
        );
      }
      const showOnlyItemsWithEmpiricalDifficulty = importedEmpiricalDifficulty
        ? await this.itemsService.ensureShowOnlyItemsWithEmpiricalDifficulty(
            command.apId,
          )
        : undefined;
      return {
        ...uploadResult,
        showOnlyItemsWithEmpiricalDifficulty,
      };
    }

    if (command.kind === "item-parameters" && uploadResult.updated === 0) {
      return {
        updated: 0,
        failed: uploadResult.failed,
        successes: uploadResult.successes,
        warnings: uploadResult.warnings,
        requiresConfirmation: uploadResult.requiresConfirmation,
        explorerState: currentState,
      };
    }

    const explorerState = await this.itemExplorerStateService.patchDraft(
      command.apId,
      { itemProperties: uploadResult.nextItemProperties },
      {
        actor,
        changeType,
        baseVersion: command.baseVersion,
      },
    );
    const showOnlyItemsWithEmpiricalDifficulty = importedEmpiricalDifficulty
      ? await this.itemsService.ensureShowOnlyItemsWithEmpiricalDifficulty(
          command.apId,
        )
      : undefined;

    return {
      updated: uploadResult.updated,
      failed: uploadResult.failed,
      successes: uploadResult.successes,
      warnings: uploadResult.warnings,
      requiresConfirmation: uploadResult.requiresConfirmation,
      showOnlyItemsWithEmpiricalDifficulty,
      explorerState,
    };
  }

  private parseBaseVersion(baseVersion?: string): number | undefined {
    const parsedBaseVersion = parseInt(baseVersion || "", 10);
    return Number.isNaN(parsedBaseVersion) ? undefined : parsedBaseVersion;
  }

  private assertCleanExplorerStateForDirectWrite(status: string): void {
    if (status === "DIRTY") {
      throw new ConflictException(
        "Direct item-property changes are not allowed while an Item Explorer draft is pending. Use draft mode or publish/discard the draft first.",
      );
    }
  }

  private async assertCanReadItemList(apId: string, req?: any): Promise<void> {
    const isManager =
      req?.user?.isAppAdmin ||
      req?.apAccessLevel === "MANAGER" ||
      req?.apAccessLevel === "ADMIN";
    if (
      !req?.apCapabilities?.some((c: string) =>
        c.startsWith("item-explorer:"),
      ) &&
      !isManager &&
      !(await this.itemsService.canUseItemList(apId))
    ) {
      throw new ForbiddenException("Item list is not enabled for this AP");
    }
  }

  private hasImportedEmpiricalDifficulty(successes: unknown): boolean {
    return (
      Array.isArray(successes) &&
      successes.some((success) => {
        if (!success || typeof success !== "object") return false;
        const fields = (success as { fields?: unknown }).fields;
        const value = (success as { value?: unknown }).value;
        return (
          Array.isArray(fields) &&
          fields.includes("est") &&
          typeof value === "number" &&
          Number.isFinite(value)
        );
      })
    );
  }
}
