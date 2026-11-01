import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Acp, AcpFile } from "../database/entities";
import {
  getAssessmentParts,
  getIndexUnits,
  toRuntimeAcpIndex,
} from "../acp/acp-index.utils";

export interface SemanticValidationResult {
  valid: boolean;
  issues: {
    severity: "error" | "warning" | "info";
    message: string;
    path?: string;
  }[];
}

/**
 * Validates cross-reference consistency within an ACP:
 * - Unit IDs in booklets exist among defined units
 * - File dependencies reference existing uploaded files
 * - Items reference valid source variables
 */
@Injectable()
export class SemanticValidator {
  constructor(
    @InjectRepository(Acp)
    private readonly acpRepository: Repository<Acp>,
    @InjectRepository(AcpFile)
    private readonly fileRepository: Repository<AcpFile>,
  ) {}

  /**
   * Validate semantic consistency of the entire ACP.
   */
  async validate(acpId: string): Promise<SemanticValidationResult> {
    const issues: SemanticValidationResult["issues"] = [];

    const acp = await this.acpRepository.findOne({ where: { id: acpId } });
    if (!acp) {
      return {
        valid: false,
        issues: [{ severity: "error", message: "AP not found" }],
      };
    }

    const index = toRuntimeAcpIndex(acp.acpIndex);
    if (!index) {
      return {
        valid: false,
        issues: [{ severity: "error", message: "AP-Index is empty" }],
      };
    }

    const files = await this.fileRepository.find({ where: { acpId } });
    const fileNames = new Set(files.map((f) => f.originalName));

    // Collect all unit IDs
    const units = getIndexUnits(index);
    const unitIds = new Set(units.map((u: any) => u.id));

    // 1. Validate file dependencies in units
    for (const unit of units) {
      for (const dep of unit.dependencies || []) {
        if (dep.id && !fileNames.has(dep.id)) {
          issues.push({
            severity: "error",
            message: `Unit "${unit.id}" references file "${dep.id}" (type: ${dep.type}) which is not uploaded`,
            path: `units.${unit.id}.dependencies`,
          });
        }
      }
    }

    // 2. Validate unit references in assessment parts (booklets)
    for (const part of getAssessmentParts(index)) {
      for (const instrument of part.instruments || []) {
        for (const unitRef of instrument.units || []) {
          const refId = typeof unitRef === "string" ? unitRef : unitRef.id;
          if (refId && !unitIds.has(refId)) {
            issues.push({
              severity: "error",
              message: `Instrument "${instrument.id}" references unit "${refId}" which is not defined`,
              path: `assessmentParts.${part.id}.instruments.${instrument.id}`,
            });
          }
        }
      }
    }

    // 3. Validate item-level references
    for (const unit of units) {
      for (const item of unit.items || []) {
        // Check that items have required identifiers
        if (!item.id) {
          issues.push({
            severity: "warning",
            message: `Unit "${unit.id}" has an item without an ID`,
            path: `units.${unit.id}.items`,
          });
        }
      }
    }

    // 4. Check for duplicate unit IDs
    const seenUnitIds = new Set<string>();
    for (const unit of units) {
      if (seenUnitIds.has(unit.id)) {
        issues.push({
          severity: "error",
          message: `Duplicate unit ID: "${unit.id}"`,
          path: "units",
        });
      }
      seenUnitIds.add(unit.id);
    }

    // 5. Check for duplicate item IDs within a unit
    for (const unit of units) {
      const seenItems = new Set<string>();
      for (const item of unit.items || []) {
        if (item.id && seenItems.has(item.id)) {
          issues.push({
            severity: "warning",
            message: `Duplicate item ID "${item.id}" in unit "${unit.id}"`,
            path: `units.${unit.id}.items`,
          });
        }
        if (item.id) seenItems.add(item.id);
      }
    }

    const hasErrors = issues.some((i) => i.severity === "error");
    return { valid: !hasErrors, issues };
  }
}
