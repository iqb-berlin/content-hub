import { ReviewManifestService } from "../review/review-manifest.service";
import {
  parseBookletXml,
  BookletStructureError,
} from "../review/booklet-parser";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as fs from "fs/promises";
import { AcpFile, Acp } from "../database/entities";
import {
  ACP_INDEX_ALLOWED_STATUS_VALUES,
  getAssessmentParts,
  getIndexScales,
  getIndexUnits,
  toRuntimeAcpIndex,
} from "../acp/acp-index.utils";
import { FileProcessingProgressReporter } from "../files/file-processing-progress";

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  field?: string;
  path?: string;
  scope?: "syntactic" | "schema" | "semantic";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  timestamp: string;
}

export interface AutoValidationSummary {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  semanticValid: boolean;
  semanticIssueCount: number;
  timestamp: string;
}

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    private readonly reviewManifestService: ReviewManifestService,
  ) {}

  /**
   * Validate a single file (syntactic validation).
   */
  async validateFile(
    file: AcpFile,
    buffer: Buffer,
    persist = true,
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    // Check file extension and apply format-specific validation
    const name = file.originalName.toLowerCase();

    if (name.endsWith(".json")) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(buffer.toString("utf-8"));
      } catch (e: any) {
        issues.push({
          severity: "error",
          message: `Invalid JSON: ${e.message}`,
          scope: "syntactic",
        });
      }
      if (parsedJson !== undefined) {
        issues.push(...this.validateJsonSchema(file.originalName, parsedJson));
      }
    } else if (name.endsWith(".xml")) {
      // Basic XML well-formedness check
      const content = buffer.toString("utf-8");
      if (/<Booklet(?:\s|>)/.test(content)) {
        try {
          parseBookletXml(content, file.originalName);
        } catch (e) {
          if (!(e instanceof BookletStructureError)) throw e;
          issues.push({
            severity: "error",
            scope: "schema",
            message: e.message,
            path: e.path,
          });
        }
      }
      if (!content.trim().startsWith("<")) {
        issues.push({
          severity: "error",
          message: "File does not appear to be valid XML",
          scope: "syntactic",
        });
      }
    }

    if (buffer.length === 0) {
      issues.push({
        severity: "warning",
        message: "File is empty",
        scope: "syntactic",
      });
    }

    const result: ValidationResult = {
      valid: !issues.some((i) => i.severity === "error"),
      issues,
      timestamp: new Date().toISOString(),
    };

    if (persist) {
      // Store validation result
      file.validationResult = result as any;
      await this.fileRepository.save(file);
    }

    return result;
  }

  /**
   * Validate freshly uploaded files automatically and persist per-file results.
   * Merges syntactic/schema checks with ACP-wide semantic checks.
   */
  async autoValidateUploadedFiles(
    acpId: string,
    files: AcpFile[],
    progress?: FileProcessingProgressReporter,
    persistResults = true,
  ): Promise<{ files: AcpFile[]; summary: AutoValidationSummary }> {
    if (!files.length) {
      return {
        files: [],
        summary: {
          totalFiles: 0,
          validFiles: 0,
          invalidFiles: 0,
          semanticValid: true,
          semanticIssueCount: 0,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const syntacticAndSchemaResults = new Map<string, ValidationResult>();

    await progress?.startPhase("validate-files", files.length, {
      message:
        files.length > 0
          ? "Dateien werden syntaktisch und gegen das Schema geprueft."
          : "Keine Dateien zur Validierung vorhanden.",
    });

    for (const file of files) {
      try {
        const buffer = await fs.readFile(file.filePath);
        const result = await this.validateFile(file, buffer, false);
        syntacticAndSchemaResults.set(file.id, result);
      } catch {
        syntacticAndSchemaResults.set(file.id, {
          valid: false,
          issues: [
            {
              severity: "error",
              message: "File is missing on disk and could not be validated",
              scope: "syntactic",
            },
          ],
          timestamp: new Date().toISOString(),
        });
      }
      await progress?.advance({ message: file.originalName });
    }

    await progress?.completePhase("Dateivaliderung abgeschlossen.");

    const semanticResult = await this.validateAcpConsistency(acpId, progress);
    const semanticIssues = semanticResult.issues.map((issue) => ({
      ...issue,
      scope: "semantic" as const,
    }));

    const now = new Date().toISOString();
    const validatedEntries = files.map((file) => {
      const fileResult = syntacticAndSchemaResults.get(file.id) || {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "Validation result missing",
            scope: "syntactic" as const,
          },
        ],
        timestamp: now,
      };
      const mergedIssues = [...fileResult.issues, ...semanticIssues];
      const mergedResult: ValidationResult = {
        valid: fileResult.valid && semanticResult.valid,
        issues: mergedIssues,
        timestamp: now,
      };
      file.validationResult = mergedResult as unknown as Record<
        string,
        unknown
      >;
      return { file, result: mergedResult };
    });
    const validatedFiles = validatedEntries.map((entry) => entry.file);

    if (persistResults) await this.fileRepository.save(validatedFiles);

    const validFiles = validatedEntries.filter(
      (entry) => entry.result.valid,
    ).length;

    return {
      files: validatedFiles,
      summary: {
        totalFiles: validatedFiles.length,
        validFiles,
        invalidFiles: validatedFiles.length - validFiles,
        semanticValid: semanticResult.valid,
        semanticIssueCount: semanticResult.issues.length,
        timestamp: now,
      },
    };
  }

  /**
   * Semantic validation: check cross-references within an ACP.
   */
  async validateAcpConsistency(
    acpId: string,
    progress?: FileProcessingProgressReporter,
  ): Promise<ValidationResult> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      return {
        valid: false,
        issues: [{ severity: "error", message: "ACP not found" }],
        timestamp: new Date().toISOString(),
      };
    }

    const issues: ValidationIssue[] = [];
    const index = toRuntimeAcpIndex(acp.acpIndex);
    const units = getIndexUnits(index);
    const unitIds = new Set(
      units
        .map((u: any) => (typeof u?.id === "string" ? u.id : ""))
        .filter((id: string) => id.length > 0),
    );
    const files = await this.fileRepository.find({ where: { acpId } });
    const fileNames = new Set(files.map((f) => f.originalName));
    const assessmentParts = getAssessmentParts(index);
    const scalesInParts =
      this.collectScaleEntriesFromAssessmentParts(assessmentParts);
    const scaleEntries = scalesInParts.length
      ? scalesInParts
      : this.collectScaleEntriesFromLegacyTopLevel(index);
    const semanticTotal =
      units.reduce(
        (count, unit: any) =>
          count +
          (Array.isArray(unit?.dependencies) ? unit.dependencies.length : 0),
        0,
      ) +
      assessmentParts.reduce((count, part: any) => {
        const modules = Array.isArray(part?.bookletModules)
          ? part.bookletModules
          : [];
        const moduleUnitRefs = modules.reduce(
          (sum: number, module: any) =>
            sum + (Array.isArray(module?.units) ? module.units.length : 0),
          0,
        );
        const instruments = Array.isArray(part?.instruments)
          ? part.instruments
          : [];
        const bookletDefinitionChecks = instruments.reduce(
          (sum: number, instrument: any) =>
            sum +
            (Array.isArray(instrument?.testcenterBooklet)
              ? instrument.testcenterBooklet.length
              : 0),
          0,
        );
        const moduleRefChecks = instruments.reduce(
          (sum: number, instrument: any) => {
            const booklets = Array.isArray(instrument?.testcenterBooklet)
              ? instrument.testcenterBooklet
              : [];
            return (
              sum +
              booklets.reduce(
                (bookletSum: number, booklet: any) =>
                  bookletSum +
                  (Array.isArray(booklet?.modules)
                    ? booklet.modules.length
                    : 0),
                0,
              )
            );
          },
          0,
        );

        return (
          count + moduleUnitRefs + bookletDefinitionChecks + moduleRefChecks
        );
      }, 0) +
      scaleEntries.reduce((count, scaleEntry: any) => {
        const items = Array.isArray(scaleEntry.scale?.items)
          ? scaleEntry.scale.items
          : Array.isArray(scaleEntry.scale?.typeParameters?.items)
            ? scaleEntry.scale.typeParameters.items
            : [];
        return count + items.length;
      }, 0);

    await progress?.startPhase("validate-semantic", semanticTotal, {
      message:
        semanticTotal > 0
          ? "ACP-weite Referenzen und Skalen werden geprueft."
          : "Keine semantischen Referenzen zur Pruefung vorhanden.",
    });

    // Check that all unit dependencies reference existing files
    for (const [unitIndex, unit] of units.entries()) {
      const dependencies = Array.isArray(unit?.dependencies)
        ? unit.dependencies
        : [];
      for (const [depIndex, dep] of dependencies.entries()) {
        const depId = typeof dep?.id === "string" ? dep.id : "";
        if (!depId || !fileNames.has(depId)) {
          issues.push({
            severity: "error",
            message: `Unit "${unit.id}" references missing file: ${depId || "(unbekannt)"}`,
            path: `units[${unitIndex}].dependencies[${depIndex}].id`,
          });
        }
        await progress?.advance({
          message: `Unit ${unit?.id || "(unbekannt)"}`,
        });
      }
    }

    // Check that booklet modules reference existing units
    for (const [partIndex, part] of assessmentParts.entries()) {
      const modules = Array.isArray(part?.bookletModules)
        ? part.bookletModules
        : [];
      const moduleIds = new Set(
        modules
          .map((m: any) => (typeof m?.id === "string" ? m.id : ""))
          .filter((id: string) => id.length > 0),
      );

      for (const [moduleIndex, module] of modules.entries()) {
        const moduleUnitRefs = Array.isArray(module?.units) ? module.units : [];
        for (const [moduleUnitIndex, modUnit] of moduleUnitRefs.entries()) {
          const { id: moduleUnitId, pathSuffix } =
            this.resolveUnitReference(modUnit);
          const unitExists = !!moduleUnitId && unitIds.has(moduleUnitId);
          if (!unitExists) {
            issues.push({
              severity: "error",
              message: `Module "${module?.id || "(unbekannt)"}" references missing unit: ${moduleUnitId || "(unbekannt)"}`,
              path: `assessmentParts[${partIndex}].bookletModules[${moduleIndex}].units[${moduleUnitIndex}]${pathSuffix}`,
            });
          }
          await progress?.advance({
            message: `Modul ${module?.id || "(unbekannt)"}`,
          });
        }
      }

      // Check instruments reference existing modules
      const instruments = Array.isArray(part?.instruments)
        ? part.instruments
        : [];
      for (const [instrumentIndex, instrument] of instruments.entries()) {
        const booklets = Array.isArray(instrument?.testcenterBooklet)
          ? instrument.testcenterBooklet
          : [];
        for (const [bookletIndex, booklet] of booklets.entries()) {
          const definitionId =
            typeof booklet?.definitionId === "string"
              ? booklet.definitionId
              : "";
          if (definitionId && !fileNames.has(definitionId)) {
            issues.push({
              severity: "warning",
              message: `Instrument "${instrument?.id || "(unbekannt)"}" references missing booklet file: ${definitionId}`,
              path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}].testcenterBooklet[${bookletIndex}].definitionId`,
            });
          }
          await progress?.advance({
            message: `Instrument ${instrument?.id || "(unbekannt)"}`,
          });

          const moduleRefs = Array.isArray(booklet?.modules)
            ? booklet.modules
            : [];
          for (const [moduleRefIndex, modRef] of moduleRefs.entries()) {
            const { id: moduleRefId, pathSuffix } =
              this.resolveModuleReference(modRef);
            const moduleExists = !!moduleRefId && moduleIds.has(moduleRefId);
            if (!moduleExists) {
              issues.push({
                severity: "error",
                message: `Instrument "${instrument?.id || "(unbekannt)"}" references missing module: ${moduleRefId || "(unbekannt)"}`,
                path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}].testcenterBooklet[${bookletIndex}].modules[${moduleRefIndex}]${pathSuffix}`,
              });
            }
            await progress?.advance({
              message: `Instrument ${instrument?.id || "(unbekannt)"}`,
            });
          }
        }
      }
    }

    const manifest = await this.reviewManifestService.getManifest(acpId);
    issues.push(...manifest.issues);

    const knownItemIds = this.collectKnownItemIds(units);

    for (const scaleEntry of scaleEntries) {
      const scaleItems = Array.isArray(scaleEntry.scale?.items)
        ? scaleEntry.scale.items
        : Array.isArray(scaleEntry.scale?.typeParameters?.items)
          ? scaleEntry.scale.typeParameters.items
          : [];
      for (const [scaleItemIndex, scaleItem] of scaleItems.entries()) {
        const scaleItemId = this.resolveScaleItemId(scaleItem);
        if (!scaleItemId || !knownItemIds.has(scaleItemId)) {
          issues.push({
            severity: "warning",
            message: `Scale "${scaleEntry.scale?.id || "(unbekannt)"}" references unknown item: ${scaleItemId || "(unbekannt)"}`,
            path: `${scaleEntry.pathBase}.${Array.isArray(scaleEntry.scale?.items) ? "items" : "typeParameters.items"}[${scaleItemIndex}].id`,
          });
        }
        await progress?.advance({
          message: `Scale ${scaleEntry.scale?.id || "(unbekannt)"}`,
        });
      }
    }

    await progress?.completePhase("Semantische Validierung abgeschlossen.");

    return {
      valid: !issues.some((i) => i.severity === "error"),
      issues,
      timestamp: new Date().toISOString(),
    };
  }

  private validateJsonSchema(
    fileName: string,
    payload: unknown,
  ): ValidationIssue[] {
    if (!this.looksLikeAcpIndex(fileName, payload)) {
      return [];
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return [
        {
          severity: "error",
          message:
            "ACP-Index schema check failed: top-level JSON must be an object",
          scope: "schema",
          path: "$",
        },
      ];
    }

    const issues: ValidationIssue[] = [];
    const index = payload as Record<string, unknown>;

    if (typeof index.packageId !== "string" || !index.packageId.trim()) {
      issues.push({
        severity: "error",
        message:
          'ACP-Index schema: required field "packageId" is missing or empty',
        scope: "schema",
        path: "packageId",
      });
    }

    if (typeof index.version !== "string" || !index.version.trim()) {
      issues.push({
        severity: "error",
        message:
          'ACP-Index schema: required field "version" is missing or empty',
        scope: "schema",
        path: "version",
      });
    }

    if (
      typeof index.status !== "string" ||
      !ACP_INDEX_ALLOWED_STATUS_VALUES.includes(index.status as any)
    ) {
      issues.push({
        severity: "error",
        message: `ACP-Index schema: "status" must be one of ${ACP_INDEX_ALLOWED_STATUS_VALUES.join(", ")}`,
        scope: "schema",
        path: "status",
      });
    }

    if (!Array.isArray(index.assessmentParts)) {
      issues.push({
        severity: "error",
        message:
          'ACP-Index schema: required field "assessmentParts" must be an array',
        scope: "schema",
        path: "assessmentParts",
      });
      return issues;
    }

    for (
      let partIndex = 0;
      partIndex < index.assessmentParts.length;
      partIndex++
    ) {
      const part = index.assessmentParts[partIndex] as Record<string, unknown>;
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        issues.push({
          severity: "error",
          message: "ACP-Index schema: assessmentPart entry must be an object",
          scope: "schema",
          path: `assessmentParts[${partIndex}]`,
        });
        continue;
      }

      const modules = part.bookletModules;
      if (modules !== undefined && !Array.isArray(modules)) {
        issues.push({
          severity: "error",
          message: 'ACP-Index schema: "bookletModules" must be an array',
          scope: "schema",
          path: `assessmentParts[${partIndex}].bookletModules`,
        });
      }

      for (const [moduleIndex, moduleEntry] of (Array.isArray(modules)
        ? modules
        : []
      ).entries()) {
        const module = moduleEntry as Record<string, unknown>;
        if (!module || typeof module !== "object" || Array.isArray(module)) {
          issues.push({
            severity: "error",
            message: "ACP-Index schema: bookletModule entry must be an object",
            scope: "schema",
            path: `assessmentParts[${partIndex}].bookletModules[${moduleIndex}]`,
          });
          continue;
        }

        if (typeof module.id !== "string" || !module.id.trim()) {
          issues.push({
            severity: "error",
            message: 'ACP-Index schema: bookletModule requires non-empty "id"',
            scope: "schema",
            path: `assessmentParts[${partIndex}].bookletModules[${moduleIndex}].id`,
          });
        }

        if (module.units !== undefined && !Array.isArray(module.units)) {
          issues.push({
            severity: "error",
            message: 'ACP-Index schema: bookletModule "units" must be an array',
            scope: "schema",
            path: `assessmentParts[${partIndex}].bookletModules[${moduleIndex}].units`,
          });
        }
      }

      const instruments = part.instruments;
      if (instruments !== undefined && !Array.isArray(instruments)) {
        issues.push({
          severity: "error",
          message: 'ACP-Index schema: "instruments" must be an array',
          scope: "schema",
          path: `assessmentParts[${partIndex}].instruments`,
        });
      }

      for (const [instrumentIndex, instrumentEntry] of (Array.isArray(
        instruments,
      )
        ? instruments
        : []
      ).entries()) {
        const instrument = instrumentEntry as Record<string, unknown>;
        if (
          !instrument ||
          typeof instrument !== "object" ||
          Array.isArray(instrument)
        ) {
          issues.push({
            severity: "error",
            message: "ACP-Index schema: instrument entry must be an object",
            scope: "schema",
            path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}]`,
          });
          continue;
        }

        const booklets = instrument.testcenterBooklet;
        if (booklets !== undefined && !Array.isArray(booklets)) {
          issues.push({
            severity: "error",
            message:
              'ACP-Index schema: instrument "testcenterBooklet" must be an array',
            scope: "schema",
            path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}].testcenterBooklet`,
          });
          continue;
        }

        for (const [bookletIndex, bookletEntry] of (Array.isArray(booklets)
          ? booklets
          : []
        ).entries()) {
          const booklet = bookletEntry as Record<string, unknown>;
          if (
            !booklet ||
            typeof booklet !== "object" ||
            Array.isArray(booklet)
          ) {
            issues.push({
              severity: "error",
              message: "ACP-Index schema: booklet entry must be an object",
              scope: "schema",
              path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}].testcenterBooklet[${bookletIndex}]`,
            });
            continue;
          }

          if (
            booklet.modules !== undefined &&
            !Array.isArray(booklet.modules)
          ) {
            issues.push({
              severity: "error",
              message: 'ACP-Index schema: booklet "modules" must be an array',
              scope: "schema",
              path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}].testcenterBooklet[${bookletIndex}].modules`,
            });
            continue;
          }

          for (const [moduleRefIndex, moduleRef] of (Array.isArray(
            booklet.modules,
          )
            ? booklet.modules
            : []
          ).entries()) {
            if (!this.resolveModuleReferenceId(moduleRef)) {
              issues.push({
                severity: "error",
                message:
                  "ACP-Index schema: module reference must be string, {moduleId}, or {id}",
                scope: "schema",
                path: `assessmentParts[${partIndex}].instruments[${instrumentIndex}].testcenterBooklet[${bookletIndex}].modules[${moduleRefIndex}]`,
              });
            }
          }
        }
      }
    }

    return issues;
  }

  private looksLikeAcpIndex(fileName: string, payload: unknown): boolean {
    if (fileName.toLowerCase().includes("acp-index")) {
      return true;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    const root = payload as Record<string, unknown>;
    return (
      "assessmentParts" in root ||
      "packageId" in root ||
      "status" in root ||
      "version" in root
    );
  }

  private resolveModuleReferenceId(moduleRef: unknown): string | null {
    if (typeof moduleRef === "string" && moduleRef.trim().length > 0) {
      return moduleRef.trim();
    }
    if (moduleRef && typeof moduleRef === "object") {
      const ref = moduleRef as { moduleId?: unknown; id?: unknown };
      if (typeof ref.moduleId === "string" && ref.moduleId.trim().length > 0) {
        return ref.moduleId.trim();
      }
      if (typeof ref.id === "string" && ref.id.trim().length > 0) {
        return ref.id.trim();
      }
    }
    return null;
  }

  private resolveModuleReference(moduleRef: unknown): {
    id: string | null;
    pathSuffix: string;
  } {
    if (typeof moduleRef === "string") {
      const id = moduleRef.trim();
      return {
        id: id.length ? id : null,
        pathSuffix: "",
      };
    }
    if (moduleRef && typeof moduleRef === "object") {
      const ref = moduleRef as { moduleId?: unknown; id?: unknown };
      if (typeof ref.moduleId === "string") {
        const id = ref.moduleId.trim();
        return {
          id: id.length ? id : null,
          pathSuffix: ".moduleId",
        };
      }
      if (typeof ref.id === "string") {
        const id = ref.id.trim();
        return {
          id: id.length ? id : null,
          pathSuffix: ".id",
        };
      }
      return { id: null, pathSuffix: "" };
    }
    return { id: null, pathSuffix: "" };
  }

  private resolveUnitReference(unitRef: unknown): {
    id: string | null;
    pathSuffix: string;
  } {
    if (typeof unitRef === "string") {
      const id = unitRef.trim();
      return {
        id: id.length ? id : null,
        pathSuffix: "",
      };
    }
    if (unitRef && typeof unitRef === "object") {
      const ref = unitRef as { id?: unknown };
      if (typeof ref.id === "string") {
        const id = ref.id.trim();
        return {
          id: id.length ? id : null,
          pathSuffix: ".id",
        };
      }
      return { id: null, pathSuffix: "" };
    }
    return { id: null, pathSuffix: "" };
  }

  private collectKnownItemIds(units: any[]): Set<string> {
    const knownItemIds = new Set<string>();
    for (const unit of units) {
      const unitId = typeof unit?.id === "string" ? unit.id : "";
      const items = Array.isArray(unit?.items) ? unit.items : [];
      for (const item of items) {
        const itemId = typeof item?.id === "string" ? item.id : "";
        if (!itemId) continue;
        knownItemIds.add(itemId);
        if (unitId && item.useUnitAliasAsPrefix !== false) {
          knownItemIds.add(`${unitId}_${itemId}`);
        }
      }
    }
    return knownItemIds;
  }

  private resolveScaleItemId(scaleItem: unknown): string | null {
    if (typeof scaleItem === "string") {
      const id = scaleItem.trim();
      return id.length ? id : null;
    }
    if (scaleItem && typeof scaleItem === "object") {
      const entry = scaleItem as { id?: unknown };
      if (typeof entry.id === "string") {
        const id = entry.id.trim();
        return id.length ? id : null;
      }
    }
    return null;
  }

  private collectScaleEntriesFromAssessmentParts(
    assessmentParts: any[],
  ): Array<{ scale: any; pathBase: string }> {
    const entries: Array<{ scale: any; pathBase: string }> = [];
    for (const [partIndex, part] of assessmentParts.entries()) {
      for (const kind of ["baseScales", "scales"]) {
        const partScales = Array.isArray(part?.[kind]) ? part[kind] : [];
        for (const [scaleIndex, scale] of partScales.entries()) {
          entries.push({
            scale,
            pathBase: `assessmentParts[${partIndex}].${kind}[${scaleIndex}]`,
          });
        }
      }
    }
    return entries;
  }

  private collectScaleEntriesFromLegacyTopLevel(
    index: Record<string, unknown>,
  ): Array<{ scale: any; pathBase: string }> {
    const scales = getIndexScales(index);
    return scales.map((scale, scaleIndex) => ({
      scale,
      pathBase: `scales[${scaleIndex}]`,
    }));
  }
}
