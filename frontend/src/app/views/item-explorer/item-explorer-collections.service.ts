import { Inject, Injectable, OnDestroy } from '@angular/core';
import { ReplaySubject, Subject, firstValueFrom, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import {
  ItemCollection,
  ItemCollectionSummary,
  ItemExplorerPerspective,
} from '../../core/models/api.models';
import { ExplorerItem, ReadonlyExplorerItem } from './item-explorer.models';
import { ItemExplorerBrowser } from './item-explorer-browser.service';

@Injectable()
export class ItemExplorerCollectionsService implements OnDestroy {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private readonly collectionsChanged = new Subject<void>();
  readonly collectionsChanged$ = this.collectionsChanged.asObservable();
  private acpId = '';
  private identity: string | null = null;
  private perspective: ItemExplorerPerspective = 'read-only';
  private items: ExplorerItem[] = [];
  private itemsAvailable = false;
  constructor(
    @Inject(ApiService) private readonly api: ApiService,
    @Inject(ItemExplorerBrowser) private readonly browser: ItemExplorerBrowser,
  ) {}

  configure(context: {
    acpId: string;
    identity: string | null;
    perspective: ItemExplorerPerspective;
    items: ExplorerItem[];
    itemsAvailable: boolean;
  }): void {
    this.acpId = context.acpId;
    this.identity = context.identity;
    this.perspective = context.perspective;
    this.items = context.items;
    this.itemsAvailable = context.itemsAvailable;
  }
  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.collectionSessionVersion++;
    this.collectionSessionIdentity = null;
    this.destroy$.next();
    this.destroy$.complete();
    this.collectionsChanged.complete();
    this.items = [];
    this.collectionItemMap.clear();
    this.collectionItemsCache = [];
    this.activeCollectionRowKeySet.clear();
  }
  enableItemCollections = false;
  itemCollections: ItemCollection[] = [];
  activeCollectionId: string | null = null;
  collectionViewMode: 'all' | 'active' = 'all';
  collectionLoadState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  collectionBusy = false;
  collectionError = '';
  sharedCollectionsTruncated = false;
  showCollectionDialog = false;
  private collectionSessionIdentity: string | null = null;
  private collectionSessionVersion = 0;
  private collectionItemMapSource: ExplorerItem[] | null = null;
  private collectionItemMap = new Map<string, ExplorerItem>();
  private collectionItemsCacheSource: string[] | null = null;
  private collectionItemsCacheItemSource: ExplorerItem[] | null = null;
  private collectionItemsCache: Array<{
    rowKey: string;
    position: number;
    item: ExplorerItem | null;
  }> = [];
  private activeCollectionSetSource: string[] | null = null;
  private activeCollectionRowKeySet = new Set<string>();

  get activeItemCollection(): ItemCollection | null {
    return (
      this.itemCollections.find((collection) => collection.id === this.activeCollectionId) || null
    );
  }

  get canEditActiveCollection(): boolean {
    return (
      Boolean(this.activeItemCollection) && this.activeItemCollection?.ownedByCurrentUser !== false
    );
  }

  get activeCollectionItems(): Array<{
    rowKey: string;
    position: number;
    item: ExplorerItem | null;
  }> {
    const collection = this.activeItemCollection;
    if (!collection) {
      this.collectionItemsCacheSource = null;
      this.collectionItemsCache = [];
      return this.collectionItemsCache;
    }
    if (
      this.collectionItemsCacheSource !== collection.rowKeys ||
      this.collectionItemsCacheItemSource !== this.items
    ) {
      const itemMap = this.getCollectionItemMap();
      this.collectionItemsCacheSource = collection.rowKeys;
      this.collectionItemsCacheItemSource = this.items;
      this.collectionItemsCache = collection.rowKeys.map((rowKey, index) => ({
        rowKey,
        position: index + 1,
        item: itemMap.get(rowKey) || null,
      }));
    }
    return this.collectionItemsCache;
  }

  openCollectionDialog(): void {
    if (this.activeItemCollection) this.showCollectionDialog = true;
  }

  closeCollectionDialog(): void {
    if (!this.collectionBusy) this.showCollectionDialog = false;
  }

  syncItemCollectionSession() {
    if (this.destroyed) return;
    const nextIdentity = this.enableItemCollections ? this.identity : null;
    if (nextIdentity === this.collectionSessionIdentity) {
      if (nextIdentity && this.collectionLoadState === 'idle') {
        this.loadItemCollections();
      } else if (
        !nextIdentity &&
        this.enableItemCollections &&
        this.collectionLoadState === 'idle'
      ) {
        this.collectionLoadState = 'error';
        this.collectionError = 'Für persönliche Auswahllisten ist eine Anmeldung erforderlich.';
      }
      return;
    }

    this.collectionSessionVersion += 1;
    this.collectionSessionIdentity = nextIdentity;
    this.itemCollections = [];
    this.activeCollectionId = null;
    this.collectionViewMode = 'all';
    this.collectionBusy = false;
    this.collectionError = '';
    this.sharedCollectionsTruncated = false;
    this.collectionLoadState = 'idle';
    this.showCollectionDialog = false;
    this.collectionsChanged.next();
    if (nextIdentity) {
      this.loadItemCollections();
    } else if (this.enableItemCollections) {
      this.collectionLoadState = 'error';
      this.collectionError = 'Für persönliche Auswahllisten ist eine Anmeldung erforderlich.';
    }
  }

  private getItemCollectionSession(): { identity: string | null; version: number } {
    return {
      identity: this.collectionSessionIdentity,
      version: this.collectionSessionVersion,
    };
  }

  private isCurrentItemCollectionSession(session: {
    identity: string | null;
    version: number;
  }): boolean {
    return (
      !this.destroyed &&
      session.identity !== null &&
      session.identity === this.collectionSessionIdentity &&
      session.version === this.collectionSessionVersion
    );
  }

  loadItemCollections(preserveError = false) {
    if (!this.enableItemCollections) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) {
      this.collectionLoadState = 'error';
      this.collectionError = 'Für persönliche Auswahllisten ist eine Anmeldung erforderlich.';
      return;
    }
    this.collectionLoadState = 'loading';
    if (!preserveError) this.collectionError = '';
    this.api
      .getItemCollections(this.acpId, this.perspective)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (payload) => {
          if (!this.isCurrentItemCollectionSession(session)) return;
          this.applyItemCollectionsPayload(payload);
          this.collectionLoadState = 'loaded';
          if (this.itemsAvailable) {
            this.recalculateCollectionSummaries();
          }
        },
        error: (error) => {
          if (!this.isCurrentItemCollectionSession(session)) return;
          this.collectionLoadState = 'error';
          this.collectionError =
            error?.status === 401
              ? 'Für persönliche Auswahllisten ist eine Anmeldung erforderlich.'
              : 'Auswahllisten konnten nicht geladen werden.';
        },
      });
  }

  async createCollection(requestedName?: string): Promise<ItemCollection | null> {
    if (this.collectionBusy) return null;
    const session = this.getItemCollectionSession();
    if (!session.identity) {
      this.collectionError = 'Für persönliche Auswahllisten ist eine Anmeldung erforderlich.';
      return null;
    }
    this.collectionBusy = true;
    this.collectionError = '';
    const name =
      requestedName?.trim() ||
      (this.itemCollections.filter((collection) => collection.ownedByCurrentUser).length === 0
        ? 'Meine Auswahlliste'
        : `Auswahlliste ${
            this.itemCollections.filter((collection) => collection.ownedByCurrentUser).length + 1
          }`);
    try {
      const payload = await firstValueFrom(
        this.api
          .createItemCollection(this.acpId, name, this.perspective)
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return null;
      this.applyItemCollectionsPayload(payload);
      return this.activeItemCollection;
    } catch {
      if (!this.isCurrentItemCollectionSession(session)) return null;
      this.collectionError = 'Die Auswahlliste konnte nicht erstellt werden.';
      return null;
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  async activateCollection(collectionId: string | null) {
    if (this.collectionBusy) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) return;
    this.collectionBusy = true;
    this.collectionError = '';
    try {
      const payload = await firstValueFrom(
        this.api
          .activateItemCollection(
            this.acpId,
            collectionId || null,
            this.perspective,
            this.collectionViewMode,
          )
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.applyItemCollectionsPayload(payload);
    } catch {
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.collectionError = 'Die aktive Auswahlliste konnte nicht gespeichert werden.';
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  isItemInActiveCollection(item: ReadonlyExplorerItem): boolean {
    return this.getActiveCollectionRowKeySet().has(item.rowKey);
  }

  async toggleItemInActiveCollection(item: ReadonlyExplorerItem) {
    let collection = this.activeItemCollection;
    if (!collection) collection = await this.createCollection();
    if (!collection) return;
    if (collection.ownedByCurrentUser === false) {
      this.collectionError = 'Freigegebene Auswahllisten anderer Personen sind schreibgeschützt.';
      return;
    }
    const mutation = this.getActiveCollectionRowKeySet().has(item.rowKey)
      ? { removeRowKeys: [item.rowKey] }
      : { addRowKeys: [item.rowKey] };
    await this.persistActiveCollectionRowsMutation(mutation);
  }

  async removeRowFromActiveCollection(rowKey: string): Promise<boolean> {
    return this.removeRowsFromActiveCollection([rowKey]);
  }

  async removeRowsFromActiveCollection(rowKeys: string[]): Promise<boolean> {
    if (!rowKeys.length) return true;
    return this.persistActiveCollectionRowsMutation({ removeRowKeys: rowKeys });
  }

  async clearActiveCollection(): Promise<boolean> {
    if (!this.activeItemCollection?.rowKeys.length) return true;
    return this.persistActiveCollectionRowsMutation({ clear: true });
  }

  async renameActiveCollection(requestedName: string) {
    const collection = this.activeItemCollection;
    if (!collection || collection.ownedByCurrentUser === false || this.collectionBusy) return;
    const name = requestedName.trim();
    if (!name || name === collection.name) return;
    await this.persistActiveCollectionUpdate({ name });
  }

  async deleteActiveCollection() {
    const collection = this.activeItemCollection;
    if (!collection || collection.ownedByCurrentUser === false || this.collectionBusy) return;
    if (!window.confirm(`Auswahlliste „${collection.name}“ löschen?`)) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) return;
    this.collectionBusy = true;
    this.collectionError = '';
    try {
      const payload = await firstValueFrom(
        this.api
          .deleteItemCollection(this.acpId, collection.id, this.perspective)
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.applyItemCollectionsPayload(payload);
      this.showCollectionDialog = false;
    } catch {
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.collectionError = 'Die Auswahlliste konnte nicht gelöscht werden.';
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  async exportActiveCollection() {
    const collection = this.activeItemCollection;
    if (!collection || this.collectionBusy) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) return;
    this.collectionBusy = true;
    this.collectionError = '';
    try {
      const blob = await firstValueFrom(
        this.api
          .exportItemCollectionCsv(this.acpId, collection.id, this.perspective)
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.browser.download(blob, `item-collection-${collection.id}.csv`);
    } catch {
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.collectionError = 'Die Auswahlliste konnte nicht exportiert werden.';
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  async setActiveCollectionShared(shared: boolean) {
    const collection = this.activeItemCollection;
    if (
      !collection ||
      collection.ownedByCurrentUser === false ||
      this.collectionBusy ||
      collection.shared === shared
    ) {
      return;
    }
    await this.persistActiveCollectionUpdate({ shared });
  }

  async copyActiveCollection() {
    const collection = this.activeItemCollection;
    if (!collection || collection.ownedByCurrentUser !== false || this.collectionBusy) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) return;
    this.collectionBusy = true;
    this.collectionError = '';
    try {
      const payload = await firstValueFrom(
        this.api
          .copyItemCollection(this.acpId, collection.id, this.perspective)
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.applyItemCollectionsPayload(payload);
    } catch {
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.collectionError = 'Die freigegebene Auswahlliste konnte nicht kopiert werden.';
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  formatDuration(rawSeconds: number): string {
    const seconds = Math.max(0, Math.round(Number(rawSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
      : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  private async persistActiveCollectionRowsMutation(
    mutation: { addRowKeys: string[] } | { removeRowKeys: string[] } | { clear: true },
  ): Promise<boolean> {
    const collection = this.activeItemCollection;
    if (!collection || collection.ownedByCurrentUser === false || this.collectionBusy) return false;
    const session = this.getItemCollectionSession();
    if (!session.identity) return false;
    const previous = structuredClone(collection);
    if ('addRowKeys' in mutation) {
      const existing = new Set(collection.rowKeys);
      collection.rowKeys = [
        ...collection.rowKeys,
        ...mutation.addRowKeys.filter((rowKey) => !existing.has(rowKey)),
      ];
    } else if ('removeRowKeys' in mutation) {
      const removals = new Set(mutation.removeRowKeys);
      collection.rowKeys = collection.rowKeys.filter((rowKey) => !removals.has(rowKey));
      collection.unavailableRowKeys = collection.unavailableRowKeys.filter(
        (rowKey) => !removals.has(rowKey),
      );
    } else {
      collection.rowKeys = [];
      collection.unavailableRowKeys = [];
    }
    this.recalculateCollectionSummaries();
    this.collectionsChanged.next();
    this.collectionBusy = true;
    this.collectionError = '';
    try {
      const result = await firstValueFrom(
        this.api
          .mutateItemCollectionRows(this.acpId, collection.id, {
            baseVersion: previous.version,
            perspective: this.perspective,
            ...mutation,
          })
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return false;
      const updated = this.itemCollections.find((candidate) => candidate.id === collection.id);
      if (!updated) return false;
      updated.version = result.version;
      updated.updatedAt = result.updatedAt;
      updated.summary = result.summary;
      return true;
    } catch (error: any) {
      if (!this.isCurrentItemCollectionSession(session)) return false;
      const index = this.itemCollections.findIndex((candidate) => candidate.id === previous.id);
      if (index >= 0) this.itemCollections[index] = previous;
      this.collectionsChanged.next();
      this.collectionError =
        error?.status === 409
          ? 'Die Auswahlliste wurde parallel geändert und wird neu geladen.'
          : 'Die Auswahlliste konnte nicht gespeichert werden.';
      if (error?.status === 409) this.loadItemCollections(true);
      return false;
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  private async persistActiveCollectionUpdate(update: {
    name?: string;
    rowKeys?: string[];
    shared?: boolean;
  }) {
    const collection = this.activeItemCollection;
    if (!collection || collection.ownedByCurrentUser === false || this.collectionBusy) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) return;
    const previous = structuredClone(collection);
    if (update.name !== undefined) collection.name = update.name;
    if (update.rowKeys !== undefined) collection.rowKeys = [...update.rowKeys];
    if (update.shared !== undefined) collection.shared = update.shared;
    this.recalculateCollectionSummaries();
    this.collectionsChanged.next();
    this.collectionBusy = true;
    this.collectionError = '';
    try {
      const payload = await firstValueFrom(
        this.api
          .updateItemCollection(
            this.acpId,
            collection.id,
            { baseVersion: previous.version, ...update },
            this.perspective,
          )
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.applyItemCollectionsPayload(payload);
    } catch (error: any) {
      if (!this.isCurrentItemCollectionSession(session)) return;
      const index = this.itemCollections.findIndex((candidate) => candidate.id === previous.id);
      if (index >= 0) this.itemCollections[index] = previous;
      this.collectionsChanged.next();
      this.collectionError =
        error?.status === 409
          ? 'Die Auswahlliste wurde parallel geändert und wird neu geladen.'
          : 'Die Auswahlliste konnte nicht gespeichert werden.';
      if (error?.status === 409) this.loadItemCollections(true);
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  private applyItemCollectionsPayload(payload: {
    activeCollectionId: string | null;
    collectionViewMode?: 'all' | 'active';
    collections: ItemCollection[];
    sharedCollectionsTruncated?: boolean;
  }) {
    this.itemCollections = (payload.collections || []).map((collection) => ({
      ...collection,
      shared: collection.shared === true,
      ownedByCurrentUser: collection.ownedByCurrentUser !== false,
      ownerLabel: collection.ownerLabel || 'Ich',
    }));
    this.activeCollectionId = payload.activeCollectionId || null;
    this.sharedCollectionsTruncated = payload.sharedCollectionsTruncated === true;
    this.collectionViewMode =
      payload.collectionViewMode === 'active' && this.activeCollectionId ? 'active' : 'all';
    this.collectionLoadState = 'loaded';
    if (this.itemsAvailable) {
      this.recalculateCollectionSummaries();
    }
    this.collectionsChanged.next();
  }

  async setCollectionViewMode(mode: 'all' | 'active') {
    const nextMode = mode === 'active' && this.activeItemCollection ? 'active' : 'all';
    if (nextMode === this.collectionViewMode || this.collectionBusy) return;
    const session = this.getItemCollectionSession();
    if (!session.identity) return;
    const previousMode = this.collectionViewMode;
    this.collectionViewMode = nextMode;
    this.collectionBusy = true;
    this.collectionError = '';
    this.collectionsChanged.next();
    try {
      const payload = await firstValueFrom(
        this.api
          .activateItemCollection(this.acpId, this.activeCollectionId, this.perspective, nextMode)
          .pipe(takeUntil(this.destroy$)),
      );
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.applyItemCollectionsPayload(payload);
    } catch {
      if (!this.isCurrentItemCollectionSession(session)) return;
      this.collectionViewMode = previousMode;
      this.collectionsChanged.next();
      this.collectionError = 'Die Ansicht der Auswahlliste konnte nicht gespeichert werden.';
    } finally {
      if (this.isCurrentItemCollectionSession(session)) this.collectionBusy = false;
    }
  }

  recalculateCollectionSummaries() {
    const itemMap = this.getCollectionItemMap();
    this.itemCollections = this.itemCollections.map((collection) => {
      const items = collection.rowKeys
        .map((rowKey) => itemMap.get(rowKey))
        .filter((item): item is ExplorerItem => Boolean(item));
      return {
        ...collection,
        unavailableRowKeys: collection.rowKeys.filter((rowKey) => !itemMap.has(rowKey)),
        summary: this.calculateCollectionSummary(items, collection.rowKeys.length),
      };
    });
  }

  private getCollectionItemMap(): Map<string, ExplorerItem> {
    if (this.collectionItemMapSource !== this.items) {
      this.collectionItemMapSource = this.items;
      this.collectionItemMap = new Map(this.items.map((item) => [item.rowKey, item] as const));
    }
    return this.collectionItemMap;
  }

  private getActiveCollectionRowKeySet(): Set<string> {
    const rowKeys = this.activeItemCollection?.rowKeys || null;
    if (this.activeCollectionSetSource !== rowKeys) {
      this.activeCollectionSetSource = rowKeys;
      this.activeCollectionRowKeySet = new Set(rowKeys || []);
    }
    return this.activeCollectionRowKeySet;
  }

  private calculateCollectionSummary(
    items: ExplorerItem[],
    selectedRowCount = items.length,
  ): ItemCollectionSummary {
    const itemsByUuid = new Map<string, ExplorerItem[]>();
    const itemsByUnit = new Map<string, ExplorerItem[]>();
    items.forEach((item) => {
      itemsByUuid.set(item.uuid, [...(itemsByUuid.get(item.uuid) || []), item]);
      itemsByUnit.set(item.unitId, [...(itemsByUnit.get(item.unitId) || []), item]);
    });
    let itemTimeSeconds = 0;
    let stimulusTimeSeconds = 0;
    let missingItemTimeCount = 0;
    let missingStimulusTimeUnitCount = 0;
    itemsByUuid.forEach((rows) => {
      const value = rows.map((row) => row.itemTimeSeconds).find((time) => Number.isFinite(time));
      if (value === undefined) missingItemTimeCount += 1;
      else itemTimeSeconds += value;
    });
    itemsByUnit.forEach((rows) => {
      const value = rows
        .map((row) => row.stimulusTimeSeconds)
        .find((time) => Number.isFinite(time));
      if (value === undefined) missingStimulusTimeUnitCount += 1;
      else stimulusTimeSeconds += value;
    });
    return {
      rowCount: selectedRowCount,
      itemCount: itemsByUuid.size,
      unitCount: itemsByUnit.size,
      itemTimeSeconds,
      stimulusTimeSeconds,
      testTimeSeconds: itemTimeSeconds + stimulusTimeSeconds,
      missingItemTimeCount,
      missingStimulusTimeUnitCount,
      complete: missingItemTimeCount === 0 && missingStimulusTimeUnitCount === 0,
    };
  }
}
