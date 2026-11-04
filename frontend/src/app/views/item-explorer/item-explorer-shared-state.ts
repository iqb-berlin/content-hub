import type { PreviewStart } from '../../core/services/preview-visibility';
import type { ExplorerItem } from './item-explorer.models';

type ItemIdentity = Pick<ExplorerItem, 'rowKey' | 'uuid' | 'unitId' | 'itemId'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** More specific row keys override older item and unit/item identifiers. */
export function getItemStateKeys(item: ItemIdentity): string[] {
  const resolvedItemId = item.itemId?.startsWith(`${item.unitId}_`)
    ? item.itemId
    : `${item.unitId}_${item.itemId}`;
  return Array.from(
    new Set(
      [item.rowKey, item.uuid, resolvedItemId, item.itemId]
        .map((candidate) => String(candidate || '').trim())
        .filter(Boolean),
    ),
  );
}

export function getExistingItemStateKey(item: ItemIdentity, itemProperties: unknown): string {
  if (!isRecord(itemProperties)) return '';
  return getItemStateKeys(item).find((key) => isRecord(itemProperties[key])) || '';
}

export function getItemPropsForKeys(
  itemProperties: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!isRecord(itemProperties)) return null;
  const merged: Record<string, unknown> = {};
  let found = false;
  for (const key of [...keys].reverse()) {
    if (isRecord(itemProperties[key])) {
      Object.assign(merged, itemProperties[key]);
      found = true;
    }
  }
  return found ? merged : null;
}

export function normalizeTagValues(values: readonly unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter((value) => value.length > 0)),
  );
}

export function normalizeTags(rawTags: unknown): Record<string, string[]> {
  if (!isRecord(rawTags)) return {};
  const tags: Record<string, string[]> = {};
  for (const [itemId, values] of Object.entries(rawTags)) {
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId || !Array.isArray(values)) continue;
    // An empty array records an explicit deletion and must override imported tags.
    tags[normalizedItemId] = normalizeTagValues(values);
  }
  return tags;
}

export function getTagsForKeys(
  tagsMap: Readonly<Record<string, readonly string[]>>,
  keys: readonly string[],
): string[] | null {
  for (const key of keys) {
    const tags = tagsMap[key];
    if (Array.isArray(tags)) return normalizeTagValues(tags);
  }
  return null;
}

export function resolveItemTags(
  item: ItemIdentity,
  itemProperties: unknown,
  stateTags: Readonly<Record<string, readonly string[]>>,
  fallbackTags: readonly string[] = [],
): string[] {
  const keys = getItemStateKeys(item);
  const tagsFromState = getTagsForKeys(stateTags, keys);
  if (tagsFromState !== null) return tagsFromState;
  const itemProps = getItemPropsForKeys(itemProperties, keys);
  return Array.isArray(itemProps?.['tags'])
    ? normalizeTagValues(itemProps['tags'])
    : [...fallbackTags];
}

/** Projects shared properties without changing the imported row or server state. */
export function projectExplorerItem(
  item: ExplorerItem,
  itemProperties: unknown,
  stateTags: Readonly<Record<string, readonly string[]>>,
): ExplorerItem {
  const keys = getItemStateKeys(item);
  const itemProps = getItemPropsForKeys(itemProperties, keys);
  const projected = { ...item };

  const empiricalDifficultyRaw = itemProps?.['empiricalDifficulty'];
  const parsed = Number(empiricalDifficultyRaw);
  if (
    empiricalDifficultyRaw !== undefined &&
    empiricalDifficultyRaw !== null &&
    Number.isFinite(parsed)
  ) {
    projected.empiricalDifficulty = parsed;
  } else {
    delete projected.empiricalDifficulty;
  }

  projected.previewStart = itemProps?.['previewStart'] as PreviewStart | undefined;
  const previewTargetId = String(itemProps?.['previewTargetId'] || '').trim();
  if (previewTargetId) projected.previewTargetId = previewTargetId;
  else delete projected.previewTargetId;

  if (itemProps?.['excluded'] === true) projected.excluded = true;
  else delete projected.excluded;

  projected.tags = resolveItemTags(
    item,
    itemProperties,
    stateTags,
    Array.isArray(item.tags) ? item.tags : [],
  );
  return projected;
}
