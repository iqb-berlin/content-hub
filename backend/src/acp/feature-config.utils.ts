type UnknownRecord = Record<string, unknown>;

interface MetadataColumnsConfig {
  restrictReviewerColumnsToManagerSelection?: boolean;
  visible: string[];
  order: string[];
  configured?: boolean;
  referenceNumberVisible?: boolean;
  definitions?: Array<{ id: string; label: string }>;
  widths?: Record<string, number>;
  layout?: TableColumnLayoutConfig;
}

interface TableColumnLayoutConfig {
  visible: string[];
  order: string[];
  configured: boolean;
  widths: Record<string, number>;
}

function asRecord(value: unknown): UnknownRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizePersonalItemTags(
  value: unknown,
): Array<{ label: string; color: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: Array<{ label: string; color: string }> = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const label =
      typeof record.label === "string" ? record.label.trim().slice(0, 100) : "";
    if (!label || seen.has(label)) continue;
    const color =
      typeof record.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(record.color.trim())
        ? record.color.trim().toLowerCase()
        : "#3498db";
    seen.add(label);
    tags.push({ label, color });
  }
  return tags.slice(0, 50);
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawLabel] of Object.entries(source)) {
    const key = rawKey.trim();
    const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
    if (key && label) {
      normalized[key] = label;
    }
  }
  return normalized;
}

function normalizeMetadataColumnDefinitions(
  value: unknown,
): Array<{ id: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const definitions: Array<{ id: string; label: string }> = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const id =
      typeof record.id === "string" ? record.id.trim().slice(0, 200) : "";
    const label =
      typeof record.label === "string" ? record.label.trim().slice(0, 200) : "";
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    definitions.push({ id, label });
  }
  return definitions.slice(0, 100);
}

function normalizeMetadataColumnWidths(value: unknown): Record<string, number> {
  const source = asRecord(value);
  const widths: Record<string, number> = {};
  for (const [rawId, rawWidth] of Object.entries(source).slice(0, 100)) {
    const id = rawId.trim().slice(0, 200);
    const width = Number(rawWidth);
    if (!id || !Number.isFinite(width)) continue;
    widths[id] = Math.min(600, Math.max(80, Math.round(width)));
  }
  return widths;
}

function normalizeTableColumnWidths(value: unknown): Record<string, number> {
  const source = asRecord(value);
  const widths: Record<string, number> = {};
  for (const [rawKey, rawWidth] of Object.entries(source).slice(0, 120)) {
    const key = rawKey.trim().slice(0, 220);
    const width = Number(rawWidth);
    if (!key || !Number.isFinite(width)) continue;
    widths[key] = Math.min(600, Math.max(80, Math.round(width)));
  }
  return widths;
}

function normalizeTableColumnLayout(
  value: unknown,
): TableColumnLayoutConfig | undefined {
  const source = asRecord(value);
  const visible = asStringArray(source.visible);
  const order = asStringArray(source.order);
  const configured =
    source.configured === true || visible.length > 0 || order.length > 0;
  const widths = normalizeTableColumnWidths(source.widths);
  if (!configured && Object.keys(widths).length === 0) return undefined;
  return {
    visible:
      source.configured === true ? visible : visible.length ? visible : order,
    order: order.length ? order : visible,
    configured,
    widths,
  };
}

function normalizeMetadataColumns(
  metadataColumnsRaw: unknown,
  legacyItemListColumnsRaw: unknown,
): MetadataColumnsConfig | undefined {
  const metadataColumns = asRecord(metadataColumnsRaw);
  const visible = asStringArray(metadataColumns.visible);
  const order = asStringArray(metadataColumns.order);
  const explicitlyConfigured = metadataColumns.configured === true;
  const hasColumnSelection = visible.length > 0 || order.length > 0;
  const referenceNumberVisible =
    metadataColumns.referenceNumberVisible === true;
  const definitions = normalizeMetadataColumnDefinitions(
    metadataColumns.definitions,
  );
  const widths = normalizeMetadataColumnWidths(metadataColumns.widths);
  const layout = normalizeTableColumnLayout(metadataColumns.layout);

  if (
    metadataColumns.restrictReviewerColumnsToManagerSelection === true ||
    explicitlyConfigured ||
    hasColumnSelection ||
    referenceNumberVisible ||
    definitions.length ||
    Object.keys(widths).length ||
    layout
  ) {
    const normalizedVisible = visible.length ? visible : order;
    const normalizedOrder = order.length ? order : normalizedVisible;
    return {
      ...(metadataColumns.restrictReviewerColumnsToManagerSelection === true
        ? { restrictReviewerColumnsToManagerSelection: true }
        : {}),
      visible: normalizedVisible,
      order: normalizedOrder,
      ...(explicitlyConfigured ? { configured: true } : {}),
      ...(referenceNumberVisible ? { referenceNumberVisible: true } : {}),
      ...(definitions.length ? { definitions } : {}),
      ...(Object.keys(widths).length ? { widths } : {}),
      ...(layout ? { layout } : {}),
    };
  }

  const legacyColumns = asStringArray(legacyItemListColumnsRaw);
  if (!legacyColumns.length) {
    return undefined;
  }

  return {
    visible: legacyColumns,
    order: legacyColumns,
  };
}

function normalizeReducedView(value: unknown): UnknownRecord {
  const source = asRecord(value);
  const actions = asRecord(source.headerActions);
  return {
    enabled: source.enabled === true,
    headerActions: Object.fromEntries(
      [
        "readonlyPreview",
        "columnManager",
        "importParameters",
        "clearEmpiricalDifficulties",
        "renumberReferences",
        "history",
      ].map((id) => [id, actions[id] !== false]),
    ),
    showHeader: source.showHeader !== false,
    showTableToolbarArea: source.showTableToolbarArea !== false,
    showItemInfo: source.showItemInfo !== false,
    showPlayerPreview: source.showPlayerPreview !== false,
    showExplorerItemPanel: source.showExplorerItemPanel !== false,
  };
}

/**
 * Canonical feature-config representation:
 * - use `metadataColumns` as the single source of truth
 * - migrate legacy `itemListMetadataColumns` if present
 * - strip legacy key from output
 */
export function normalizeFeatureConfig(featureConfig: unknown): UnknownRecord {
  const source = asRecord(featureConfig);
  const normalized: UnknownRecord = { ...source };

  normalized.commentVisibilityMode =
    source.commentVisibilityMode === "GROUP"
      ? "GROUP"
      : source.commentVisibilityMode === "SHARED"
        ? "SHARED"
        : "PRIVATE";

  normalized.enablePlayerFocusHighlight =
    source.enablePlayerFocusHighlight === true;
  normalized.showStudioItemComments = source.showStudioItemComments === true;
  if (source.itemExplorerReducedView !== undefined) {
    normalized.itemExplorerReducedView = normalizeReducedView(
      source.itemExplorerReducedView,
    );
  }

  normalized.enablePersonalItemData = source.enablePersonalItemData === true;
  normalized.enableItemCollections = source.enableItemCollections === true;
  normalized.showGeneralCodingInstructions =
    source.showGeneralCodingInstructions === true;
  normalized.preferManualCodingInstructions =
    source.preferManualCodingInstructions !== false;
  normalized.personalItemCategoryLabel =
    typeof source.personalItemCategoryLabel === "string" &&
    source.personalItemCategoryLabel.trim()
      ? source.personalItemCategoryLabel.trim().slice(0, 100)
      : "Kompetenzstufe";
  normalized.personalItemCategoryValues = Array.from(
    new Set(
      asStringArray(source.personalItemCategoryValues).map((value) =>
        value.slice(0, 200),
      ),
    ),
  ).slice(0, 50);
  normalized.personalItemTagLabel =
    typeof source.personalItemTagLabel === "string" &&
    source.personalItemTagLabel.trim()
      ? source.personalItemTagLabel.trim().slice(0, 100)
      : "Markierungen";
  normalized.personalItemTags = normalizePersonalItemTags(
    source.personalItemTags,
  );

  normalized.itemSubIdLabel =
    typeof source.itemSubIdLabel === "string" &&
    source.itemSubIdLabel.trim().length > 0
      ? source.itemSubIdLabel.trim()
      : "Sub-ID";

  const itemSubIdLabels = normalizeStringMap(source.itemSubIdLabels);
  if (Object.keys(itemSubIdLabels).length > 0) {
    normalized.itemSubIdLabels = itemSubIdLabels;
  } else {
    delete normalized.itemSubIdLabels;
  }

  const metadataColumns = normalizeMetadataColumns(
    source.metadataColumns,
    source.itemListMetadataColumns,
  );

  if (metadataColumns) {
    normalized.metadataColumns = metadataColumns;
  } else {
    delete normalized.metadataColumns;
  }

  delete normalized.itemListMetadataColumns;

  return normalized;
}
