import { createHash } from "crypto";
import { stat } from "fs/promises";
import { Acp } from "../database/entities/acp.entity";
import { ReviewReadinessSnapshot } from "../database/entities/review-readiness-snapshot.entity";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AcpFile } from "../database/entities";
import { UnitParserService } from "../files/unit-parser.service";
import {
  ValidationIssue,
  ValidationService,
} from "../validation/validation.service";
import { ReviewManifestService } from "./review-manifest.service";

export type ReviewReadinessStatus = "READY" | "WARNING" | "BLOCKED";

export interface ReviewReadinessResult {
  status: ReviewReadinessStatus;
  checkedAt: string;
  stale?: boolean;
  blockers: string[];
  warnings: string[];
  summary: {
    totalFiles: number;
    validFiles: number;
    invalidFiles: number;
    bookletCount: number;
    unitCount: number;
  };
}

@Injectable()
export class ReviewReadinessService {
  constructor(
    @InjectRepository(AcpFile)
    private readonly files: Repository<AcpFile>,
    private readonly validation: ValidationService,
    private readonly unitParser: UnitParserService,
    private readonly manifest: ReviewManifestService,
    @InjectRepository(Acp) private readonly acps: Repository<Acp>,
    @InjectRepository(ReviewReadinessSnapshot)
    private readonly snapshots: Repository<ReviewReadinessSnapshot>,
  ) {}

  // Bump when readiness rules or validation dependencies change.
  private readonly rulesVersion = "review-readiness-v1";

  private async fingerprint(acpId: string): Promise<string> {
    const [acp, files] = await Promise.all([
      this.acps.findOne({ where: { id: acpId } }),
      this.files.find({ where: { acpId } }),
    ]);
    const entries = await Promise.all(
      files.map(async (file) => {
        const disk = await stat(file.filePath)
          .then((s) => [s.size, s.mtimeMs, s.ctimeMs])
          .catch(() => null);
        return [
          file.id,
          file.originalName,
          file.fileType,
          file.checksum,
          file.fileSize,
          file.filePath,
          disk,
        ];
      }),
    );
    entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const stable = (value: any): any =>
      Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, stable(value[key])]),
            )
          : value;
    return createHash("sha256")
      .update(
        JSON.stringify(stable([this.rulesVersion, acp?.acpIndex, entries])),
      )
      .digest("hex");
  }

  async getLast(acpId: string): Promise<ReviewReadinessResult | null> {
    const snapshot = await this.snapshots.findOne({ where: { acpId } });
    if (!snapshot) return null;
    return {
      ...snapshot.result,
      stale:
        snapshot.result.stale === true ||
        snapshot.fingerprint !== (await this.fingerprint(acpId)),
    };
  }

  async check(acpId: string): Promise<ReviewReadinessResult> {
    const fingerprint = await this.fingerprint(acpId);
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const files = await this.files.find({ where: { acpId } });

    if (files.length === 0) blockers.add("Der AP enthält keine Dateien.");

    const validationRun = await this.validation.autoValidateUploadedFiles(
      acpId,
      files,
      undefined,
      false,
    );
    for (const issue of this.uniqueIssues(validationRun.files)) {
      const text = issue.path
        ? `${issue.message} (${issue.path})`
        : issue.message;
      if (issue.severity === "error") blockers.add(text);
      else if (issue.severity === "warning") warnings.add(text);
    }

    const unitResults = await this.unitParser.validateUnitFiles(acpId);
    const manifest = await this.manifest.getManifest(acpId);

    if (manifest.booklets.length === 0) {
      blockers.add("Der AP enthält kein auflösbares Booklet.");
    }

    for (const issue of manifest.issues) {
      const text = issue.path
        ? `${issue.message} (${issue.path})`
        : issue.message;
      if (issue.severity === "error") blockers.add(text);
      else warnings.add(text);
    }

    const unitsById = new Map(unitResults.map((unit) => [unit.unitId, unit]));
    const referencedUnitIds = new Set(
      manifest.booklets.flatMap((booklet) =>
        booklet.units.map((unit) => unit.id),
      ),
    );
    for (const unitId of referencedUnitIds) {
      if (!unitsById.has(unitId)) {
        blockers.add(
          `Für die referenzierte Unit „${unitId}“ wurde keine Unit-Datei gefunden.`,
        );
      }
    }

    for (const unitId of referencedUnitIds) {
      const unit = unitsById.get(unitId);
      if (!unit) continue;
      if (!unit.files.definition.found) {
        blockers.add(
          `Unit „${unit.unitLabel || unit.unitId}“: Aufgabendefinition „${unit.files.definition.expected}“ fehlt.`,
        );
      }
      if (!unit.files.player.found) {
        blockers.add(
          `Unit „${unit.unitLabel || unit.unitId}“: Player „${unit.files.player.expected}“ fehlt.`,
        );
      }
      if (!unit.files.codingScheme.found) {
        warnings.add(
          `Unit „${unit.unitLabel || unit.unitId}“: Kodierschema „${unit.files.codingScheme.expected}“ fehlt.`,
        );
      }
      if (!unit.files.metadata.found) {
        warnings.add(
          `Unit „${unit.unitLabel || unit.unitId}“: Metadaten „${unit.files.metadata.expected}“ fehlen.`,
        );
      }
    }

    for (const booklet of manifest.booklets) {
      if (booklet.units.length === 0) {
        warnings.add(
          `Booklet „${booklet.name || booklet.id}“ enthält keine Aufgaben.`,
        );
      }
    }

    const blockerList = [...blockers];
    const warningList = [...warnings];
    const result: ReviewReadinessResult = {
      status: blockerList.length
        ? "BLOCKED"
        : warningList.length
          ? "WARNING"
          : "READY",
      checkedAt: new Date().toISOString(),
      blockers: blockerList,
      warnings: warningList,
      summary: {
        totalFiles: validationRun.summary.totalFiles,
        validFiles: validationRun.summary.validFiles,
        invalidFiles: validationRun.summary.invalidFiles,
        bookletCount: manifest.booklets.length,
        unitCount: referencedUnitIds.size,
      },
    };
    result.stale = fingerprint !== (await this.fingerprint(acpId));
    await this.snapshots.upsert({ acpId, fingerprint, result }, ["acpId"]);
    return result;
  }

  private uniqueIssues(files: AcpFile[]): ValidationIssue[] {
    const issues = new Map<string, ValidationIssue>();
    for (const file of files) {
      const result = file.validationResult as
        | { issues?: ValidationIssue[] }
        | null
        | undefined;
      for (const issue of result?.issues || []) {
        const key = [issue.severity, issue.message, issue.path || ""].join(
          "\u0000",
        );
        issues.set(key, issue);
      }
    }
    return [...issues.values()];
  }
}
