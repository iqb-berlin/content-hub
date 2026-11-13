type UnknownRecord = Record<string, unknown>;
export const DEFAULT_AP_INDEX_VERSION = "0.5.0";
export const AP_INDEX_ALLOWED_STATUS_VALUES = [
  "IN_DEVELOPMENT",
  "DISCONTINUED",
  "RELEASED_PUBLIC",
  "RELEASED_CONFIDENTIAL",
] as const;

function asRecord(value: unknown): UnknownRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return {};
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function dedupeById<T extends { id?: unknown }>(entries: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) {
      deduped.push(entry);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(entry);
  }

  return deduped;
}

export function getAssessmentParts(index: unknown): any[] {
  const obj = asRecord(index);
  return asArray(obj.assessmentParts);
}

export function getIndexUnits(index: unknown): any[] {
  const obj = asRecord(index);
  const partUnits = getAssessmentParts(obj).flatMap((part) =>
    asArray(part?.units),
  );
  const units = partUnits.length ? partUnits : asArray(obj.units);
  return dedupeById(units);
}

export function getIndexScales(index: unknown): any[] {
  const obj = asRecord(index);
  const partScales = getAssessmentParts(obj).flatMap((part) =>
    asArray(part?.scales),
  );
  const scales = partScales.length ? partScales : asArray(obj.scales);
  return dedupeById(scales);
}

export function findUnitInIndex(
  index: unknown,
  unitId: string,
): any | undefined {
  return getIndexUnits(index).find((unit) => unit?.id === unitId);
}

/**
 * Runtime view of AP index:
 * - prefers assessmentParts units/scales (AP 0.5)
 * - keeps legacy top-level units/scales for compatibility
 */
export function toRuntimeApIndex(index: unknown): UnknownRecord {
  const source = asRecord(index);
  const version =
    typeof source.version === "string" && source.version.trim()
      ? source.version
      : DEFAULT_AP_INDEX_VERSION;

  return {
    ...source,
    version,
    assessmentParts: getAssessmentParts(source),
    units: getIndexUnits(source),
    scales: getIndexScales(source),
  };
}

/**
 * Storage normalization:
 * - preserve incoming fields
 * - ensure assessmentParts can serve as canonical source for units/scales
 */
export function normalizeIndexForStorage(index: unknown): UnknownRecord {
  const runtime = toRuntimeApIndex(index);
  const parts = getAssessmentParts(runtime).map((part) => ({ ...part }));
  const units = getIndexUnits(runtime);
  const scales = getIndexScales(runtime);

  const hasUnitsInParts = parts.some((part) => asArray(part.units).length > 0);
  const hasScalesInParts = parts.some(
    (part) => asArray(part.scales).length > 0,
  );

  if (
    (units.length && !hasUnitsInParts) ||
    (scales.length && !hasScalesInParts)
  ) {
    if (!parts.length) {
      parts.push({
        id: "default-assessment-part",
        name: [{ lang: "de", value: "Default Assessment Part" }],
      });
    }

    const primary = { ...parts[0] };
    if (!hasUnitsInParts) primary.units = units;
    if (!hasScalesInParts && scales.length) primary.scales = scales;
    parts[0] = primary;
  }

  return {
    ...runtime,
    assessmentParts: parts,
  };
}
