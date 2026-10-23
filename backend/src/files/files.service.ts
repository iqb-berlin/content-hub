import { ReviewManifestService } from "../review/review-manifest.service";
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import {
  AcpFile,
  Acp,
  AcpAccessConfig,
  ItemResponseState,
} from "../database/entities";
import {
  findUnitInIndex,
  findUnitInPart,
  findUnitsInIndex,
  getAssessmentParts,
  getIndexUnits,
  toRuntimeAcpIndex,
} from "../acp/acp-index.utils";
import { normalizeFeatureConfig } from "../acp/feature-config.utils";
import { UnitParserService } from "./unit-parser.service";
import {
  ValidationService,
  AutoValidationSummary,
} from "../validation/validation.service";
import { FileProcessingProgressReporter } from "./file-processing-progress";
import { parseItemRowKeyParts } from "../items/item-row-key.util";
import { assertUuidParam } from "../common/uuid-param";
import {
  FileMutationService,
  UploadMultipleOptions,
} from "./file-mutation.service";
import { FileStorageService } from "./file-storage.service";
export type FilePreviewMode =
  | "text"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "structured"
  | "binary";
export type FilePreviewTextFormat =
  | "text"
  | "json"
  | "xml"
  | "csv"
  | "html"
  | "markdown";

export interface FilePreviewUnitXmlData {
  type: "unit-xml";
  unitId: string;
  unitLabel: string;
  description?: string;
  references: {
    definition?: string;
    player?: string;
    codingScheme?: string;
    metadata?: string;
  };
}

export interface FilePreviewVomdData {
  type: "vomd";
  itemCount: number;
  unitProfileCount: number;
  metadataColumns: { id: string; label: string }[];
  unitProfiles: { id: string; label: string; value: string }[];
  items: {
    id: string;
    description: string;
    variableId?: string;
    sourceVariable?: string;
    variableReadOnlyId?: string;
    metadata: Record<string, string>;
  }[];
}

export interface FilePreviewVocsData {
  type: "vocs";
  variableCount: number;
  codeCount: number;
  variables: {
    id: string;
    label: string;
    manualInstruction?: string;
    codeCount: number;
    codes: {
      id: string;
      label: string;
      score: string;
      manualInstruction?: string;
    }[];
  }[];
}

export interface FilePreviewVoudData {
  type: "voud";
  pageCount: number;
  variableRefCount: number;
  topLevelKeys: string[];
  identifierPreview: string[];
  pages: {
    pageNumber: number;
    variableRefs: string[];
    alwaysVisible: string[];
  }[];
}

export interface FilePreviewCsvData {
  type: "csv";
  delimiter: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: string[][];
}

export type FileStructuredPreviewData =
  | FilePreviewUnitXmlData
  | FilePreviewVomdData
  | FilePreviewVocsData
  | FilePreviewVoudData
  | FilePreviewCsvData;

export interface FilePreviewResponse {
  fileId: string;
  originalName: string;
  mimeType: string | null;
  extension: string;
  mode: FilePreviewMode;
  textFormat?: FilePreviewTextFormat;
  textContent?: string;
  truncated: boolean;
  lineCount?: number;
  characterCount?: number;
  structuredData?: FileStructuredPreviewData | null;
}

const TEXT_PREVIEW_MAX_CHARACTERS = 50000;
const STRUCTURED_PREVIEW_MAX_ITEMS = 20;
const STRUCTURED_PREVIEW_MAX_COLUMNS = 12;
const STRUCTURED_PREVIEW_MAX_PAGES = 12;

@Injectable()
export class FilesService {
  private readonly storagePath: string;

  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    @InjectRepository(ItemResponseState)
    private readonly itemResponseStateRepository: Repository<ItemResponseState>,
    private readonly configService: ConfigService,
    private readonly unitParserService: UnitParserService,
    private readonly validationService: ValidationService,
    private readonly fileMutationService: FileMutationService,
    private readonly fileStorageService: FileStorageService,
    private readonly reviewManifestService: ReviewManifestService,
  ) {
    this.storagePath = this.configService.get<string>(
      "FILE_STORAGE_PATH",
      "./uploads",
    );
  }

  async findByAcp(acpId: string): Promise<AcpFile[]> {
    await this.getAcpOrFail(acpId);
    return this.findFileRecordsByAcp(acpId);
  }

  private async findFileRecordsByAcp(acpId: string): Promise<AcpFile[]> {
    return this.fileRepository.find({
      where: { acpId },
      order: { originalName: "ASC" },
    });
  }

  async findById(id: string): Promise<AcpFile> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }
    return file;
  }

  async findByIdForAcp(acpId: string, id: string): Promise<AcpFile> {
    const file = await this.findById(id);
    if (file.acpId !== acpId) {
      throw new NotFoundException(
        `File with ID ${id} not found for ACP ${acpId}`,
      );
    }
    return file;
  }

  async upload(
    acpId: string,
    uploadedFile: Express.Multer.File,
  ): Promise<AcpFile> {
    const file = await this.fileMutationService.upload(acpId, uploadedFile);
    this.unitParserService.invalidateFileCaches(acpId);
    return file;
  }

  async uploadMultiple(
    acpId: string,
    files: Express.Multer.File[],
    options: UploadMultipleOptions = {},
  ): Promise<AcpFile[]> {
    const savedFiles = await this.fileMutationService.uploadMultiple(
      acpId,
      files,
      options,
    );
    this.unitParserService.invalidateFileCaches(acpId);
    return savedFiles;
  }

  async download(id: string): Promise<{ buffer: Buffer; file: AcpFile }> {
    const file = await this.findById(id);
    try {
      const buffer = await this.fileStorageService.read(file);
      return { buffer, file };
    } catch {
      throw new NotFoundException("File not found on disk");
    }
  }

  async downloadForAcp(
    acpId: string,
    id: string,
  ): Promise<{ buffer: Buffer; file: AcpFile }> {
    const file = await this.findByIdForAcp(acpId, id);
    try {
      const buffer = await this.fileStorageService.read(file);
      return { buffer, file };
    } catch {
      throw new NotFoundException("File not found on disk");
    }
  }

  async delete(id: string): Promise<void> {
    const file = await this.findById(id);
    await this.fileMutationService.deleteMultiple(file.acpId, [file.id]);
    this.unitParserService.invalidateFileCaches(file.acpId);
  }

  async deleteForAcp(acpId: string, id: string): Promise<void> {
    const file = await this.findByIdForAcp(acpId, id);
    await this.fileMutationService.deleteMultiple(acpId, [file.id]);
    this.unitParserService.invalidateFileCaches(acpId);
  }

  async deleteManyForAcp(acpId: string, ids: string[]): Promise<string[]> {
    const normalizedIds = Array.from(
      new Set(
        (ids || [])
          .map((id) => String(id || "").trim())
          .filter((id) => id.length > 0),
      ),
    );

    if (!normalizedIds.length) {
      throw new BadRequestException("At least one file ID is required");
    }

    const files = await this.findByAcp(acpId);
    const filesById = new Map(files.map((file) => [file.id, file]));
    const missingIds = normalizedIds.filter((id) => !filesById.has(id));
    if (missingIds.length) {
      throw new NotFoundException(
        `Files not found for ACP ${acpId}: ${missingIds.join(", ")}`,
      );
    }

    const filesToDelete = normalizedIds.map((id) => filesById.get(id)!);
    await this.fileMutationService.deleteMultiple(
      acpId,
      filesToDelete.map((file) => file.id),
    );
    this.unitParserService.invalidateFileCaches(acpId);
    return normalizedIds;
  }

  async deleteAll(acpId: string): Promise<void> {
    const files = await this.findByAcp(acpId);
    if (files.length) {
      await this.fileMutationService.deleteMultiple(
        acpId,
        files.map((file) => file.id),
      );
    }
    this.unitParserService.invalidateFileCaches(acpId);
  }

  async cleanupOrphanedResponseStates(acpId: string): Promise<{
    totalStates: number;
    deletedStates: number;
    keptStates: number;
  }> {
    const existingStates = await this.itemResponseStateRepository.find({
      where: { acpId },
      select: {
        id: true,
        unitId: true,
        itemId: true,
        rowKey: true,
      },
    });

    if (!existingStates.length) {
      return {
        totalStates: 0,
        deletedStates: 0,
        keptStates: 0,
      };
    }

    const fileItemList =
      await this.unitParserService.getItemListFromFiles(acpId);
    const validKeys = new Set<string>();
    const validItemUuids = new Set<string>();
    for (const item of fileItemList.items || []) {
      validKeys.add(item.rowKey);
      validKeys.add(`${item.unitId}::${item.itemId}`);
      if (item.uuid) {
        validItemUuids.add(item.uuid);
      }
    }

    const staleStateIds = existingStates
      .filter((state) => {
        if (validKeys.has(state.rowKey)) {
          return false;
        }
        const partialRow = parseItemRowKeyParts(state.rowKey);
        return !partialRow || !validItemUuids.has(partialRow.itemUuid);
      })
      .map((state) => state.id);

    if (staleStateIds.length) {
      await this.itemResponseStateRepository.delete(staleStateIds);
    }

    return {
      totalStates: existingStates.length,
      deletedStates: staleStateIds.length,
      keptStates: existingStates.length - staleStateIds.length,
    };
  }

  async cleanupReferencesAfterFileMutation(
    acpId: string,
    options: { skipValidation?: boolean } = {},
    progress?: FileProcessingProgressReporter,
  ): Promise<{
    cleanupReport: {
      unitsUpdated: number;
      dependenciesRemoved: number;
      bookletsUpdated: number;
      bookletDefinitionsRemoved: number;
      indexUpdated: boolean;
    };
    responseStateCleanup: {
      totalStates: number;
      deletedStates: number;
      keptStates: number;
    };
    validationSummary?: AutoValidationSummary;
  }> {
    await progress?.startPhase("cleanup-overwrite", 2, {
      message: "Verweise und Antwortdaten werden nach dem Ersetzen bereinigt.",
    });
    const cleanupReport =
      await this.unitParserService.pruneMissingDependencies(acpId);
    await progress?.advance({ message: "Index-Verweise bereinigt" });
    const responseStateCleanup =
      await this.cleanupOrphanedResponseStates(acpId);
    await progress?.advance({ message: "Antwortdaten bereinigt" });

    if (options.skipValidation) {
      await progress?.completePhase("Bereinigung nach Ersetzen abgeschlossen.");
      return {
        cleanupReport,
        responseStateCleanup,
      };
    }

    const validationRun =
      await this.validationService.autoValidateUploadedFiles(
        acpId,
        await this.findByAcp(acpId),
      );

    await progress?.completePhase("Bereinigung nach Ersetzen abgeschlossen.");
    return {
      cleanupReport,
      responseStateCleanup,
      validationSummary: validationRun.summary,
    };
  }

  async getValidationResult(
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const file = await this.findById(id);
    return (file.validationResult as Record<string, unknown>) || null;
  }

  async getValidationResultForAcp(
    acpId: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const file = await this.findByIdForAcp(acpId, id);
    return (file.validationResult as Record<string, unknown>) || null;
  }

  async updateValidationResult(
    id: string,
    result: Record<string, unknown>,
  ): Promise<AcpFile> {
    const file = await this.findById(id);
    file.validationResult = result;
    return this.fileRepository.save(file);
  }

  async getPreviewForAcp(
    acpId: string,
    id: string,
  ): Promise<FilePreviewResponse> {
    const file = await this.findByIdForAcp(acpId, id);
    const extension = this.getFileExtension(file.originalName);
    const mimeType = this.normalizeMimeType(file.fileType);

    if (this.isImagePreview(extension, mimeType)) {
      return this.buildBasePreview(file, extension, "image");
    }

    if (this.isPdfPreview(extension, mimeType)) {
      return this.buildBasePreview(file, extension, "pdf");
    }

    if (this.isAudioPreview(extension, mimeType)) {
      return this.buildBasePreview(file, extension, "audio");
    }

    if (this.isVideoPreview(extension, mimeType)) {
      return this.buildBasePreview(file, extension, "video");
    }

    if (!this.isTextPreviewCandidate(extension, mimeType)) {
      return this.buildBasePreview(file, extension, "binary");
    }

    const rawContent = await this.readTextFileForPreview(file);
    const textFormat = this.getTextFormat(extension);
    let formattedContent = rawContent;
    let structuredData: FileStructuredPreviewData | null = null;
    let mode: FilePreviewMode = "text";

    if (textFormat === "json") {
      const parsedJson = this.tryParseJson(rawContent);
      if (parsedJson !== null) {
        formattedContent = JSON.stringify(parsedJson, null, 2);
      }
    }

    if (extension === "xml") {
      const structuredXml = this.buildUnitXmlPreview(rawContent);
      if (structuredXml) {
        structuredData = structuredXml;
        mode = "structured";
      }
    } else if (extension === "vomd") {
      const structuredVomd = this.buildVomdPreview(rawContent);
      if (structuredVomd) {
        structuredData = structuredVomd;
        mode = "structured";
        formattedContent = JSON.stringify(
          this.tryParseJson(rawContent),
          null,
          2,
        );
      }
    } else if (extension === "vocs") {
      const structuredVocs = this.buildVocsPreview(rawContent);
      if (structuredVocs) {
        structuredData = structuredVocs;
        mode = "structured";
        formattedContent = JSON.stringify(
          this.tryParseJson(rawContent),
          null,
          2,
        );
      }
    } else if (extension === "voud") {
      const structuredVoud = this.buildVoudPreview(rawContent);
      if (structuredVoud) {
        structuredData = structuredVoud;
        mode = "structured";
        formattedContent = JSON.stringify(
          this.tryParseJson(rawContent),
          null,
          2,
        );
      }
    } else if (extension === "csv" || extension === "tsv") {
      const structuredCsv = this.buildCsvPreview(rawContent, extension);
      if (structuredCsv) {
        structuredData = structuredCsv;
        mode = "structured";
      }
    }

    return this.buildTextPreview(
      file,
      extension,
      formattedContent,
      textFormat,
      mode,
      structuredData,
    );
  }

  async createUnitZip(
    acpId: string,
    unitId: string,
    partId?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const index = await this.getAcpIndex(acpId);
    const allFiles = await this.findByAcp(acpId);
    const unitFiles = this.collectUnitFiles(
      index,
      allFiles,
      unitId,
      true,
      partId,
    );
    if (!unitFiles.length) {
      throw new NotFoundException(`No files found for unit "${unitId}"`);
    }

    const buffer = await this.createZipBuffer(unitFiles);
    return {
      buffer,
      fileName: `acp-${acpId}${partId ? `-part-${partId}` : ""}-unit-${unitId}.zip`,
    };
  }

  async createSequenceZip(
    acpId: string,
    sequenceId: string,
    kind?: "booklet",
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const index = await this.getAcpIndex(acpId);
    const allFiles = await this.findByAcp(acpId);
    const sequence =
      kind === "booklet"
        ? {
            partId: getAssessmentParts(index).find((part: any) =>
              (part.instruments || []).some((instrument: any) =>
                (instrument.testcenterBooklet || []).some(
                  (booklet: any) => booklet.id === sequenceId,
                ),
              ),
            )?.id,
            unitIds: [
              ...new Set(
                (await this.reviewManifestService.getManifest(acpId)).booklets
                  .find((entry) => !entry.legacy && entry.id === sequenceId)
                  ?.units.map((unit) => unit.id) || [],
              ),
            ],
          }
        : this.resolveSequenceUnitIds(index, sequenceId);

    if (!sequence.unitIds.length) {
      throw new NotFoundException(`Sequence "${sequenceId}" not found`);
    }

    const fileMap = new Map<string, AcpFile>();
    for (const unitId of sequence.unitIds) {
      const unitFiles = this.collectUnitFiles(
        index,
        allFiles,
        unitId,
        false,
        sequence.partId,
      );
      for (const file of unitFiles) {
        fileMap.set(file.id, file);
      }
    }

    const files = Array.from(fileMap.values());
    if (!files.length) {
      throw new NotFoundException(
        `No files found for sequence "${sequenceId}"`,
      );
    }

    const buffer = await this.createZipBuffer(files);
    return { buffer, fileName: `acp-${acpId}-sequence-${sequenceId}.zip` };
  }

  async createFilesZip(
    acpId: string,
    ids?: string[],
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const { files, fileName } = await this.resolveFilesForArchive(acpId, ids);
    const buffer = await this.createZipBuffer(files);
    return { buffer, fileName };
  }

  async createFilesZipArchive(
    acpId: string,
    ids?: string[],
    progress?: FileProcessingProgressReporter,
  ): Promise<{ filePath: string; fileName: string }> {
    const { files, fileName } = await this.resolveFilesForArchive(acpId, ids);
    const totalSourceBytes = this.getArchiveSourceBytesTotal(files);
    if (progress) {
      await progress.startPhase("zip-files", totalSourceBytes, {
        phaseLabel: "ZIP wird erstellt",
        message: this.buildArchiveProgressMessage(
          0,
          files.length,
          0,
          totalSourceBytes,
        ),
      });
    }

    const buffer = await this.createZipBuffer(files, progress);
    const archiveDir = path.join(this.storagePath, acpId, "__archives");
    await fs.mkdir(archiveDir, { recursive: true });

    const archivePath = path.join(archiveDir, `${crypto.randomUUID()}.zip`);
    await fs.writeFile(archivePath, buffer);

    if (progress) {
      await progress.completePhase("ZIP-Datei ist erstellt.");
    }

    return { filePath: archivePath, fileName };
  }

  async getFeatureConfig(acpId: string): Promise<Record<string, any>> {
    await this.getAcpOrFail(acpId);
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    return normalizeFeatureConfig(config?.featureConfig || {}) as Record<
      string,
      any
    >;
  }

  async isRuntimeDependencyFile(
    acpId: string,
    fileName: string,
  ): Promise<boolean> {
    const units = getIndexUnits(await this.getAcpIndex(acpId));
    const isRuntime = (dependency: any) =>
      ["PLAYER", "UNIT_DEFINITION", "CODING_SCHEME"].includes(
        dependency?.type,
      ) &&
      (dependency.id === fileName || dependency.originalName === fileName);
    for (const unit of units) {
      if ((unit.dependencies || []).some(isRuntime)) return true;
      // The uploaded Unit XML can be newer than the stored index dependency list.
      const view = await this.unitParserService.getUnitViewFromFiles(
        acpId,
        unit.id,
      );
      if ((view?.dependencies || []).some(isRuntime)) return true;
    }
    return false;
  }

  async isUnitDependencyFile(
    acpId: string,
    fileName: string,
  ): Promise<boolean> {
    const index = await this.getAcpIndex(acpId);
    for (const unit of getIndexUnits(index)) {
      if (`${unit.id}.xml` === fileName) {
        return true;
      }

      for (const dep of unit.dependencies || []) {
        if (dep?.id && dep.id === fileName) {
          return true;
        }
      }
    }
    return false;
  }

  private async getAcpOrFail(acpId: string): Promise<Acp> {
    assertUuidParam(acpId, "ACP ID");
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }
    return acp;
  }

  private buildBasePreview(
    file: AcpFile,
    extension: string,
    mode: FilePreviewMode,
  ): FilePreviewResponse {
    return {
      fileId: file.id,
      originalName: file.originalName,
      mimeType: file.fileType || null,
      extension,
      mode,
      truncated: false,
    };
  }

  private buildTextPreview(
    file: AcpFile,
    extension: string,
    fullContent: string,
    textFormat: FilePreviewTextFormat,
    mode: FilePreviewMode = "text",
    structuredData: FileStructuredPreviewData | null = null,
  ): FilePreviewResponse {
    const characterCount = fullContent.length;
    const truncated = characterCount > TEXT_PREVIEW_MAX_CHARACTERS;
    const textContent = truncated
      ? fullContent.slice(0, TEXT_PREVIEW_MAX_CHARACTERS)
      : fullContent;

    return {
      fileId: file.id,
      originalName: file.originalName,
      mimeType: file.fileType || null,
      extension,
      mode,
      textFormat,
      textContent,
      truncated,
      lineCount: this.countLines(fullContent),
      characterCount,
      structuredData,
    };
  }

  private async readTextFileForPreview(file: AcpFile): Promise<string> {
    try {
      return await fs.readFile(file.filePath, "utf-8");
    } catch {
      throw new NotFoundException("File not found on disk");
    }
  }

  private buildUnitXmlPreview(content: string): FilePreviewUnitXmlData | null {
    if (!content.includes("<Unit")) {
      return null;
    }

    const parsed = this.unitParserService.parseUnitXml(content, "preview.xml");
    if (!parsed) {
      return null;
    }

    return {
      type: "unit-xml",
      unitId: parsed.unitId,
      unitLabel: parsed.unitLabel,
      description: parsed.description,
      references: {
        definition: parsed.definitionRef || undefined,
        player: parsed.playerRef || undefined,
        codingScheme: parsed.codingSchemeRef,
        metadata: parsed.metadataRef,
      },
    };
  }

  private buildVomdPreview(content: string): FilePreviewVomdData | null {
    const parsed = this.unitParserService.parseVomd(content);
    if (!parsed) {
      return null;
    }

    const metadataColumns = new Map<string, string>();
    const unitProfiles = this.extractPreviewEntries(
      (parsed.unitProfiles || []).flatMap((profile: any) =>
        Array.isArray(profile?.entries) ? profile.entries : [],
      ),
    ).slice(0, STRUCTURED_PREVIEW_MAX_COLUMNS);

    const items = (parsed.items || [])
      .slice(0, STRUCTURED_PREVIEW_MAX_ITEMS)
      .map((item: any) => {
        const profiles = Array.isArray(item?.profiles) ? item.profiles : [];
        const entries = this.extractPreviewEntries(
          profiles.flatMap((profile: any) =>
            Array.isArray(profile?.entries) ? profile.entries : [],
          ),
        );

        const metadata = entries.reduce<Record<string, string>>(
          (acc, entry) => {
            if (entry.id && !metadataColumns.has(entry.id)) {
              metadataColumns.set(entry.id, entry.label || entry.id);
            }
            if (entry.id) {
              acc[entry.id] = entry.value;
            }
            return acc;
          },
          {},
        );

        return {
          id: String(item?.id || ""),
          description: String(item?.description || item?.label || ""),
          variableId: this.pickFirstNonEmptyString([item?.variableId]),
          sourceVariable: this.pickFirstNonEmptyString([item?.sourceVariable]),
          variableReadOnlyId: this.pickFirstNonEmptyString([
            item?.variableReadOnlyId,
          ]),
          metadata,
        };
      });

    return {
      type: "vomd",
      itemCount: Array.isArray(parsed.items) ? parsed.items.length : 0,
      unitProfileCount: Array.isArray(parsed.unitProfiles)
        ? parsed.unitProfiles.length
        : 0,
      metadataColumns: Array.from(metadataColumns.entries()).map(
        ([id, label]) => ({
          id,
          label,
        }),
      ),
      unitProfiles,
      items,
    };
  }

  private buildVocsPreview(content: string): FilePreviewVocsData | null {
    const parsed = this.tryParseJson(content);
    if (!parsed) {
      return null;
    }

    const variablesRaw = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.variableCodings)
        ? ((parsed as Record<string, unknown>).variableCodings as any[])
        : [];

    const variableCount = variablesRaw.length;
    const codeCount = variablesRaw.reduce((sum, variable: any) => {
      const codesRaw = Array.isArray(variable?.codes) ? variable.codes : [];
      return sum + codesRaw.length;
    }, 0);

    const variables = variablesRaw.map((variable: any) => {
      const codesRaw = Array.isArray(variable?.codes) ? variable.codes : [];

      return {
        id: String(variable?.id || ""),
        label:
          this.readLocalizedText(variable?.label) ||
          String(variable?.id || "Variable"),
        manualInstruction: this.readTextValue(variable?.manualInstruction),
        codeCount: codesRaw.length,
        codes: codesRaw.map((code: any) => ({
          id:
            code?.id === null || typeof code?.id === "undefined"
              ? "null"
              : String(code.id),
          label:
            this.readLocalizedText(code?.label) ||
            this.readTextValue(code?.manualInstruction) ||
            "",
          score:
            code?.score === null || typeof code?.score === "undefined"
              ? ""
              : String(code.score),
          manualInstruction: this.readTextValue(code?.manualInstruction),
        })),
      };
    });

    return {
      type: "vocs",
      variableCount,
      codeCount,
      variables,
    };
  }

  private buildVoudPreview(content: string): FilePreviewVoudData | null {
    const parsed = this.tryParseJson(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const pages = Array.isArray((parsed as Record<string, unknown>).pages)
      ? ((parsed as Record<string, unknown>).pages as any[])
      : [];
    const identifiers = this.collectNestedStringValues(
      parsed,
      ["id", "alias"],
      ["visibilityRules"],
    );

    return {
      type: "voud",
      pageCount: pages.length,
      variableRefCount: identifiers.length,
      topLevelKeys: Object.keys(parsed).slice(
        0,
        STRUCTURED_PREVIEW_MAX_COLUMNS,
      ),
      identifierPreview: identifiers.slice(0, STRUCTURED_PREVIEW_MAX_ITEMS),
      pages: pages
        .slice(0, STRUCTURED_PREVIEW_MAX_PAGES)
        .map((page, index) => ({
          pageNumber: index + 1,
          variableRefs: this.collectNestedStringValues(
            page,
            ["id", "alias"],
            ["visibilityRules"],
          ).slice(0, STRUCTURED_PREVIEW_MAX_ITEMS),
          alwaysVisible: this.collectNestedStringValues(page, [
            "alwaysVisible",
          ]).slice(0, STRUCTURED_PREVIEW_MAX_ITEMS),
        })),
    };
  }

  private buildCsvPreview(
    content: string,
    extension: string,
  ): FilePreviewCsvData | null {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.replace(/\r/g, ""))
      .filter((line) => line.length > 0);

    if (!lines.length) {
      return {
        type: "csv",
        delimiter: extension === "tsv" ? "\\t" : ",",
        rowCount: 0,
        columnCount: 0,
        headers: [],
        rows: [],
      };
    }

    const delimiter =
      extension === "tsv" ? "\t" : this.detectCsvDelimiter(lines[0]);
    const parsedRows = lines.map((line) => this.parseCsvLine(line, delimiter));
    const headers = parsedRows[0] || [];

    return {
      type: "csv",
      delimiter: delimiter === "\t" ? "\\t" : delimiter,
      rowCount: Math.max(parsedRows.length - 1, 0),
      columnCount: headers.length,
      headers,
      rows: parsedRows.slice(1, STRUCTURED_PREVIEW_MAX_ITEMS + 1),
    };
  }

  private extractPreviewEntries(
    entries: unknown[],
  ): { id: string; label: string; value: string }[] {
    return (entries || [])
      .map((entry: any) => {
        const id = String(entry?.id || "").trim();
        if (!id) {
          return null;
        }

        return {
          id,
          label: this.readLocalizedText(entry?.label) || id,
          value:
            this.readLocalizedText(entry?.valueAsText) ||
            this.readTextValue(entry?.value) ||
            "",
        };
      })
      .filter(
        (entry): entry is { id: string; label: string; value: string } =>
          entry !== null,
      );
  }

  private collectNestedStringValues(
    node: unknown,
    targetKeys: string[],
    ignoredParents: string[] = [],
  ): string[] {
    const values = new Set<string>();
    const ignoredParentSet = new Set(ignoredParents);

    const visit = (value: unknown, parentKey?: string) => {
      if (ignoredParentSet.has(parentKey || "")) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((entry) => visit(entry, parentKey));
        return;
      }

      if (typeof value !== "object" || value === null) {
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        if (targetKeys.includes(key)) {
          this.asStringList(child).forEach((entry) => values.add(entry));
        }

        if (!ignoredParentSet.has(key)) {
          visit(child, key);
        }
      }
    };

    visit(node);
    return Array.from(values);
  }

  private asStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.asStringList(entry));
    }

    const normalized = this.readTextValue(value);
    return normalized ? [normalized] : [];
  }

  private readLocalizedText(value: unknown): string {
    if (Array.isArray(value)) {
      const localized = value
        .map((entry) => {
          if (typeof entry === "string") {
            return entry.trim();
          }
          if (typeof entry === "object" && entry !== null && "value" in entry) {
            return this.readTextValue((entry as Record<string, unknown>).value);
          }
          return "";
        })
        .find((entry) => entry.length > 0);

      return localized || "";
    }

    if (typeof value === "object" && value !== null && "value" in value) {
      return this.readTextValue((value as Record<string, unknown>).value);
    }

    return this.readTextValue(value);
  }

  private readTextValue(value: unknown): string {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value).trim();
    }
    return "";
  }

  private pickFirstNonEmptyString(values: unknown[]): string | undefined {
    return values
      .map((value) => this.readTextValue(value))
      .find((value) => value.length > 0);
  }

  private tryParseJson(content: string): unknown | null {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private getFileExtension(fileName: string): string {
    return path.extname(fileName).replace(/^\./, "").trim().toLowerCase();
  }

  private normalizeMimeType(mimeType?: string): string {
    return String(mimeType || "")
      .trim()
      .toLowerCase();
  }

  private isImagePreview(extension: string, mimeType: string): boolean {
    return (
      mimeType.startsWith("image/") ||
      ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "svgz"].includes(
        extension,
      )
    );
  }

  private isPdfPreview(extension: string, mimeType: string): boolean {
    return extension === "pdf" || mimeType === "application/pdf";
  }

  private isAudioPreview(extension: string, mimeType: string): boolean {
    return (
      mimeType.startsWith("audio/") ||
      ["mp3", "wav", "ogg", "m4a", "aac"].includes(extension)
    );
  }

  private isVideoPreview(extension: string, mimeType: string): boolean {
    return (
      mimeType.startsWith("video/") ||
      ["mp4", "webm", "mov", "m4v", "ogv"].includes(extension)
    );
  }

  private isTextPreviewCandidate(extension: string, mimeType: string): boolean {
    if (mimeType.startsWith("text/")) {
      return true;
    }

    if (
      mimeType.includes("json") ||
      mimeType.includes("xml") ||
      mimeType.includes("javascript")
    ) {
      return true;
    }

    return [
      "txt",
      "json",
      "xml",
      "csv",
      "tsv",
      "md",
      "html",
      "htm",
      "voud",
      "vomd",
      "vocs",
      "log",
      "yml",
      "yaml",
      "ini",
      "properties",
    ].includes(extension);
  }

  private getTextFormat(extension: string): FilePreviewTextFormat {
    if (["json", "voud", "vomd", "vocs"].includes(extension)) {
      return "json";
    }
    if (extension === "xml") {
      return "xml";
    }
    if (extension === "csv" || extension === "tsv") {
      return "csv";
    }
    if (extension === "html" || extension === "htm") {
      return "html";
    }
    if (extension === "md") {
      return "markdown";
    }
    return "text";
  }

  private countLines(content: string): number {
    if (!content) {
      return 0;
    }
    return content.split(/\r?\n/).length;
  }

  private detectCsvDelimiter(headerLine: string): string {
    const candidates = [",", ";", "\t"];
    const ranked = candidates
      .map((delimiter) => ({
        delimiter,
        columns: this.parseCsvLine(headerLine, delimiter).length,
      }))
      .sort((a, b) => b.columns - a.columns);

    return ranked[0]?.columns > 1 ? ranked[0].delimiter : ",";
  }

  private parseCsvLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
        continue;
      }

      current += char;
    }

    result.push(current.trim());
    return result;
  }

  private async getAcpIndex(acpId: string): Promise<any> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }
    return toRuntimeAcpIndex(acp.acpIndex);
  }

  private resolveSequenceUnitIds(
    index: any,
    sequenceId: string,
  ): { partId?: string; unitIds: string[] } {
    const parts = getAssessmentParts(index);
    for (const part of parts) {
      for (const module of part.bookletModules || []) {
        if (module.id === sequenceId) {
          return {
            partId: part.id,
            unitIds: (module.units || [])
              .slice()
              .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
              .map((u: any) => u.id)
              .filter(
                (id: unknown): id is string =>
                  typeof id === "string" && id.length > 0,
              ),
          };
        }
      }
    }
    return { unitIds: [] };
  }

  private collectUnitFiles(
    index: any,
    allFiles: AcpFile[],
    unitId: string,
    throwOnMissingUnit = true,
    partId?: string,
  ): AcpFile[] {
    const matches = findUnitsInIndex(index, unitId);
    if (!partId && matches.length > 1) {
      throw new ConflictException({
        message: `Unit ${unitId} exists in multiple assessment parts`,
        possibleParts: matches.map((entry) => entry.partId),
      });
    }
    const unit = partId
      ? findUnitInPart(index, partId, unitId)
      : matches[0]?.unit || findUnitInIndex(index, unitId);
    if (!unit) {
      if (throwOnMissingUnit) {
        throw new NotFoundException(`Unit "${unitId}" not found`);
      }
      return [];
    }

    const dependencyNames = new Set<string>();
    let hasUnitIndexDependency = false;
    for (const dep of unit.dependencies || []) {
      if (dep?.id && typeof dep.id === "string") {
        dependencyNames.add(dep.id);
        if (dep.type === "UNIT_INDEX") hasUnitIndexDependency = true;
      }
    }

    // Most ACP exports include one XML per unit; include it if available.
    if (!hasUnitIndexDependency) dependencyNames.add(`${unitId}.xml`);

    return allFiles.filter(
      (file) =>
        dependencyNames.has(file.relativePath || file.originalName) ||
        dependencyNames.has(file.originalName),
    );
  }

  private async createZipBuffer(
    files: AcpFile[],
    progress?: FileProcessingProgressReporter,
  ): Promise<Buffer> {
    // JSZip is already part of the backend dependency tree.
    // Use dynamic require here to avoid TypeScript type dependency friction.
    const JSZip = require("jszip");
    const zip = new JSZip();

    let added = 0;
    let processedBytes = 0;
    const totalSourceBytes = this.getArchiveSourceBytesTotal(files);
    for (const [index, file] of files.entries()) {
      const fileBytes = this.getArchiveProgressBytes(file);
      try {
        const data = await fs.readFile(file.filePath);
        zip.file(file.relativePath || file.originalName, data);
        added++;
      } catch {
        // Ignore missing on-disk files; we still zip what is available.
      } finally {
        processedBytes += fileBytes;
        if (progress) {
          await progress.advance({
            delta: fileBytes,
            message: this.buildArchiveProgressMessage(
              index + 1,
              files.length,
              processedBytes,
              totalSourceBytes,
            ),
          });
        }
      }
    }

    if (added === 0) {
      throw new NotFoundException(
        "None of the selected files are available on disk",
      );
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    return buffer as Buffer;
  }

  private getArchiveSourceBytesTotal(files: AcpFile[]): number {
    return files.reduce(
      (sum, file) => sum + this.getArchiveProgressBytes(file),
      0,
    );
  }

  private getArchiveProgressBytes(file: AcpFile): number {
    const fileSize = Number(file.fileSize || 0);
    return Number.isFinite(fileSize) && fileSize > 0 ? fileSize : 0;
  }

  private buildArchiveProgressMessage(
    processedFiles: number,
    totalFiles: number,
    processedBytes: number,
    totalBytes: number,
  ): string {
    return (
      `${processedFiles} von ${totalFiles} Datei(en), ` +
      `${this.formatProgressBytes(processedBytes)} von ${this.formatProgressBytes(totalBytes)} verarbeitet`
    );
  }

  private formatProgressBytes(bytes: number): string {
    const normalizedBytes = Math.max(Number(bytes) || 0, 0);
    if (normalizedBytes < 1024) {
      return `${normalizedBytes} B`;
    }
    if (normalizedBytes < 1024 * 1024) {
      return `${(normalizedBytes / 1024).toFixed(1)} KB`;
    }
    if (normalizedBytes < 1024 * 1024 * 1024) {
      return `${(normalizedBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(normalizedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private async resolveFilesForArchive(
    acpId: string,
    ids?: string[],
  ): Promise<{ files: AcpFile[]; fileName: string }> {
    const allFiles = await this.findByAcp(acpId);
    if (!allFiles.length) {
      throw new NotFoundException(`No files found for ACP "${acpId}"`);
    }

    const normalizedIds = Array.from(
      new Set(
        (ids || [])
          .map((id) => String(id || "").trim())
          .filter((id) => id.length > 0),
      ),
    );

    if (!normalizedIds.length) {
      return {
        files: allFiles,
        fileName: `acp-${acpId}-all-files.zip`,
      };
    }

    const filesById = new Map(allFiles.map((file) => [file.id, file]));
    const missingIds = normalizedIds.filter((id) => !filesById.has(id));
    if (missingIds.length) {
      throw new NotFoundException(
        `Files not found for ACP ${acpId}: ${missingIds.join(", ")}`,
      );
    }

    return {
      files: normalizedIds.map((id) => filesById.get(id)!),
      fileName: `acp-${acpId}-selected-files.zip`,
    };
  }
}
