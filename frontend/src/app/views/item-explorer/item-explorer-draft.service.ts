import { Inject, Injectable, OnDestroy } from '@angular/core';
import { firstValueFrom, ReplaySubject, Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ItemExplorerSharedState, ItemExplorerStateEnvelope } from '../../core/models/api.models';
import { ExplorerUiStatus } from './item-explorer.models';

export type ItemExplorerDraftResult =
  | { kind: 'applied'; envelope: ItemExplorerStateEnvelope; markSaved: boolean }
  | { kind: 'idle' | 'busy' | 'cancelled' | 'conflict' | 'version-only' }
  | { kind: 'failed'; rollbackTags: boolean };

@Injectable()
export class ItemExplorerDraftService implements OnDestroy {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private readonly flushRequested = new Subject<void>();
  readonly flushRequested$ = this.flushRequested.asObservable();
  private acpId = '';
  private canEdit = false;
  private canPublish = false;
  private flushInFlight: Promise<ItemExplorerDraftResult> | null = null;
  private conflictRecovery: {
    result: ItemExplorerDraftResult;
    completion: Promise<ItemExplorerDraftResult>;
    resolve: (result: ItemExplorerDraftResult) => void;
  } | null = null;
  private operationInFlight = false;
  private publishing = false;
  discarding = false;

  constructor(@Inject(ApiService) private readonly api: ApiService) {}

  configure(context: { acpId: string; canEdit: boolean; canPublish: boolean }): void {
    this.acpId = context.acpId;
    this.canEdit = context.canEdit;
    this.canPublish = context.canPublish;
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operationInFlight = false;
    this.publishing = false;
    this.discarding = false;
    this.conflictRecovery?.resolve({ kind: 'cancelled' });
    this.conflictRecovery = null;
    this.clearPatchTimer();
    if (this.saveStatusResetTimeout) clearTimeout(this.saveStatusResetTimeout);
    if (this.draftSaveMessageResetTimeout) clearTimeout(this.draftSaveMessageResetTimeout);
    this.pendingDraftPatch = null;
    this.destroy$.next();
    this.destroy$.complete();
    this.flushRequested.complete();
  }

  get operationBusy(): boolean {
    return this.operationInFlight;
  }
  get hasUnflushedChanges(): boolean {
    return (
      this.pendingDraftPatch !== null ||
      this.flushInFlight !== null ||
      this.conflictRecovery !== null
    );
  }

  canApplyEnvelope(envelope: ItemExplorerStateEnvelope): boolean {
    return (
      !this.destroyed &&
      !this.flushInFlight &&
      !this.pendingDraftPatch &&
      this.latestExplorerState === envelope
    );
  }

  get patchSuppressed(): boolean {
    return this.suppressDraftPatch;
  }
  setPatchSuppressed(suppressed: boolean): void {
    this.suppressDraftPatch = suppressed;
  }

  acceptEnvelope(envelope: ItemExplorerStateEnvelope, markSaved = false): void {
    if (this.destroyed) return;
    this.adoptVersion(envelope);
    this.lastDraftOperationError = '';
    const roleLabel = envelope.updatedByRole ? ` (${envelope.updatedByRole})` : '';
    const username = envelope.updatedByUsername || 'unbekannt';
    this.lastExplorerChangeInfo = `${username}${roleLabel} · ${new Date(envelope.updatedAt).toLocaleString()}`;
    this.explorerUiStatus = envelope.status === 'DIRTY' ? 'DIRTY' : markSaved ? 'SAVED' : 'CLEAN';
    if (this.saveStatusResetTimeout) clearTimeout(this.saveStatusResetTimeout);
    if (markSaved && envelope.status !== 'DIRTY') {
      this.saveStatusResetTimeout = setTimeout(() => {
        this.saveStatusResetTimeout = null;
        if (!this.hasPendingDraftChanges()) this.explorerUiStatus = 'CLEAN';
      }, 1800);
    }
  }

  private adoptVersion(envelope: ItemExplorerStateEnvelope): void {
    this.latestExplorerState = envelope;
    this.explorerVersion = envelope.version;
    this.explorerPublishedVersion = envelope.publishedVersion;
  }

  queueDraftPatch(
    changeType: string,
    patch: Record<string, unknown>,
    flushImmediately = false,
  ): void {
    if (this.destroyed || !this.canEdit || this.suppressDraftPatch || this.discarding) return;
    this.pendingDraftPatch = this.mergeDraftPatches(this.pendingDraftPatch, patch);
    this.pendingDraftChangeType = changeType;
    this.explorerUiStatus = 'DIRTY';
    this.draftSaveSuccessMessage = '';
    this.clearPatchTimer();
    if (flushImmediately) this.flushRequested.next();
    else
      this.draftPatchTimeout = setTimeout(() => {
        this.draftPatchTimeout = null;
        this.flushRequested.next();
      }, this.draftPatchDebounceMs);
  }

  flushDraftPatch(): Promise<ItemExplorerDraftResult> {
    if (this.destroyed || this.discarding) return Promise.resolve({ kind: 'cancelled' });
    if (this.publishing) return Promise.resolve({ kind: 'busy' });
    if (this.conflictRecovery) return this.conflictRecovery.completion;
    if (this.flushInFlight) return this.flushInFlight;
    if (!this.canEdit || !this.pendingDraftPatch) return Promise.resolve({ kind: 'idle' });
    const drain = this.drainDraftPatches();
    const tracked = drain.finally(() => {
      if (this.flushInFlight === tracked) this.flushInFlight = null;
    });
    this.flushInFlight = tracked;
    return tracked;
  }

  private async drainDraftPatches(): Promise<ItemExplorerDraftResult> {
    let result: ItemExplorerDraftResult = { kind: 'idle' };
    while (this.pendingDraftPatch && !this.discarding) {
      if (this.destroyed || !this.canEdit) return { kind: 'cancelled' };
      result = await this.performDraftPatch();
      if (result.kind !== 'applied') return result;
    }
    return this.destroyed || this.discarding ? { kind: 'cancelled' } : result;
  }

  private async performDraftPatch(): Promise<ItemExplorerDraftResult> {
    this.clearPatchTimer();
    const patch = this.pendingDraftPatch!;
    const changeType = this.pendingDraftChangeType;
    this.pendingDraftPatch = null;
    this.pendingDraftChangeType = 'UI_UPDATE';
    this.explorerUiStatus = 'SAVING';
    try {
      const envelope = await firstValueFrom(
        this.api
          .patchItemExplorerDraft(this.acpId, {
            changeType,
            patch: patch as ItemExplorerSharedState,
            baseVersion: this.explorerVersion,
          })
          .pipe(takeUntil(this.destroy$)),
      );
      if (this.destroyed) return { kind: 'cancelled' };
      this.adoptVersion(envelope);
      if (this.pendingDraftPatch) this.explorerUiStatus = 'DIRTY';
      return { kind: 'applied', envelope, markSaved: false };
    } catch (error: any) {
      if (this.destroyed) return { kind: 'cancelled' };
      this.explorerUiStatus = 'ERROR';
      if (error?.status === 409) {
        this.lastDraftOperationError =
          'Konflikt beim Aktualisieren des Entwurfs. Der Explorer wurde neu geladen.';
        this.pendingDraftPatch = null;
        this.pendingDraftChangeType = 'UI_UPDATE';
        const result: ItemExplorerDraftResult = { kind: 'conflict' };
        this.beginConflictRecovery(result);
        return result;
      }
      this.lastDraftOperationError = this.extractDraftErrorMessage(
        error,
        'Fehler beim Aktualisieren des Entwurfs.',
      );
      const queuedPatch = this.pendingDraftPatch;
      const queuedChangeType = this.pendingDraftChangeType;
      const rollbackTags = Object.prototype.hasOwnProperty.call(patch, 'tags');
      if (!this.discarding) {
        const retryPatch = this.mergeDraftPatches(
          this.withoutDraftPatchField(patch, rollbackTags ? 'tags' : ''),
          this.withoutDraftPatchField(queuedPatch, rollbackTags ? 'tags' : ''),
        );
        this.pendingDraftPatch = Object.keys(retryPatch).length ? retryPatch : null;
        this.pendingDraftChangeType = this.pendingDraftPatch
          ? queuedPatch
            ? queuedChangeType
            : changeType
          : 'UI_UPDATE';
      }
      return { kind: 'failed', rollbackTags };
    }
  }

  async saveExplorerDraft(): Promise<ItemExplorerDraftResult> {
    if (this.destroyed || !this.canPublish || this.operationInFlight) return { kind: 'cancelled' };
    this.operationInFlight = true;
    const flushed = await this.flushDraftPatch();
    if (flushed.kind !== 'applied' && flushed.kind !== 'idle') return flushed;
    if (this.destroyed) return { kind: 'cancelled' };
    this.lastDraftOperationError = '';
    this.explorerUiStatus = 'SAVING';
    this.publishing = true;
    try {
      const envelope = await firstValueFrom(
        this.api
          .saveItemExplorerDraft(this.acpId, this.explorerVersion)
          .pipe(takeUntil(this.destroy$)),
      );
      if (this.destroyed) return { kind: 'cancelled' };
      if (this.pendingDraftPatch) {
        this.adoptVersion(envelope);
        this.explorerUiStatus = 'DIRTY';
        return { kind: 'version-only' };
      }
      this.acceptEnvelope(envelope, true);
      this.draftSaveSuccessMessage =
        'Entwurf gespeichert. Referenznummern können bei Bedarf separat neu vergeben werden.';
      if (this.draftSaveMessageResetTimeout) clearTimeout(this.draftSaveMessageResetTimeout);
      this.draftSaveMessageResetTimeout = setTimeout(() => {
        this.draftSaveMessageResetTimeout = null;
        this.draftSaveSuccessMessage = '';
      }, 5000);
      return { kind: 'applied', envelope, markSaved: true };
    } catch (error: any) {
      return this.operationError(error, 'Fehler beim Speichern der Änderungen.');
    }
  }

  async discardExplorerDraft(): Promise<ItemExplorerDraftResult> {
    if (this.destroyed || !this.canPublish || this.operationInFlight) return { kind: 'cancelled' };
    this.operationInFlight = true;
    this.discarding = true;
    this.clearPatchTimer();
    this.pendingDraftPatch = null;
    this.pendingDraftChangeType = 'UI_UPDATE';
    this.showSavePreviewDialog = false;
    const recovering = this.conflictRecovery?.completion;
    if (recovering) return recovering;
    const running = this.flushInFlight;
    if (running) {
      const result = await running;
      if (result.kind === 'conflict') return result;
    }
    if (this.destroyed) return { kind: 'cancelled' };
    this.lastDraftOperationError = '';
    this.explorerUiStatus = 'SAVING';
    try {
      const envelope = await firstValueFrom(
        this.api
          .discardItemExplorerDraft(this.acpId, this.explorerVersion)
          .pipe(takeUntil(this.destroy$)),
      );
      if (this.destroyed) return { kind: 'cancelled' };
      this.acceptEnvelope(envelope, true);
      return { kind: 'applied', envelope, markSaved: true };
    } catch (error: any) {
      return this.operationError(error, 'Fehler beim Verwerfen der Änderungen.');
    }
  }

  /** Called after the facade has applied the result, including any conflict reload. */
  finishOperation(): void {
    if (this.destroyed) return;
    const flushDeferredEdits = this.publishing && this.explorerUiStatus !== 'ERROR';
    this.operationInFlight = false;
    this.publishing = false;
    this.discarding = false;
    if (!this.destroyed && flushDeferredEdits && this.pendingDraftPatch) this.flushRequested.next();
  }

  /** Called after the facade has finished reloading state for a patch conflict. */
  finishConflictRecovery(reloaded: boolean): void {
    const recovery = this.conflictRecovery;
    if (!recovery) return;
    this.conflictRecovery = null;
    recovery.resolve(recovery.result);
    if (this.destroyed) return;
    if (!reloaded) {
      this.lastDraftOperationError =
        'Konflikt beim Aktualisieren des Entwurfs. Der Explorer konnte nicht neu geladen werden. Bitte erneut versuchen.';
      this.explorerUiStatus = 'ERROR';
      return;
    }
    if (!this.publishing && !this.discarding && this.pendingDraftPatch) {
      this.flushRequested.next();
    }
  }

  private beginConflictRecovery(result: ItemExplorerDraftResult): void {
    if (this.conflictRecovery) return;
    let resolve!: (value: ItemExplorerDraftResult) => void;
    const completion = new Promise<ItemExplorerDraftResult>((done) => {
      resolve = done;
    });
    this.conflictRecovery = { result, completion, resolve };
  }

  private operationError(error: any, fallback: string): ItemExplorerDraftResult {
    if (this.destroyed) return { kind: 'cancelled' };
    this.explorerUiStatus = 'ERROR';
    this.lastDraftOperationError = this.extractDraftErrorMessage(error, fallback);
    return error?.status === 409 ? { kind: 'conflict' } : { kind: 'failed', rollbackTags: false };
  }

  openSavePreviewDialog(): void {
    if (!this.canPublish || !this.hasPendingDraftChanges()) return;
    this.draftPreviewSummary = this.buildDraftPreviewSummary();
    this.showSavePreviewDialog = true;
  }
  cancelSavePreviewDialog(): void {
    this.showSavePreviewDialog = false;
  }
  openDiscardExplorerDraftDialog(): void {
    if (!this.canPublish || !this.hasPendingDraftChanges()) return;
    this.showDiscardDraftDialog = true;
    this.discardDraftDialogBusy = false;
    this.discardDraftDialogError = '';
  }
  closeDiscardDraftDialog(): void {
    if (this.discardDraftDialogBusy) return;
    this.showDiscardDraftDialog = false;
    this.discardDraftDialogError = '';
  }
  private clearPatchTimer(): void {
    if (this.draftPatchTimeout) clearTimeout(this.draftPatchTimeout);
    this.draftPatchTimeout = null;
  }

  private readonly draftPatchDebounceMs = 250;
  private draftPatchTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingDraftPatch: Record<string, unknown> | null = null;
  private pendingDraftChangeType = 'UI_UPDATE';
  private suppressDraftPatch = false;
  private saveStatusResetTimeout: ReturnType<typeof setTimeout> | null = null;
  explorerUiStatus: ExplorerUiStatus = 'CLEAN';
  explorerVersion = 1;
  explorerPublishedVersion = 1;
  lastExplorerChangeInfo = '';
  latestExplorerState: ItemExplorerStateEnvelope | null = null;
  showSavePreviewDialog = false;
  draftPreviewSummary: Array<{ label: string; detail: string }> = [];
  lastDraftOperationError = '';
  showDiscardDraftDialog = false;
  discardDraftDialogBusy = false;
  discardDraftDialogError = '';
  draftSaveSuccessMessage = '';
  private draftSaveMessageResetTimeout: ReturnType<typeof setTimeout> | null = null;

  hasPendingDraftChanges(): boolean {
    return (
      Boolean(this.pendingDraftPatch) ||
      this.flushInFlight !== null ||
      this.operationInFlight ||
      this.latestExplorerState?.status === 'DIRTY' ||
      this.explorerUiStatus === 'DIRTY'
    );
  }

  private mergeDraftPatches(
    current: Record<string, unknown> | null,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...(current || {}) };
    for (const [key, value] of Object.entries(incoming || {})) {
      if (key === 'ui' && this.isRecord(value) && this.isRecord(merged['ui'])) {
        merged['ui'] = {
          ...merged['ui'],
          ...value,
        };
      } else if (key === 'itemPropertiesPatch' && this.isRecord(value)) {
        merged[key] = this.mergeItemPropertiesPatches(merged[key], value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  private mergeItemPropertiesPatches(
    current: unknown,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = this.isRecord(current) ? { ...current } : {};
    for (const [itemKey, propertyPatch] of Object.entries(incoming)) {
      if (propertyPatch === null) {
        merged[itemKey] = null;
      } else if (this.isRecord(propertyPatch)) {
        merged[itemKey] = this.isRecord(merged[itemKey])
          ? { ...merged[itemKey], ...propertyPatch }
          : { ...propertyPatch };
      } else {
        merged[itemKey] = propertyPatch;
      }
    }
    return merged;
  }

  private withoutDraftPatchField(
    patch: Record<string, unknown> | null,
    field: string,
  ): Record<string, unknown> {
    if (!patch) return {};
    if (!field) return { ...patch };
    const result = { ...patch };
    delete result[field];
    return result;
  }

  private extractDraftErrorMessage(error: any, fallback: string): string {
    if (error?.status === 409) {
      return 'Konflikt erkannt: Der Explorer wurde zwischenzeitlich geändert. Status wurde neu geladen.';
    }
    const message = String(error?.error?.message || '');
    return message || fallback;
  }

  private buildDraftPreviewSummary(): Array<{ label: string; detail: string }> {
    const draft = this.latestExplorerState?.draftState;
    const published = this.latestExplorerState?.publishedState;
    if (!draft || !published) {
      return [];
    }

    const summary: Array<{ label: string; detail: string }> = [];

    if (JSON.stringify(draft.ui || {}) !== JSON.stringify(published.ui || {})) {
      summary.push({
        label: 'Filter/Sortierung',
        detail: 'Globale Filter-, Sortier- oder Spaltenfilter-Einstellungen wurden geändert.',
      });
    }
    if (
      JSON.stringify(draft.metadataColumns || {}) !==
      JSON.stringify(published.metadataColumns || {})
    ) {
      summary.push({
        label: 'Metadaten-Spalten',
        detail: 'Sichtbarkeit oder Reihenfolge der Metadaten-Spalten wurde angepasst.',
      });
    }
    if (JSON.stringify(draft.itemOrder || []) !== JSON.stringify(published.itemOrder || [])) {
      summary.push({
        label: 'Item-Reihenfolge',
        detail: `Manuelle Reihenfolge mit ${Array.isArray(draft.itemOrder) ? draft.itemOrder.length : 0} Positionen wurde geändert.`,
      });
    }
    if (JSON.stringify(draft.tags || {}) !== JSON.stringify(published.tags || {})) {
      summary.push({
        label: 'Tags',
        detail: 'Tag-Zuordnungen für Items wurden verändert.',
      });
    }
    if (
      JSON.stringify(draft.itemProperties || {}) !== JSON.stringify(published.itemProperties || {})
    ) {
      const draftCount = this.isRecord(draft.itemProperties)
        ? Object.keys(draft.itemProperties).length
        : 0;
      const publishedCount = this.isRecord(published.itemProperties)
        ? Object.keys(published.itemProperties).length
        : 0;
      summary.push({
        label: 'Item-Werte',
        detail: `Item-Eigenschaften (z.B. empirische Schwierigkeit, Vorschauziele oder Ausschlüsse) geändert: ${publishedCount} → ${draftCount} Einträge.`,
      });
    }

    return summary;
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
