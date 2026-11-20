import type { ItemExplorerChangeLogEntry } from '../../core/models/api.models';

export interface ItemExplorerHistoryFilters {
  historyFilterUser: string;
  historyFilterType: string;
  historyFilterFrom: string;
  historyFilterTo: string;
}

export function filterHistoryEntries(
  entries: readonly ItemExplorerChangeLogEntry[],
  filters: ItemExplorerHistoryFilters,
): ItemExplorerChangeLogEntry[] {
  const userNeedle = filters.historyFilterUser.trim().toLowerCase();
  const typeNeedle = filters.historyFilterType.trim().toLowerCase();
  const fromDate = filters.historyFilterFrom
    ? new Date(`${filters.historyFilterFrom}T00:00:00`)
    : null;
  const toDate = filters.historyFilterTo
    ? new Date(`${filters.historyFilterTo}T23:59:59.999`)
    : null;
  return entries.filter((entry) => {
    const user = (entry.actorUsername || '').toLowerCase();
    const type = (entry.changeType || '').toLowerCase();
    const entryDate = new Date(entry.createdAt);
    return (
      (!userNeedle || user.includes(userNeedle)) &&
      (!typeNeedle || type.includes(typeNeedle)) &&
      (!fromDate || entryDate >= fromDate) &&
      (!toDate || entryDate <= toDate)
    );
  });
}

export function buildHistoryCsv(entries: readonly ItemExplorerChangeLogEntry[]): string {
  const escapeCsv = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Zeit', 'Nutzer', 'Rolle', 'Aktion', 'Draft-Version', 'Published-Version', 'Diff'],
    ...entries.map((entry) => [
      new Date(entry.createdAt).toISOString(),
      entry.actorUsername || '',
      entry.actorRole || '',
      entry.changeType || '',
      entry.draftVersion ?? '',
      entry.publishedVersion ?? '',
      JSON.stringify(entry.diff || {}),
    ]),
  ];
  return rows.map((row) => row.map(escapeCsv).join(';')).join('\n');
}
