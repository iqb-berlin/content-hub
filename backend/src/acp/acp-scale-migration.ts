import Ajv from "ajv";
import { AcpIndexValidationIssue } from "./acp-index.types";

const validateLegacyScale = new Ajv({ allErrors: true, strict: false }).compile<
  Record<string, any>
>(require("./schemas/acp-scale-0.2.schema.json"));

/** Convert only lossless 0.5 scale representations; keep other data for review. */
export function migrateLegacyScales(
  part: Record<string, any>,
  partPath: string,
  changes: Array<{ path: string; message: string }>,
): AcpIndexValidationIssue[] {
  if (!Array.isArray(part.scales)) return [];
  const issues: AcpIndexValidationIssue[] = [];
  const remaining: unknown[] = [];
  for (const [index, scale] of part.scales.entries()) {
    const path = `${partPath}/scales/${index}`;
    let converted: Record<string, any> | undefined;
    let target = "derivedScales";
    if (validateLegacyScale(scale)) {
      const { scaleType, typeParameters: parameters, ...header } = scale;
      if (scaleType === "BASE") {
        target = "baseScales";
        converted = { ...header, ...parameters };
      } else if (
        scaleType === "AGGREGATED" &&
        Array.isArray(parameters.sources) &&
        parameters.sources.every(
          (source: any) => source.weight === undefined || source.weight === 1,
        )
      ) {
        converted = {
          ...header,
          method: parameters.method || "SUM",
          sources: parameters.sources.map((source: any) => source.id),
        };
      } else if (
        scaleType === "DERIVED" &&
        typeof parameters.source === "string" &&
        Array.isArray(parameters.mappings) &&
        !parameters.relatedVocabularies?.length
      ) {
        converted = {
          ...header,
          method: "MAP",
          sources: [parameters.source],
          mappings: parameters.mappings.map((mapping: any) => ({
            method: mapping.method,
            parameters: mapping.parameters,
            newValue: {
              value: mapping.newValue,
              ...(mapping.valueLabel ? { label: mapping.valueLabel } : {}),
              ...(mapping.valueDescription
                ? { description: mapping.valueDescription }
                : {}),
            },
          })),
          mappingsElse: {
            value: parameters.elseValue ?? 0,
            ...(parameters.elseValueLabel
              ? { label: parameters.elseValueLabel }
              : {}),
            ...(parameters.elseValueDescription
              ? { description: parameters.elseValueDescription }
              : {}),
          },
        };
      }
    }
    if (
      converted &&
      (part[target] === undefined || Array.isArray(part[target]))
    ) {
      part[target] = [...(part[target] || []), converted];
      changes.push({
        path,
        message: `Skala ${scale.id} nach ${target} (ACP-Index 0.6) migriert.`,
      });
    } else {
      remaining.push(scale);
      issues.push({
        code: "SCALE_MIGRATION_REVIEW_REQUIRED",
        scope: "semantic",
        severity: "error",
        path: `${partPath}/scales/${remaining.length - 1}`,
        message:
          "Skala kann nicht verlustfrei nach 0.6 migriert werden. Gewichte, Vokabularbeziehungen und ungültige Strukturen müssen fachlich geprüft werden; die Originaldaten bleiben erhalten.",
      });
    }
  }
  if (remaining.length) part.scales = remaining;
  else delete part.scales;
  return issues;
}
