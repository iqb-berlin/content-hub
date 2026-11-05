import { describe, expect, it } from 'vitest';
import type { ItemExplorerChangeLogEntry } from '../../core/models/api.models';
import {
  buildHistoryCsv,
  filterHistoryEntries,
  ItemExplorerHistoryFilters,
} from './item-explorer-history';

const filters: ItemExplorerHistoryFilters = {
  historyFilterUser: '',
  historyFilterType: '',
  historyFilterFrom: '',
  historyFilterTo: '',
};

function entry(overrides: Partial<ItemExplorerChangeLogEntry> = {}): ItemExplorerChangeLogEntry {
  return {
    id: 'change',
    acpId: 'package',
    changeType: 'TAGS_CHANGED',
    beforeState: {},
    afterState: {},
    diff: {},
    actorUsername: 'Reviewer',
    actorRole: 'manager',
    createdAt: '2026-11-04T12:34:56.000Z',
    ...overrides,
  };
}

describe('history filtering', () => {
  it('combines case-insensitive user and action filters, trimming their search values', () => {
    const matching = entry();
    const entries = Object.freeze([
      entry({ actorUsername: 'Other' }),
      matching,
      entry({ changeType: 'UI_UPDATE' }),
      entry({ actorUsername: null, changeType: '' }),
    ]);
    expect(
      filterHistoryEntries(entries, {
        ...filters,
        historyFilterUser: ' VIEW ',
        historyFilterType: ' tags ',
      }),
    ).toEqual([matching]);
    expect(entries).toHaveLength(4);
    expect(filterHistoryEntries(entries, filters)).toEqual(entries);
  });

  it('includes both local date boundaries and excludes the adjacent days', () => {
    const dates = [
      new Date(2026, 10, 3, 23, 59, 59, 999),
      new Date(2026, 10, 4, 0, 0, 0, 0),
      new Date(2026, 10, 4, 23, 59, 59, 999),
      new Date(2026, 10, 5, 0, 0, 0, 0),
    ];
    const entries = dates.map((date, index) =>
      entry({ id: `${index}`, createdAt: date.toISOString() }),
    );
    expect(
      filterHistoryEntries(entries, {
        ...filters,
        historyFilterFrom: '2026-11-04',
        historyFilterTo: '2026-11-04',
      }),
    ).toEqual([entries[1], entries[2]]);
    expect(filterHistoryEntries(entries, { ...filters, historyFilterFrom: '2026-11-04' })).toEqual(
      entries.slice(1),
    );
    expect(filterHistoryEntries(entries, { ...filters, historyFilterTo: '2026-11-04' })).toEqual(
      entries.slice(0, 3),
    );
  });

  it('returns no entries for reversed or invalid date bounds', () => {
    expect(
      filterHistoryEntries([entry()], {
        ...filters,
        historyFilterFrom: '2026-11-05',
        historyFilterTo: '2026-11-03',
      }),
    ).toEqual([]);
    expect(filterHistoryEntries([entry()], { ...filters, historyFilterFrom: 'invalid' })).toEqual(
      [],
    );
  });
});

describe('history CSV', () => {
  it('preserves the column order, UTC time, zero versions and quoted special characters', () => {
    const input = Object.freeze([
      Object.freeze(
        entry({
          actorUsername: 'A;"B"\nC',
          actorRole: null,
          draftVersion: 0,
          publishedVersion: null,
          diff: { tags: ['Prüfen'] },
        }),
      ),
    ]);
    expect(buildHistoryCsv(input)).toBe(
      '"Zeit";"Nutzer";"Rolle";"Aktion";"Draft-Version";"Published-Version";"Diff"\n' +
        '"2026-11-04T12:34:56.000Z";"A;""B""\nC";"";"TAGS_CHANGED";"0";"";"{""tags"":[""Prüfen""]}"',
    );
    expect(input[0].actorUsername).toBe('A;"B"\nC');
  });

  it('retains missing labels as empty cells and exports no phantom data row', () => {
    expect(
      buildHistoryCsv([
        entry({ actorUsername: null, actorRole: null, changeType: '', diff: null as any }),
      ]),
    ).toContain('"2026-11-04T12:34:56.000Z";"";"";"";"";"";"{}"');
    expect(buildHistoryCsv([])).toBe(
      '"Zeit";"Nutzer";"Rolle";"Aktion";"Draft-Version";"Published-Version";"Diff"',
    );
  });
});
