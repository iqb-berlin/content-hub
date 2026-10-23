import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { promises as dns } from "dns";
import { isIP } from "net";
import * as ipaddr from "ipaddr.js";
import { Repository } from "typeorm";
import { Agent } from "undici";
import { migrateLegacyScales } from "./acp-scale-migration";
import { Acp, AcpExternalResourceCache, AcpFile } from "../database/entities";
import { SnapshotsService } from "../snapshots/snapshots.service";
import {
  getAssessmentParts,
  normalizeIndexForStorage,
} from "./acp-index.utils";
import {
  AcpExternalCheck,
  AcpIndexMigrationPreview,
  AcpIndexValidationIssue,
  AcpIndexValidationReport,
} from "./acp-index.types";

const ACP_SCHEMA_ID = "acp-index@0.6" as const;
const RELEASED_STATUSES = new Set(["RELEASED_PUBLIC", "RELEASED_CONFIDENTIAL"]);
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NORMAL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PUBLISH_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EXTERNAL_BYTES = 1024 * 1024;

@Injectable()
export class AcpIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AcpIndexService.name);
  private readonly validateSchema: ValidateFunction;

  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(AcpExternalResourceCache)
    private readonly cacheRepository: Repository<AcpExternalResourceCache>,
    private readonly snapshotsService: SnapshotsService,
  ) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const metadataSchema = require("./schemas/metadata-values-3.0.schema.json");
    const unitSchema = require("./schemas/acp-unit-0.5.schema.json");
    const baseScaleSchema = require("./schemas/acp-scale-base-0.4.schema.json");
    const derivedScaleSchema = require("./schemas/acp-scale-derived-0.4.schema.json");
    const indexSchema = require("./schemas/acp-index-0.6.schema.json");
    ajv.addSchema(metadataSchema);
    ajv.addSchema(
      metadataSchema,
      "https://w3id.org/iqb/spec/metadata-values/3.0",
    );
    ajv.addSchema(unitSchema);
    ajv.addSchema(unitSchema, "https://w3id.org/iqb/spec/acp-unit/0.5");
    ajv.addSchema(baseScaleSchema);
    ajv.addSchema(
      baseScaleSchema,
      "https://w3id.org/iqb/spec/acp-scale-base/0.4",
    );
    ajv.addSchema(derivedScaleSchema);
    ajv.addSchema(
      derivedScaleSchema,
      "https://w3id.org/iqb/spec/acp-scale-derived/0.4",
    );
    this.validateSchema = ajv.compile(indexSchema);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      const acps = await this.acpRepository.find({ select: { id: true } });
      for (const acp of acps) {
        await this.validateStoredIndex(acp.id, {
          external: false,
          persist: true,
        });
      }
    } catch (error) {
      this.logger.warn(
        `ACP index inventory could not be completed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  createEmptyIndex(
    acp: Pick<Acp, "packageId" | "name" | "description">,
  ): Record<string, unknown> {
    return {
      packageId: acp.packageId,
      version: "0.5.0",
      name: [{ lang: "de", value: acp.name || acp.packageId }],
      ...(acp.description
        ? { description: [{ lang: "de", value: acp.description }] }
        : {}),
      status: "IN_DEVELOPMENT",
    };
  }

  async validateStoredIndex(
    acpId: string,
    options: {
      external?: boolean;
      forPublication?: boolean;
      persist?: boolean;
    } = {},
  ): Promise<AcpIndexValidationReport> {
    const acp = await this.getAcp(acpId);
    const report = await this.validateCandidate(acpId, acp.acpIndex, options);
    if (options.persist !== false) {
      await this.persistValidationReport(acp, report);
    }
    return report;
  }

  async validateCandidate(
    acpId: string,
    candidate: Record<string, unknown>,
    options: { external?: boolean; forPublication?: boolean } = {},
  ): Promise<AcpIndexValidationReport> {
    const issues: AcpIndexValidationIssue[] = [];
    const externalChecks: AcpExternalCheck[] = [];
    const schemaValid = this.validateSchema(candidate);
    if (!schemaValid) {
      issues.push(...this.mapSchemaErrors(this.validateSchema.errors || []));
    }
    if (
      typeof candidate.version === "string" &&
      !SEMVER_PATTERN.test(candidate.version)
    ) {
      issues.push(
        this.issue(
          "INVALID_SEMVER",
          "schema",
          "error",
          "/version",
          "version muss SemVer entsprechen.",
        ),
      );
    }

    const files = await this.fileRepository.find({ where: { acpId } });
    this.validateSemantics(candidate, files, issues);
    if (options.external) {
      await this.validateScaleVocabularies(
        candidate,
        issues,
        externalChecks,
        Boolean(options.forPublication),
      );
      await this.validateMetadata(
        candidate,
        issues,
        externalChecks,
        Boolean(options.forPublication),
      );
    }
    const errorCount = issues.filter(
      (entry) => entry.severity === "error",
    ).length;
    return {
      schemaId: ACP_SCHEMA_ID,
      valid:
        schemaValid &&
        !issues.some(
          (entry) => entry.scope === "schema" && entry.severity === "error",
        ),
      publishable:
        schemaValid &&
        errorCount === 0 &&
        externalChecks.every(
          (entry) => entry.status === "valid" || entry.status === "cached",
        ),
      checkedAt: new Date().toISOString(),
      issues,
      externalChecks,
    };
  }

  async saveCandidate(
    acpId: string,
    candidateInput: Record<string, unknown>,
    expectedUpdatedAt?: string,
    options: {
      allowReleasedStatus?: boolean;
      itemProperties?: Record<string, Record<string, unknown>>;
      name?: string;
      description?: string;
    } = {},
  ): Promise<Acp> {
    const acp = await this.getAcp(acpId);
    this.assertExpectedUpdatedAt(acp, expectedUpdatedAt);
    if (RELEASED_STATUSES.has(String(acp.acpIndex?.status || ""))) {
      throw new ConflictException(
        "Published ACP must be reopened before it can be changed",
      );
    }
    const candidate = normalizeIndexForStorage(candidateInput);
    if (candidate.packageId !== acp.packageId) {
      throw new UnprocessableEntityException(
        "packageId must match the ACP packageId",
      );
    }
    if (
      !options.allowReleasedStatus &&
      RELEASED_STATUSES.has(String(candidate.status || ""))
    ) {
      throw new UnprocessableEntityException(
        "Released status can only be set through the publish endpoint",
      );
    }
    const report = await this.validateCandidate(acpId, candidate);
    if (!report.valid) {
      throw new UnprocessableEntityException({
        message: "ACP index violates acp-index@0.6",
        report,
      });
    }
    return this.saveLocked(
      acpId,
      expectedUpdatedAt || acp.updatedAt.toISOString(),
      (locked) => {
        if (RELEASED_STATUSES.has(String(locked.acpIndex?.status || ""))) {
          throw new ConflictException(
            "Published ACP must be reopened before it can be changed",
          );
        }
        if (locked.packageId !== candidate.packageId) {
          throw new UnprocessableEntityException(
            "packageId must match the ACP packageId",
          );
        }
        locked.acpIndex = candidate;
        locked.acpIndexSchemaId = ACP_SCHEMA_ID;
        locked.acpIndexValidationStatus = report.publishable
          ? "CONFORMANT"
          : "CONFORMANT_WITH_ISSUES";
        locked.acpIndexValidationReport = report as unknown as Record<
          string,
          unknown
        >;
        if (options.itemProperties)
          locked.itemProperties = options.itemProperties;
        if (options.name !== undefined) locked.name = options.name;
        if (options.description !== undefined)
          locked.description = options.description;
      },
    );
  }

  async migrationPreview(acpId: string): Promise<AcpIndexMigrationPreview> {
    const acp = await this.getAcp(acpId);
    const candidate = structuredClone(acp.acpIndex || {});
    const changes: Array<{ path: string; message: string }> = [];
    const migrationIssues: AcpIndexValidationIssue[] = [];
    const candidateItemProperties = structuredClone(acp.itemProperties || {});
    const legacyUnits = Array.isArray((candidate as any).units)
      ? (candidate as any).units
      : [];
    const legacyScales = Array.isArray((candidate as any).scales)
      ? (candidate as any).scales
      : [];
    let parts = Array.isArray((candidate as any).assessmentParts)
      ? (candidate as any).assessmentParts
      : [];

    if ((legacyUnits.length || legacyScales.length) && !parts.length) {
      parts = [
        {
          id: "default-assessment-part",
          name: [{ lang: "de", value: "Default Assessment Part" }],
          units: legacyUnits,
          ...(legacyScales.length ? { scales: legacyScales } : {}),
          bookletModules: [],
          instruments: [],
        },
      ];
      changes.push({
        path: "/assessmentParts",
        message:
          "Top-Level-Units und -Skalen in einen Assessment-Part verschoben.",
      });
    } else if (parts.length) {
      if (legacyUnits.length)
        parts[0].units = [...(parts[0].units || []), ...legacyUnits];
      if (legacyScales.length)
        parts[0].scales = [...(parts[0].scales || []), ...legacyScales];
    }
    delete (candidate as any).units;
    delete (candidate as any).scales;
    if (parts.length) (candidate as any).assessmentParts = parts;
    else delete (candidate as any).assessmentParts;

    for (const [partIndex, part] of parts.entries()) {
      migrationIssues.push(
        ...migrateLegacyScales(part, `/assessmentParts/${partIndex}`, changes),
      );
      for (const [unitIndex, unit] of (part.units || []).entries()) {
        if (unit.dependencies && !Array.isArray(unit.dependencies)) {
          unit.dependencies = [unit.dependencies];
          changes.push({
            path: `/assessmentParts/${partIndex}/units/${unitIndex}/dependencies`,
            message: "Dependency-Objekt in Array umgewandelt.",
          });
        }
        for (const dependency of unit.dependencies || []) {
          const mapped = this.mapLegacyDependencyType(dependency.type);
          if (mapped !== dependency.type) {
            changes.push({
              path: `/assessmentParts/${partIndex}/units/${unitIndex}/dependencies`,
              message: `${dependency.type} nach ${mapped} migriert.`,
            });
            dependency.type = mapped;
          }
          if (
            typeof dependency.id === "string" &&
            dependency.id.startsWith("./")
          ) {
            dependency.id = dependency.id.replace(/^\.\/+/, "");
            changes.push({
              path: `/assessmentParts/${partIndex}/units/${unitIndex}/dependencies`,
              message: "Relativen Dateipfad kanonisch normalisiert.",
            });
          }
        }
        for (const item of unit.items || []) {
          if (item.metadata !== undefined) {
            const key = `${part.id}/${unit.id}/${item.id}`;
            candidateItemProperties[key] = {
              ...(candidateItemProperties[key] || {}),
              metadata: item.metadata,
            };
            delete item.metadata;
            changes.push({
              path: `/assessmentParts/${partIndex}/units/${unitIndex}/items`,
              message: `Item-Metadaten für ${key} nach itemProperties verschoben.`,
            });
          }
        }
      }
      for (const instrument of part.instruments || []) {
        for (const booklet of instrument.testcenterBooklet || []) {
          if (
            typeof booklet.definitionId === "string" &&
            booklet.definitionId.startsWith("./")
          ) {
            booklet.definitionId = booklet.definitionId.replace(/^\.\/+/, "");
            changes.push({
              path: `/assessmentParts/${partIndex}/instruments`,
              message: "Booklet-Pfad kanonisch normalisiert.",
            });
          }
        }
      }
    }
    const validation = await this.validateCandidate(acpId, candidate, {
      external: true,
    });
    if (migrationIssues.length) {
      validation.issues.push(...migrationIssues);
      validation.valid = false;
      validation.publishable = false;
    }
    return {
      candidateIndex: candidate,
      candidateItemProperties,
      changes,
      unresolved: validation.issues.filter(
        (entry) => entry.severity === "error",
      ),
      validation,
      sourceUpdatedAt: acp.updatedAt.toISOString(),
    };
  }

  async migrate(acpId: string, expectedUpdatedAt: string): Promise<Acp> {
    const preview = await this.migrationPreview(acpId);
    if (!preview.validation.valid) {
      throw new UnprocessableEntityException({
        message: "Migration has unresolved schema errors",
        preview,
      });
    }
    await this.snapshotsService.create(acpId, "ACP-Index 0.6 migration");
    return this.saveCandidate(
      acpId,
      preview.candidateIndex,
      expectedUpdatedAt,
      {
        itemProperties: preview.candidateItemProperties,
      },
    );
  }

  async publish(
    acpId: string,
    status: "RELEASED_PUBLIC" | "RELEASED_CONFIDENTIAL",
    expectedUpdatedAt: string,
  ): Promise<Acp> {
    if (!RELEASED_STATUSES.has(status)) {
      throw new UnprocessableEntityException(
        "status must be RELEASED_PUBLIC or RELEASED_CONFIDENTIAL",
      );
    }
    const acp = await this.getAcp(acpId);
    this.assertExpectedUpdatedAt(acp, expectedUpdatedAt);
    const candidate = { ...acp.acpIndex, status };
    const report = await this.validateCandidate(acpId, candidate, {
      external: true,
      forPublication: true,
    });
    if (!report.publishable) {
      throw new UnprocessableEntityException({
        message: "ACP index is not publishable",
        report,
      });
    }
    return this.saveLocked(
      acpId,
      expectedUpdatedAt || acp.updatedAt.toISOString(),
      (locked) => {
        locked.acpIndex = { ...locked.acpIndex, status };
        locked.acpIndexSchemaId = ACP_SCHEMA_ID;
        locked.acpIndexValidationStatus = "CONFORMANT";
        locked.acpIndexValidationReport = report as unknown as Record<
          string,
          unknown
        >;
      },
    );
  }

  async reopen(acpId: string, expectedUpdatedAt: string): Promise<Acp> {
    const acp = await this.getAcp(acpId);
    this.assertExpectedUpdatedAt(acp, expectedUpdatedAt);
    if (!RELEASED_STATUSES.has(String(acp.acpIndex?.status || ""))) return acp;
    await this.snapshotsService.create(acpId, "ACP reopened for editing");
    return this.saveLocked(
      acpId,
      expectedUpdatedAt || acp.updatedAt.toISOString(),
      (locked) => {
        locked.acpIndex = { ...locked.acpIndex, status: "IN_DEVELOPMENT" };
      },
    );
  }

  private validateSemantics(
    candidate: Record<string, unknown>,
    files: AcpFile[],
    issues: AcpIndexValidationIssue[],
  ): void {
    const filePaths = new Set(
      files.map((file) => file.relativePath || file.originalName),
    );
    const resolvesFile = (id: string) => filePaths.has(id);

    for (const [partIndex, part] of getAssessmentParts(candidate).entries()) {
      const partPath = `/assessmentParts/${partIndex}`;
      const unitIds = new Set<string>();
      for (const [unitIndex, unit] of (part.units || []).entries()) {
        if (unitIds.has(unit.id))
          issues.push(
            this.issue(
              "DUPLICATE_UNIT_ID",
              "semantic",
              "error",
              `${partPath}/units/${unitIndex}/id`,
              `Unit-ID ${unit.id} ist innerhalb des Parts doppelt.`,
            ),
          );
        unitIds.add(unit.id);
        for (const [dependencyIndex, dependency] of (
          unit.dependencies || []
        ).entries()) {
          if (dependency?.id && !resolvesFile(dependency.id))
            issues.push(
              this.issue(
                "MISSING_FILE",
                "file",
                "error",
                `${partPath}/units/${unitIndex}/dependencies/${dependencyIndex}/id`,
                `Datei ${dependency.id} wurde nicht gefunden.`,
              ),
            );
        }
      }
      const moduleIds = new Set(
        (part.bookletModules || []).map((module: any) => module.id),
      );
      for (const [moduleIndex, module] of (
        part.bookletModules || []
      ).entries()) {
        for (const [refIndex, ref] of (module.units || []).entries()) {
          if (!unitIds.has(ref.id))
            issues.push(
              this.issue(
                "UNKNOWN_UNIT_REFERENCE",
                "semantic",
                "error",
                `${partPath}/bookletModules/${moduleIndex}/units/${refIndex}/id`,
                `Unit ${ref.id} ist in diesem Part nicht definiert.`,
              ),
            );
        }
      }
      for (const [instrumentIndex, instrument] of (
        part.instruments || []
      ).entries()) {
        for (const [bookletIndex, booklet] of (
          instrument.testcenterBooklet || []
        ).entries()) {
          if (!resolvesFile(booklet.definitionId))
            issues.push(
              this.issue(
                "MISSING_BOOKLET_FILE",
                "file",
                "error",
                `${partPath}/instruments/${instrumentIndex}/testcenterBooklet/${bookletIndex}/definitionId`,
                `Booklet ${booklet.definitionId} wurde nicht gefunden.`,
              ),
            );
          for (const [moduleRefIndex, moduleRef] of (
            booklet.modules || []
          ).entries()) {
            if (!moduleIds.has(moduleRef.moduleId))
              issues.push(
                this.issue(
                  "UNKNOWN_MODULE_REFERENCE",
                  "semantic",
                  "error",
                  `${partPath}/instruments/${instrumentIndex}/testcenterBooklet/${bookletIndex}/modules/${moduleRefIndex}/moduleId`,
                  `Modul ${moduleRef.moduleId} ist in diesem Part nicht definiert.`,
                ),
              );
          }
        }
        for (const [handoutIndex, handout] of (
          instrument.handOutsForTestTaker || []
        ).entries()) {
          this.validateFileReferenceTree(
            handout.file,
            `${partPath}/instruments/${instrumentIndex}/handOutsForTestTaker/${handoutIndex}/file`,
            resolvesFile,
            issues,
          );
        }
      }
      for (const [documentIndex, document] of (
        part.additionalDocuments || []
      ).entries()) {
        this.validateFileReferenceTree(
          document.file,
          `${partPath}/additionalDocuments/${documentIndex}/file`,
          resolvesFile,
          issues,
        );
      }
      const itemIds = new Set<string>();
      for (const unit of part.units || []) {
        const aliases = new Set<string>([
          unit.id,
          ...(part.bookletModules || []).flatMap((module: any) =>
            (module.units || [])
              .filter((ref: any) => ref.id === unit.id)
              .map((ref: any) => ref.alias || ref.id),
          ),
        ]);
        for (const item of unit.items || []) {
          itemIds.add(item.id);
          if (item.useUnitAliasAsPrefix !== false) {
            for (const alias of aliases) itemIds.add(`${alias}_${item.id}`);
          }
        }
      }
      const baseScales = Array.isArray(part.baseScales) ? part.baseScales : [];
      const derivedScales = Array.isArray(part.derivedScales)
        ? part.derivedScales
        : [];
      const scaleIds = new Set<string>();
      for (const [kind, scales] of [
        ["baseScales", baseScales],
        ["derivedScales", derivedScales],
      ] as const) {
        for (const [scaleIndex, scale] of scales.entries()) {
          if (scaleIds.has(scale?.id))
            issues.push(
              this.issue(
                "DUPLICATE_SCALE_ID",
                "semantic",
                "error",
                `${partPath}/${kind}/${scaleIndex}/id`,
                `Skalen-ID ${scale.id} ist innerhalb des Parts doppelt.`,
              ),
            );
          scaleIds.add(scale?.id);
        }
      }
      for (const [scaleIndex, scale] of baseScales.entries()) {
        for (const [itemIndex, item] of (Array.isArray(scale?.items)
          ? scale.items
          : []
        ).entries()) {
          if (!itemIds.has(item?.id))
            issues.push(
              this.issue(
                "UNKNOWN_SCALE_ITEM",
                "semantic",
                "error",
                `${partPath}/baseScales/${scaleIndex}/items/${itemIndex}/id`,
                `Skalen-Item ${item?.id} ist nicht auflösbar.`,
              ),
            );
        }
      }
      const graph = new Map<string, string[]>();
      for (const [scaleIndex, scale] of derivedScales.entries()) {
        const sources = Array.isArray(scale?.sources) ? scale.sources : [];
        graph.set(scale?.id, sources);
        for (const [sourceIndex, source] of sources.entries()) {
          if (!scaleIds.has(source))
            issues.push(
              this.issue(
                "UNKNOWN_SCALE_REFERENCE",
                "semantic",
                "error",
                `${partPath}/derivedScales/${scaleIndex}/sources/${sourceIndex}`,
                `Skala ${source} ist in diesem Part nicht definiert.`,
              ),
            );
        }
        if (
          !scale?.publicVocabularyUrl &&
          [
            ...(Array.isArray(scale?.mappings)
              ? scale.mappings.map((mapping: any) => mapping?.newValue)
              : []),
            scale?.mappingsElse,
          ].some((value) => value?.publicVocabularyEntry !== undefined)
        )
          issues.push(
            this.issue(
              "MISSING_SCALE_VOCABULARY",
              "semantic",
              "error",
              `${partPath}/derivedScales/${scaleIndex}/publicVocabularyUrl`,
              "Vokabulareinträge benötigen eine publicVocabularyUrl.",
            ),
          );
      }
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        const cyclic = (graph.get(id) || []).some((source) => visit(source));
        visiting.delete(id);
        visited.add(id);
        return cyclic;
      };
      for (const id of graph.keys()) {
        if (visit(id))
          issues.push(
            this.issue(
              "CYCLIC_SCALE_REFERENCE",
              "semantic",
              "error",
              `${partPath}/derivedScales`,
              `Zyklische Skalenabhängigkeit bei ${id}.`,
            ),
          );
      }
    }
  }

  private validateFileReferenceTree(
    value: unknown,
    path: string,
    resolvesFile: (id: string) => boolean,
    issues: AcpIndexValidationIssue[],
  ): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        this.validateFileReferenceTree(
          entry,
          `${path}/${index}`,
          resolvesFile,
          issues,
        ),
      );
      return;
    }
    if (!value || typeof value !== "object") return;
    const id = (value as Record<string, unknown>).id;
    if (typeof id === "string" && !resolvesFile(id)) {
      issues.push(
        this.issue(
          "MISSING_FILE",
          "file",
          "error",
          `${path}/id`,
          `Datei ${id} wurde nicht gefunden.`,
        ),
      );
    }
  }

  private async validateScaleVocabularies(
    candidate: Record<string, unknown>,
    issues: AcpIndexValidationIssue[],
    checks: AcpExternalCheck[],
    forPublication: boolean,
  ): Promise<void> {
    const resources = new Map<
      string,
      Awaited<ReturnType<AcpIndexService["loadExternalJson"]>>
    >();
    for (const [partIndex, part] of getAssessmentParts(candidate).entries()) {
      const scales = Array.isArray(part.derivedScales)
        ? part.derivedScales
        : [];
      for (const [scaleIndex, scale] of scales.entries()) {
        if (typeof scale?.publicVocabularyUrl !== "string") continue;
        const url = scale.publicVocabularyUrl;
        const path = `/assessmentParts/${partIndex}/derivedScales/${scaleIndex}`;
        if (!resources.has(url)) {
          const resource = await this.loadExternalJson(url, forPublication);
          resources.set(url, resource);
          checks.push(resource.check);
        }
        const resource = resources.get(url)!;
        const payload = resource.payload as any;
        if (
          !payload ||
          (!Array.isArray(payload.hasTopConcept) &&
            !Array.isArray(payload.concepts))
        ) {
          if (payload) resource.check.status = "invalid";
          issues.push(
            this.issue(
              "SCALE_VOCABULARY_UNAVAILABLE",
              "vocabulary",
              "error",
              `${path}/publicVocabularyUrl`,
              `Skalenvokabular ${url} ist nicht verfügbar oder enthält keine Konzepteinträge.`,
            ),
          );
          continue;
        }
        const ids = new Set<string>();
        const collect = (nodes: any[]) => {
          for (const node of nodes) {
            if (typeof node?.id === "string") ids.add(node.id);
            if (Array.isArray(node?.narrower)) collect(node.narrower);
          }
        };
        collect([
          ...(payload.hasTopConcept || []),
          ...(payload.concepts || []),
        ]);
        const values = [
          ...(Array.isArray(scale.mappings)
            ? scale.mappings.map((mapping: any, index: number) => ({
                value: mapping?.newValue,
                path: `${path}/mappings/${index}/newValue`,
              }))
            : []),
          { value: scale.mappingsElse, path: `${path}/mappingsElse` },
        ];
        for (const entry of values) {
          const suffix = entry.value?.publicVocabularyEntry;
          if (typeof suffix === "string" && !ids.has(`${url}${suffix}`))
            issues.push(
              this.issue(
                "UNKNOWN_SCALE_VOCABULARY_ENTRY",
                "vocabulary",
                "error",
                `${entry.path}/publicVocabularyEntry`,
                `Eintrag ${suffix} existiert nicht im Skalenvokabular ${url}.`,
              ),
            );
        }
      }
    }
  }

  private async validateMetadata(
    candidate: Record<string, unknown>,
    issues: AcpIndexValidationIssue[],
    checks: AcpExternalCheck[],
    forPublication: boolean,
  ): Promise<void> {
    const metadataNodes: Array<{ path: string; value: any }> = [];
    const visit = (value: unknown, path: string) => {
      if (!value || typeof value !== "object") return;
      if (!Array.isArray(value) && typeof (value as any).profileId === "string")
        metadataNodes.push({ path, value });
      if (Array.isArray(value))
        value.forEach((entry, index) => visit(entry, `${path}/${index}`));
      else
        Object.entries(value).forEach(([key, entry]) =>
          visit(entry, `${path}/${key}`),
        );
    };
    visit(candidate, "");
    const vocabularies = new Map<string, Record<string, unknown> | undefined>();
    for (const node of metadataNodes) {
      const resource = await this.loadExternalJson(
        node.value.profileId,
        forPublication,
      );
      checks.push(resource.check);
      if (!resource.payload) {
        issues.push(
          this.issue(
            "PROFILE_UNAVAILABLE",
            "vocabulary",
            "error",
            `${node.path}/profileId`,
            `Metadatenprofil ${node.value.profileId} ist nicht verfügbar.`,
          ),
        );
        continue;
      }
      const profileEntries = this.collectProfileEntries(resource.payload);
      if (
        (resource.payload as any).id !== node.value.profileId ||
        profileEntries.size === 0
      ) {
        resource.check.status = "invalid";
        issues.push(
          this.issue(
            "INVALID_PROFILE_STRUCTURE",
            "vocabulary",
            "error",
            `${node.path}/profileId`,
            `Metadatenprofil ${node.value.profileId} hat keine passende ID oder keine Einträge.`,
          ),
        );
        continue;
      }
      for (const [entryIndex, entry] of (node.value.entries || []).entries()) {
        const definition = profileEntries.get(entry.id);
        if (!definition) {
          issues.push(
            this.issue(
              "UNKNOWN_PROFILE_ENTRY",
              "vocabulary",
              "error",
              `${node.path}/entries/${entryIndex}/id`,
              `Eintrag ${entry.id} existiert nicht im Profil.`,
            ),
          );
          continue;
        }
        const vocabularyUrl = definition?.parameters?.url;
        if (typeof vocabularyUrl === "string" && Array.isArray(entry.value)) {
          if (!vocabularies.has(vocabularyUrl)) {
            const vocabulary = await this.loadExternalJson(
              vocabularyUrl,
              forPublication,
            );
            checks.push(vocabulary.check);
            vocabularies.set(vocabularyUrl, vocabulary.payload);
            if (
              vocabulary.payload &&
              !Array.isArray((vocabulary.payload as any).hasTopConcept) &&
              !Array.isArray((vocabulary.payload as any).concepts)
            ) {
              vocabulary.check.status = "invalid";
              issues.push(
                this.issue(
                  "INVALID_VOCABULARY_STRUCTURE",
                  "vocabulary",
                  "error",
                  `${node.path}/entries/${entryIndex}/value`,
                  `Vokabular ${vocabularyUrl} enthält keine Konzepteinträge.`,
                ),
              );
            }
          }
          const vocabulary = vocabularies.get(vocabularyUrl);
          if (!vocabulary) {
            issues.push(
              this.issue(
                "VOCABULARY_UNAVAILABLE",
                "vocabulary",
                "error",
                `${node.path}/entries/${entryIndex}/value`,
                `Vokabular ${vocabularyUrl} ist nicht verfügbar.`,
              ),
            );
          }
          const vocabularyEntries = new Map<string, any>(
            [
              ...((vocabulary as any)?.hasTopConcept || []),
              ...((vocabulary as any)?.concepts || []),
            ]
              .filter((value: any) => typeof value?.id === "string")
              .map((value: any) => [value.id, value]),
          );
          for (const [valueIndex, vocabularyEntry] of entry.value.entries()) {
            if (
              typeof vocabularyEntry?.id === "string" &&
              (!vocabularyEntry.id.startsWith(vocabularyUrl) ||
                (vocabulary && !vocabularyEntries.has(vocabularyEntry.id)))
            ) {
              issues.push(
                this.issue(
                  "WRONG_VOCABULARY",
                  "vocabulary",
                  "error",
                  `${node.path}/entries/${entryIndex}/value/${valueIndex}/id`,
                  `${vocabularyEntry.id} gehört nicht zu ${vocabularyUrl}.`,
                ),
              );
            } else if (
              vocabularyEntry?.label &&
              vocabularyEntries.has(vocabularyEntry.id)
            ) {
              const canonical = vocabularyEntries.get(
                vocabularyEntry.id,
              )?.prefLabel;
              const supplied = Object.fromEntries(
                (vocabularyEntry.label || []).map((label: any) => [
                  label.lang,
                  label.value,
                ]),
              );
              if (
                canonical &&
                Object.entries(supplied).some(
                  ([lang, value]) =>
                    canonical[lang] && canonical[lang] !== value,
                )
              ) {
                issues.push(
                  this.issue(
                    "VOCABULARY_LABEL_MISMATCH",
                    "vocabulary",
                    "warning",
                    `${node.path}/entries/${entryIndex}/value/${valueIndex}/label`,
                    `Label für ${vocabularyEntry.id} weicht vom Vokabular ab.`,
                  ),
                );
              }
            }
          }
        }
        if (
          entry.label &&
          definition.label &&
          JSON.stringify(entry.label) !== JSON.stringify(definition.label)
        ) {
          issues.push(
            this.issue(
              "PROFILE_LABEL_MISMATCH",
              "vocabulary",
              "warning",
              `${node.path}/entries/${entryIndex}/label`,
              `Label für ${entry.id} weicht vom Profil ab.`,
            ),
          );
        }
      }
    }
  }

  private collectProfileEntries(
    profile: Record<string, unknown>,
  ): Map<string, any> {
    const entries = new Map<string, any>();
    for (const group of Array.isArray((profile as any).groups)
      ? (profile as any).groups
      : []) {
      for (const entry of Array.isArray(group?.entries) ? group.entries : [])
        if (typeof entry?.id === "string") entries.set(entry.id, entry);
    }
    return entries;
  }

  private async loadExternalJson(
    urlValue: string,
    forPublication: boolean,
  ): Promise<{ payload?: Record<string, unknown>; check: AcpExternalCheck }> {
    const cached = await this.cacheRepository.findOne({
      where: { url: urlValue },
    });
    const cacheAge = cached?.lastSuccessAt
      ? Date.now() - cached.lastSuccessAt.getTime()
      : Number.POSITIVE_INFINITY;
    const cacheKnownInvalid = cached?.status === "invalid";
    const freshCache = Boolean(
      cached?.payload &&
      cached.status === "valid" &&
      cacheAge <= NORMAL_CACHE_MAX_AGE_MS,
    );
    const publicationFallback = Boolean(
      cached?.payload &&
      !cacheKnownInvalid &&
      cacheAge <= PUBLISH_CACHE_MAX_AGE_MS,
    );
    if (freshCache) {
      return {
        payload: cached!.payload,
        check: {
          url: urlValue,
          status: "cached",
          checkedAt: cached!.lastSuccessAt!.toISOString(),
        },
      };
    }
    const dispatchers: Agent[] = [];
    try {
      let currentUrl = this.assertSafeHttpsUrl(urlValue);
      const headers: Record<string, string> = {};
      if (!cacheKnownInvalid && cached?.etag) {
        headers["If-None-Match"] = cached.etag;
      }
      if (!cacheKnownInvalid && cached?.lastModified) {
        headers["If-Modified-Since"] = cached.lastModified;
      }
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        const dispatcher = await this.createPinnedDispatcher(
          currentUrl.hostname,
        );
        dispatchers.push(dispatcher);
        response = await fetch(currentUrl, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
          dispatcher,
        } as RequestInit & { dispatcher: Agent });
        if (response.status === 304) break;
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw new Error("Redirect without location");
          const redirectedUrl = this.assertSafeHttpsUrl(
            new URL(location, currentUrl).toString(),
          );
          if (redirectedUrl.origin !== currentUrl.origin) {
            delete headers["If-None-Match"];
            delete headers["If-Modified-Since"];
          }
          currentUrl = redirectedUrl;
          continue;
        }
        break;
      }
      if (!response) throw new Error("No response");
      if (response.status === 304 && cached?.payload && !cacheKnownInvalid) {
        const now = new Date();
        cached.status = "valid";
        cached.lastSuccessAt = now;
        cached.lastError = undefined;
        cached.etag = response.headers.get("etag") || cached.etag;
        cached.lastModified =
          response.headers.get("last-modified") || cached.lastModified;
        await this.cacheRepository.save(cached);
        return {
          payload: cached.payload,
          check: {
            url: urlValue,
            status: "valid",
            checkedAt: now.toISOString(),
          },
        };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const declaredLength = Number(
        response.headers.get("content-length") || "0",
      );
      if (declaredLength > MAX_EXTERNAL_BYTES) {
        await response.body?.cancel();
        throw new Error("INVALID_RESOURCE: Resource exceeds 1 MB");
      }
      const bytes = await this.readLimitedBody(response);
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error("INVALID_RESOURCE: Resource is not valid JSON");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error("INVALID_RESOURCE: Resource is not a JSON object");
      const jsonObject = payload as Record<string, unknown>;
      const now = new Date();
      const entity = cached || this.cacheRepository.create({ url: urlValue });
      entity.payload = jsonObject;
      entity.status = "valid";
      entity.lastSuccessAt = now;
      entity.lastError = undefined;
      entity.etag = response.headers.get("etag") || undefined;
      entity.lastModified = response.headers.get("last-modified") || undefined;
      await this.cacheRepository.save(entity);
      return {
        payload: jsonObject,
        check: { url: urlValue, status: "valid", checkedAt: now.toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalidResource = message.startsWith("INVALID_RESOURCE:");
      if (cached) {
        cached.status =
          invalidResource || cacheKnownInvalid ? "invalid" : "unavailable";
        cached.lastError = message;
        await this.cacheRepository.save(cached);
      }
      if (invalidResource) {
        return { check: { url: urlValue, status: "invalid" } };
      }
      if (forPublication && publicationFallback) {
        return {
          payload: cached!.payload,
          check: {
            url: urlValue,
            status: "cached",
            checkedAt: cached!.lastSuccessAt!.toISOString(),
          },
        };
      }
      return { check: { url: urlValue, status: "unavailable" } };
    } finally {
      await Promise.all(
        dispatchers.map((dispatcher) =>
          dispatcher.close().catch(() => undefined),
        ),
      );
    }
  }

  private assertSafeHttpsUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid URL");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Only credential-free HTTPS URLs are allowed");
    return url;
  }

  private async createPinnedDispatcher(hostname: string): Promise<Agent> {
    const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(normalizedHostname)
      ? [{ address: normalizedHostname, family: isIP(normalizedHostname) }]
      : await dns.lookup(normalizedHostname, { all: true });
    if (
      !addresses.length ||
      addresses.some(({ address }) => this.isPrivateAddress(address))
    ) {
      throw new Error("Private and loopback addresses are blocked");
    }
    const { address, family } = addresses[0];
    return new Agent({
      connect: {
        lookup: ((_host: string, options: any, callback: any) => {
          if (options?.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        }) as any,
      },
    });
  }

  private async readLimitedBody(response: Response): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_EXTERNAL_BYTES) {
          await reader.cancel();
          throw new Error("INVALID_RESOURCE: Resource exceeds 1 MB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private isPrivateAddress(address: string): boolean {
    try {
      const normalized = address.toLowerCase().split("%")[0];
      return ipaddr.process(normalized).range() !== "unicast";
    } catch {
      return true;
    }
  }

  private mapLegacyDependencyType(type: string): string {
    return (
      (
        {
          UNIT_DEFINITION: "UNIT_UI_DEFINITION",
          CODING_SCHEME: "UNIT_CODING_SCHEME",
          METADATA: "UNIT_METADATA",
        } as Record<string, string>
      )[type] || type
    );
  }

  private mapSchemaErrors(errors: ErrorObject[]): AcpIndexValidationIssue[] {
    return errors.map((error) =>
      this.issue(
        `SCHEMA_${error.keyword.toUpperCase()}`,
        "schema",
        "error",
        error.instancePath || "/",
        error.message || "Schema validation failed",
      ),
    );
  }

  private issue(
    code: string,
    scope: AcpIndexValidationIssue["scope"],
    severity: AcpIndexValidationIssue["severity"],
    path: string,
    message: string,
  ): AcpIndexValidationIssue {
    return { code, scope, severity, path, message };
  }

  private async getAcp(acpId: string): Promise<Acp> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) throw new NotFoundException(`ACP with ID ${acpId} not found`);
    return acp;
  }

  private async persistValidationReport(
    acp: Acp,
    report: AcpIndexValidationReport,
  ): Promise<void> {
    const status = report.valid
      ? report.publishable
        ? "CONFORMANT"
        : "CONFORMANT_WITH_ISSUES"
      : "LEGACY_NONCONFORMANT";

    if (typeof this.acpRepository.query === "function") {
      await this.acpRepository.query(
        `UPDATE "acp"
         SET "acp_index_schema_id" = $2,
             "acp_index_validation_status" = $3,
             "acp_index_validation_report" = $4::jsonb
         WHERE "id" = $1`,
        [acp.id, ACP_SCHEMA_ID, status, JSON.stringify(report)],
      );
      return;
    }

    acp.acpIndexSchemaId = ACP_SCHEMA_ID;
    acp.acpIndexValidationStatus = status;
    acp.acpIndexValidationReport = report as unknown as Record<string, unknown>;
    await this.acpRepository.save(acp);
  }

  private async saveLocked(
    acpId: string,
    expectedUpdatedAt: string | undefined,
    mutate: (acp: Acp) => void,
  ): Promise<Acp> {
    const manager = this.acpRepository.manager;
    if (manager?.transaction) {
      return manager.transaction(async (transactionManager) => {
        const repository = transactionManager.getRepository(Acp);
        const acp = await repository.findOne({
          where: { id: acpId },
          lock: { mode: "pessimistic_write" },
        });
        if (!acp) {
          throw new NotFoundException(`ACP with ID ${acpId} not found`);
        }
        this.assertExpectedUpdatedAt(acp, expectedUpdatedAt);
        mutate(acp);
        return repository.save(acp);
      });
    }

    const acp = await this.getAcp(acpId);
    this.assertExpectedUpdatedAt(acp, expectedUpdatedAt);
    mutate(acp);
    return this.acpRepository.save(acp);
  }

  private assertExpectedUpdatedAt(acp: Acp, expected?: string): void {
    if (expected && acp.updatedAt.toISOString() !== expected)
      throw new ConflictException({
        message: "ACP has changed since preview",
        expectedUpdatedAt: expected,
        actualUpdatedAt: acp.updatedAt.toISOString(),
      });
  }
}
