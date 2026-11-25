import { createHash } from "crypto";
import { stat } from "fs/promises";
import { Ap } from "../database/entities/ap.entity";
import { ReviewReadinessSnapshot } from "../database/entities/review-readiness-snapshot.entity";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ApFile } from "../database/entities";
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
    @InjectRepository(ApFile)
    private readonly files: Repository<ApFile>,
    private readonly validation: ValidationService,
    private readonly unitParser: UnitParserService,
    private readonly manifest: ReviewManifestService,
    @InjectRepository(Ap) private readonly aps: Repository<Ap>,
    @InjectRepository(ReviewReadinessSnapshot)
    private readonly snapshots: Repository<ReviewReadinessSnapshot>,
  ) {}

  // Bump when readiness rules or validation dependencies change.
  private readonly rulesVersion = "review-readiness-v2";

  private async fingerprint(apId: string): Promise<string> {
    const [ap, files] = await Promise.all([
      this.aps.findOne({ where: { id: apId } }),
      this.files.find({ where: { apId } }),
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
      .update(JSON.stringify(stable([this.rulesVersion, ap?.apIndex, entries])))
      .digest("hex");
  }

  async getLast(apId: string): Promise<ReviewReadinessResult | null> {
    const snapshot = await this.snapshots.findOne({ where: { apId } });
    if (!snapshot) return null;
    return {
      ...snapshot.result,
      stale:
        snapshot.result.stale === true ||
        snapshot.fingerprint !== (await this.fingerprint(apId)),
    };
  }

  async check(apId: string): Promise<ReviewReadinessResult> {
    const fingerprint = await this.fingerprint(apId);
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const files = await this.files.find({ where: { apId } });

    if (files.length === 0) blockers.add("Der AP enthält keine Dateien.");

    const validationRun = await this.validation.autoValidateUploadedFiles(
      apId,
      files,
      undefined,
      false,
    );
    const validationIssues = [
      ...this.uniqueIssues(validationRun.files),
      ...validationRun.summary.semanticIssues,
    ];
    for (const issue of validationIssues) {
      const text = issue.path
        ? `${issue.message} (${issue.path})`
        : issue.message;
      if (issue.severity === "error") blockers.add(text);
      else if (issue.severity === "warning") warnings.add(text);
    }

    const unitResults = await this.unitParser.validateUnitFiles(apId);
    const manifest = await this.manifest.getManifest(apId);

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
    result.stale = fingerprint !== (await this.fingerprint(apId));
    await this.snapshots.upsert({ apId, fingerprint, result }, ["apId"]);
    return result;
  }

  private uniqueIssues(files: ApFile[]): ValidationIssue[] {
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
