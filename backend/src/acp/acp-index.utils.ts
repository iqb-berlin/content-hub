type UnknownRecord = Record<string, unknown>;
export const DEFAULT_ACP_INDEX_VERSION = "0.5.0";
export const ACP_INDEX_ALLOWED_STATUS_VALUES = [
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
  return partUnits.length ? partUnits : dedupeById(asArray(obj.units));
}

export function getIndexScales(index: unknown): any[] {
  const obj = asRecord(index);
  const partScales = getAssessmentParts(obj).flatMap((part) =>
    part?.baseScales !== undefined || part?.derivedScales !== undefined
      ? [...asArray(part?.baseScales), ...asArray(part?.derivedScales)]
      : asArray(part?.scales),
  );
  return partScales.length ? partScales : dedupeById(asArray(obj.scales));
}

export function findUnitInIndex(
  index: unknown,
  unitId: string,
): any | undefined {
  return getIndexUnits(index).find((unit) => unit?.id === unitId);
}

export function findUnitsInIndex(
  index: unknown,
  unitId: string,
): Array<{ partId: string; unit: any }> {
  return getAssessmentParts(index).flatMap((part) =>
    asArray(part?.units)
      .filter((unit) => unit?.id === unitId)
      .map((unit) => ({ partId: String(part?.id || ""), unit })),
  );
}

export function findUnitInPart(
  index: unknown,
  partId: string,
  unitId: string,
): any | undefined {
  const part = getAssessmentParts(index).find((entry) => entry?.id === partId);
  return asArray(part?.units).find((unit) => unit?.id === unitId);
}

/**
 * Runtime view of ACP index:
 * - prefers assessmentParts units and both scale types (ACP 0.6)
 * - keeps legacy top-level units/scales for compatibility
 */
export function toRuntimeAcpIndex(index: unknown): UnknownRecord {
  const source = asRecord(index);
  const version =
    typeof source.version === "string" && source.version.trim()
      ? source.version
      : DEFAULT_ACP_INDEX_VERSION;

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
 * - preserve schema-defined incoming fields
 * - remove legacy top-level units/scales; explicit migration places them in parts
 */
export function normalizeIndexForStorage(index: unknown): UnknownRecord {
  const source = asRecord(index);
  const { units: _legacyUnits, scales: _legacyScales, ...canonical } = source;
  const parts = getAssessmentParts(source).map((part) => ({ ...part }));
  if (parts.length) canonical.assessmentParts = parts;
  else delete canonical.assessmentParts;
  return canonical;
}
