import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "crypto";
import { SaxesParser } from "saxes";
import { Repository } from "typeorm";
import { assertUuidParam } from "../common/uuid-param";
import { Acp, AcpFile } from "../database/entities";
import {
  BookletStructureError,
  NavigationNode,
  parseBookletXml,
} from "../review/booklet-parser";
import {
  findPlayerFile,
  getXmlRootElement,
  parseUnitXml,
  parseVomd,
} from "./unit-file-parsing";
import {
  ArchiveExpansionService,
  ExpandedUploadFile,
} from "./archive-expansion.service";
import { FileStorageService } from "./file-storage.service";

export type UploadPreflightConflictStrategy =
  | "reject"
  | "overwrite"
  | "keep-both";

export interface UploadPreflightIssue {
  severity: "error" | "warning" | "info";
  code:
    | "duplicate-content-conflict"
    | "existing-file-conflict"
    | "invalid-json"
    | "invalid-xml"
    | "invalid-booklet"
    | "invalid-unit"
    | "duplicate-booklet-id"
    | "duplicate-unit-id"
    | "missing-unit-reference"
    | "missing-file-reference"
    | "unreferenced-unit";
  message: string;
  fileName?: string;
  sourcePaths?: string[];
}

export interface UploadPreflightReport {
  canUpload: boolean;
  selectedFileCount: number;
  expandedFileCount: number;
  acceptedFileCount: number;
  identicalDuplicates: Array<{
    fileName: string;
    keptSource: string;
    ignoredSources: string[];
  }>;
  existingConflicts: Array<{
    fileName: string;
    sourcePath: string;
    existingFileIds: string[];
  }>;
  issues: UploadPreflightIssue[];
}

export interface PreparedUpload {
  files: ExpandedUploadFile[];
  report: UploadPreflightReport;
}

interface XmlCandidate {
  fileName: string;
  sourcePath: string;
  content: string;
  incoming: boolean;
}

interface IdOccurrence {
  fileName: string;
  sourcePath: string;
  incoming: boolean;
}

@Injectable()
export class UploadPreflightService {
  constructor(
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    private readonly archiveExpansionService: ArchiveExpansionService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async prepare(
    acpId: string,
    files: Express.Multer.File[],
    options: {
      conflictStrategy: UploadPreflightConflictStrategy;
      expandArchives?: boolean;
      semanticScope?: "complete" | "partial";
    },
  ): Promise<PreparedUpload> {
    if (!files?.length) {
      throw new BadRequestException("At least one file is required");
    }
    assertUuidParam(acpId, "ACP ID");
    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      throw new NotFoundException(`ACP with ID ${acpId} not found`);
    }

    const expandedFiles =
      options.expandArchives === false
        ? files.map((file) => this.withDirectSource(file))
        : await this.archiveExpansionService.expand(files);
    const issues: UploadPreflightIssue[] = [];
    const { acceptedFiles, identicalDuplicates } =
      this.resolveIncomingDuplicates(expandedFiles, issues);
    const existingFiles = await this.fileRepository.find({ where: { acpId } });
    const existingByName = this.groupExistingFiles(existingFiles);
    const existingConflicts = acceptedFiles.flatMap((file) => {
      const matches =
        existingByName.get(this.normalizeFileName(file.originalname)) || [];
      if (!matches.length) return [];
      return [
        {
          fileName: file.originalname,
          sourcePath: this.sourcePath(file),
          existingFileIds: matches.map((match) => match.id),
        },
      ];
    });

    if (options.conflictStrategy === "reject") {
      for (const conflict of existingConflicts) {
        issues.push({
          severity: "error",
          code: "existing-file-conflict",
          message: `Datei "${conflict.fileName}" ist im ACP bereits vorhanden.`,
          fileName: conflict.fileName,
          sourcePaths: [conflict.sourcePath],
        });
      }
    }

    if (options.expandArchives !== false) {
      await this.inspectSyntaxAndSemantics(
        acceptedFiles,
        existingFiles,
        options.conflictStrategy,
        options.semanticScope || "complete",
        issues,
      );
    }

    return {
      files: acceptedFiles,
      report: {
        canUpload: !issues.some((issue) => issue.severity === "error"),
        selectedFileCount: files.length,
        expandedFileCount: expandedFiles.length,
        acceptedFileCount: acceptedFiles.length,
        identicalDuplicates,
        existingConflicts,
        issues,
      },
    };
  }

  assertCanUpload(report: UploadPreflightReport): void {
    if (report.canUpload) return;
    const conflict = report.issues.some(
      (issue) =>
        issue.code === "duplicate-content-conflict" ||
        issue.code === "existing-file-conflict",
    );
    const payload = {
      message: "Upload preflight failed",
      preflight: report,
    };
    if (conflict) throw new ConflictException(payload);
    throw new BadRequestException(payload);
  }

  private resolveIncomingDuplicates(
    files: ExpandedUploadFile[],
    issues: UploadPreflightIssue[],
  ): {
    acceptedFiles: ExpandedUploadFile[];
    identicalDuplicates: UploadPreflightReport["identicalDuplicates"];
  } {
    const grouped = new Map<string, ExpandedUploadFile[]>();
    for (const file of files) {
      const name = String(file?.originalname || "").trim();
      const key = this.normalizeFileName(name);
      if (!key)
        throw new BadRequestException("All files must include a filename");
      const bucket = grouped.get(key) || [];
      bucket.push(file);
      grouped.set(key, bucket);
    }

    const acceptedFiles: ExpandedUploadFile[] = [];
    const identicalDuplicates: UploadPreflightReport["identicalDuplicates"] =
      [];
    for (const group of grouped.values()) {
      const byHash = new Map<string, ExpandedUploadFile[]>();
      for (const file of group) {
        const hash = createHash("sha256").update(file.buffer).digest("hex");
        const bucket = byHash.get(hash) || [];
        bucket.push(file);
        byHash.set(hash, bucket);
      }

      const kept = group[0];
      acceptedFiles.push(kept);
      if (byHash.size > 1) {
        issues.push({
          severity: "error",
          code: "duplicate-content-conflict",
          message: `Gleichnamige Datei "${kept.originalname}" enthält unterschiedliche Inhalte.`,
          fileName: kept.originalname,
          sourcePaths: group.map((file) => this.sourcePath(file)),
        });
      } else if (group.length > 1) {
        identicalDuplicates.push({
          fileName: kept.originalname,
          keptSource: this.sourcePath(kept),
          ignoredSources: group.slice(1).map((file) => this.sourcePath(file)),
        });
      }
    }
    return { acceptedFiles, identicalDuplicates };
  }

  private async inspectSyntaxAndSemantics(
    incomingFiles: ExpandedUploadFile[],
    existingFiles: AcpFile[],
    conflictStrategy: UploadPreflightConflictStrategy,
    semanticScope: "complete" | "partial",
    issues: UploadPreflightIssue[],
  ): Promise<void> {
    for (const file of incomingFiles) this.inspectIncomingSyntax(file, issues);

    const incomingNames = new Set(
      incomingFiles.map((file) => this.normalizeFileName(file.originalname)),
    );
    const xmlCandidates: XmlCandidate[] = [];
    for (const file of existingFiles) {
      if (!file.originalName.toLowerCase().endsWith(".xml")) continue;
      if (
        conflictStrategy === "overwrite" &&
        incomingNames.has(this.normalizeFileName(file.originalName))
      ) {
        continue;
      }
      try {
        xmlCandidates.push({
          fileName: file.originalName,
          sourcePath: `ACP/${file.originalName}`,
          content: (await this.fileStorageService.read(file)).toString("utf-8"),
          incoming: false,
        });
      } catch {
        // Existing unreadable files are handled by the regular ACP validation.
      }
    }
    xmlCandidates.push(
      ...incomingFiles
        .filter((file) => file.originalname.toLowerCase().endsWith(".xml"))
        .map((file) => ({
          fileName: file.originalname,
          sourcePath: this.sourcePath(file),
          content: file.buffer.toString("utf-8"),
          incoming: true,
        })),
    );

    const unitOccurrences = new Map<string, IdOccurrence[]>();
    const bookletOccurrences = new Map<string, IdOccurrence[]>();
    const bookletUnitRefs = new Set<string>();
    const incomingBooklets: Array<{
      id: string;
      sourcePath: string;
      unitRefs: string[];
    }> = [];
    const incomingUnits: Array<{
      id: string;
      sourcePath: string;
      definitionRef?: string;
      codingSchemeRef?: string;
      metadataRef?: string;
      playerRef?: string;
    }> = [];

    for (const candidate of xmlCandidates) {
      const root = getXmlRootElement(candidate.content);
      if (root === "Booklet") {
        try {
          const parsed = parseBookletXml(
            candidate.content,
            candidate.sourcePath,
          );
          this.addOccurrence(bookletOccurrences, parsed.id, candidate);
          const refs = this.collectBookletUnitIds(parsed.children);
          refs.forEach((id) => bookletUnitRefs.add(id));
          if (candidate.incoming) {
            incomingBooklets.push({
              id: parsed.id,
              sourcePath: candidate.sourcePath,
              unitRefs: refs,
            });
          }
        } catch (error) {
          if (candidate.incoming && error instanceof BookletStructureError) {
            // The syntax pass already reports the same structural error.
          }
        }
      } else if (root === "Unit") {
        const parsed = parseUnitXml(candidate.content, candidate.fileName, {
          error: () => undefined,
        });
        if (!parsed?.unitId) continue;
        this.addOccurrence(unitOccurrences, parsed.unitId, candidate);
        if (candidate.incoming) {
          incomingUnits.push({
            id: parsed.unitId,
            sourcePath: candidate.sourcePath,
            definitionRef: parsed.definitionRef,
            codingSchemeRef: parsed.codingSchemeRef,
            metadataRef: parsed.metadataRef,
            playerRef: parsed.playerRef,
          });
        }
      }
    }

    this.addDuplicateIdIssues(
      bookletOccurrences,
      "duplicate-booklet-id",
      "Booklet-ID",
      issues,
    );
    this.addDuplicateIdIssues(
      unitOccurrences,
      "duplicate-unit-id",
      "Unit-ID",
      issues,
    );

    const unitIds = new Set(unitOccurrences.keys());
    for (const booklet of incomingBooklets) {
      for (const unitId of booklet.unitRefs) {
        if (unitIds.has(unitId)) continue;
        issues.push({
          severity: semanticScope === "complete" ? "error" : "warning",
          code: "missing-unit-reference",
          message: `Booklet "${booklet.id}" referenziert die fehlende Unit "${unitId}".`,
          sourcePaths: [booklet.sourcePath],
        });
      }
    }

    const allFileNames = [
      ...existingFiles
        .filter(
          (file) =>
            conflictStrategy !== "overwrite" ||
            !incomingNames.has(this.normalizeFileName(file.originalName)),
        )
        .map((file) => file.originalName),
      ...incomingFiles.map((file) => file.originalname),
    ];
    const normalizedFileNames = new Set(
      allFileNames.map((name) => this.normalizeFileName(name)),
    );
    for (const unit of incomingUnits) {
      for (const reference of [
        unit.definitionRef,
        unit.codingSchemeRef,
        unit.metadataRef,
      ].filter((value): value is string => !!value)) {
        if (normalizedFileNames.has(this.normalizeFileName(reference)))
          continue;
        issues.push({
          severity: semanticScope === "complete" ? "error" : "warning",
          code: "missing-file-reference",
          message: `Unit "${unit.id}" referenziert die fehlende Datei "${reference}".`,
          sourcePaths: [unit.sourcePath],
        });
      }
      if (unit.playerRef && !findPlayerFile(unit.playerRef, allFileNames)) {
        issues.push({
          severity: semanticScope === "complete" ? "error" : "warning",
          code: "missing-file-reference",
          message: `Unit "${unit.id}" referenziert den fehlenden Player "${unit.playerRef}".`,
          sourcePaths: [unit.sourcePath],
        });
      }
      if (!bookletUnitRefs.has(unit.id)) {
        issues.push({
          severity: "warning",
          code: "unreferenced-unit",
          message: `Unit "${unit.id}" wird von keinem Booklet referenziert.`,
          sourcePaths: [unit.sourcePath],
        });
      }
    }
  }

  private inspectIncomingSyntax(
    file: ExpandedUploadFile,
    issues: UploadPreflightIssue[],
  ): void {
    const name = file.originalname;
    const lowerName = name.toLowerCase();
    const sourcePath = this.sourcePath(file);
    if (
      [".json", ".vocs", ".vomd", ".voud"].some((ext) =>
        lowerName.endsWith(ext),
      )
    ) {
      try {
        JSON.parse(file.buffer.toString("utf-8"));
        if (
          lowerName.endsWith(".vomd") &&
          !parseVomd(file.buffer.toString("utf-8"), true, {
            error: () => undefined,
          })
        ) {
          throw new Error("VOMD has an invalid structure");
        }
      } catch (error) {
        issues.push({
          severity: "error",
          code: "invalid-json",
          message: `Ungültige JSON-Struktur in "${name}": ${error instanceof Error ? error.message : String(error)}`,
          fileName: name,
          sourcePaths: [sourcePath],
        });
      }
      return;
    }
    if (!lowerName.endsWith(".xml")) return;

    const content = file.buffer.toString("utf-8");
    let xmlError: Error | undefined;
    const parser = new SaxesParser({ xmlns: false });
    parser.on("doctype", () => {
      xmlError = new Error("DTDs werden nicht unterstützt.");
    });
    parser.on("error", (error) => {
      xmlError = error;
    });
    try {
      parser.write(content).close();
    } catch (error) {
      xmlError = error instanceof Error ? error : new Error(String(error));
    }
    if (xmlError) {
      issues.push({
        severity: "error",
        code: "invalid-xml",
        message: `Ungültiges XML in "${name}": ${xmlError.message}`,
        fileName: name,
        sourcePaths: [sourcePath],
      });
      return;
    }

    const root = getXmlRootElement(content);
    if (root === "Booklet") {
      try {
        parseBookletXml(content, sourcePath);
      } catch (error) {
        issues.push({
          severity: "error",
          code: "invalid-booklet",
          message:
            error instanceof Error
              ? error.message
              : `Ungültige Booklet-Struktur in "${name}".`,
          fileName: name,
          sourcePaths: [sourcePath],
        });
      }
    } else if (root === "Unit") {
      const unit = parseUnitXml(content, name, { error: () => undefined });
      if (!unit?.unitId) {
        issues.push({
          severity: "error",
          code: "invalid-unit",
          message: `Unit-ID fehlt in "${name}".`,
          fileName: name,
          sourcePaths: [sourcePath],
        });
      }
    }
  }

  private addOccurrence(
    target: Map<string, IdOccurrence[]>,
    id: string,
    candidate: XmlCandidate,
  ): void {
    const bucket = target.get(id) || [];
    bucket.push({
      fileName: candidate.fileName,
      sourcePath: candidate.sourcePath,
      incoming: candidate.incoming,
    });
    target.set(id, bucket);
  }

  private addDuplicateIdIssues(
    occurrences: Map<string, IdOccurrence[]>,
    code: "duplicate-booklet-id" | "duplicate-unit-id",
    label: string,
    issues: UploadPreflightIssue[],
  ): void {
    for (const [id, entries] of occurrences) {
      if (entries.length < 2 || !entries.some((entry) => entry.incoming))
        continue;
      issues.push({
        severity: "error",
        code,
        message: `${label} "${id}" ist mehrfach definiert.`,
        sourcePaths: entries.map((entry) => entry.sourcePath),
      });
    }
  }

  private collectBookletUnitIds(nodes: NavigationNode[]): string[] {
    return nodes.flatMap((node) =>
      node.kind === "UNIT"
        ? [node.id]
        : this.collectBookletUnitIds(node.children || []),
    );
  }

  private groupExistingFiles(files: AcpFile[]): Map<string, AcpFile[]> {
    const grouped = new Map<string, AcpFile[]>();
    for (const file of files) {
      const key = this.normalizeFileName(file.originalName);
      const bucket = grouped.get(key) || [];
      bucket.push(file);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  private withDirectSource(file: Express.Multer.File): ExpandedUploadFile {
    return {
      ...file,
      uploadSource: { path: String(file?.originalname || "").trim() },
    };
  }

  private sourcePath(file: ExpandedUploadFile): string {
    const source = file.uploadSource;
    return source?.archiveName
      ? `${source.archiveName}/${source.path}`
      : source?.path || file.originalname;
  }

  private normalizeFileName(fileName: string): string {
    return String(fileName || "")
      .trim()
      .toLowerCase();
  }
}
