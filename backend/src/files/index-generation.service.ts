import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { Repository } from "typeorm";
import { Acp, AcpFile } from "../database/entities";
import { AcpIndexService } from "../acp/acp-index.service";
import { AcpIndexValidationReport } from "../acp/acp-index.types";
import { SnapshotsService } from "../snapshots/snapshots.service";
import { normalizePartId } from "./relative-path";

export interface IndexGenerationOptions {
  partAssignments?: Record<string, string>;
  omittedUnitPaths?: string[];
}

export interface IndexGenerationPreview {
  candidateIndex: Record<string, unknown>;
  validation: AcpIndexValidationReport;
  sourceRevision: string;
  sourceUpdatedAt: string;
  assignments: Record<string, string>;
  unassignedUnitPaths: string[];
  ambiguousBooklets: Array<{ path: string; possibleParts: string[] }>;
  warnings: string[];
  diff: Array<{ operation: "add" | "remove" | "replace"; path: string }>;
  canApply: boolean;
}

@Injectable()
export class IndexGenerationService {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    maxNestedTags: 100,
    processEntities: {
      enabled: true,
      maxEntitySize: 1000,
      maxExpansionDepth: 5,
      maxTotalExpansions: 1000,
      maxExpandedLength: 100_000,
      maxEntityCount: 100,
    },
  });

  constructor(
    @InjectRepository(Acp) private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    private readonly acpIndexService: AcpIndexService,
    private readonly snapshotsService: SnapshotsService,
  ) {}

  async preview(
    acpId: string,
    options: IndexGenerationOptions = {},
  ): Promise<IndexGenerationPreview> {
    const acp = await this.getAcp(acpId);
    const files = await this.fileRepository.find({
      where: { acpId },
      order: { relativePath: "ASC" },
    });
    const sourceRevision = await this.sourceRevision(files);
    const warnings: string[] = [];
    const assignments: Record<string, string> = {};
    const omitted = new Set(options.omittedUnitPaths || []);
    const unitsByPart = new Map<string, any[]>();
    const unitIdsByPart = new Map<string, Set<string>>();
    const unassignedUnitPaths: string[] = [];
    const xmlFiles = files.filter((file) =>
      (file.relativePath || file.originalName).toLowerCase().endsWith(".xml"),
    );
    const parsedBooklets: Array<{
      file: AcpFile;
      id: string;
      label: string;
      unitIds: string[];
    }> = [];

    for (const file of xmlFiles) {
      const parsed = await this.parseXmlFile(file, warnings);
      if (!parsed) continue;
      if (parsed.Booklet) {
        const metadata = parsed.Booklet.Metadata || {};
        const id = String(
          metadata.Id || path.posix.basename(file.relativePath, ".xml"),
        );
        const refs = this.asArray(parsed.Booklet.Units?.Unit)
          .map((entry: any) => String(entry?.["@_id"] || entry?.Id || ""))
          .filter(Boolean);
        parsedBooklets.push({
          file,
          id,
          label: String(metadata.Label || id),
          unitIds: refs,
        });
        continue;
      }
      if (!parsed.Unit) continue;
      const relativePath = file.relativePath || file.originalName;
      const partId = this.resolveUnitPart(
        relativePath,
        options.partAssignments,
      );
      if (!partId) {
        if (!omitted.has(relativePath)) unassignedUnitPaths.push(relativePath);
        continue;
      }
      assignments[relativePath] = partId;
      const unit = this.buildUnit(parsed.Unit, file, files, warnings);
      if (!unit) continue;
      const bucket = unitsByPart.get(partId) || [];
      if (bucket.some((entry) => entry.id === unit.id)) {
        warnings.push(
          `Unit ${unit.id} ist in Part ${partId} mehrfach vorhanden; ${relativePath} wurde ignoriert.`,
        );
        continue;
      }
      bucket.push(unit);
      unitsByPart.set(partId, bucket);
      const ids = unitIdsByPart.get(partId) || new Set<string>();
      ids.add(unit.id);
      unitIdsByPart.set(partId, ids);
    }

    const bookletsByPart = new Map<string, typeof parsedBooklets>();
    const ambiguousBooklets: Array<{ path: string; possibleParts: string[] }> =
      [];
    for (const booklet of parsedBooklets) {
      const relativePath =
        booklet.file.relativePath || booklet.file.originalName;
      const explicit = options.partAssignments?.[relativePath];
      const scores = Array.from(unitIdsByPart.entries())
        .map(([partId, ids]) => ({
          partId,
          score: booklet.unitIds.filter((id) => ids.has(id)).length,
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.partId.localeCompare(b.partId));
      const bestParts = scores.length
        ? scores
            .filter((entry) => entry.score === scores[0].score)
            .map((entry) => entry.partId)
        : [];
      const partId = explicit
        ? normalizePartId(explicit)
        : bestParts.length === 1
          ? bestParts[0]
          : undefined;
      if (!partId) {
        ambiguousBooklets.push({
          path: relativePath,
          possibleParts: bestParts.length
            ? bestParts
            : Array.from(unitsByPart.keys()),
        });
        continue;
      }
      assignments[relativePath] = partId;
      const bucket = bookletsByPart.get(partId) || [];
      bucket.push(booklet);
      bookletsByPart.set(partId, bucket);
    }

    const assessmentParts: any[] = [];
    for (const partId of Array.from(unitsByPart.keys()).sort()) {
      const partBooklets = bookletsByPart.get(partId) || [];
      if (!partBooklets.length) {
        for (const filePath of Object.entries(assignments)
          .filter(([, assigned]) => assigned === partId)
          .map(([filePath]) => filePath)) {
          if (!omitted.has(filePath) && filePath.toLowerCase().endsWith(".xml"))
            unassignedUnitPaths.push(filePath);
        }
        continue;
      }
      const units = unitsByPart.get(partId) || [];
      const bookletModules = partBooklets.map((booklet) => ({
        id: `${booklet.id}-module`,
        name: booklet.label,
        lang: "de",
        units: booklet.unitIds.map((id, order, all) => ({
          id,
          order,
          ...(all.indexOf(id) === order
            ? {}
            : {
                alias: `${id}-${all.slice(0, order + 1).filter((entry) => entry === id).length}`,
              }),
        })),
      }));
      const instruments = partBooklets.map((booklet) => ({
        id: booklet.id,
        name: [{ lang: "de", value: booklet.label }],
        testcenterBooklet: [
          {
            lang: "de",
            definitionId:
              booklet.file.relativePath || booklet.file.originalName,
            modules: [{ moduleId: `${booklet.id}-module`, order: 0 }],
          },
        ],
        administrationMode: "TEST_BY_TEST_TAKER",
      }));
      const generatedPart = {
        id: partId,
        name: [{ lang: "de", value: this.humanize(partId) }],
        units,
        bookletModules,
        instruments,
      };
      const existingPart = Array.isArray(acp.acpIndex?.assessmentParts)
        ? acp.acpIndex.assessmentParts.find((part: any) => part?.id === partId)
        : undefined;
      assessmentParts.push(
        existingPart
          ? this.mergeGeneratedPart(existingPart, generatedPart)
          : generatedPart,
      );
    }

    const generatedPartIds = new Set(
      assessmentParts.map((part) => String(part.id)),
    );
    for (const existingPart of Array.isArray(acp.acpIndex?.assessmentParts)
      ? acp.acpIndex.assessmentParts
      : []) {
      if (!generatedPartIds.has(String(existingPart?.id))) {
        assessmentParts.push(existingPart);
      }
    }

    const candidateIndex: Record<string, unknown> = {
      ...acp.acpIndex,
      packageId: acp.packageId,
      status: "IN_DEVELOPMENT",
      ...(assessmentParts.length ? { assessmentParts } : {}),
    };
    delete (candidateIndex as any).units;
    delete (candidateIndex as any).scales;
    if (!assessmentParts.length) delete candidateIndex.assessmentParts;
    const validation = await this.acpIndexService.validateCandidate(
      acpId,
      candidateIndex,
    );
    const uniqueUnassigned = Array.from(new Set(unassignedUnitPaths))
      .filter((entry) => !omitted.has(entry))
      .sort();
    return {
      candidateIndex,
      validation,
      sourceRevision,
      sourceUpdatedAt: acp.updatedAt.toISOString(),
      assignments,
      unassignedUnitPaths: uniqueUnassigned,
      ambiguousBooklets,
      warnings,
      diff: this.diff(acp.acpIndex, candidateIndex),
      canApply:
        validation.valid &&
        uniqueUnassigned.length === 0 &&
        ambiguousBooklets.length === 0,
    };
  }

  async apply(
    acpId: string,
    input: IndexGenerationOptions & {
      sourceRevision: string;
      expectedUpdatedAt: string;
    },
  ): Promise<{
    index: Record<string, unknown>;
    validation: AcpIndexValidationReport;
  }> {
    const files = await this.fileRepository.find({ where: { acpId } });
    const actualRevision = await this.sourceRevision(files);
    if (actualRevision !== input.sourceRevision)
      throw new ConflictException({
        message: "Files changed since index preview",
        expectedSourceRevision: input.sourceRevision,
        actualSourceRevision: actualRevision,
      });
    const preview = await this.preview(acpId, input);
    if (preview.sourceRevision !== input.sourceRevision) {
      throw new ConflictException({
        message: "Files changed while index generation was being prepared",
        expectedSourceRevision: input.sourceRevision,
        actualSourceRevision: preview.sourceRevision,
      });
    }
    if (!preview.canApply)
      throw new UnprocessableEntityException({
        message:
          "Index generation preview has unresolved assignments or schema errors",
        preview,
      });
    await this.snapshotsService.create(acpId, "Generated ACP index from files");
    const saved = await this.acpIndexService.saveCandidate(
      acpId,
      preview.candidateIndex,
      input.expectedUpdatedAt,
    );
    return { index: saved.acpIndex, validation: preview.validation };
  }

  private buildUnit(
    parsed: any,
    file: AcpFile,
    files: AcpFile[],
    warnings: string[],
  ): any | null {
    const metadata = parsed.Metadata || {};
    const id = String(metadata.Id || "").trim();
    if (!id) {
      warnings.push(
        `Unit-Datei ${file.relativePath || file.originalName} enthält keine ID.`,
      );
      return null;
    }
    const dependencies: any[] = [
      { id: file.relativePath || file.originalName, type: "UNIT_INDEX" },
    ];
    const metadataRef = this.text(metadata.Reference);
    const definitionRef = this.text(parsed.DefinitionRef);
    const codingRef = this.text(parsed.CodingSchemeRef);
    if (definitionRef)
      this.addDependency(
        dependencies,
        file,
        definitionRef,
        "UNIT_UI_DEFINITION",
        files,
        warnings,
      );
    if (codingRef)
      this.addDependency(
        dependencies,
        file,
        codingRef,
        "UNIT_CODING_SCHEME",
        files,
        warnings,
      );
    if (metadataRef)
      this.addDependency(
        dependencies,
        file,
        metadataRef,
        "UNIT_METADATA",
        files,
        warnings,
      );
    const player = parsed.DefinitionRef?.["@_player"];
    if (typeof player === "string") {
      const normalizedPlayer = player.replace("@", "-").toLowerCase();
      const candidates = files.filter((entry) => {
        const value = (entry.relativePath || entry.originalName)
          .split("/")
          .pop()!
          .toLowerCase();
        return value.endsWith(".html") && value.startsWith(normalizedPlayer);
      });
      if (candidates.length === 1)
        dependencies.push({
          id: candidates[0].relativePath || candidates[0].originalName,
          type: "PLAYER",
        });
      else
        warnings.push(
          `Player ${player} für Unit ${id} ist ${candidates.length ? "mehrdeutig" : "nicht vorhanden"}.`,
        );
    }
    return {
      id,
      name: String(metadata.Label || id),
      ...(metadata.Description
        ? { description: String(metadata.Description) }
        : {}),
      lang: "de",
      dependencies,
    };
  }

  private addDependency(
    target: any[],
    source: AcpFile,
    reference: string,
    type: string,
    files: AcpFile[],
    warnings: string[],
  ): void {
    const sourceDir = path.posix.dirname(
      source.relativePath || source.originalName,
    );
    const localPath = path.posix.normalize(
      path.posix.join(sourceDir === "." ? "" : sourceDir, reference),
    );
    const exact = files.find(
      (file) => (file.relativePath || file.originalName) === localPath,
    );
    if (exact) {
      target.push({ id: exact.relativePath || exact.originalName, type });
      return;
    }
    const basename = path.posix.basename(reference);
    const matches = files.filter(
      (file) =>
        path.posix.basename(file.relativePath || file.originalName) ===
        basename,
    );
    if (matches.length === 1) {
      target.push({
        id: matches[0].relativePath || matches[0].originalName,
        type,
      });
      warnings.push(
        `${reference} wurde per eindeutigem Dateinamen zu ${matches[0].relativePath || matches[0].originalName} aufgelöst.`,
      );
    } else {
      target.push({ id: localPath, type });
      warnings.push(
        `${reference} aus ${source.relativePath || source.originalName} ist ${matches.length ? "mehrdeutig" : "nicht vorhanden"}.`,
      );
    }
  }

  private resolveUnitPart(
    relativePath: string,
    explicit?: Record<string, string>,
  ): string | undefined {
    if (explicit?.[relativePath])
      return normalizePartId(explicit[relativePath]);
    const segments = relativePath.split("/");
    const unitsIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === "units",
    );
    return unitsIndex >= 0 && segments[unitsIndex + 1]
      ? normalizePartId(segments[unitsIndex + 1])
      : undefined;
  }

  private async parseXmlFile(
    file: AcpFile,
    warnings: string[],
  ): Promise<any | null> {
    try {
      return this.xmlParser.parse(await fs.readFile(file.filePath, "utf8"));
    } catch (error) {
      warnings.push(
        `XML ${file.relativePath || file.originalName} konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async sourceRevision(files: AcpFile[]): Promise<string> {
    const entries = await Promise.all(
      files.map(async (file) => {
        const checksum =
          file.checksum ||
          crypto
            .createHash("sha256")
            .update(await fs.readFile(file.filePath))
            .digest("hex");
        return `${file.relativePath || file.originalName}:${checksum}`;
      }),
    );
    const digest = entries.sort().join("\n");
    return crypto.createHash("sha256").update(digest).digest("hex");
  }

  private mergeGeneratedPart(existing: any, generated: any): any {
    const existingUnits = new Map(
      this.asArray(existing?.units).map((unit: any) => [unit.id, unit]),
    );
    const mergeById = (before: any, after: any) => {
      const entries = new Map(
        this.asArray(before).map((entry: any) => [entry.id, entry]),
      );
      for (const entry of this.asArray(after)) entries.set(entry.id, entry);
      return Array.from(entries.values());
    };
    return {
      ...existing,
      ...generated,
      units: generated.units.map((unit: any) => ({
        ...(existingUnits.get(unit.id) || {}),
        ...unit,
      })),
      bookletModules: mergeById(
        existing.bookletModules,
        generated.bookletModules,
      ),
      instruments: mergeById(existing.instruments, generated.instruments),
    };
  }

  private diff(
    before: unknown,
    after: unknown,
  ): Array<{ operation: "add" | "remove" | "replace"; path: string }> {
    const changes: Array<{
      operation: "add" | "remove" | "replace";
      path: string;
    }> = [];
    const walk = (left: any, right: any, pointer: string) => {
      if (JSON.stringify(left) === JSON.stringify(right)) return;
      if (
        !left ||
        !right ||
        typeof left !== "object" ||
        typeof right !== "object" ||
        Array.isArray(left) ||
        Array.isArray(right)
      ) {
        changes.push({
          operation:
            left === undefined
              ? "add"
              : right === undefined
                ? "remove"
                : "replace",
          path: pointer || "/",
        });
        return;
      }
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        walk(
          left[key],
          right[key],
          `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
        );
    };
    walk(before, after, "");
    return changes;
  }

  private text(value: any): string {
    if (typeof value === "string") return value.trim();
    if (
      value &&
      typeof value === "object" &&
      typeof value["#text"] === "string"
    )
      return value["#text"].trim();
    return "";
  }

  private asArray<T>(value: T | T[] | undefined): T[] {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  }

  private humanize(value: string): string {
    return value
      .split("-")
      .filter(Boolean)
      .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
      .join(" ");
  }

  private async getAcp(acpId: string): Promise<Acp> {
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) throw new NotFoundException(`ACP with ID ${acpId} not found`);
    return acp;
  }
}
