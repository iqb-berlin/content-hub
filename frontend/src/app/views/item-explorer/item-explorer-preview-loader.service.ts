import { Injectable } from '@angular/core';
import {
  Observable,
  ReplaySubject,
  catchError,
  finalize,
  forkJoin,
  map,
  of,
  share,
  switchMap,
  tap,
  timer,
  throwError,
} from 'rxjs';
import { ItemExplorerPerspective } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { ItemExplorerLoadDiagnostics } from './item-explorer-load-diagnostics.service';

export interface ItemExplorerPreviewAssets {
  unit: any;
  playerHtml: string | null;
  definition: string | null;
  cacheStatus: 'hit' | 'miss' | 'coalesced';
}

interface PreviewCacheEntry {
  observable: Observable<Omit<ItemExplorerPreviewAssets, 'cacheStatus'>>;
  settled: boolean;
}

interface AssetCacheEntry {
  observable: Observable<string>;
  settled: boolean;
}

@Injectable()
export class ItemExplorerPreviewLoader {
  private readonly unitCache = new Map<string, PreviewCacheEntry>();
  private readonly assetCache = new Map<string, AssetCacheEntry>();

  constructor(
    private readonly api: ApiService,
    private readonly diagnostics: ItemExplorerLoadDiagnostics,
  ) {}

  load(
    acpId: string,
    perspective: ItemExplorerPerspective,
    unitId: string,
    partId?: string,
  ): Observable<ItemExplorerPreviewAssets> {
    const key = `${acpId}:${perspective}:${partId || 'legacy'}:${unitId}`;
    const cached = this.unitCache.get(key);
    if (cached) {
      const cacheStatus = cached.settled ? 'hit' : 'coalesced';
      return cached.observable.pipe(map((value) => ({ ...value, cacheStatus })));
    }

    const entry: PreviewCacheEntry = {
      settled: false,
      observable: of({ unit: null, playerHtml: null, definition: null }),
    };
    const unitTiming = this.diagnostics.start('unit-view');
    let unitTimingFinished = false;
    const finishUnitTiming = (outcome: 'loaded' | 'error' | 'cancelled') => {
      if (unitTimingFinished) return;
      unitTimingFinished = true;
      this.diagnostics.finish(unitTiming, {
        cacheStatus: 'miss',
        unitId,
        outcome,
      });
    };
    entry.observable = this.api
      .getFileUnitView(acpId, unitId, {
        perspective,
        ...(partId ? { partId } : {}),
      })
      .pipe(
        tap({
          next: () => finishUnitTiming('loaded'),
        }),
        switchMap((unit: any) => {
          if (!unit) {
            return of({ unit: null, playerHtml: null, definition: null });
          }

          const dependencies = (unit.dependencies || []).map((dependency: any) => ({
            ...dependency,
            downloadUrl: this.api.appendAuthToken(dependency.downloadUrl),
          }));
          unit.dependencies = dependencies;
          const player = dependencies.find(
            (dependency: any) => String(dependency?.type || '').toLowerCase() === 'player',
          );
          const definition = dependencies.find((dependency: any) => {
            const type = String(dependency?.type || '').toLowerCase();
            return type === 'unit_definition' || type === 'unitdefinition' || type === 'definition';
          });

          return forkJoin({
            unit: of(unit),
            playerHtml: player?.downloadUrl ? this.loadTextAsset(player, 'player-html') : of(null),
            definition: definition?.downloadUrl
              ? this.loadTextAsset(definition, 'definition')
              : of(null),
          });
        }),
        tap({
          next: (value) => {
            if (value.unit && value.playerHtml !== null && value.definition !== null) {
              entry.settled = true;
            } else {
              this.removeUnitEntry(key, entry);
            }
          },
        }),
        catchError((error) => {
          finishUnitTiming('error');
          this.removeUnitEntry(key, entry);
          return throwError(() => error);
        }),
        finalize(() => {
          if (!entry.settled) {
            finishUnitTiming('cancelled');
            this.removeUnitEntry(key, entry);
          }
        }),
        share({
          connector: () => new ReplaySubject(1),
          resetOnError: true,
          resetOnComplete: false,
          // Keep an identical request alive across a synchronous switchMap hand-off,
          // but cancel it once no replacement subscriber arrives.
          resetOnRefCountZero: () => timer(0),
        }),
      );
    this.unitCache.set(key, entry);
    return entry.observable.pipe(map((value) => ({ ...value, cacheStatus: 'miss' as const })));
  }

  clear(): void {
    this.unitCache.clear();
    this.assetCache.clear();
  }

  private loadTextAsset(
    dependency: { fileId?: string; downloadUrl: string },
    phase: 'player-html' | 'definition',
  ): Observable<string> {
    const key = String(dependency.fileId || dependency.downloadUrl);
    const cached = this.assetCache.get(key);
    if (cached) return cached.observable;

    const entry: AssetCacheEntry = {
      settled: false,
      observable: of(''),
    };
    const timing = this.diagnostics.start(phase);
    let timingFinished = false;
    const finishTiming = (outcome: 'loaded' | 'error' | 'cancelled') => {
      if (timingFinished) return;
      timingFinished = true;
      this.diagnostics.finish(timing, {
        cacheStatus: 'miss',
        fileId: dependency.fileId,
        outcome,
      });
    };
    entry.observable = this.fetchTextAsset(dependency.downloadUrl, phase).pipe(
      tap({
        next: () => {
          entry.settled = true;
          finishTiming('loaded');
        },
      }),
      catchError((error) => {
        finishTiming('error');
        this.removeAssetEntry(key, entry);
        return throwError(() => error);
      }),
      finalize(() => {
        if (!entry.settled) {
          finishTiming('cancelled');
          this.removeAssetEntry(key, entry);
        }
      }),
      share({
        connector: () => new ReplaySubject(1),
        resetOnError: true,
        resetOnComplete: false,
        resetOnRefCountZero: () => timer(0),
      }),
    );
    this.assetCache.set(key, entry);
    return entry.observable;
  }

  private fetchTextAsset(
    downloadUrl: string,
    phase: 'player-html' | 'definition',
  ): Observable<string> {
    return new Observable<string>((subscriber) => {
      const controller = new AbortController();
      void fetch(downloadUrl, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`${phase} request failed with ${response.status}`);
          }
          return response.text();
        })
        .then((content) => {
          if (subscriber.closed) return;
          subscriber.next(content);
          subscriber.complete();
        })
        .catch((error) => {
          if (!subscriber.closed) subscriber.error(error);
        });
      return () => controller.abort();
    });
  }

  private removeUnitEntry(key: string, entry: PreviewCacheEntry): void {
    if (this.unitCache.get(key) === entry) {
      this.unitCache.delete(key);
    }
  }

  private removeAssetEntry(key: string, entry: AssetCacheEntry): void {
    if (this.assetCache.get(key) === entry) {
      this.assetCache.delete(key);
    }
  }
}
