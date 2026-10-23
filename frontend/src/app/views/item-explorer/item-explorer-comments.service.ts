import { Inject, Injectable, OnDestroy } from '@angular/core';
import { Observable, ReplaySubject, Subject, takeUntil, timeout } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ReadonlyExplorerItem } from './item-explorer.models';
import { ItemExplorerBrowser } from './item-explorer-browser.service';

@Injectable()
export class ItemExplorerCommentsService implements OnDestroy {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private readonly countsChanged = new Subject<void>();
  readonly countsChanged$ = this.countsChanged.asObservable();
  private stopVisibilityWatch: (() => void) | null = null;
  private acpId = '';
  private identity: string | null = null;
  private loggedIn = false;
  private canExport = false;
  constructor(
    @Inject(ApiService) private readonly api: ApiService,
    @Inject(ItemExplorerBrowser) private readonly browser: ItemExplorerBrowser,
  ) {}

  configure(context: {
    acpId: string;
    identity: string | null;
    loggedIn: boolean;
    canExport: boolean;
  }): void {
    this.acpId = context.acpId;
    this.identity = context.identity;
    this.loggedIn = context.loggedIn;
    this.canExport = context.canExport;
  }
  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.itemCommentCountsRequestToken++;
    this.stopCommentAutoRefresh();
    this.destroy$.next();
    this.destroy$.complete();
    this.countsChanged.complete();
  }
  itemCommentsEnabled = false;
  itemCommentsConfigured = false;
  codingCommentsEnabled = false;
  codingCommentsConfigured = false;
  itemCommentCounts: Record<string, number> = {};
  codingCommentCounts: Record<string, number> = {};
  itemCommentCountsLoading = false;
  itemCommentCountsAvailable = false;
  itemCommentCountsError = '';
  itemCommentRefreshToken = 0;
  itemCommentSessionToken = 0;
  commentExportInProgress = false;
  commentExportError = '';
  private itemCommentCountsRequestToken = 0;
  private commentRefreshTimer: ReturnType<typeof setInterval> | null = null;

  private readonly commentVisibilityListener = () => this.refreshVisibleItemComments();
  private itemCommentCountStateVersion = 0;

  private readonly itemCommentCountChangeVersions = new Map<string, number>();

  private readonly codingCommentCountChangeVersions = new Map<string, number>();
  private itemCommentCountSessionIdentity: string | null = null;

  get canExportAllComments(): boolean {
    return (this.itemCommentsEnabled || this.codingCommentsEnabled) && this.canExport;
  }

  getItemCommentCount(item?: ReadonlyExplorerItem | null): number {
    if (!item) return 0;
    const key = this.resolveItemCommentCountKey(item.unitId, item.itemId, this.itemCommentCounts);
    return this.itemCommentCounts[key] || 0;
  }

  getCodingCommentCount(item?: ReadonlyExplorerItem | null): number {
    if (!item) return 0;
    const key = this.resolveItemCommentCountKey(item.unitId, item.itemId, this.codingCommentCounts);
    return this.codingCommentCounts[key] || 0;
  }

  updateItemCommentCount(event: {
    targetType?: 'BOOKLET' | 'UNIT' | 'ITEM' | 'CODING';
    unitId: string;
    itemId: string;
    count: number;
    refreshToken?: number;
  }): void {
    if (event.targetType && event.targetType !== 'ITEM' && event.targetType !== 'CODING') return;
    if (event.refreshToken !== undefined && event.refreshToken !== this.itemCommentRefreshToken) {
      return;
    }
    const key = this.itemCommentTargetKey(event.unitId, event.itemId);
    const count = Math.max(0, Number(event.count) || 0);
    // Even an unchanged count is a newer observation than an in-flight batch.
    this.itemCommentCountStateVersion += 1;
    const changeVersions =
      event.targetType === 'CODING'
        ? this.codingCommentCountChangeVersions
        : this.itemCommentCountChangeVersions;
    changeVersions.set(key, this.itemCommentCountStateVersion);
    const targetCounts =
      event.targetType === 'CODING' ? this.codingCommentCounts : this.itemCommentCounts;
    if (targetCounts[key] === count) return;
    if (event.targetType === 'CODING') {
      this.codingCommentCounts = { ...this.codingCommentCounts, [key]: count };
    } else {
      this.itemCommentCounts = { ...this.itemCommentCounts, [key]: count };
    }
    this.countsChanged.next();
  }

  refreshItemComments(refreshSelectedThread = true): void {
    if (this.destroyed || (!this.itemCommentsEnabled && !this.codingCommentsEnabled) || !this.acpId)
      return;
    const token = ++this.itemCommentCountsRequestToken;
    const stateVersion = this.itemCommentCountStateVersion;
    if (refreshSelectedThread) this.itemCommentRefreshToken += 1;
    this.itemCommentCountsLoading = true;
    this.itemCommentCountsError = '';
    this.api
      .getItemCommentCounts(this.acpId)
      .pipe(timeout(10_000), takeUntil(this.destroy$))
      .subscribe({
        next: (snapshot) => {
          if (token !== this.itemCommentCountsRequestToken) return;
          const nextCounts = Object.fromEntries(
            (snapshot.counts || []).map((entry) => [
              this.itemCommentTargetKey(entry.unitId, entry.itemId),
              entry.count,
            ]),
          );
          const nextCodingCounts = Object.fromEntries(
            (snapshot.counts || []).map((entry) => [
              this.itemCommentTargetKey(entry.unitId, entry.itemId),
              entry.codingCount || 0,
            ]),
          );
          for (const [key, changeVersion] of this.itemCommentCountChangeVersions) {
            if (changeVersion > stateVersion) {
              nextCounts[key] = this.itemCommentCounts[key] || 0;
            } else {
              this.itemCommentCountChangeVersions.delete(key);
            }
          }
          for (const [key, changeVersion] of this.codingCommentCountChangeVersions) {
            if (changeVersion > stateVersion) {
              nextCodingCounts[key] = this.codingCommentCounts[key] || 0;
            } else {
              this.codingCommentCountChangeVersions.delete(key);
            }
          }
          this.itemCommentCounts = nextCounts;
          this.codingCommentCounts = nextCodingCounts;
          this.itemCommentCountsAvailable = true;
          this.itemCommentCountsLoading = false;
          this.countsChanged.next();
        },
        error: () => {
          if (token !== this.itemCommentCountsRequestToken) return;
          this.itemCommentCountsLoading = false;
          this.itemCommentCountsError = 'Kommentaranzahlen konnten nicht geladen werden.';
          this.countsChanged.next();
        },
      });
  }

  exportMyCommentsCsv(): void {
    this.downloadCommentExport(
      this.api.exportMyReviewCommentsCsv(this.acpId),
      `comments-${this.acpId}-mine.csv`,
    );
  }

  exportMyCommentsXlsx(): void {
    this.downloadCommentExport(
      this.api.exportMyReviewCommentsXlsx(this.acpId),
      `comments-${this.acpId}-mine.xlsx`,
    );
  }

  exportAllCommentsXlsx(): void {
    if (!this.canExportAllComments) return;
    this.downloadCommentExport(
      this.api.exportAllReviewCommentsXlsx(this.acpId),
      `comments-${this.acpId}-all.xlsx`,
    );
  }

  private resolveItemCommentCountKey(
    unitId: string,
    itemId: string,
    counts: Record<string, number>,
  ): string {
    const exactKey = this.itemCommentTargetKey(unitId, itemId);
    if (Object.prototype.hasOwnProperty.call(counts, exactKey)) return exactKey;
    const prefix = `${unitId}_`;
    // Match the backend: exact canonical ID first, then a unit-prefixed request alias.
    if (!itemId.startsWith(prefix)) return exactKey;
    const alternateKey = this.itemCommentTargetKey(unitId, itemId.slice(prefix.length));
    return Object.prototype.hasOwnProperty.call(counts, alternateKey) ? alternateKey : exactKey;
  }

  private itemCommentTargetKey(unitId: string, itemId: string): string {
    return `${unitId}\u0000${itemId}`;
  }

  syncItemCommentCountSession(): void {
    if (this.destroyed) return;
    const nextIdentity =
      this.itemCommentsEnabled || this.codingCommentsEnabled ? this.identity : null;
    if (nextIdentity === this.itemCommentCountSessionIdentity) return;

    this.stopCommentAutoRefresh();
    this.itemCommentCountSessionIdentity = nextIdentity;
    this.itemCommentSessionToken += 1;
    this.commentExportInProgress = false;
    this.commentExportError = '';
    this.itemCommentCountsRequestToken += 1;
    this.itemCommentRefreshToken += 1;
    this.itemCommentCountsLoading = false;
    this.itemCommentCountsAvailable = false;
    this.itemCommentCounts = {};
    this.codingCommentCounts = {};
    this.itemCommentCountsError = '';
    this.itemCommentCountStateVersion += 1;
    this.itemCommentCountChangeVersions.clear();
    this.codingCommentCountChangeVersions.clear();
    this.countsChanged.next();

    if (nextIdentity) {
      this.refreshItemComments(false);
      this.stopVisibilityWatch = this.browser.watchVisibility(this.commentVisibilityListener);
      this.commentRefreshTimer = setInterval(() => this.refreshVisibleItemComments(), 5_000);
    }
  }

  private refreshVisibleItemComments(): void {
    if (
      this.destroyed ||
      !this.browser.isVisible() ||
      (!this.itemCommentsEnabled && !this.codingCommentsEnabled) ||
      !this.loggedIn ||
      !this.itemCommentCountSessionIdentity ||
      this.itemCommentCountsLoading
    )
      return;
    this.refreshItemComments();
  }

  private stopCommentAutoRefresh(): void {
    this.stopVisibilityWatch?.();
    this.stopVisibilityWatch = null;
    if (this.commentRefreshTimer !== null) clearInterval(this.commentRefreshTimer);
    this.commentRefreshTimer = null;
  }

  private downloadCommentExport(request: Observable<Blob>, fileName: string): void {
    if (this.destroyed || this.commentExportInProgress) return;
    const sessionToken = this.itemCommentSessionToken;
    this.commentExportInProgress = true;
    this.commentExportError = '';
    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        if (sessionToken !== this.itemCommentSessionToken) return;
        this.commentExportInProgress = false;
        if (!blob?.size) {
          this.commentExportError = 'Der Kommentar-Export war leer.';
          return;
        }
        this.browser.download(blob, fileName);
      },
      error: () => {
        if (sessionToken !== this.itemCommentSessionToken) return;
        this.commentExportInProgress = false;
        this.commentExportError = 'Kommentare konnten nicht exportiert werden.';
      },
    });
  }
}
