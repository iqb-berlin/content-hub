import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { readFile } from "fs/promises";
import { Ap, ApFile } from "../database/entities";
import { getAssessmentParts, toRuntimeApIndex } from "../ap/ap-index.utils";
import { buildReviewManifest } from "./review-manifest";

@Injectable()
export class ReviewManifestService {
  constructor(
    @InjectRepository(Ap) private readonly aps: Repository<Ap>,
    @InjectRepository(ApFile) private readonly files: Repository<ApFile>,
  ) {}

  async getManifest(apId: string, manager?: EntityManager) {
    const ap = await (manager?.getRepository(Ap) || this.aps).findOne({
      where: { id: apId },
    });
    if (!ap) throw new NotFoundException("AP nicht gefunden.");
    const files = await (manager?.getRepository(ApFile) || this.files).find({
      where: { apId },
    });
    const wanted = new Set<string>();
    for (const part of getAssessmentParts(toRuntimeApIndex(ap.apIndex))) {
      for (const instrument of Array.isArray(part.instruments)
        ? part.instruments
        : []) {
        for (const booklet of Array.isArray(instrument.testcenterBooklet)
          ? instrument.testcenterBooklet
          : []) {
          if (typeof booklet.definitionId === "string")
            wanted.add(booklet.definitionId);
        }
      }
    }
    const definitions = new Map<string, string>();
    for (const file of files.filter((entry) =>
      wanted.has(entry.originalName),
    )) {
      try {
        definitions.set(
          file.originalName,
          await readFile(file.filePath, "utf8"),
        );
      } catch {
        /* The manifest reports the missing definition with its index path. */
      }
    }
    return buildReviewManifest(ap.apIndex, definitions);
  }
}
