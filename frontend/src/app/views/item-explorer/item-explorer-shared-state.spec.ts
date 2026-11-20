import { describe, expect, it } from 'vitest';
import type { ExplorerItem } from './item-explorer.models';
import {
  getExistingItemStateKey,
  getItemPropsForKeys,
  getItemStateKeys,
  getTagsForKeys,
  normalizeTags,
  projectExplorerItem,
  resolveItemTags,
} from './item-explorer-shared-state';

function row(overrides: Partial<ExplorerItem> = {}): ExplorerItem {
  return {
    rowKey: 'uuid::1',
    uuid: 'uuid',
    unitId: 'UNIT',
    itemId: 'ITEM',
    unitLabel: 'Unit',
    description: '',
    variableId: 'answer',
    metadata: {},
    ...overrides,
  };
}

describe('shared Explorer item identity and property precedence', () => {
  it('prefers the partial-credit row over UUID, unit/item and legacy item keys', () => {
    const item = row();
    const properties = Object.freeze({
      ITEM: { excluded: true, previewTargetId: 'legacy', empiricalDifficulty: 0.5 },
      UNIT_ITEM: { previewTargetId: 'unit target' },
      uuid: { tags: ['base'], previewTargetId: 'base target' },
      'uuid::1': { excluded: false, previewTargetId: '', tags: [] },
    });
    expect(getItemStateKeys(item)).toEqual(['uuid::1', 'uuid', 'UNIT_ITEM', 'ITEM']);
    expect(getExistingItemStateKey(item, properties)).toBe('uuid::1');
    expect(getItemPropsForKeys(properties, getItemStateKeys(item))).toEqual({
      excluded: false,
      previewTargetId: '',
      tags: [],
      empiricalDifficulty: 0.5,
    });
    expect(properties.ITEM.excluded).toBe(true);
  });

  it('deduplicates trimmed keys and retains already unit-prefixed item IDs', () => {
    expect(getItemStateKeys(row({ rowKey: ' uuid ', uuid: 'uuid', itemId: 'UNIT_ITEM' }))).toEqual([
      'uuid',
      'UNIT_ITEM',
    ]);
  });

  it('skips invalid property entries and chooses an existing fallback for updates', () => {
    const item = row();
    const properties = { 'uuid::1': [], uuid: null, UNIT_ITEM: { excluded: true } };
    expect(getExistingItemStateKey(item, properties)).toBe('UNIT_ITEM');
    expect(getItemPropsForKeys(properties, getItemStateKeys(item))).toEqual({ excluded: true });
    expect(getExistingItemStateKey(item, {})).toBe('');
  });

  it.each([undefined, null, [], 'invalid', 1])('ignores malformed state %j', (properties) => {
    expect(getExistingItemStateKey(row(), properties)).toBe('');
    expect(getItemPropsForKeys(properties, getItemStateKeys(row()))).toBeNull();
    expect(normalizeTags(properties)).toEqual({});
  });
});

describe('shared Explorer tags', () => {
  it('normalizes labels and keys without dropping explicit deletions or mutating input', () => {
    const input = Object.freeze({
      ' uuid ': Object.freeze([' Prüfen ', 'Prüfen', '', ' ', null, false, 0, 2]),
      'uuid::1': Object.freeze([]),
      ' ': ['ignored'],
      invalid: 'ignored',
    });
    expect(normalizeTags(input)).toEqual({ uuid: ['Prüfen', '2'], 'uuid::1': [] });
    expect(input[' uuid '][0]).toBe(' Prüfen ');
  });

  it('restores persisted tags on rollback and discards optimistic tags without a saved value', () => {
    const item = row({ tags: ['optimistic'] });
    expect(resolveItemTags(item, {}, {})).toEqual([]);
    expect(resolveItemTags(item, { uuid: { tags: [' persisted '] } }, {})).toEqual(['persisted']);
    expect(resolveItemTags(item, { uuid: { tags: ['persisted'] } }, { 'uuid::1': [] })).toEqual([]);
  });

  it('distinguishes a missing tag entry from an explicit empty row override', () => {
    const keys = getItemStateKeys(row());
    expect(getTagsForKeys({}, keys)).toBeNull();
    expect(getTagsForKeys({ uuid: ['base'], 'uuid::1': [] }, keys)).toEqual([]);
    expect(getTagsForKeys({ uuid: [' base ', 'base'] }, keys)).toEqual(['base']);
  });
});

describe('shared Explorer row projection', () => {
  it('clears inherited values on one partial-credit row while preserving another row', () => {
    const first = row({ tags: ['imported'], excluded: true, previewTargetId: 'imported' });
    const second = row({ rowKey: 'uuid::2', tags: ['imported'] });
    const properties = {
      uuid: { excluded: true, previewTargetId: 'base', empiricalDifficulty: '0.65' },
      'uuid::1': { excluded: false, previewTargetId: '', empiricalDifficulty: null },
    };
    const tags = { uuid: ['base'], 'uuid::1': [] };
    const projected = projectExplorerItem(first, properties, tags);
    expect(projected.tags).toEqual([]);
    expect(projected).not.toHaveProperty('excluded');
    expect(projected).not.toHaveProperty('previewTargetId');
    expect(projected).not.toHaveProperty('empiricalDifficulty');
    expect(projectExplorerItem(second, properties, tags)).toMatchObject({
      tags: ['base'],
      excluded: true,
      previewTargetId: 'base',
      empiricalDifficulty: 0.65,
    });
    expect(first.tags).toEqual(['imported']);
    expect(first.excluded).toBe(true);
  });

  it('prefers shared tags to property tags and uses imports only when both are absent', () => {
    const item = row({ tags: ['imported'] });
    const properties = { uuid: { tags: [' property ', 'property'] } };
    expect(projectExplorerItem(item, properties, { uuid: ['shared'] }).tags).toEqual(['shared']);
    expect(projectExplorerItem(item, properties, {}).tags).toEqual(['property']);
    expect(projectExplorerItem(item, {}, {}).tags).toEqual(['imported']);
    expect(projectExplorerItem(row(), {}, {}).tags).toEqual([]);
  });

  it.each(['invalid', Infinity, null, undefined])('clears invalid difficulty %s', (value) => {
    expect(
      projectExplorerItem(
        row({ empiricalDifficulty: 0.3 }),
        { uuid: { empiricalDifficulty: value } },
        {},
      ),
    ).not.toHaveProperty('empiricalDifficulty');
  });

  it('preserves zero difficulty and the preview start without changing frozen inputs', () => {
    const item = Object.freeze(row({ tags: ['imported'] }));
    const previewStart = { context: { page: 2 } };
    const properties = Object.freeze({
      uuid: Object.freeze({ empiricalDifficulty: 0, previewTargetId: ' target ', previewStart }),
    });
    const result = projectExplorerItem(item, properties, {});
    expect(result).toMatchObject({
      empiricalDifficulty: 0,
      previewTargetId: 'target',
      previewStart,
    });
    result.tags!.push('new');
    expect(item.tags).toEqual(['imported']);
    expect(item).not.toHaveProperty('previewTargetId');
  });
});
