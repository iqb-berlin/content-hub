import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { readFile } from "fs/promises";
import { Acp, AcpFile } from "../database/entities";
import { getAssessmentParts, toRuntimeAcpIndex } from "../acp/acp-index.utils";
import { buildReviewManifest } from "./review-manifest";

@Injectable()
export class ReviewManifestService {
  constructor(
    @InjectRepository(Acp) private readonly acps: Repository<Acp>,
    @InjectRepository(AcpFile) private readonly files: Repository<AcpFile>,
  ) {}

  async getManifest(acpId: string, manager?: EntityManager) {
    const acp = await (manager?.getRepository(Acp) || this.acps).findOne({
      where: { id: acpId },
    });
    if (!acp) throw new NotFoundException("AP nicht gefunden.");
    const files = await (manager?.getRepository(AcpFile) || this.files).find({
      where: { acpId },
    });
    const wanted = new Set<string>();
    for (const part of getAssessmentParts(toRuntimeAcpIndex(acp.acpIndex))) {
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
    return buildReviewManifest(acp.acpIndex, definitions);
  }
}
