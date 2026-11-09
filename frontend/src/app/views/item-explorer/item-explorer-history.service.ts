import { Inject, Injectable, OnDestroy } from '@angular/core';
import { ReplaySubject, Subscription, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import type { ItemExplorerChangeLogEntry } from '../../core/models/api.models';
import { ItemExplorerBrowser } from './item-explorer-browser.service';
import {
  buildHistoryCsv,
  filterHistoryEntries,
  ItemExplorerHistoryFilters,
} from './item-explorer-history';

/** Owns the route-local change history, filters and CSV export. */
@Injectable()
export class ItemExplorerHistoryService implements OnDestroy, ItemExplorerHistoryFilters {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private request?: Subscription;
  private apId = '';

  showHistoryOverlay = false;
  historyLoading = false;
  historyError = '';
  historyEntries: ItemExplorerChangeLogEntry[] = [];
  historyFilterUser = '';
  historyFilterType = '';
  historyFilterFrom = '';
  historyFilterTo = '';

  constructor(
    @Inject(ApiService) private readonly api: ApiService,
    @Inject(ItemExplorerBrowser) private readonly browser: ItemExplorerBrowser,
  ) {}

  get filteredHistoryEntries(): ItemExplorerChangeLogEntry[] {
    return filterHistoryEntries(this.historyEntries, this);
  }

  setHistoryFilter(key: keyof ItemExplorerHistoryFilters, value: string): void {
    if (!this.destroyed) this[key] = value;
  }

  showHistory(apId: string): void {
    if (this.destroyed) return;
    this.request?.unsubscribe();
    if (this.apId !== apId) this.historyEntries = [];
    this.apId = apId;
    this.showHistoryOverlay = true;
    this.historyLoading = true;
    this.historyError = '';
    this.request = this.api
      .getItemExplorerChanges(apId, 300)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (entries) => {
          this.historyEntries = entries || [];
          this.historyLoading = false;
        },
        error: (error) => {
          console.error('Failed to load history', error);
          this.historyLoading = false;
          this.historyError = 'Änderungsverlauf konnte nicht geladen werden.';
        },
      });
  }

  closeHistoryOverlay(): boolean {
    if (this.destroyed || !this.showHistoryOverlay) return false;
    this.showHistoryOverlay = false;
    return true;
  }

  exportHistoryCsv(): void {
    if (this.destroyed) return;
    const entries = this.filteredHistoryEntries;
    if (!entries.length) return;
    this.browser.download(
      new Blob([buildHistoryCsv(entries)], { type: 'text/csv;charset=utf-8;' }),
      `item-explorer-history-${this.apId}.csv`,
    );
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
    this.request = undefined;
  }
}
