import { describe, expect, it } from 'vitest';
import {
  ItemExplorerTableService,
  ItemExplorerTableFilterContext,
} from './item-explorer-table.service';
import { ExplorerItem } from './item-explorer.models';

const context = (
  overrides: Partial<ItemExplorerTableFilterContext> = {},
): ItemExplorerTableFilterContext => ({
  canEditExplorer: true,
  reviewerColumnsRestricted: false,
  reviewerVisibleColumns: undefined,
  itemCommentsEnabled: true,
  itemCommentCountsAvailable: true,
  commentCountsByRow: new Map(),
  enableTags: true,
  showPersonalItemData: true,
  personalItemCategoryLabel: 'Kategorie',
  personalItemTagLabel: 'Tags',
  enableItemCollections: true,
  itemTags: {},
  personalColumnFilters: {},
  personalItemData: {},
  activeCollectionRowKeys: null,
  ...overrides,
});
const row = (id: string, values: Partial<ExplorerItem> = {}): ExplorerItem => ({
  itemId: id,
  uuid: id,
  rowKey: id,
  unitId: 'u',
  unitLabel: 'U',
  description: '',
  variableId: 'v',
  metadata: {},
  ...values,
});

describe('ItemExplorerTableService', () => {
  it('reconciles manual order with a replaced item snapshot without losing partial-credit rows', () => {
    const table = new ItemExplorerTableService();
    table.itemOrder = ['removed', 'uuid::2', 'uuid::1'];
    const items = [row('new'), row('uuid::1'), row('uuid::2')];
    table.reconcileItemOrder(items);
    expect(table.itemOrder).toEqual(['uuid::2', 'uuid::1', 'new']);
    table.reconcileItemOrder([]);
    expect(table.itemOrder).toEqual([]);
    table.reconcileItemOrder(items);
    expect(table.itemOrder).toEqual(['new', 'uuid::1', 'uuid::2']);
  });

  it('matches booklet and position on the same occurrence and combines them with text search', () => {
    const table = new ItemExplorerTableService();
    table.filterText = 'needle';
    table.columnFilters = { booklet: 'alpha', bookletPosition: '> 2' };
    const rows = [
      row('a', {
        description: 'needle',
        bookletOccurrences: [
          { booklet: 'alpha', position: 1 },
          { booklet: 'beta', position: 3 },
        ],
      }),
      row('b', {
        metadata: { hint: 'needle' },
        bookletOccurrences: [{ booklet: 'alpha', position: 3 }],
      }),
      row('c', { bookletOccurrences: [{ booklet: 'alpha', position: 3 }] }),
    ];
    table.applyFilter(context(), rows);
    expect(table.filteredItems).toEqual([rows[1]]);
    expect(table.filteredItems[0]).toBe(rows[1]);
  });

  it('uses the supplied personal, comment and collection data without retaining a previous session', () => {
    const table = new ItemExplorerTableService();
    const rows = [row('a'), row('b')];
    table.columnFilters = { comments: 'with' };
    table.applyFilter(
      context({
        commentCountsByRow: new Map([['a', 2]]),
        personalColumnFilters: { personalCategory: 'keep' },
        personalItemData: { a: { category: 'keep' } },
        activeCollectionRowKeys: new Set(['a']),
      }),
      rows,
    );
    expect(table.filteredItems).toEqual([rows[0]]);
    table.applyFilter(context({ itemCommentCountsAvailable: false }), rows);
    expect(table.filteredItems).toEqual(rows);
    table.applyFilter(
      context({ commentCountsByRow: new Map([['b', 1]]), activeCollectionRowKeys: new Set() }),
      rows,
    );
    expect(table.filteredItems).toEqual([]);
  });

  it('keeps hidden rows in manual order and restores the previous sort mode', () => {
    const table = new ItemExplorerTableService();
    const rows = [row('c'), row('a'), row('b')];
    const ctx = context();
    table.applyFilter(ctx, rows);
    table.sortBy(ctx, 'itemId');
    table.toggleManualOrderMode(ctx, rows);
    expect(table.filteredItems.map((r) => r.rowKey)).toEqual(['c', 'a', 'b']);
    table.filterText = 'ua';
    table.applyFilter(ctx, rows);
    expect(table.moveRow(rows, 'a', -1)).toBe(true);
    table.filterText = '';
    table.applyFilter(ctx, rows);
    expect(table.filteredItems.map((r) => r.rowKey)).toEqual(['a', 'c', 'b']);
    expect(rows.map((r) => r.rowKey)).toEqual(['c', 'a', 'b']);
    table.toggleManualOrderMode(ctx, rows);
    expect(table.sortField).toBe('itemId');
    expect(table.filteredItems.map((r) => r.rowKey)).toEqual(['a', 'b', 'c']);
  });

  it('sorts numeric metadata with missing values last in either direction', () => {
    const table = new ItemExplorerTableService();
    const ctx = context();
    table.allColumns = [{ id: 'itemTimeSeconds', label: 'Time', kind: 'number' }];
    table.columns = [...table.allColumns];
    const rows = [row('a', { itemTimeSeconds: 10 }), row('b'), row('c', { itemTimeSeconds: 2 })];
    table.applyFilter(ctx, rows);
    table.sortByMeta(ctx, 'itemTimeSeconds');
    expect(table.filteredItems.map((r) => r.rowKey)).toEqual(['c', 'a', 'b']);
    table.sortByMeta(ctx, 'itemTimeSeconds');
    expect(table.filteredItems.map((r) => r.rowKey)).toEqual(['a', 'c', 'b']);
  });

  it('enforces the published column restriction while retaining item identity and personal columns', () => {
    const table = new ItemExplorerTableService();
    table.allColumns = [{ id: 'secret', label: 'Secret' }];
    table.columns = [...table.allColumns];
    const ctx = context({
      canEditExplorer: false,
      reviewerColumnsRestricted: true,
      reviewerVisibleColumns: ['system:unitLabel'],
    });
    expect(table.allTableColumns(ctx).map((c) => c.key)).toEqual([
      'system:itemId',
      'system:unitLabel',
      'personal:category',
      'personal:tags',
      'personal:note',
    ]);
    table.toggleColumnVisibility(ctx, table.allColumns[0]);
    expect(table.metadataSettings.configured).toBe(false);
    const itemId = table.allTableColumns(ctx).find((c) => c.key === 'system:itemId')!;
    table.toggleColumnVisibility(ctx, itemId);
    expect(table.tableColumns(ctx)).toContainEqual(itemId);
  });

  it('restores nested layout state on dialog cancellation', () => {
    const table = new ItemExplorerTableService();
    const ctx = context();
    const original = structuredClone(table.metadataSettings);
    table.openColumnManager();
    const column = table.allTableColumns(ctx).find((c) => c.key === 'system:unitLabel')!;
    table.setColumnWidth(ctx, column, 599);
    table.toggleColumnVisibility(ctx, column);
    table.closeColumnManager(ctx);
    expect(table.metadataSettings).toEqual(original);
    expect(table.showColumnManager).toBe(false);
  });

  it('builds a shared settings patch without local search or personal filters and reports hidden personal columns', () => {
    const table = new ItemExplorerTableService();
    const ctx = context();
    table.filterText = 'private local search';
    table.columnFilters = { unitLabel: 'shared filter', personalNote: 'must not be shared' };
    table.openColumnManager();
    const note = table.allTableColumns(ctx).find((c) => c.key === 'personal:note')!;
    table.toggleColumnVisibility(ctx, note);
    const result = table.completeColumnManager(ctx);
    expect(result.visiblePersonalFilterKeys.has('personalNote')).toBe(false);
    expect(result.patch.ui).toMatchObject({ columnFilters: { unitLabel: 'shared filter' } });
    expect(result.patch.ui).not.toHaveProperty('filterText');
    expect(table.filterText).toBe('private local search');
    const publishedWidths = result.patch.metadataColumns.layout.widths;
    table.metadataSettings.layout!.widths['system:itemId'] = 500;
    expect(publishedWidths).not.toHaveProperty('system:itemId');
    expect(table.showColumnManager).toBe(false);
  });

  it('migrates an explicitly empty old layout without exposing previously hidden columns', () => {
    const table = new ItemExplorerTableService();
    table.metadataSettings = table.resolveMetadataSettings({
      metadataColumns: {
        layout: {
          configured: true,
          visible: [],
          order: [],
          widths: {},
          schemaVersion: 1,
        },
      },
    });
    table.ensureTableColumnDefaults(context());
    expect(table.tableColumns(context()).map((c) => c.key)).toEqual(['system:position']);
    expect(table.metadataSettings.layout!.schemaVersion).toBe(3);
  });
});
