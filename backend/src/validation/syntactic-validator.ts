import { Injectable } from "@nestjs/common";
import { ApFile } from "../database/entities";

export interface SyntacticValidationResult {
  valid: boolean;
  issues: {
    severity: "error" | "warning" | "info";
    message: string;
    field?: string;
  }[];
}

/**
 * Validates file formats (JSON, XML, CSV, etc.) for syntactic correctness.
 */
@Injectable()
export class SyntacticValidator {
  /**
   * Validate a file's syntactic correctness based on its extension.
   */
  validate(file: ApFile, buffer: Buffer): SyntacticValidationResult {
    const issues: SyntacticValidationResult["issues"] = [];

    if (buffer.length === 0) {
      issues.push({ severity: "warning", message: "File is empty" });
      return { valid: true, issues };
    }

    const ext = file.originalName?.split(".").pop()?.toLowerCase() || "";

    switch (ext) {
      case "json":
        return this.validateJson(buffer, issues);
      case "xml":
        return this.validateXml(buffer, issues);
      case "csv":
        return this.validateCsv(buffer, issues);
      default:
        issues.push({
          severity: "info",
          message: `No specific validator for .${ext} files`,
        });
        return { valid: true, issues };
    }
  }

  private validateJson(
    buffer: Buffer,
    issues: SyntacticValidationResult["issues"],
  ): SyntacticValidationResult {
    try {
      const content = buffer.toString("utf-8");
      JSON.parse(content);
      return { valid: true, issues };
    } catch (e: any) {
      issues.push({ severity: "error", message: `Invalid JSON: ${e.message}` });
      return { valid: false, issues };
    }
  }

  private validateXml(
    buffer: Buffer,
    issues: SyntacticValidationResult["issues"],
  ): SyntacticValidationResult {
    const content = buffer.toString("utf-8").trim();

    // Basic XML structure check
    if (!content.startsWith("<?xml") && !content.startsWith("<")) {
      issues.push({
        severity: "error",
        message: "File does not appear to be valid XML",
      });
      return { valid: false, issues };
    }

    // Check for balanced tags (simple heuristic)
    const openTags = (content.match(/<[a-zA-Z][^/>]*/g) || []).length;
    const closeTags = (content.match(/<\/[a-zA-Z][^>]*/g) || []).length;
    const selfClosing = (content.match(/\/>/g) || []).length;

    if (openTags !== closeTags + selfClosing) {
      issues.push({
        severity: "warning",
        message: "XML tags may not be balanced",
      });
    }

    return { valid: true, issues };
  }

  private validateCsv(
    buffer: Buffer,
    issues: SyntacticValidationResult["issues"],
  ): SyntacticValidationResult {
    const content = buffer.toString("utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    if (lines.length === 0) {
      issues.push({
        severity: "warning",
        message: "CSV file has no data rows",
      });
      return { valid: true, issues };
    }

    // Check consistent column count
    const delimiter = lines[0].includes(";") ? ";" : ",";
    const headerCols = lines[0].split(delimiter).length;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).length;
      if (cols !== headerCols) {
        issues.push({
          severity: "warning",
          message: `Row ${i + 1} has ${cols} columns, expected ${headerCols}`,
        });
      }
    }

    return { valid: true, issues };
  }
}
