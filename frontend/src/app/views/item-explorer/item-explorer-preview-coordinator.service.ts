import { Injectable, OnDestroy } from '@angular/core';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  finalize,
  forkJoin,
  map,
  of,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { ItemExplorerPerspective } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { ExplorerItem, PreviewStatus } from './item-explorer.models';
import {
  ItemExplorerPreviewAssets,
  ItemExplorerPreviewLoader,
} from './item-explorer-preview-loader.service';
import {
  ItemExplorerLoadDiagnostics,
  ItemExplorerTimingToken,
} from './item-explorer-load-diagnostics.service';

export interface PreviewResponseStateItem {
  itemId: string;
  unitId: string;
  rowKey: string;
}

export interface ItemExplorerPreviewRequest {
  acpId: string;
  perspective: ItemExplorerPerspective;
  item: ExplorerItem;
  itemList: PreviewResponseStateItem[];
  reuseUnit: boolean;
}

export interface ItemExplorerPreviewResult {
  item: ExplorerItem;
  reuseUnit: boolean;
  assets: ItemExplorerPreviewAssets | null;
  responseState: any;
  error?: unknown;
}

interface TimedPreviewRequest extends ItemExplorerPreviewRequest {
  timing: ItemExplorerTimingToken | null;
}

@Injectable()
export class ItemExplorerPreviewCoordinator implements OnDestroy {
  private readonly selection$ = new Subject<TimedPreviewRequest | null>();
  private readonly resultSubject = new Subject<ItemExplorerPreviewResult>();
  private readonly destroy$ = new Subject<void>();

  readonly results$: Observable<ItemExplorerPreviewResult> = this.resultSubject.asObservable();
  status: PreviewStatus = { kind: 'idle' };

  constructor(
    private readonly api: ApiService,
    private readonly loader: ItemExplorerPreviewLoader,
    private readonly diagnostics: ItemExplorerLoadDiagnostics,
  ) {
    this.selection$
      .pipe(
        switchMap((request) => (request ? this.loadSelection(request) : EMPTY)),
        takeUntil(this.destroy$),
      )
      .subscribe((result) => {
        this.status = this.resolveCompletedStatus(result);
        this.resultSubject.next(result);
      });
  }

  select(request: ItemExplorerPreviewRequest): void {
    this.status = request.reuseUnit
      ? { kind: 'loading-response', item: request.item, reuseUnit: true }
      : { kind: 'loading-unit', item: request.item };
    this.selection$.next({
      ...request,
      timing: this.diagnostics.start('item-selection-total'),
    });
  }

  cancel(): void {
    this.selection$.next(null);
    this.status = { kind: 'idle' };
  }

  markReady(item: ExplorerItem): void {
    this.status = { kind: 'ready', item };
  }

  markUnavailable(reason: string): void {
    this.selection$.next(null);
    this.status = { kind: 'unavailable', reason };
  }

  clear(): void {
    this.cancel();
    this.loader.clear();
  }

  ngOnDestroy(): void {
    this.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.resultSubject.complete();
  }

  private loadSelection(request: TimedPreviewRequest): Observable<ItemExplorerPreviewResult> {
    let selectionOutcome: 'loaded' | 'error' | 'cancelled' = 'cancelled';
    const responseTiming = this.diagnostics.start('response-state');
    let responseOutcome: 'loaded' | 'error' | 'cancelled' = 'cancelled';
    const responseState$ = this.createResponseStateRequest(request).pipe(
      tap(() => {
        responseOutcome = 'loaded';
      }),
      catchError(() => {
        responseOutcome = 'error';
        return of(null);
      }),
      finalize(() => {
        this.diagnostics.finish(responseTiming, { outcome: responseOutcome });
      }),
    );
    const assets$ = request.reuseUnit
      ? of(null)
      : request.item.partId
        ? this.loader.load(
            request.acpId,
            request.perspective,
            request.item.unitId,
            request.item.partId,
          )
        : this.loader.load(request.acpId, request.perspective, request.item.unitId);

    return forkJoin({ assets: assets$, responseState: responseState$ }).pipe(
      map(({ assets, responseState }) => {
        selectionOutcome = 'loaded';
        return {
          item: request.item,
          reuseUnit: request.reuseUnit,
          assets,
          responseState,
        };
      }),
      catchError((error) => {
        selectionOutcome = 'error';
        this.status = {
          kind: 'error',
          reason:
            error?.status === 403
              ? 'Die Aufgaben-Vorschau ist für diese Ansicht nicht freigegeben.'
              : 'Die Aufgaben-Vorschau konnte nicht geladen werden.',
        };
        return of({
          item: request.item,
          reuseUnit: request.reuseUnit,
          assets: null,
          responseState: null,
          error,
        });
      }),
      finalize(() => {
        this.diagnostics.finish(request.timing, { outcome: selectionOutcome });
      }),
    );
  }

  private createResponseStateRequest(request: ItemExplorerPreviewRequest): Observable<any> {
    const { acpId, item, itemList } = request;
    return item.rowKey
      ? this.api.getResponseStateWithFallback(
          acpId,
          item.itemId,
          item.unitId,
          itemList,
          item.rowKey,
        )
      : this.api.getResponseStateWithFallback(acpId, item.itemId, item.unitId, itemList);
  }

  private resolveCompletedStatus(result: ItemExplorerPreviewResult): PreviewStatus {
    if (result.error) {
      return this.status.kind === 'error'
        ? this.status
        : { kind: 'error', reason: 'Die Aufgaben-Vorschau konnte nicht geladen werden.' };
    }
    if (result.reuseUnit) {
      return { kind: 'ready', item: result.item };
    }
    if (!result.assets?.unit) {
      return {
        kind: 'unavailable',
        reason: 'Für diese Aufgabe sind keine Vorschaudaten verfügbar.',
      };
    }
    if (result.assets.playerHtml === null) {
      return { kind: 'unavailable', reason: 'Für diese Aufgabe ist kein Player verfügbar.' };
    }
    if (result.assets.definition === null) {
      return {
        kind: 'unavailable',
        reason: 'Für diese Aufgabe ist keine Aufgabendefinition verfügbar.',
      };
    }
    return { kind: 'ready', item: result.item };
  }
}
