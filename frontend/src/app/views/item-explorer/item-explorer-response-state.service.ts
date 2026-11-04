import { Inject, Injectable, OnDestroy } from '@angular/core';
import { ReplaySubject, Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import type { ExplorerItem } from './item-explorer.models';
import { ItemExplorerPlayerService } from './item-explorer-player.service';

export interface ItemExplorerResponseStateContext {
  acpId: string;
  selectedItem: ExplorerItem | null;
  isCorrectSolutionActive: boolean;
  previewReady: boolean;
}

/** Owns response persistence and dialogs; the player remains the owner of answer data. */
@Injectable()
export class ItemExplorerResponseStateService implements OnDestroy {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private readContext: (() => ItemExplorerResponseStateContext) | null = null;
  private readonly dialogClosed = new Subject<void>();
  readonly dialogClosed$ = this.dialogClosed.asObservable();
  private readonly loadFailed = new Subject<void>();
  readonly loadFailed$ = this.loadFailed.asObservable();

  showSaveConfirmDialog = false;
  showDeleteConfirmDialog = false;
  confirmDialogState: 'idle' | 'saving' | 'deleting' = 'idle';
  confirmDialogError = '';
  showRawDataOverlay = false;
  allResponseStates: any[] = [];

  constructor(
    @Inject(ApiService) private readonly api: ApiService,
    @Inject(ItemExplorerPlayerService) private readonly player: ItemExplorerPlayerService,
  ) {
    this.player.sessionChanges$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.confirmDialogState = 'idle';
      this.confirmDialogError = '';
      this.showSaveConfirmDialog = false;
      this.showDeleteConfirmDialog = false;
    });
  }

  /** Read live selection instead of retaining a snapshot across asynchronous requests. */
  connect(readContext: () => ItemExplorerResponseStateContext): void {
    if (!this.destroyed) this.readContext = readContext;
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.readContext = null;
    this.destroy$.next();
    this.destroy$.complete();
    this.dialogClosed.complete();
    this.loadFailed.complete();
  }

  saveCurrentResponseState(): void {
    const context = this.getContext();
    if (!context) return;
    if (this.player.syntheticPreviewState) {
      this.confirmDialogError =
        'Ein vorbereiteter Vorschauzustand kann nicht als Antwortzustand gespeichert werden.';
    } else if (context.isCorrectSolutionActive) {
      this.confirmDialogError =
        'Die Musterlösung ist nur eine Vorschau und kann nicht als Player-Eingabe gespeichert werden. Blenden Sie sie zuerst aus.';
    } else if (!context.previewReady) {
      this.confirmDialogError =
        'Der Zustand des ausgewählten Items wird noch geladen. Bitte versuchen Sie es gleich erneut.';
    } else if (!context.selectedItem || !this.player.currentResponseData) {
      this.confirmDialogError =
        'Kein Zustand zum Speichern vorhanden. Bitte füllen Sie zuerst das Formular aus.';
    } else {
      this.confirmDialogError = '';
    }
    this.showSaveConfirmDialog = true;
  }

  confirmSaveResponseState(): void {
    const context = this.getContext();
    if (!context) return;
    if (this.player.syntheticPreviewState) {
      this.confirmDialogError =
        'Ein vorbereiteter Vorschauzustand kann nicht als Antwortzustand gespeichert werden.';
      return;
    }
    const responseData = this.player.currentResponseData;
    const responseItem = context.selectedItem;
    if (
      !responseItem ||
      !responseData ||
      context.isCorrectSolutionActive ||
      !this.player.isAnswerSession ||
      !this.player.activePlayerSessionId ||
      !context.previewReady
    ) {
      this.confirmDialogError =
        'Der Zustand des ausgewählten Items ist noch nicht vollständig geladen.';
      return;
    }

    this.confirmDialogState = 'saving';
    const responseSession = this.player.responseSessionToken;
    this.api
      .saveResponseState(
        context.acpId,
        responseItem.itemId,
        responseItem.unitId,
        responseData,
        responseItem.rowKey,
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (!this.isCurrent(context, responseSession)) return;
          this.player.markResponseStateSaved(responseData);
          this.confirmDialogState = 'idle';
          this.closeSaveConfirmDialog();
        },
        error: (err) => {
          if (!this.isCurrent(context, responseSession)) return;
          console.error('Error saving response state:', err);
          this.confirmDialogState = 'idle';
          this.confirmDialogError = 'Fehler beim Speichern des Zustands.';
        },
      });
  }

  resetResponseState(): void {
    if (!this.readContext?.().selectedItem) return;
    this.confirmDialogError = '';
    this.showDeleteConfirmDialog = true;
  }

  confirmDeleteResponseState(): void {
    const context = this.getContext();
    if (!context?.selectedItem) return;
    const responseItem = context.selectedItem;
    const responseSession = this.player.responseSessionToken;
    this.confirmDialogState = 'deleting';
    this.api
      .deleteResponseState(
        context.acpId,
        responseItem.itemId,
        responseItem.unitId,
        responseItem.rowKey,
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (!this.isCurrent(context, responseSession)) return;
          this.player.clearResponseState();
          this.confirmDialogState = 'idle';
          this.closeDeleteConfirmDialog();
        },
        error: (err) => {
          if (!this.isCurrent(context, responseSession)) return;
          console.error('Error deleting response state:', err);
          this.confirmDialogState = 'idle';
          this.confirmDialogError = 'Fehler beim Löschen des Zustands.';
        },
      });
  }

  loadAllResponseStates(): void {
    const context = this.getContext();
    if (!context) return;
    this.api
      .getAllResponseStates(context.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (states) => {
          if (this.readContext?.().acpId !== context.acpId) return;
          this.allResponseStates = states;
          this.showRawDataOverlay = true;
        },
        error: (err) => {
          if (this.readContext?.().acpId !== context.acpId) return;
          console.error('Error loading response states:', err);
          this.loadFailed.next();
        },
      });
  }

  closeSaveConfirmDialog(): void {
    if (this.destroyed || this.confirmDialogState !== 'idle') return;
    this.showSaveConfirmDialog = false;
    this.confirmDialogError = '';
    this.dialogClosed.next();
  }

  closeDeleteConfirmDialog(): void {
    if (this.destroyed || this.confirmDialogState !== 'idle') return;
    this.showDeleteConfirmDialog = false;
    this.confirmDialogError = '';
    this.dialogClosed.next();
  }

  closeRawDataOverlay(): void {
    if (this.destroyed || !this.showRawDataOverlay) return;
    this.showRawDataOverlay = false;
    this.dialogClosed.next();
  }

  private getContext(): ItemExplorerResponseStateContext | null {
    const context = this.readContext?.();
    return context ? { ...context } : null;
  }

  private isCurrent(context: ItemExplorerResponseStateContext, responseSession: object): boolean {
    const current = this.readContext?.();
    return (
      !this.destroyed &&
      current?.acpId === context.acpId &&
      current?.selectedItem === context.selectedItem &&
      this.player.responseSessionToken === responseSession
    );
  }
}
