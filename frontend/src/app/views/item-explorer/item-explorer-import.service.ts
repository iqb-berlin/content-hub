import { Inject, Injectable, OnDestroy } from '@angular/core';
import { firstValueFrom, ReplaySubject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ItemExplorerStateEnvelope } from '../../core/models/api.models';
import {
  ItemParameterUploadResult,
  ReadonlyItemParameterUploadSuccess,
} from './item-explorer.models';

export interface ItemExplorerImportContext {
  acpId: string;
  baseVersion: number;
}
export type ItemExplorerImportResult =
  | { kind: 'cancelled' }
  | { kind: 'warning' | 'failed'; operation: number }
  | { kind: 'conflict'; operation: number; confirmed: boolean }
  | {
      kind: 'imported';
      operation: number;
      result: ItemParameterUploadResult & { explorerState?: ItemExplorerStateEnvelope };
    };

const UPLOAD_FIELD_LABELS: Record<string, string> = {
  est: 'Empirische Itemschwierigkeit',
  empiricalDifficulty: 'Empirische Itemschwierigkeit',
  bista: 'BiSta-Wert',
  infit: 'Infit',
  discrimination: 'Trennschärfe',
  solution_rate: 'Lösungshäufigkeit',
  solutionRate: 'Lösungshäufigkeit',
  text_complexity: 'Textkomplexität',
  textComplexity: 'Textkomplexität',
  kstufe: 'Kompetenzstufe',
  competenceLevel: 'Kompetenzstufe',
  item_time_s: 'Itemzeit (s)',
  itemTimeSeconds: 'Itemzeit (s)',
  stimulus_time_s: 'Stimuluszeit (s)',
  stimulusTimeSeconds: 'Stimuluszeit (s)',
  booklet: 'Booklet',
  position: 'Position im Booklet',
};

/** Owns a single import, its pending file and all import dialog state. */
@Injectable()
export class ItemExplorerImportService implements OnDestroy {
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private operation = 0;
  private busy = false;
  constructor(@Inject(ApiService) private readonly api: ApiService) {}

  showUploadReport = false;

  uploadResult: ItemParameterUploadResult | null = null;

  isUploading = false;

  showUploadWarningDialog = false;

  uploadWarningMessages: string[] = [];

  uploadWarningBusy = false;

  uploadWarningError = '';

  private pendingItemParameterUploadFile: File | null = null;

  showErrorDialog = false;

  errorMessage = '';

  getUploadSuccessFieldSummary(success: ReadonlyItemParameterUploadSuccess): string {
    const fields = Array.isArray(success.fields) ? success.fields : [];
    const labels = fields.map((field) => UPLOAD_FIELD_LABELS[field] || field);
    const difficultyIndex = fields.findIndex(
      (field) => field === 'est' || field === 'empiricalDifficulty',
    );

    if (success.value !== undefined && success.value !== null) {
      const valueLabel = `Empirische Itemschwierigkeit: ${success.value}`;
      if (difficultyIndex >= 0) labels[difficultyIndex] = valueLabel;
      else labels.unshift(valueLabel);
    }

    const hasBookletUpdate =
      fields.includes('booklet') ||
      fields.includes('position') ||
      Array.isArray(success.bookletOccurrences);
    if (hasBookletUpdate) {
      const withoutSeparateBookletFields = labels.filter(
        (label) => label !== 'Booklet' && label !== 'Position im Booklet',
      );
      withoutSeparateBookletFields.push(
        success.bookletOccurrences?.length
          ? success.bookletOccurrences.some((occurrence) => occurrence.position !== null)
            ? 'Booklet / Position'
            : 'Booklet'
          : 'Booklet / Position gelöscht',
      );
      return [...new Set(withoutSeparateBookletFields)].join(', ') || '–';
    }

    return [...new Set(labels)].join(', ') || '–';
  }

  getUploadSuccessBookletSummary(success: ReadonlyItemParameterUploadSuccess): string {
    if (!Array.isArray(success.bookletOccurrences)) {
      return '–';
    }
    if (!success.bookletOccurrences.length) return 'Gelöscht';

    return success.bookletOccurrences
      .map((occurrence) =>
        occurrence.position === null
          ? occurrence.booklet
          : `${occurrence.booklet} / ${occurrence.position}`,
      )
      .join(' | ');
  }

  private resetItemParameterUploadWarning(): void {
    this.showUploadWarningDialog = false;
    this.uploadWarningMessages = [];
    this.uploadWarningBusy = false;
    this.uploadWarningError = '';
    this.pendingItemParameterUploadFile = null;
  }

  upload(file: File, context: ItemExplorerImportContext): Promise<ItemExplorerImportResult> {
    if (this.destroyed || this.busy) return Promise.resolve({ kind: 'cancelled' });
    this.resetItemParameterUploadWarning();
    return this.performUpload(file, context, false);
  }

  confirmWarnings(context: ItemExplorerImportContext): Promise<ItemExplorerImportResult> {
    if (this.destroyed || this.busy || !this.pendingItemParameterUploadFile) {
      return Promise.resolve({ kind: 'cancelled' });
    }
    this.uploadWarningBusy = true;
    this.uploadWarningError = '';
    return this.performUpload(this.pendingItemParameterUploadFile, context, true);
  }

  openWarnings(): void {
    if (!this.destroyed && this.pendingItemParameterUploadFile) this.showUploadWarningDialog = true;
  }

  cancelWarnings(): boolean {
    if (this.destroyed || this.busy || this.uploadWarningBusy) return false;
    this.resetItemParameterUploadWarning();
    return true;
  }

  closeReport(): void {
    this.showUploadReport = false;
  }
  closeError(): void {
    this.showErrorDialog = false;
  }

  isCurrent(result: ItemExplorerImportResult): boolean {
    return !this.destroyed && result.kind !== 'cancelled' && result.operation === this.operation;
  }

  finishOperation(result: ItemExplorerImportResult): void {
    if (!this.isCurrent(result)) return;
    this.busy = false;
    this.isUploading = false;
  }

  finishConflict(result: ItemExplorerImportResult, reloaded: boolean): void {
    if (
      !this.isCurrent(result) ||
      result.kind !== 'conflict' ||
      !result.confirmed ||
      !this.showUploadWarningDialog
    )
      return;
    if (!reloaded) {
      this.resetItemParameterUploadWarning();
      this.errorMessage =
        'Der Explorer konnte nach dem Versionskonflikt nicht neu geladen werden. Bitte lade die Seite neu und starte den Import erneut.';
      this.showErrorDialog = true;
      return;
    }
    this.uploadWarningBusy = false;
    this.uploadWarningError =
      'Der Explorer-Entwurf wurde neu geladen. Bitte bestätige den Import erneut.';
  }

  private async performUpload(
    file: File,
    context: ItemExplorerImportContext,
    confirmed: boolean,
  ): Promise<ItemExplorerImportResult> {
    const operation = ++this.operation;
    this.busy = true;
    this.isUploading = true;
    try {
      const result = await firstValueFrom(
        this.api
          .uploadItemParameters(context.acpId, file, {
            draft: true,
            baseVersion: context.baseVersion,
            ...(confirmed ? { confirmWarnings: true } : {}),
          })
          .pipe(takeUntil(this.destroy$)),
      );
      if (this.destroyed) return { kind: 'cancelled' };
      this.isUploading = false;
      this.uploadWarningBusy = false;
      if (result.requiresConfirmation) {
        if (confirmed) {
          this.uploadWarningError =
            'Die bestätigte Verarbeitung wurde vom Server nicht akzeptiert. Bitte versuche es erneut.';
          return { kind: 'failed', operation };
        }
        this.pendingItemParameterUploadFile = file;
        this.uploadWarningMessages = (result.warnings || []).map((warning) => warning.message);
        return { kind: 'warning', operation };
      }
      this.resetItemParameterUploadWarning();
      this.uploadResult = result;
      this.showUploadReport = true;
      return { kind: 'imported', operation, result };
    } catch (error: any) {
      if (this.destroyed) return { kind: 'cancelled' };
      console.error(error);
      this.isUploading = false;
      if (confirmed && this.showUploadWarningDialog) {
        if (error?.status === 409) {
          this.uploadWarningBusy = true;
          this.uploadWarningError =
            'Der Explorer-Entwurf wurde zwischenzeitlich geändert und wird neu geladen.';
          return { kind: 'conflict', operation, confirmed: true };
        }
        this.uploadWarningBusy = false;
        this.uploadWarningError =
          error?.error?.message ||
          'Fehler beim bestätigten Import. Es wurden keine Itemparameter geändert.';
        return { kind: 'failed', operation };
      }
      this.uploadWarningBusy = false;
      this.errorMessage =
        error?.status === 409
          ? 'Konflikt beim Speichern des Entwurfs. Der Explorer wurde neu geladen.'
          : error?.error?.message ||
            'Fehler beim Hochladen der CSV-Datei. Bitte prüfe die Spalte "item" und die unterstützten Itemparameter.';
      this.showErrorDialog = true;
      if (error?.status === 409) {
        this.isUploading = true;
        return { kind: 'conflict', operation, confirmed: false };
      }
      return { kind: 'failed', operation };
    }
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operation += 1;
    this.busy = false;
    this.isUploading = false;
    this.resetItemParameterUploadWarning();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
