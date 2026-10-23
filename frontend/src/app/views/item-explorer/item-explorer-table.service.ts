import { Injectable } from '@angular/core';
import {
  DeepReadonly,
  ExplorerItem,
  ReadonlyExplorerItem,
  MetadataColumn,
  MetadataSettings,
  ItemExplorerTableColumn,
  PersonalItemRowData,
} from './item-explorer.models';
import { matchesNumericFilter } from '../../core/utils/numeric-filter.util';
import {
  normalizeItemExplorerColumnFilters,
  normalizeItemExplorerColumnList,
  normalizeItemExplorerColumnRecord,
  normalizeItemExplorerMetadataColumnId,
  normalizeItemExplorerTableColumnKey,
} from './item-explorer-time-columns.util';

export interface ItemExplorerTableColumnContext {
  canEditExplorer: boolean;
  reviewerColumnsRestricted: boolean;
  reviewerVisibleColumns: readonly string[] | undefined;
  itemCommentsEnabled: boolean;
  enableTags: boolean;
  showPersonalItemData: boolean;
  personalItemCategoryLabel: string;
  personalItemTagLabel: string;
  enableItemCollections: boolean;
}
export interface ItemExplorerTableFilterContext extends ItemExplorerTableColumnContext {
  itemCommentCountsAvailable: boolean;
  commentCountsByRow: ReadonlyMap<string, number>;
  itemTags: Readonly<Record<string, readonly string[]>>;
  personalColumnFilters: Readonly<Record<string, string>>;
  personalItemData: Readonly<Record<string, PersonalItemRowData>>;
  activeCollectionRowKeys: ReadonlySet<string> | null;
}
const DEFAULT_EXPLORER_SORT_FIELD = 'unitLabel';
const DEFAULT_EXPLORER_SORT_DIR: 'asc' | 'desc' = 'asc';
const COLLECTION_SELECTION_COLUMN_WIDTH = 38;
const POSITION_COLUMN_WIDTH = 72;
const COMMENT_COLUMN_LAYOUT_SCHEMA_VERSION = 2;
const TABLE_COLUMN_LAYOUT_SCHEMA_VERSION = 3;
const TABLE_COLUMN_KEYS = {
  position: 'system:position',
  referenceNumber: 'system:referenceNumber',
  itemId: 'system:itemId',
  unitLabel: 'system:unitLabel',
  subId: 'system:subId',
  empiricalDifficulty: 'system:empiricalDifficulty',
  meanTaskDifficulty: 'system:meanTaskDifficulty',
  comments: 'system:comments',
  tags: 'system:tags',
  personalCategory: 'personal:category',
  personalTags: 'personal:tags',
  personalNote: 'personal:note',
} as const;
const TABLE_COLUMN_SORT_FIELDS: Readonly<Record<string, string>> = {
  [TABLE_COLUMN_KEYS.referenceNumber]: 'rowNumber',
  [TABLE_COLUMN_KEYS.itemId]: 'itemId',
  [TABLE_COLUMN_KEYS.unitLabel]: 'unitLabel',
  [TABLE_COLUMN_KEYS.subId]: 'subIdDisplay',
  [TABLE_COLUMN_KEYS.empiricalDifficulty]: 'empiricalDifficulty',
  [TABLE_COLUMN_KEYS.meanTaskDifficulty]: 'meanTaskDifficulty',
  [TABLE_COLUMN_KEYS.comments]: 'commentCount',
};
const METADATA_COLUMN_KEY_PREFIX = 'metadata:';
const IMPORTED_PARAMETER_COLUMNS: MetadataColumn[] = [
  { id: 'bista', label: 'BiSta-Wert', kind: 'number', visible: false },
  { id: 'infit', label: 'Infit', kind: 'number' },
  { id: 'discrimination', label: 'Trennschärfe', kind: 'number' },
  { id: 'solutionRate', label: 'Lösungshäufigkeit', kind: 'number' },
  { id: 'textComplexity', label: 'Textkomplexität', kind: 'text' },
  { id: 'competenceLevel', label: 'Kompetenzstufe', kind: 'text' },
  { id: 'itemTimeSeconds', label: 'Itemzeit (s)', kind: 'number' },
  { id: 'stimulusTimeSeconds', label: 'Stimuluszeit (s)', kind: 'number' },
  { id: 'booklet', label: 'Booklet', kind: 'booklet' },
  { id: 'bookletPosition', label: 'Position im Booklet', kind: 'position' },
];

/** Owns table state; other domains supply data snapshots for each operation. */
@Injectable()
export class ItemExplorerTableService {
  columns: MetadataColumn[] = [];

  filteredItems: ExplorerItem[] = [];

  hasEmpiricalDifficulty = false;

  hasMeanTaskDifficulty = false;

  hasPartialCredit = false;

  itemSubIdLabel = 'Sub-ID';

  filterText = '';

  sortField = DEFAULT_EXPLORER_SORT_FIELD;

  sortIsMeta = false;

  sortDir: 'asc' | 'desc' = DEFAULT_EXPLORER_SORT_DIR;

  private sortBeforeManualOrder: {
    field: string;
    isMeta: boolean;
    direction: 'asc' | 'desc';
  } | null = null;

  columnFilters: Record<string, string> = {};

  showExcludedItems = false;

  showOnlyItemsWithEmpiricalDifficulty = false;

  showColumnManager = false;

  allColumns: MetadataColumn[] = [];

  configuredMetadataColumns: MetadataColumn[] = [];

  metadataSettings: MetadataSettings = {
    visible: [],
    order: [],
    configured: false,
    widths: {},
    referenceNumberVisible: false,
    layout: {
      visible: [],
      order: [],
      configured: false,
      widths: {},
      schemaVersion: TABLE_COLUMN_LAYOUT_SCHEMA_VERSION,
    },
  };

  private columnManagerOriginalSettings: MetadataSettings | null = null;

  columnFilterText = '';

  itemOrder: string[] = [];

  excludedItemsCount(items: readonly ExplorerItem[]): number {
    return items.filter((item) => this.isItemExcluded(item)).length;
  }

  totalItemsCount(items: readonly ExplorerItem[]): number {
    return items.length;
  }

  visibleItemsCount(items: readonly ExplorerItem[]): number {
    return items.filter((item) => this.isItemVisibleByBaseRules(item)).length;
  }

  hiddenExcludedItemsCount(items: readonly ExplorerItem[]): number {
    if (this.showExcludedItems) return 0;
    return items.filter((item) => this.isItemExcluded(item)).length;
  }

  hiddenMissingDifficultyItemsCount(items: readonly ExplorerItem[]): number {
    if (!this.showOnlyItemsWithEmpiricalDifficulty || !this.hasEmpiricalDifficulty) return 0;
    return items.filter(
      (item) =>
        (this.showExcludedItems || !this.isItemExcluded(item)) &&
        (item.empiricalDifficulty === undefined || item.empiricalDifficulty === null),
    ).length;
  }

  referenceNumberVisible(): boolean {
    const layout = this.metadataSettings.layout;
    if (layout?.configured) {
      return layout.visible.includes(TABLE_COLUMN_KEYS.referenceNumber);
    }
    return this.metadataSettings.referenceNumberVisible === true;
  }

  canResetMetadataSettings(): boolean {
    return (
      this.metadataSettings.configured ||
      Object.keys(this.metadataSettings.widths).length > 0 ||
      this.referenceNumberVisible() ||
      this.metadataSettings.layout?.configured === true ||
      Object.keys(this.metadataSettings.layout?.widths || {}).length > 0
    );
  }

  isReviewerColumnAllowed(context: ItemExplorerTableColumnContext, key: string): boolean {
    if (
      !context.reviewerColumnsRestricted ||
      key.startsWith('personal:') ||
      key === TABLE_COLUMN_KEYS.itemId
    )
      return true;
    const visible = context.reviewerVisibleColumns;
    return (
      Array.isArray(visible) &&
      normalizeItemExplorerColumnList(visible, normalizeItemExplorerTableColumnKey).includes(key)
    );
  }

  setRestrictReviewerColumns(context: ItemExplorerTableColumnContext, value: boolean) {
    if (!context.canEditExplorer) return;
    this.ensureExplicitTableLayout(context);
    this.metadataSettings.restrictReviewerColumnsToManagerSelection = value;
    if (value && !this.metadataSettings.layout!.visible.includes(TABLE_COLUMN_KEYS.itemId)) {
      this.metadataSettings.layout!.visible.unshift(TABLE_COLUMN_KEYS.itemId);
    }
  }

  allTableColumns(context: ItemExplorerTableColumnContext): ItemExplorerTableColumn[] {
    const columns: ItemExplorerTableColumn[] = [
      {
        key: TABLE_COLUMN_KEYS.position,
        id: 'position',
        label: 'Position',
        source: 'system',
        defaultWidth: POSITION_COLUMN_WIDTH,
      },
      {
        key: TABLE_COLUMN_KEYS.referenceNumber,
        id: 'referenceNumber',
        label: 'Referenz-Nr.',
        source: 'system',
        defaultWidth: 140,
      },
      {
        key: TABLE_COLUMN_KEYS.itemId,
        id: 'itemId',
        label: 'Item-ID',
        source: 'system',
        defaultWidth: 220,
      },
      {
        key: TABLE_COLUMN_KEYS.unitLabel,
        id: 'unitLabel',
        label: 'Aufgabe',
        source: 'system',
        defaultWidth: 200,
      },
    ];
    if (this.hasPartialCredit) {
      columns.push({
        key: TABLE_COLUMN_KEYS.subId,
        id: 'subId',
        label: this.itemSubIdLabel,
        source: 'system',
        defaultWidth: 140,
      });
    }
    if (this.hasEmpiricalDifficulty) {
      columns.push({
        key: TABLE_COLUMN_KEYS.empiricalDifficulty,
        id: 'empiricalDifficulty',
        label: 'Empirische Itemschwierigkeit',
        source: 'system',
        defaultWidth: 210,
      });
    }
    if (this.hasMeanTaskDifficulty) {
      columns.push({
        key: TABLE_COLUMN_KEYS.meanTaskDifficulty,
        id: 'meanTaskDifficulty',
        label: 'Mittlere Aufgabenschwierigkeit',
        source: 'system',
        defaultWidth: 230,
      });
    }
    if (context.itemCommentsEnabled) {
      columns.push({
        key: TABLE_COLUMN_KEYS.comments,
        id: 'comments',
        label: 'Kommentare',
        source: 'system',
        defaultWidth: 150,
      });
    }
    columns.push(
      ...this.allColumns.map((metadataColumn) => ({
        key: this.getMetadataTableColumnKey(metadataColumn.id),
        id: metadataColumn.id,
        label: metadataColumn.label,
        source: 'metadata' as const,
        defaultWidth: 180,
        metadataColumn,
      })),
    );
    if (context.enableTags) {
      columns.push({
        key: TABLE_COLUMN_KEYS.tags,
        id: 'tags',
        label: 'Tags',
        source: 'system',
        defaultWidth: 220,
      });
    }
    if (context.showPersonalItemData) {
      columns.push(
        {
          key: TABLE_COLUMN_KEYS.personalCategory,
          id: 'personalCategory',
          label: context.personalItemCategoryLabel,
          source: 'personal',
          defaultWidth: 200,
        },
        {
          key: TABLE_COLUMN_KEYS.personalTags,
          id: 'personalTags',
          label: context.personalItemTagLabel,
          source: 'personal',
          defaultWidth: 240,
        },
        {
          key: TABLE_COLUMN_KEYS.personalNote,
          id: 'personalNote',
          label: 'Notiz',
          source: 'personal',
          defaultWidth: 280,
        },
      );
    }
    return columns.filter((column) => this.isReviewerColumnAllowed(context, column.key));
  }

  tableColumns(context: ItemExplorerTableColumnContext): ItemExplorerTableColumn[] {
    const available = this.allTableColumns(context);
    const layout = this.metadataSettings.layout;
    if (!layout?.configured) {
      const visibleMetadata = new Set(this.columns.map((column) => column.id));
      return this.orderPinnedTableColumns(
        available.filter((column) => {
          if (column.key === TABLE_COLUMN_KEYS.referenceNumber)
            return this.referenceNumberVisible();
          return column.source !== 'metadata' || visibleMetadata.has(column.id);
        }),
      );
    }
    const availableByKey = new Map(available.map((column) => [column.key, column]));
    const visible = new Set(layout.visible);
    if (context.reviewerColumnsRestricted) visible.add(TABLE_COLUMN_KEYS.itemId);
    const ordered = layout.order
      .map((key) => availableByKey.get(key))
      .filter((column): column is ItemExplorerTableColumn => column !== undefined)
      .filter((column) => visible.has(column.key));
    const orderedKeys = new Set(ordered.map((column) => column.key));
    for (const column of available) {
      if (visible.has(column.key) && !orderedKeys.has(column.key)) {
        ordered.push(column);
        orderedKeys.add(column.key);
      }
    }
    return this.orderPinnedTableColumns(ordered);
  }

  filteredAllColumns(context: ItemExplorerTableColumnContext): ItemExplorerTableColumn[] {
    let list = [...this.allTableColumns(context)];
    if (this.columnFilterText) {
      const term = this.columnFilterText.toLowerCase();
      list = list.filter(
        (c) =>
          c.label.toLowerCase().includes(term) ||
          c.id.toLowerCase().includes(term) ||
          c.key.toLowerCase().includes(term),
      );
    }

    const layout = this.metadataSettings.layout;
    if (!layout?.configured) {
      return list;
    }

    // Sort columns: selected/ordered ones first, then alphabetical
    const ordered = list.sort((a, b) => {
      const indexA = layout.order.indexOf(a.key);
      const indexB = layout.order.indexOf(b.key);

      // Both are in the custom order
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      // Only A is in the order
      if (indexA !== -1) return -1;
      // Only B is in the order
      if (indexB !== -1) return 1;
      // Neither is in the order: alphabetical
      return a.label.localeCompare(b.label);
    });
    return this.orderPinnedTableColumns(ordered);
  }

  getAvailableMetadataColumns(sourceColumns: MetadataColumn[]): MetadataColumn[] {
    const importedIds = new Set(IMPORTED_PARAMETER_COLUMNS.map((column) => column.id));
    const normalizedSourceColumns = sourceColumns.filter(
      (column) => !importedIds.has(normalizeItemExplorerMetadataColumnId(column.id)),
    );
    const columnsById = new Map<string, MetadataColumn>();
    normalizedSourceColumns.forEach((column) =>
      columnsById.set(column.id, { ...column, kind: 'text' as const }),
    );
    this.configuredMetadataColumns
      .filter((column) => !importedIds.has(normalizeItemExplorerMetadataColumnId(column.id)))
      .forEach((column) =>
        columnsById.set(column.id, { ...columnsById.get(column.id), ...column, kind: 'text' }),
      );
    IMPORTED_PARAMETER_COLUMNS.forEach((column) => columnsById.set(column.id, column));
    return Array.from(columnsById.values());
  }

  getMetadataColumnDisplayValue(
    item: ReadonlyExplorerItem,
    column: DeepReadonly<MetadataColumn>,
  ): string {
    if (column.kind === 'booklet') {
      return (item.bookletOccurrences || []).map((occurrence) => occurrence.booklet).join(' | ');
    }
    if (column.kind === 'position') {
      return (item.bookletOccurrences || [])
        .map((occurrence) => (occurrence.position === null ? '' : String(occurrence.position)))
        .join(' | ');
    }
    const value = this.getMetadataColumnRawValue(item, column);
    return value === undefined || value === null ? '' : String(value);
  }

  private getMetadataColumnRawValue(
    item: ReadonlyExplorerItem,
    column: MetadataColumn,
  ): string | number | undefined {
    switch (column.id) {
      case 'bista':
        return item.bista;
      case 'infit':
        return item.infit;
      case 'discrimination':
        return item.discrimination;
      case 'solutionRate':
        return item.solutionRate;
      case 'textComplexity':
        return item.textComplexity;
      case 'competenceLevel':
        return item.competenceLevel;
      case 'itemTimeSeconds':
        return item.itemTimeSeconds;
      case 'stimulusTimeSeconds':
        return item.stimulusTimeSeconds;
      case 'booklet':
        return item.bookletOccurrences?.[0]?.booklet;
      case 'bookletPosition': {
        const positions = (item.bookletOccurrences || []).flatMap((occurrence) =>
          occurrence.position === null ? [] : [occurrence.position],
        );
        return positions.length ? Math.min(...positions) : undefined;
      }
      default:
        return item.metadata[column.id];
    }
  }

  applyFilter(context: ItemExplorerTableFilterContext, items: readonly ExplorerItem[]) {
    const term = this.filterText.toLowerCase();
    const activeCollectionRowKeys = context.activeCollectionRowKeys;

    this.filteredItems = items.filter((item) => {
      if (!this.isItemVisibleByBaseRules(item)) {
        return false;
      }

      if (activeCollectionRowKeys && !activeCollectionRowKeys.has(item.rowKey)) {
        return false;
      }

      return this.matchesActiveItemFilters(context, item, term);
    });

    this.applySort(context);
  }

  isItemExcluded(item?: ReadonlyExplorerItem | null): boolean {
    return item?.excluded === true;
  }

  private isItemVisibleByBaseRules(item: ExplorerItem): boolean {
    if (!this.showExcludedItems && this.isItemExcluded(item)) {
      return false;
    }

    if (
      this.showOnlyItemsWithEmpiricalDifficulty &&
      this.hasEmpiricalDifficulty &&
      (item.empiricalDifficulty === undefined || item.empiricalDifficulty === null)
    ) {
      return false;
    }

    return true;
  }

  private matchesActiveItemFilters(
    context: ItemExplorerTableFilterContext,
    item: ExplorerItem,
    term: string,
  ): boolean {
    // 1. Global Filter
    if (term) {
      const matchesGlobal =
        (item.unitId + item.itemId).toLowerCase().includes(term) ||
        String(item.subId || '')
          .toLowerCase()
          .includes(term) ||
        String(item.subIdDisplay || '')
          .toLowerCase()
          .includes(term) ||
        item.unitLabel.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        Object.values(item.metadata).some((val) => val && val.toLowerCase().includes(term)) ||
        IMPORTED_PARAMETER_COLUMNS.some((column) =>
          this.getMetadataColumnDisplayValue(item, column).toLowerCase().includes(term),
        );
      if (!matchesGlobal) return false;
    }

    const bookletFilter = (this.columnFilters['booklet'] || '').trim().toLowerCase();
    const positionFilter = (this.columnFilters['bookletPosition'] || '').trim();
    if (bookletFilter || positionFilter) {
      const matchesOccurrence = (item.bookletOccurrences || []).some((occurrence) => {
        const matchesBooklet =
          !bookletFilter || occurrence.booklet.toLowerCase().includes(bookletFilter);
        const matchesPosition =
          !positionFilter ||
          (occurrence.position !== null &&
            matchesNumericFilter(occurrence.position, positionFilter));
        return matchesBooklet && matchesPosition;
      });
      if (!matchesOccurrence) return false;
    }

    // 2. Column Filters
    for (const [colId, filterValue] of Object.entries(this.columnFilters)) {
      if (!filterValue) continue;
      const subTerm = filterValue.toLowerCase();

      if (colId === 'itemId') {
        const combined = (item.unitId + item.itemId).toLowerCase();
        if (!combined.includes(subTerm)) return false;
      } else if (colId === 'unitLabel') {
        if (!item.unitLabel.toLowerCase().includes(subTerm)) return false;
      } else if (colId === 'subId') {
        const subIdValue = `${item.subId || ''} ${item.subIdDisplay || ''}`.toLowerCase();
        if (!subIdValue.includes(subTerm)) return false;
      } else if (colId === 'tags') {
        const tags = context.itemTags[item.rowKey] || [];
        if (!tags.some((t) => t.toLowerCase().includes(subTerm))) return false;
      } else if (colId === 'empiricalDifficulty') {
        if (item.empiricalDifficulty === undefined || item.empiricalDifficulty === null)
          return false;
        if (!matchesNumericFilter(item.empiricalDifficulty, filterValue)) return false;
      } else if (colId === 'meanTaskDifficulty') {
        if (item.meanTaskDifficulty === undefined || item.meanTaskDifficulty === null) return false;
        if (!matchesNumericFilter(item.meanTaskDifficulty, filterValue)) return false;
      } else if (colId === 'comments') {
        if (!context.itemCommentsEnabled || !context.itemCommentCountsAvailable) continue;
        const count = context.commentCountsByRow.get(this.getStableRowKey(item)) ?? 0;
        if (filterValue === 'with' && count === 0) return false;
        if (filterValue === 'without' && count > 0) return false;
      } else if (colId === 'booklet' || colId === 'bookletPosition') {
        continue;
      } else {
        const column = this.allColumns.find((candidate) => candidate.id === colId);
        if (column?.kind === 'number') {
          const value = this.getMetadataColumnRawValue(item, column);
          if (typeof value !== 'number' || !matchesNumericFilter(value, filterValue)) {
            return false;
          }
        } else {
          const val = column
            ? this.getMetadataColumnDisplayValue(item, column)
            : item.metadata[colId] || '';
          if (!val.toLowerCase().includes(subTerm)) return false;
        }
      }
    }

    if (context.showPersonalItemData) {
      const categoryFilter = (
        context.personalColumnFilters['personalCategory'] || ''
      ).toLowerCase();
      const tagFilter = (context.personalColumnFilters['personalTags'] || '').toLowerCase();
      const noteFilter = (context.personalColumnFilters['personalNote'] || '').toLowerCase();
      const row = context.personalItemData[item.rowKey];
      if (categoryFilter && !(row?.category || '').toLowerCase().includes(categoryFilter)) {
        return false;
      }
      if (tagFilter && !(row?.tags || []).some((tag) => tag.toLowerCase().includes(tagFilter))) {
        return false;
      }
      if (noteFilter && !(row?.note || '').toLowerCase().includes(noteFilter)) {
        return false;
      }
    }

    return true;
  }

  sortBy(context: ItemExplorerTableFilterContext, field: string) {
    if (this.sortField === field && !this.sortIsMeta) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortIsMeta = false;
      this.sortDir = 'asc';
    }
    this.applySort(context);
  }

  sortByMeta(context: ItemExplorerTableFilterContext, colId: string) {
    if (this.sortField === colId && this.sortIsMeta) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = colId;
      this.sortIsMeta = true;
      this.sortDir = 'asc';
    }
    this.applySort(context);
  }

  applySort(context: ItemExplorerTableFilterContext) {
    this.ensureVisibleSortField(context);
    if (this.sortField === '__manual__') {
      const rank = new Map<string, number>();
      this.itemOrder.forEach((entry, idx) => rank.set(entry, idx));
      this.filteredItems.sort((a, b) => {
        const posA = rank.get(this.getStableRowKey(a)) ?? Number.MAX_SAFE_INTEGER;
        const posB = rank.get(this.getStableRowKey(b)) ?? Number.MAX_SAFE_INTEGER;
        return posA - posB;
      });
      return;
    }

    this.filteredItems.sort((a, b) => {
      if (!this.sortIsMeta && this.sortField === 'itemId') {
        return this.compareVisibleItemIds(a, b, this.sortDir);
      }

      let aVal: any = '';
      let bVal: any = '';

      if (this.sortIsMeta) {
        const column = this.allColumns.find((candidate) => candidate.id === this.sortField);
        aVal = column ? this.getMetadataColumnRawValue(a, column) : a.metadata[this.sortField];
        bVal = column ? this.getMetadataColumnRawValue(b, column) : b.metadata[this.sortField];
      } else if (
        this.sortField === 'empiricalDifficulty' ||
        this.sortField === 'meanTaskDifficulty' ||
        this.sortField === 'commentCount'
      ) {
        if (this.sortField === 'commentCount') {
          aVal = context.commentCountsByRow.get(this.getStableRowKey(a)) ?? 0;
          bVal = context.commentCountsByRow.get(this.getStableRowKey(b)) ?? 0;
        } else {
          aVal =
            this.sortField === 'empiricalDifficulty' ? a.empiricalDifficulty : a.meanTaskDifficulty;
          bVal =
            this.sortField === 'empiricalDifficulty' ? b.empiricalDifficulty : b.meanTaskDifficulty;
        }
      } else {
        aVal = (a as any)[this.sortField] || '';
        bVal = (b as any)[this.sortField] || '';
      }

      const aMissing = aVal === undefined || aVal === null || aVal === '';
      const bMissing = bVal === undefined || bVal === null || bVal === '';
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      const primaryCmp = this.compareSortValues(aVal, bVal, this.sortDir);
      if (primaryCmp !== 0) {
        return primaryCmp;
      }

      if (!this.sortIsMeta && this.sortField === 'unitLabel') {
        const unitCmp = this.compareSortText(a.unitId, b.unitId);
        if (unitCmp !== 0) {
          return unitCmp;
        }
        const itemCmp = this.compareSortText(a.itemId, b.itemId);
        if (itemCmp !== 0) {
          return itemCmp;
        }
        return this.compareSortText(a.subIdDisplay, b.subIdDisplay);
      }

      return 0;
    });
  }

  ensureVisibleSortField(context: ItemExplorerTableColumnContext) {
    if (this.sortField === '__manual__') return;
    const visibleColumns = this.tableColumns(context);
    const currentColumnKey = this.sortIsMeta
      ? this.getMetadataTableColumnKey(this.sortField)
      : Object.keys(TABLE_COLUMN_SORT_FIELDS).find(
          (key) => TABLE_COLUMN_SORT_FIELDS[key] === this.sortField,
        );
    if (!currentColumnKey || visibleColumns.some((column) => column.key === currentColumnKey)) {
      return;
    }
    const replacement =
      visibleColumns.find((column) => column.key === TABLE_COLUMN_KEYS.unitLabel) ||
      visibleColumns.find((column) => this.isTableColumnSortable(column));
    if (!replacement) return;
    if (replacement.source === 'metadata') {
      this.sortField = replacement.id;
      this.sortIsMeta = true;
    } else {
      this.sortField = TABLE_COLUMN_SORT_FIELDS[replacement.key];
      this.sortIsMeta = false;
    }
    this.sortDir = DEFAULT_EXPLORER_SORT_DIR;
  }

  private compareSortValues(aVal: unknown, bVal: unknown, direction: 'asc' | 'desc'): number {
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    }

    const cmp = this.compareSortText(aVal, bVal);
    return direction === 'asc' ? cmp : -cmp;
  }

  private compareSortText(aVal: unknown, bVal: unknown): number {
    return String(aVal ?? '')
      .toLowerCase()
      .localeCompare(String(bVal ?? '').toLowerCase(), undefined, { numeric: true });
  }

  private compareVisibleItemIds(
    a: ReadonlyExplorerItem,
    b: ReadonlyExplorerItem,
    direction: 'asc' | 'desc',
  ): number {
    const comparisons = [
      this.compareDeterministicSortText(`${a.unitId}${a.itemId}`, `${b.unitId}${b.itemId}`),
      this.compareDeterministicSortText(a.subId, b.subId),
      this.compareDeterministicSortText(this.getStableRowKey(a), this.getStableRowKey(b)),
    ];
    const cmp = comparisons.find((comparison) => comparison !== 0) ?? 0;
    return direction === 'asc' ? cmp : -cmp;
  }

  private compareDeterministicSortText(aVal: unknown, bVal: unknown): number {
    const naturalCmp = this.compareSortText(aVal, bVal);
    if (naturalCmp !== 0) {
      return naturalCmp;
    }

    const aText = String(aVal ?? '');
    const bText = String(bVal ?? '');
    if (aText === bText) {
      return 0;
    }
    return aText < bText ? -1 : 1;
  }

  getSortIndicator(field: string): string {
    if (this.sortField !== field || this.sortIsMeta) return '';
    return this.sortDir === 'asc' ? '↑' : '↓';
  }

  getMetaSortIndicator(colId: string): string {
    if (this.sortField !== colId || !this.sortIsMeta) return '';
    return this.sortDir === 'asc' ? '↑' : '↓';
  }

  filterVisibleColumns(
    context: ItemExplorerTableColumnContext,
    allColumns: MetadataColumn[],
  ): MetadataColumn[] {
    allColumns = allColumns.filter((column) =>
      this.isReviewerColumnAllowed(context, this.getMetadataTableColumnKey(column.id)),
    );
    if (!this.metadataSettings.configured) {
      return allColumns.filter((column) => column.visible !== false);
    }

    // Filter visible columns and maintain order
    const visibleMap = new Set(this.metadataSettings.visible);
    const orderedColumns = [];

    // First, add columns in the specified order
    for (const colId of this.metadataSettings.order || []) {
      const col = allColumns.find((c) => c.id === colId);
      if (col && visibleMap.has(colId)) {
        orderedColumns.push({ ...col, visible: true });
      }
    }

    // Then add any remaining visible columns not in the order list
    for (const col of allColumns) {
      if (visibleMap.has(col.id) && !orderedColumns.some((c) => c.id === col.id)) {
        orderedColumns.push({ ...col, visible: true });
      }
    }

    return orderedColumns;
  }

  isColumnVisible(
    context: ItemExplorerTableColumnContext,
    column: ItemExplorerTableColumn | MetadataColumn,
  ): boolean {
    const key = 'key' in column ? column.key : this.getMetadataTableColumnKey(column.id);
    if (!this.isReviewerColumnAllowed(context, key)) return false;
    if (key === TABLE_COLUMN_KEYS.itemId && context.reviewerColumnsRestricted) return true;
    if (!('key' in column)) {
      return this.metadataSettings.configured
        ? this.metadataSettings.visible.includes(column.id)
        : column.visible !== false;
    }
    const layout = this.metadataSettings.layout;
    if (layout?.configured) return layout.visible.includes(column.key);
    if (column.key === TABLE_COLUMN_KEYS.referenceNumber) return this.referenceNumberVisible();
    return column.source !== 'metadata' || this.isColumnVisible(context, column.metadataColumn!);
  }

  getColumnWidth(column: ItemExplorerTableColumn | MetadataColumn): number {
    if (!('key' in column)) {
      return (
        this.metadataSettings.layout?.widths[this.getMetadataTableColumnKey(column.id)] ||
        this.metadataSettings.widths[column.id] ||
        180
      );
    }
    return (
      this.metadataSettings.layout?.widths[column.key] ||
      (column.source === 'metadata' ? this.metadataSettings.widths[column.id] : undefined) ||
      column.defaultWidth
    );
  }

  setColumnWidth(
    context: ItemExplorerTableColumnContext,
    column: ItemExplorerTableColumn | MetadataColumn,
    value: unknown,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const width = Math.min(600, Math.max(80, Math.round(parsed)));
    if (!('key' in column)) {
      this.metadataSettings.widths = {
        ...this.metadataSettings.widths,
        [column.id]: width,
      };
      return;
    }
    this.ensureExplicitTableLayout(context);
    this.metadataSettings.layout!.widths = {
      ...this.metadataSettings.layout!.widths,
      [column.key]: width,
    };
  }

  private ensureExplicitMetadataSelection() {
    if (this.metadataSettings.configured) return;
    this.metadataSettings.visible = this.allColumns.map((column) => column.id);
    this.metadataSettings.order = this.allColumns.map((column) => column.id);
    this.metadataSettings.configured = true;
  }

  ensureExplicitTableLayout(context: ItemExplorerTableColumnContext) {
    if (this.metadataSettings.layout?.configured) return;
    const visible = this.tableColumns(context).map((column) => column.key);
    const hidden = this.allTableColumns(context)
      .map((column) => column.key)
      .filter((key) => !visible.includes(key));
    this.metadataSettings.layout = {
      visible,
      order: [...visible, ...hidden],
      configured: true,
      widths: { ...(this.metadataSettings.layout?.widths || {}) },
      schemaVersion: TABLE_COLUMN_LAYOUT_SCHEMA_VERSION,
    };
  }

  ensureTableColumnDefaults(context: ItemExplorerTableColumnContext): void {
    const layout = this.metadataSettings.layout;
    if (!layout?.configured || (layout.schemaVersion || 0) >= TABLE_COLUMN_LAYOUT_SCHEMA_VERSION) {
      return;
    }
    const schemaVersion = layout.schemaVersion || 0;
    const hasExplicitColumns = layout.order.length > 0 || layout.visible.length > 0;
    if (
      context.itemCommentsEnabled &&
      schemaVersion < COMMENT_COLUMN_LAYOUT_SCHEMA_VERSION &&
      hasExplicitColumns &&
      !layout.order.includes(TABLE_COLUMN_KEYS.comments)
    ) {
      layout.order.push(TABLE_COLUMN_KEYS.comments);
      layout.visible.push(TABLE_COLUMN_KEYS.comments);
    }
    if (!layout.order.includes(TABLE_COLUMN_KEYS.position)) {
      layout.order.unshift(TABLE_COLUMN_KEYS.position);
    }
    if (!layout.visible.includes(TABLE_COLUMN_KEYS.position)) {
      layout.visible.unshift(TABLE_COLUMN_KEYS.position);
    }
    layout.schemaVersion = TABLE_COLUMN_LAYOUT_SCHEMA_VERSION;
  }

  syncLegacyMetadataSettingsFromLayout(context: ItemExplorerTableColumnContext) {
    const layout = this.metadataSettings.layout;
    if (!layout?.configured) return;
    const metadataIds = new Set(this.allColumns.map((column) => column.id));
    const toMetadataId = (key: string) =>
      key.startsWith(METADATA_COLUMN_KEY_PREFIX)
        ? key.slice(METADATA_COLUMN_KEY_PREFIX.length)
        : '';
    this.metadataSettings.visible = layout.visible
      .map(toMetadataId)
      .filter((id) => metadataIds.has(id));
    this.metadataSettings.order = layout.order
      .map(toMetadataId)
      .filter((id) => metadataIds.has(id));
    this.metadataSettings.configured = true;
    this.metadataSettings.referenceNumberVisible = layout.visible.includes(
      TABLE_COLUMN_KEYS.referenceNumber,
    );
    const legacyWidths: Record<string, number> = { ...this.metadataSettings.widths };
    for (const column of this.allColumns) {
      const width = layout.widths[this.getMetadataTableColumnKey(column.id)];
      if (width) legacyWidths[column.id] = width;
    }
    this.metadataSettings.widths = legacyWidths;
    this.columns = this.filterVisibleColumns(context, this.allColumns);
  }

  private getMetadataTableColumnKey(id: string): string {
    return `${METADATA_COLUMN_KEY_PREFIX}${id}`;
  }

  isTableColumnSortable(column: ItemExplorerTableColumn): boolean {
    return column.source === 'metadata' || Boolean(TABLE_COLUMN_SORT_FIELDS[column.key]);
  }

  sortTableColumn(context: ItemExplorerTableFilterContext, column: ItemExplorerTableColumn) {
    if (!this.isTableColumnSortable(column)) return;
    if (column.source === 'metadata') {
      this.sortByMeta(context, column.id);
      return;
    }
    this.sortBy(context, TABLE_COLUMN_SORT_FIELDS[column.key]);
  }

  getTableColumnSortIndicator(column: ItemExplorerTableColumn): string {
    if (column.source === 'metadata') return this.getMetaSortIndicator(column.id);
    const sortField = TABLE_COLUMN_SORT_FIELDS[column.key];
    return sortField ? this.getSortIndicator(sortField) : '';
  }

  getTableColumnDisplayValue(
    item: ReadonlyExplorerItem,
    column: DeepReadonly<ItemExplorerTableColumn>,
  ): string {
    return column.metadataColumn
      ? String(this.getMetadataColumnDisplayValue(item, column.metadataColumn) ?? '')
      : '';
  }

  isStickyTableColumn(column: DeepReadonly<ItemExplorerTableColumn>): boolean {
    return this.isPinnedTableColumnKey(column.key);
  }

  getStickyTableColumnLeft(
    column: DeepReadonly<ItemExplorerTableColumn>,
    columns: ReadonlyArray<DeepReadonly<ItemExplorerTableColumn>>,
    enableItemCollections: boolean,
  ): number | null {
    if (!this.isStickyTableColumn(column)) return null;
    let left = enableItemCollections ? COLLECTION_SELECTION_COLUMN_WIDTH : 0;
    for (const current of columns) {
      if (current.key === column.key) return left;
      if (!this.isPinnedTableColumnKey(current.key)) break;
      left += this.getColumnWidth(current);
    }
    return null;
  }

  clearHiddenTableColumnFilters(context: ItemExplorerTableColumnContext) {
    const visibleColumns = this.tableColumns(context);
    const sharedFilterKeys = new Set(
      visibleColumns
        .filter(
          (column) =>
            column.source !== 'personal' && column.key !== TABLE_COLUMN_KEYS.referenceNumber,
        )
        .map((column) => column.id),
    );
    for (const filterKey of Object.keys(this.columnFilters)) {
      if (!sharedFilterKeys.has(filterKey)) delete this.columnFilters[filterKey];
    }
    const personalFilterKeys = new Set(
      visibleColumns.filter((column) => column.source === 'personal').map((column) => column.id),
    );
    return personalFilterKeys;
  }

  toggleColumnVisibility(
    context: ItemExplorerTableColumnContext,
    column: ItemExplorerTableColumn | MetadataColumn,
  ) {
    const key = 'key' in column ? column.key : this.getMetadataTableColumnKey(column.id);
    if (!this.isReviewerColumnAllowed(context, key)) return;
    if (
      key === TABLE_COLUMN_KEYS.itemId &&
      (context.reviewerColumnsRestricted ||
        this.metadataSettings.restrictReviewerColumnsToManagerSelection)
    )
      return;
    if (!('key' in column)) {
      this.ensureExplicitMetadataSelection();
      const colIndex = this.metadataSettings.visible.indexOf(column.id);
      if (colIndex === -1) {
        this.metadataSettings.visible.push(column.id);
        if (!this.metadataSettings.order.includes(column.id)) {
          this.metadataSettings.order.push(column.id);
        }
      } else {
        this.metadataSettings.visible.splice(colIndex, 1);
        const orderIndex = this.metadataSettings.order.indexOf(column.id);
        if (orderIndex !== -1) this.metadataSettings.order.splice(orderIndex, 1);
      }
      this.columns = this.filterVisibleColumns(context, this.allColumns);
      return;
    }
    this.ensureExplicitTableLayout(context);
    const layout = this.metadataSettings.layout!;
    const colIndex = layout.visible.indexOf(column.key);
    if (colIndex === -1) {
      layout.visible.push(column.key);
      if (
        column.key === TABLE_COLUMN_KEYS.position ||
        column.key === TABLE_COLUMN_KEYS.referenceNumber
      ) {
        layout.order = [column.key, ...layout.order.filter((key) => key !== column.key)];
      } else if (!layout.order.includes(column.key)) {
        layout.order.push(column.key);
      }
    } else {
      layout.visible.splice(colIndex, 1);
      const orderIndex = layout.order.indexOf(column.key);
      if (orderIndex !== -1) {
        layout.order.splice(orderIndex, 1);
      }
    }
    this.syncLegacyMetadataSettingsFromLayout(context);
  }

  moveColumnUp(
    context: ItemExplorerTableColumnContext,
    column: ItemExplorerTableColumn | MetadataColumn,
  ) {
    if (!('key' in column)) {
      this.ensureExplicitMetadataSelection();
      const index = this.metadataSettings.order.indexOf(column.id);
      if (index > 0) {
        [this.metadataSettings.order[index], this.metadataSettings.order[index - 1]] = [
          this.metadataSettings.order[index - 1],
          this.metadataSettings.order[index],
        ];
        this.columns = this.filterVisibleColumns(context, this.allColumns);
      }
      return;
    }
    this.moveTableColumn(context, column, -1);
  }

  moveColumnDown(
    context: ItemExplorerTableColumnContext,
    column: ItemExplorerTableColumn | MetadataColumn,
  ) {
    if (!('key' in column)) {
      this.ensureExplicitMetadataSelection();
      const index = this.metadataSettings.order.indexOf(column.id);
      if (index >= 0 && index < this.metadataSettings.order.length - 1) {
        [this.metadataSettings.order[index], this.metadataSettings.order[index + 1]] = [
          this.metadataSettings.order[index + 1],
          this.metadataSettings.order[index],
        ];
        this.columns = this.filterVisibleColumns(context, this.allColumns);
      }
      return;
    }
    this.moveTableColumn(context, column, 1);
  }

  canMoveTableColumn(
    context: ItemExplorerTableColumnContext,
    column: DeepReadonly<ItemExplorerTableColumn>,
    delta: -1 | 1,
  ): boolean {
    if (this.isPinnedTableColumnKey(column.key)) return false;
    const visibleOrder = this.tableColumns(context);
    const visibleIndex = visibleOrder.findIndex((entry) => entry.key === column.key);
    const neighbor = visibleOrder[visibleIndex + delta];
    return visibleIndex >= 0 && Boolean(neighbor) && !this.isPinnedTableColumnKey(neighbor.key);
  }

  private moveTableColumn(
    context: ItemExplorerTableColumnContext,
    column: ItemExplorerTableColumn,
    delta: -1 | 1,
  ) {
    if (!this.canMoveTableColumn(context, column, delta)) return;
    this.ensureExplicitTableLayout(context);
    const layout = this.metadataSettings.layout!;
    const visibleOrder = this.tableColumns(context).map((entry) => entry.key);
    const visibleIndex = visibleOrder.indexOf(column.key);
    const neighborKey = visibleOrder[visibleIndex + delta];
    if (visibleIndex < 0 || !neighborKey) return;

    for (const key of visibleOrder) {
      if (!layout.order.includes(key)) layout.order.push(key);
    }
    const index = layout.order.indexOf(column.key);
    const neighborIndex = layout.order.indexOf(neighborKey);
    [layout.order[index], layout.order[neighborIndex]] = [
      layout.order[neighborIndex],
      layout.order[index],
    ];
    this.syncLegacyMetadataSettingsFromLayout(context);
  }

  private orderPinnedTableColumns(columns: ItemExplorerTableColumn[]): ItemExplorerTableColumn[] {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const pinned = [
      TABLE_COLUMN_KEYS.position,
      TABLE_COLUMN_KEYS.referenceNumber,
      TABLE_COLUMN_KEYS.itemId,
    ]
      .map((key) => byKey.get(key))
      .filter((column): column is ItemExplorerTableColumn => Boolean(column));
    return [...pinned, ...columns.filter((column) => !this.isPinnedTableColumnKey(column.key))];
  }

  private isPinnedTableColumnKey(key: string): boolean {
    return (
      key === TABLE_COLUMN_KEYS.position ||
      key === TABLE_COLUMN_KEYS.referenceNumber ||
      key === TABLE_COLUMN_KEYS.itemId
    );
  }

  toggleManualOrderMode(context: ItemExplorerTableFilterContext, items: readonly ExplorerItem[]) {
    if (this.sortField === '__manual__') {
      this.sortField = this.sortBeforeManualOrder?.field ?? DEFAULT_EXPLORER_SORT_FIELD;
      this.sortIsMeta = this.sortBeforeManualOrder?.isMeta ?? false;
      this.sortDir = this.sortBeforeManualOrder?.direction ?? DEFAULT_EXPLORER_SORT_DIR;
      this.sortBeforeManualOrder = null;
      this.applySort(context);
      return;
    }

    this.sortBeforeManualOrder = {
      field: this.sortField,
      isMeta: this.sortIsMeta,
      direction: this.sortDir,
    };
    this.sortField = '__manual__';
    this.sortIsMeta = false;
    this.sortDir = 'asc';
    if (!this.itemOrder.length) {
      this.itemOrder = items.map((item) => item.rowKey);
    }
    this.applySort(context);
  }

  resetToDefault(context: ItemExplorerTableColumnContext) {
    const restricted = this.metadataSettings.restrictReviewerColumnsToManagerSelection;
    this.metadataSettings = {
      restrictReviewerColumnsToManagerSelection: restricted,
      visible: [],
      order: [],
      configured: false,
      widths: {},
      referenceNumberVisible: false,
      layout: {
        visible: [],
        order: [],
        configured: false,
        widths: {},
        schemaVersion: TABLE_COLUMN_LAYOUT_SCHEMA_VERSION,
      },
    };
    this.columns = this.filterVisibleColumns(context, this.allColumns);
  }

  toggleReferenceNumberVisibility(context: ItemExplorerTableColumnContext) {
    const column = this.allTableColumns(context).find(
      (entry) => entry.key === TABLE_COLUMN_KEYS.referenceNumber,
    );
    if (column) this.toggleColumnVisibility(context, column);
  }

  resolveMetadataSettings(featureConfig: Record<string, any>): MetadataSettings {
    const metadataColumns = featureConfig?.['metadataColumns'];
    if (metadataColumns && typeof metadataColumns === 'object') {
      const visible = normalizeItemExplorerColumnList(
        Array.isArray(metadataColumns.visible)
          ? metadataColumns.visible.filter(
              (entry: unknown): entry is string => typeof entry === 'string',
            )
          : [],
      );
      const order = normalizeItemExplorerColumnList(
        Array.isArray(metadataColumns.order)
          ? metadataColumns.order.filter(
              (entry: unknown): entry is string => typeof entry === 'string',
            )
          : [],
      );

      return {
        visible: visible.length ? visible : order,
        order: order.length ? order : visible,
        restrictReviewerColumnsToManagerSelection:
          metadataColumns.restrictReviewerColumnsToManagerSelection === true,
        configured: metadataColumns.configured === true || visible.length > 0 || order.length > 0,
        widths: normalizeItemExplorerColumnRecord(
          this.normalizeMetadataColumnWidths(metadataColumns.widths),
        ),
        referenceNumberVisible: metadataColumns.referenceNumberVisible === true,
        layout: this.resolveTableColumnLayout(metadataColumns.layout),
      };
    }

    const legacyColumns = featureConfig?.['itemListMetadataColumns'];
    const legacy = normalizeItemExplorerColumnList(
      Array.isArray(legacyColumns)
        ? legacyColumns.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
    );

    return {
      visible: legacy,
      order: legacy,
      configured: legacy.length > 0,
      widths: {},
      referenceNumberVisible: false,
      layout: this.resolveTableColumnLayout(undefined),
    };
  }

  private resolveTableColumnLayout(raw: unknown) {
    const layout = this.isRecord(raw) ? raw : {};
    const visible = normalizeItemExplorerColumnList(
      Array.isArray(layout['visible'])
        ? layout['visible'].filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
      normalizeItemExplorerTableColumnKey,
    );
    const order = normalizeItemExplorerColumnList(
      Array.isArray(layout['order'])
        ? layout['order'].filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
      normalizeItemExplorerTableColumnKey,
    );
    return {
      visible: layout['configured'] === true ? visible : visible.length ? visible : order,
      order: order.length ? order : visible,
      configured: layout['configured'] === true || visible.length > 0 || order.length > 0,
      widths: normalizeItemExplorerColumnRecord(
        this.normalizeMetadataColumnWidths(layout['widths']),
        normalizeItemExplorerTableColumnKey,
      ),
      ...(Number.isInteger(Number(layout['schemaVersion']))
        ? { schemaVersion: Number(layout['schemaVersion']) }
        : {}),
    };
  }

  resolveConfiguredMetadataColumns(featureConfig: Record<string, any>): MetadataColumn[] {
    const definitions = featureConfig?.['metadataColumns']?.definitions;
    if (!Array.isArray(definitions)) return [];
    const seen = new Set<string>();
    const columns: MetadataColumn[] = [];
    definitions.forEach((entry: unknown) => {
      if (!this.isRecord(entry)) return;
      const id = String(entry['id'] || '').trim();
      const label = String(entry['label'] || '').trim();
      if (!id || !label || seen.has(id)) return;
      seen.add(id);
      columns.push({ id, label, kind: 'text' });
    });
    return columns;
  }

  private normalizeMetadataColumnWidths(raw: unknown): Record<string, number> {
    if (!this.isRecord(raw)) return {};
    const widths: Record<string, number> = {};
    Object.entries(raw).forEach(([id, value]) => {
      const width = Number(value);
      if (!id.trim() || !Number.isFinite(width)) return;
      widths[id] = Math.min(600, Math.max(80, Math.round(width)));
    });
    return widths;
  }

  buildUiPreferences(): Record<string, unknown> {
    const sharedColumnFilters = Object.fromEntries(
      Object.entries(this.columnFilters).filter(([key]) => !this.isPersonalColumnFilterKey(key)),
    );
    return {
      sortField: this.sortField,
      sortIsMeta: this.sortIsMeta,
      sortDir: this.sortDir,
      columnFilters: sharedColumnFilters,
    };
  }

  applyUiPreferences(rawUi: unknown) {
    if (!this.isRecord(rawUi)) return;

    const sortField = rawUi['sortField'];
    const sortIsMeta = rawUi['sortIsMeta'];
    const sortDir = rawUi['sortDir'];
    const columnFilters = rawUi['columnFilters'];

    const normalizedSortIsMeta = typeof sortIsMeta === 'boolean' ? sortIsMeta : this.sortIsMeta;
    if (typeof sortField === 'string') {
      this.sortField = normalizedSortIsMeta
        ? normalizeItemExplorerMetadataColumnId(sortField)
        : sortField;
    }

    this.sortIsMeta = normalizedSortIsMeta;

    this.sortDir = sortDir === 'desc' ? 'desc' : 'asc';
    this.columnFilters = this.isRecord(columnFilters)
      ? normalizeItemExplorerColumnFilters(
          Object.fromEntries(
            Object.entries(columnFilters).filter(([key]) => !this.isPersonalColumnFilterKey(key)),
          ),
        )
      : {};
  }

  private isPersonalColumnFilterKey(key: string): boolean {
    return key === 'personalCategory' || key === 'personalTags' || key === 'personalNote';
  }

  openColumnManager() {
    if (this.showColumnManager) {
      return;
    }
    this.columnManagerOriginalSettings = {
      restrictReviewerColumnsToManagerSelection:
        this.metadataSettings.restrictReviewerColumnsToManagerSelection,
      visible: [...this.metadataSettings.visible],
      order: [...this.metadataSettings.order],
      configured: this.metadataSettings.configured,
      widths: { ...this.metadataSettings.widths },
      referenceNumberVisible: this.referenceNumberVisible(),
      ...(this.metadataSettings.layout
        ? {
            layout: {
              visible: [...this.metadataSettings.layout.visible],
              order: [...this.metadataSettings.layout.order],
              configured: this.metadataSettings.layout.configured,
              widths: { ...this.metadataSettings.layout.widths },
              ...(this.metadataSettings.layout.schemaVersion
                ? { schemaVersion: this.metadataSettings.layout.schemaVersion }
                : {}),
            },
          }
        : {}),
    };
    this.showColumnManager = true;
  }

  closeColumnManager(context: ItemExplorerTableColumnContext) {
    if (!this.showColumnManager) {
      return;
    }
    if (this.columnManagerOriginalSettings) {
      this.metadataSettings = this.columnManagerOriginalSettings;
      this.columns = this.filterVisibleColumns(context, this.allColumns);
      this.columnManagerOriginalSettings = null;
    }
    this.showColumnManager = false;
  }

  private getStableRowKey(item?: ReadonlyExplorerItem | null): string {
    if (!item) return '';
    return String(item.rowKey || item.uuid || `${item.unitId}_${item.itemId}`).trim();
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  reconcileItemOrder(items: readonly ExplorerItem[]): void {
    const currentKeys = items.map((item) => item.rowKey);
    const availableKeys = new Set(currentKeys);
    const retainedOrder = this.itemOrder.filter((key) => availableKeys.has(key));
    const retainedKeys = new Set(retainedOrder);
    this.itemOrder = [...retainedOrder, ...currentKeys.filter((key) => !retainedKeys.has(key))];
  }

  canMoveRow(items: readonly ExplorerItem[], rowKey: string, delta: number): boolean {
    if (this.sortField !== '__manual__') {
      return false;
    }
    const order = this.itemOrder.length ? this.itemOrder : items.map((item) => item.rowKey);
    const currentIndex = order.indexOf(rowKey);
    const targetIndex = currentIndex + delta;
    return currentIndex >= 0 && targetIndex >= 0 && targetIndex < order.length;
  }

  moveRow(items: readonly ExplorerItem[], rowKey: string, delta: number): boolean {
    if (!this.canMoveRow(items, rowKey, delta)) return false;
    if (!this.itemOrder.length) {
      this.itemOrder = items.map((item) => item.rowKey);
    }
    const currentIndex = this.itemOrder.indexOf(rowKey);
    const targetIndex = currentIndex + delta;
    [this.itemOrder[currentIndex], this.itemOrder[targetIndex]] = [
      this.itemOrder[targetIndex],
      this.itemOrder[currentIndex],
    ];
    return true;
  }

  reconcileMeanTaskDifficultyState(items: readonly ExplorerItem[]): boolean {
    this.hasMeanTaskDifficulty = items.some((item) => item.meanTaskDifficulty !== undefined);
    if (!this.hasMeanTaskDifficulty) {
      let uiStateChanged = false;
      if (this.columnFilters['meanTaskDifficulty'] !== undefined) {
        delete this.columnFilters['meanTaskDifficulty'];
        uiStateChanged = true;
      }
      if (this.sortField === 'meanTaskDifficulty') {
        this.sortField = DEFAULT_EXPLORER_SORT_FIELD;
        this.sortIsMeta = false;
        this.sortDir = DEFAULT_EXPLORER_SORT_DIR;
        uiStateChanged = true;
      }
      if (uiStateChanged) {
        return true;
      }
    }
    return false;
  }

  completeColumnManager(context: ItemExplorerTableColumnContext) {
    if (this.metadataSettings.restrictReviewerColumnsToManagerSelection)
      this.ensureExplicitTableLayout(context);
    this.syncLegacyMetadataSettingsFromLayout(context);
    const layout = this.metadataSettings.layout || {
      visible: [],
      order: [],
      configured: false,
      widths: {},
      schemaVersion: TABLE_COLUMN_LAYOUT_SCHEMA_VERSION,
    };
    this.columns = this.filterVisibleColumns(context, this.allColumns);
    const visiblePersonalFilterKeys = this.clearHiddenTableColumnFilters(context);
    this.ensureVisibleSortField(context);
    this.columnManagerOriginalSettings = null;
    this.showColumnManager = false;
    return {
      visiblePersonalFilterKeys,
      patch: {
        ui: this.buildUiPreferences(),
        metadataColumns: {
          restrictReviewerColumnsToManagerSelection:
            this.metadataSettings.restrictReviewerColumnsToManagerSelection === true,
          visible: [...this.metadataSettings.visible],
          order: [...this.metadataSettings.order],
          configured: this.metadataSettings.configured,
          widths: { ...this.metadataSettings.widths },
          referenceNumberVisible: this.referenceNumberVisible(),
          layout: {
            visible: [...layout.visible],
            order: [...layout.order],
            configured: layout.configured,
            widths: { ...layout.widths },
            schemaVersion: TABLE_COLUMN_LAYOUT_SCHEMA_VERSION,
          },
        },
      },
    };
  }
}
