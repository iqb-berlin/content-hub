/** Presentation context is shared draft data, never a saved response state. */
export function normalizePreviewContext(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.definitionKey !== "string" ||
    !/^\d+-[\da-f]{1,8}-[\da-f]{1,8}$/.test(raw.definitionKey) ||
    typeof raw.target !== "string" ||
    !raw.target.trim() ||
    raw.target.length > 256 ||
    typeof raw.page !== "number" ||
    !Number.isInteger(raw.page) ||
    raw.page < 0 ||
    raw.page >= 10000 ||
    !raw.dataParts ||
    typeof raw.dataParts !== "object" ||
    Array.isArray(raw.dataParts)
  )
    return null;
  const entries = Object.entries(raw.dataParts);
  if (
    !entries.length ||
    entries.some(
      ([key, data]) =>
        ![
          "elementCodes",
          "stateVariableCodes",
          "geometryVariableCodes",
        ].includes(key) || typeof data !== "string",
    ) ||
    JSON.stringify(raw.dataParts).length > 524288
  )
    return null;
  try {
    if (entries.some(([, data]) => !Array.isArray(JSON.parse(data as string))))
      return null;
  } catch {
    return null;
  }
  return {
    definitionKey: raw.definitionKey,
    target: raw.target.trim(),
    page: raw.page,
    dataParts: { ...raw.dataParts },
  };
}
