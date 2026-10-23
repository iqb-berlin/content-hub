import { Inject, Injectable, OnDestroy } from '@angular/core';
import { ReplaySubject, Subject, finalize, firstValueFrom, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { ItemExplorerPerspective } from '../../core/models/api.models';
import {
  PendingPersonalRowUpdate,
  PersonalDataLoadState,
  PersonalDataSaveState,
  PersonalItemRowData,
  PersonalItemTagConfig,
  SuspendedPersonalSession,
} from './item-explorer.models';
import { ItemExplorerBrowser } from './item-explorer-browser.service';

@Injectable()
export class ItemExplorerPersonalDataService implements OnDestroy {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private readonly dataChanged = new Subject<void>();
  readonly dataChanged$ = this.dataChanged.asObservable();
  private acpId = '';
  private identity: string | null = null;
  private perspective: ItemExplorerPerspective = 'read-only';
  private hasExplorerEditPermission = false;
  private perspectiveSwitchBusy = false;
  retainVisibleColumnFilters(visibleKeys: ReadonlySet<string>): void {
    for (const key of Object.keys(this.personalColumnFilters)) {
      if (!visibleKeys.has(key)) delete this.personalColumnFilters[key];
    }
  }

  constructor(
    @Inject(ApiService) private readonly api: ApiService,
    @Inject(PendingPersonalSessionStorageService)
    private readonly pendingPersonalSessionStorage: PendingPersonalSessionStorageService,
    @Inject(ItemExplorerBrowser) private readonly browser: ItemExplorerBrowser,
  ) {}

  configureFeatures(config: Record<string, unknown>): void {
    this.enablePersonalItemData = config['enablePersonalItemData'] === true;
    const categoryLabel =
      String(config['personalItemCategoryLabel'] || 'Kompetenzstufe').trim() || 'Kompetenzstufe';
    this.personalItemCategoryLabel =
      categoryLabel.toLocaleLowerCase('de-DE') === 'kompetenzstufe'
        ? 'Kompetenzstufe (persönlich)'
        : categoryLabel;
    this.personalItemCategoryValues = this.normalizeStringList(
      config['personalItemCategoryValues'],
    );
    this.personalItemTagLabel =
      String(config['personalItemTagLabel'] || 'Markierungen').trim() || 'Markierungen';
    this.personalItemTags = this.normalizePersonalItemTagConfig(config['personalItemTags']);
  }

  configure(context: {
    acpId: string;
    identity: string | null;
    perspective: ItemExplorerPerspective;
    canExportAll: boolean;
    perspectiveSwitchBusy: boolean;
  }): void {
    this.acpId = context.acpId;
    this.identity = context.identity;
    this.perspective = context.perspective;
    this.hasExplorerEditPermission = context.canExportAll;
    this.perspectiveSwitchBusy = context.perspectiveSwitchBusy;
  }
  ngOnDestroy(): void {
    if (this.destroyed) return;
    if (this.personalDataSessionIdentity && this.pendingPersonalRowUpdates.size) {
      this.suspendPendingPersonalSession(this.personalDataSessionIdentity);
    }
    this.destroyed = true;
    this.personalDataSessionVersion++;
    this.clearPersonalSaveTimeout();
    this.destroy$.next();
    this.destroy$.complete();
    this.personalDataSessionIdentity = null;
    this.pendingPersonalRowUpdates.clear();
    this.personalSaveInFlight = false;
    this.resolvePersonalSaveWaiters(false);
    this.dataChanged.complete();
  }
  enablePersonalItemData = false;
  personalItemCategoryLabel = 'Kompetenzstufe';
  personalItemCategoryValues: string[] = [];
  personalItemTagLabel = 'Markierungen';
  personalItemTags: PersonalItemTagConfig[] = [];
  personalItemData: Record<string, PersonalItemRowData> = {};
  personalColumnFilters: Record<string, string> = {};
  personalDataLoadState: PersonalDataLoadState = 'idle';
  personalDataSaveState: PersonalDataSaveState = 'idle';
  personalDataError = '';
  personalExportInProgress = false;
  personalExportError = '';
  allPersonalDataExportInProgress = false;
  allPersonalDataExportError = '';
  collectionDataExportError = '';
  showDiscardPersonalItemDataDialog = false;

  private readonly personalPreferenceViewId = 'item-explorer';

  private readonly personalSaveDebounceMs = 350;
  private personalSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private personalSaveInFlight = false;
  private personalRowUpdateVersion = 0;

  private readonly pendingPersonalRowUpdates = new Map<string, PendingPersonalRowUpdate>();
  private personalSaveWaiters: Array<(saved: boolean) => void> = [];
  private personalDataSessionIdentity: string | null = null;
  private personalDataSessionVersion = 0;

  get showPersonalItemData(): boolean {
    return (
      !this.destroyed && this.enablePersonalItemData && this.personalDataSessionIdentity !== null
    );
  }

  get canEditPersonalItemData(): boolean {
    return this.showPersonalItemData && this.personalDataLoadState === 'loaded';
  }

  get canChangePersonalItemData(): boolean {
    return this.canEditPersonalItemData && !this.perspectiveSwitchBusy;
  }

  get canExportAllPersonalItemData(): boolean {
    return !this.destroyed && this.enablePersonalItemData && this.hasExplorerEditPermission;
  }

  private loadPersonalItemData(
    sessionIdentity = this.personalDataSessionIdentity,
    sessionVersion = this.personalDataSessionVersion,
  ) {
    if (!sessionIdentity) return;
    this.personalDataLoadState = 'loading';
    this.personalDataError = '';
    this.api
      .getViewItemPreferences(this.acpId, this.personalPreferenceViewId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (preferences) => {
          if (
            this.personalDataSessionIdentity !== sessionIdentity ||
            this.personalDataSessionVersion !== sessionVersion
          ) {
            return;
          }
          this.personalItemData = this.normalizePersonalItemRowData(preferences?.rowData);
          this.personalDataLoadState = 'loaded';
          this.restorePendingPersonalSession(sessionIdentity);
          this.dataChanged.next();
        },
        error: (error) => {
          if (
            this.personalDataSessionIdentity !== sessionIdentity ||
            this.personalDataSessionVersion !== sessionVersion
          ) {
            return;
          }
          console.error('Failed to load personal item working data', error);
          this.personalDataLoadState = 'error';
          this.personalDataError =
            'Persönliche Arbeitsdaten konnten nicht geladen werden. Bearbeitung ist deaktiviert.';
        },
      });
  }

  retryPersonalItemDataLoad() {
    if (!this.showPersonalItemData || this.personalSaveInFlight) return;
    this.loadPersonalItemData();
  }

  setPersonalItemCategory(rowKey: string, value: unknown) {
    if (!this.canChangePersonalItemData) return;
    const category = typeof value === 'string' ? value.trim().slice(0, 200) : '';
    const row = this.getOrCreatePersonalItemRow(rowKey);
    if (category) row.category = category;
    else delete row.category;
    this.compactPersonalItemRow(rowKey);
    this.queuePersonalItemRowSave(rowKey);
    this.dataChanged.next();
  }

  setPersonalItemNote(rowKey: string, value: unknown) {
    if (!this.canChangePersonalItemData) return;
    const note = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').slice(0, 10_000) : '';
    const row = this.getOrCreatePersonalItemRow(rowKey);
    if (note) row.note = note;
    else delete row.note;
    this.compactPersonalItemRow(rowKey);
    this.queuePersonalItemRowSave(rowKey);
    this.dataChanged.next();
  }

  addPersonalItemTagToRow(rowKey: string, event: Event) {
    if (!this.canChangePersonalItemData) return;
    const select = event.target as HTMLSelectElement;
    const tag = select.value.trim();
    select.value = '';
    if (!tag || !this.personalItemTags.some((entry) => entry.label === tag)) return;
    const row = this.getOrCreatePersonalItemRow(rowKey);
    const tags = row.tags || [];
    if (!tags.includes(tag)) row.tags = [...tags, tag];
    this.queuePersonalItemRowSave(rowKey);
    this.dataChanged.next();
  }

  removePersonalItemTagFromRow(rowKey: string, tag: string) {
    if (!this.canChangePersonalItemData) return;
    const row = this.personalItemData[rowKey];
    if (!row?.tags) return;
    row.tags = row.tags.filter((entry) => entry !== tag);
    if (!row.tags.length) delete row.tags;
    this.compactPersonalItemRow(rowKey);
    this.queuePersonalItemRowSave(rowKey);
    this.dataChanged.next();
  }

  availablePersonalTagsForRow(rowKey: string): PersonalItemTagConfig[] {
    const selected = new Set(this.personalItemData[rowKey]?.tags || []);
    return this.personalItemTags.filter((tag) => !selected.has(tag.label));
  }

  getPersonalTagColor(label: string): string {
    return this.personalItemTags.find((tag) => tag.label === label)?.color || '#6c757d';
  }

  flushPersonalItemDataSave() {
    this.clearPersonalSaveTimeout();
    this.saveNextPersonalItemRow();
  }

  async exportPersonalItemDataXlsx(rowKeys: string[]) {
    if (
      this.destroyed ||
      !this.showPersonalItemData ||
      this.personalDataLoadState !== 'loaded' ||
      !rowKeys.length ||
      this.personalExportInProgress
    ) {
      return;
    }

    const sessionVersion = this.personalDataSessionVersion;
    this.personalExportInProgress = true;
    this.personalExportError = '';
    try {
      const saved = await this.flushPersonalItemDataSaveAndWait();
      if (this.destroyed || sessionVersion !== this.personalDataSessionVersion) return;
      if (!saved) {
        this.personalExportError =
          'Persönliche Änderungen konnten vor dem Export nicht gespeichert werden.';
        return;
      }

      const blob = await firstValueFrom(
        this.api
          .exportViewPersonalItemDataXlsx(this.acpId, rowKeys, this.perspective)
          .pipe(takeUntil(this.destroy$)),
      );
      if (this.destroyed || sessionVersion !== this.personalDataSessionVersion) return;
      this.browser.download(blob, `personal-item-data-${this.acpId}.xlsx`);
    } catch (error) {
      if (this.destroyed || sessionVersion !== this.personalDataSessionVersion) return;
      console.error('Failed to export personal item working data', error);
      this.personalExportError = 'Persönliche Item-Arbeitsdaten konnten nicht exportiert werden.';
    } finally {
      if (!this.destroyed && sessionVersion === this.personalDataSessionVersion)
        this.personalExportInProgress = false;
    }
  }

  async exportAllPersonalItemDataCsv(collection: { id: string; name: string } | null = null) {
    if (
      this.destroyed ||
      !this.canExportAllPersonalItemData ||
      this.allPersonalDataExportInProgress
    ) {
      return;
    }

    const sessionVersion = this.personalDataSessionVersion;
    this.allPersonalDataExportInProgress = true;
    this.allPersonalDataExportError = '';
    this.collectionDataExportError = '';
    try {
      const blob = await firstValueFrom(
        this.api
          .exportAllViewPersonalItemDataCsv(this.acpId, this.perspective, collection?.id)
          .pipe(takeUntil(this.destroy$)),
      );
      if (this.destroyed || sessionVersion !== this.personalDataSessionVersion) return;
      const collectionSuffix = collection
        ? `-collection-${collection.name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-').slice(0, 80)}-${collection.id}`
        : '';
      this.browser.download(blob, `all-participant-item-data-${this.acpId}${collectionSuffix}.csv`);
    } catch (error) {
      if (this.destroyed || sessionVersion !== this.personalDataSessionVersion) return;
      const response = error as { status?: number; error?: unknown };
      let details = response.error;
      if (details instanceof Blob) {
        try {
          details = JSON.parse(await details.text());
        } catch {
          details = undefined;
        }
      }
      if (this.destroyed || sessionVersion !== this.personalDataSessionVersion) return;
      console.error(
        'Failed to export all personal item working data',
        JSON.stringify({ status: response.status, details }),
      );
      const message =
        response.status === 404 && collection
          ? 'Die Auswahlliste ist nicht mehr verfügbar oder nicht mehr freigegeben. Bitte die Auswahllisten neu laden.'
          : response.status === 403
            ? 'Für diesen Export fehlt die Berechtigung oder die benötigte ACP-Funktion ist deaktiviert.'
            : response.status === 0
              ? 'Der Server ist nicht erreichbar. Bitte die Verbindung prüfen und den Export erneut versuchen.'
              : `Die Item-Arbeitsdaten aller Teilnehmenden konnten nicht exportiert werden${response.status ? ` (HTTP ${response.status})` : ''}.`;
      if (collection) this.collectionDataExportError = message;
      else this.allPersonalDataExportError = message;
    } finally {
      if (!this.destroyed && sessionVersion === this.personalDataSessionVersion)
        this.allPersonalDataExportInProgress = false;
    }
  }

  retryPersonalItemDataSave() {
    if (!this.canEditPersonalItemData || !this.pendingPersonalRowUpdates.size) return;
    this.personalDataError = '';
    this.personalDataSaveState = 'pending';
    this.clearPersonalSaveTimeout();
    this.saveNextPersonalItemRow();
  }

  openDiscardPersonalItemDataDialog() {
    if (
      this.personalDataSaveState !== 'error' ||
      this.personalSaveInFlight ||
      !this.pendingPersonalRowUpdates.size
    ) {
      return;
    }
    this.showDiscardPersonalItemDataDialog = true;
  }

  closeDiscardPersonalItemDataDialog() {
    this.showDiscardPersonalItemDataDialog = false;
  }

  confirmDiscardPersonalItemDataChanges() {
    if (
      this.personalDataSaveState !== 'error' ||
      this.personalSaveInFlight ||
      !this.pendingPersonalRowUpdates.size
    ) {
      this.closeDiscardPersonalItemDataDialog();
      return;
    }

    const sessionIdentity = this.personalDataSessionIdentity;
    const sessionVersion = this.personalDataSessionVersion;
    this.showDiscardPersonalItemDataDialog = false;
    this.clearPersonalSaveTimeout();
    this.pendingPersonalRowUpdates.clear();
    this.removePendingPersonalSession();
    this.personalItemData = {};
    this.personalDataSaveState = 'idle';
    this.personalDataError = '';
    this.resolvePersonalSaveWaiters(false);
    this.dataChanged.next();

    if (sessionIdentity) {
      this.loadPersonalItemData(sessionIdentity, sessionVersion);
    }
  }

  private queuePersonalItemRowSave(rowKey: string) {
    if (!this.canChangePersonalItemData) return;
    const normalizedRow = this.normalizePersonalItemRowData({
      [rowKey]: this.personalItemData[rowKey],
    })[rowKey];
    this.pendingPersonalRowUpdates.set(rowKey, {
      version: ++this.personalRowUpdateVersion,
      rowData: normalizedRow || null,
      perspective: this.perspective,
    });
    this.personalDataSaveState = 'pending';
    this.personalDataError = '';
    this.clearPersonalSaveTimeout();
    this.personalSaveTimeout = setTimeout(() => {
      this.personalSaveTimeout = null;
      this.saveNextPersonalItemRow();
    }, this.personalSaveDebounceMs);
  }

  private saveNextPersonalItemRow() {
    if (!this.canEditPersonalItemData || this.personalSaveInFlight) return;
    const nextUpdate = this.pendingPersonalRowUpdates.entries().next().value as
      | [string, PendingPersonalRowUpdate]
      | undefined;
    if (!nextUpdate) {
      this.personalDataSaveState = 'saved';
      this.resolvePersonalSaveWaiters(true);
      return;
    }

    const [rowKey, update] = nextUpdate;
    const saveSessionIdentity = this.personalDataSessionIdentity;
    const saveSessionVersion = this.personalDataSessionVersion;
    if (!saveSessionIdentity) return;
    this.personalSaveInFlight = true;
    this.personalDataSaveState = 'saving';
    this.api
      .patchViewItemPreferenceRow(this.acpId, rowKey, update.rowData, update.perspective)
      .pipe(
        finalize(() => {
          if (
            this.personalDataSessionIdentity !== saveSessionIdentity ||
            this.personalDataSessionVersion !== saveSessionVersion
          ) {
            return;
          }
          this.personalSaveInFlight = false;
          if (this.personalDataSaveState === 'error') {
            this.resolvePersonalSaveWaiters(false);
          } else if (this.pendingPersonalRowUpdates.size) {
            this.saveNextPersonalItemRow();
          } else {
            this.personalDataSaveState = 'saved';
            this.resolvePersonalSaveWaiters(true);
          }
        }),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: () => {
          if (
            this.personalDataSessionIdentity !== saveSessionIdentity ||
            this.personalDataSessionVersion !== saveSessionVersion
          ) {
            return;
          }
          const current = this.pendingPersonalRowUpdates.get(rowKey);
          if (current?.version === update.version) {
            this.pendingPersonalRowUpdates.delete(rowKey);
          }
        },
        error: (error) => {
          if (
            this.personalDataSessionIdentity !== saveSessionIdentity ||
            this.personalDataSessionVersion !== saveSessionVersion
          ) {
            return;
          }
          console.error('Failed to save personal item working data', error);
          this.personalDataSaveState = 'error';
          this.personalDataError =
            'Persönliche Änderungen konnten nicht gespeichert werden. Bitte erneut versuchen.';
        },
      });
  }

  syncPersonalItemDataSession() {
    if (this.destroyed) return;
    const nextIdentity = this.enablePersonalItemData ? this.identity : null;
    if (nextIdentity === this.personalDataSessionIdentity) {
      if (nextIdentity && this.personalDataLoadState === 'idle') {
        this.loadPersonalItemData(nextIdentity);
      }
      return;
    }

    const previousIdentity = this.personalDataSessionIdentity;
    if (previousIdentity && !nextIdentity) {
      this.suspendPendingPersonalSession(previousIdentity);
    } else if (nextIdentity && nextIdentity !== previousIdentity) {
      this.discardPendingPersonalSessionUnlessOwnedBy(nextIdentity);
    }

    this.resetPersonalItemDataSession();
    this.personalDataSessionIdentity = nextIdentity;
    if (nextIdentity) {
      this.loadPersonalItemData(nextIdentity);
    }
  }

  private resetPersonalItemDataSession() {
    this.personalDataSessionIdentity = null;
    this.personalDataSessionVersion += 1;
    this.clearPersonalSaveTimeout();
    this.personalItemData = {};
    this.personalColumnFilters = {};
    this.personalDataLoadState = 'idle';
    this.personalDataSaveState = 'idle';
    this.personalExportInProgress = false;
    this.allPersonalDataExportInProgress = false;
    this.personalExportError = '';
    this.allPersonalDataExportError = '';
    this.collectionDataExportError = '';
    this.personalDataError = '';
    this.showDiscardPersonalItemDataDialog = false;
    this.personalSaveInFlight = false;
    this.pendingPersonalRowUpdates.clear();
    this.resolvePersonalSaveWaiters(false);
    this.dataChanged.next();
  }

  private suspendPendingPersonalSession(identity: string) {
    if (!this.pendingPersonalRowUpdates.size) return;
    const snapshot: SuspendedPersonalSession = {
      identity,
      updates: Array.from(this.pendingPersonalRowUpdates.entries()).map(([rowKey, update]) => [
        rowKey,
        {
          version: update.version,
          rowData: update.rowData ? structuredClone(update.rowData) : null,
          perspective: update.perspective,
        },
      ]),
    };
    this.pendingPersonalSessionStorage.set(
      this.personalPendingStorageKey(),
      JSON.stringify(snapshot),
    );
  }

  private restorePendingPersonalSession(identity: string) {
    const snapshot = this.readPendingPersonalSession();
    if (!snapshot) return;
    if (snapshot.identity !== identity) {
      this.removePendingPersonalSession();
      return;
    }

    this.pendingPersonalRowUpdates.clear();
    for (const [rowKey, update] of snapshot.updates) {
      this.pendingPersonalRowUpdates.set(rowKey, update);
      this.personalRowUpdateVersion = Math.max(this.personalRowUpdateVersion, update.version);
      if (update.rowData) {
        this.personalItemData[rowKey] = structuredClone(update.rowData);
      } else {
        delete this.personalItemData[rowKey];
      }
    }
    this.removePendingPersonalSession();
    if (this.pendingPersonalRowUpdates.size) {
      this.personalDataSaveState = 'pending';
      this.personalDataError = '';
      this.clearPersonalSaveTimeout();
      this.personalSaveTimeout = setTimeout(() => {
        this.personalSaveTimeout = null;
        this.saveNextPersonalItemRow();
      }, this.personalSaveDebounceMs);
    }
  }

  private discardPendingPersonalSessionUnlessOwnedBy(identity: string) {
    const snapshot = this.readPendingPersonalSession();
    if (snapshot && snapshot.identity !== identity) {
      this.removePendingPersonalSession();
    }
  }

  private readPendingPersonalSession(): SuspendedPersonalSession | null {
    const raw = this.pendingPersonalSessionStorage.get(this.personalPendingStorageKey());
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<SuspendedPersonalSession>;
      if (typeof parsed.identity !== 'string' || !Array.isArray(parsed.updates)) {
        throw new Error('Invalid pending personal session');
      }
      const updates: Array<[string, PendingPersonalRowUpdate]> = [];
      for (const entry of parsed.updates) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue;
        const rawUpdate = entry[1] as Partial<PendingPersonalRowUpdate> | null;
        if (!rawUpdate || !Number.isFinite(rawUpdate.version)) continue;
        const rowData =
          rawUpdate.rowData === null
            ? null
            : this.normalizePersonalItemRowData({ [entry[0]]: rawUpdate.rowData })[entry[0]] ||
              null;
        const perspective =
          rawUpdate.perspective === 'editor' || rawUpdate.perspective === 'read-only'
            ? rawUpdate.perspective
            : 'read-only';
        updates.push([entry[0], { version: Number(rawUpdate.version), rowData, perspective }]);
      }
      return { identity: parsed.identity, updates };
    } catch {
      this.removePendingPersonalSession();
      return null;
    }
  }

  private removePendingPersonalSession() {
    this.pendingPersonalSessionStorage.remove(this.personalPendingStorageKey());
  }

  private personalPendingStorageKey(): string {
    return `cp_item_explorer_pending_personal:${this.acpId}`;
  }

  private resolvePersonalItemDataSessionIdentity(): string | null {
    return this.identity;
  }

  flushPersonalItemDataSaveAndWait(): Promise<boolean> {
    if (!this.hasPendingPersonalItemDataChanges()) {
      return Promise.resolve(true);
    }
    if (!this.canEditPersonalItemData) {
      return Promise.resolve(false);
    }

    const result = new Promise<boolean>((resolve) => {
      this.personalSaveWaiters.push(resolve);
    });
    this.personalDataError = '';
    if (this.pendingPersonalRowUpdates.size) {
      this.personalDataSaveState = 'pending';
    }
    this.clearPersonalSaveTimeout();
    this.saveNextPersonalItemRow();
    return result;
  }

  hasPendingPersonalItemDataChanges(): boolean {
    return (
      this.pendingPersonalRowUpdates.size > 0 ||
      this.personalSaveInFlight ||
      this.personalSaveTimeout !== null ||
      this.personalDataSaveState === 'error'
    );
  }

  private resolvePersonalSaveWaiters(saved: boolean) {
    const waiters = this.personalSaveWaiters;
    this.personalSaveWaiters = [];
    waiters.forEach((resolve) => resolve(saved));
  }

  private clearPersonalSaveTimeout() {
    if (!this.personalSaveTimeout) return;
    clearTimeout(this.personalSaveTimeout);
    this.personalSaveTimeout = null;
  }

  private getOrCreatePersonalItemRow(rowKey: string): PersonalItemRowData {
    if (!this.personalItemData[rowKey]) this.personalItemData[rowKey] = {};
    return this.personalItemData[rowKey];
  }

  private compactPersonalItemRow(rowKey: string) {
    const row = this.personalItemData[rowKey];
    if (row && !row.category && !row.note && !row.tags?.length) {
      delete this.personalItemData[rowKey];
    }
  }

  private normalizePersonalItemRowData(raw: unknown): Record<string, PersonalItemRowData> {
    if (!this.isRecord(raw)) return {};
    const normalized: Record<string, PersonalItemRowData> = {};
    for (const [rawRowKey, rawValue] of Object.entries(raw)) {
      const rowKey = rawRowKey.trim();
      if (!rowKey || !this.isRecord(rawValue)) continue;
      const category =
        typeof rawValue['category'] === 'string' ? rawValue['category'].trim().slice(0, 200) : '';
      const note =
        typeof rawValue['note'] === 'string'
          ? rawValue['note'].replace(/\r\n?/g, '\n').slice(0, 10_000)
          : '';
      const tags = this.normalizeStringList(rawValue['tags']).slice(0, 50);
      const row: PersonalItemRowData = {};
      if (category) row.category = category;
      if (tags.length) row.tags = tags;
      if (note) row.note = note;
      if (Object.keys(row).length) normalized[rowKey] = row;
    }
    return normalized;
  }

  private normalizePersonalItemTagConfig(raw: unknown): PersonalItemTagConfig[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw
      .map((entry) => {
        const record = this.isRecord(entry) ? entry : {};
        const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
        const colorRaw = typeof record['color'] === 'string' ? record['color'].trim() : '';
        return {
          label,
          color: /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : '#3498db',
        };
      })
      .filter((tag) => {
        if (!tag.label || seen.has(tag.label)) return false;
        seen.add(tag.label);
        return true;
      })
      .slice(0, 50);
  }

  private normalizeStringList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return Array.from(
      new Set(
        raw
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
  }
  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
