import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ExplorerItem } from './item-explorer.models';
import { ItemExplorerPreviewCoordinator } from './item-explorer-preview-coordinator.service';

function createItem(itemId: string, unitId: string): ExplorerItem {
  return {
    itemId,
    uuid: itemId,
    rowKey: itemId,
    unitId,
    unitLabel: unitId,
    description: itemId,
    variableId: itemId,
    metadata: {},
  };
}

function createDiagnostics() {
  return {
    start: vi.fn((phase: string) => ({ phase })),
    finish: vi.fn(),
  };
}

describe('ItemExplorerPreviewCoordinator', () => {
  it('exposes the selection lifecycle as a single explicit status', () => {
    const assets$ = new Subject<any>();
    const responseState$ = new Subject<any>();
    const loader = { load: vi.fn(() => assets$), clear: vi.fn() };
    const api = { getResponseStateWithFallback: vi.fn(() => responseState$) };
    const coordinator = new ItemExplorerPreviewCoordinator(
      api as any,
      loader as any,
      createDiagnostics() as any,
    );
    const item = createItem('ITEM_1', 'UNIT_1');
    const results: any[] = [];
    coordinator.results$.subscribe((result) => results.push(result));

    coordinator.select({
      acpId: 'acp-1',
      perspective: 'editor',
      item,
      itemList: [{ itemId: item.itemId, unitId: item.unitId, rowKey: item.rowKey }],
      reuseUnit: false,
    });

    expect(coordinator.status).toEqual({ kind: 'loading-unit', item });
    assets$.next({
      unit: { id: item.unitId },
      playerHtml: '<html></html>',
      definition: '{"pages":[]}',
      cacheStatus: 'miss',
    });
    assets$.complete();
    responseState$.next({ state: null, isFallback: false });
    responseState$.complete();

    expect(coordinator.status).toEqual({ kind: 'ready', item });
    expect(results).toHaveLength(1);
  });

  it('uses switchMap cancellation and never publishes a superseded selection', () => {
    const assetRequests = new Map<string, Subject<any>>();
    const responseRequests = new Map<string, Subject<any>>();
    const loader = {
      load: vi.fn((_acpId: string, _perspective: string, unitId: string) => {
        const request = new Subject<any>();
        assetRequests.set(unitId, request);
        return request;
      }),
      clear: vi.fn(),
    };
    const api = {
      getResponseStateWithFallback: vi.fn((_acpId: string, itemId: string) => {
        const request = new Subject<any>();
        responseRequests.set(itemId, request);
        return request;
      }),
    };
    const coordinator = new ItemExplorerPreviewCoordinator(
      api as any,
      loader as any,
      createDiagnostics() as any,
    );
    const first = createItem('ITEM_1', 'UNIT_1');
    const second = createItem('ITEM_2', 'UNIT_2');
    const results: any[] = [];
    coordinator.results$.subscribe((result) => results.push(result));

    for (const item of [first, second]) {
      coordinator.select({
        acpId: 'acp-1',
        perspective: 'editor',
        item,
        itemList: [],
        reuseUnit: false,
      });
    }

    assetRequests.get('UNIT_1')?.next({
      unit: { id: 'UNIT_1' },
      playerHtml: 'stale',
      definition: 'stale',
      cacheStatus: 'miss',
    });
    assetRequests.get('UNIT_1')?.complete();
    responseRequests.get('ITEM_1')?.next({ state: null });
    responseRequests.get('ITEM_1')?.complete();
    assetRequests.get('UNIT_2')?.next({
      unit: { id: 'UNIT_2' },
      playerHtml: 'current',
      definition: 'current',
      cacheStatus: 'miss',
    });
    assetRequests.get('UNIT_2')?.complete();
    responseRequests.get('ITEM_2')?.next({ state: null });
    responseRequests.get('ITEM_2')?.complete();

    expect(results.map((result) => result.item.itemId)).toEqual(['ITEM_2']);
    expect(coordinator.status).toEqual({ kind: 'ready', item: second });
  });

  it('passes the selected assessment part to the preview loader', () => {
    const loader = {
      load: vi.fn(() =>
        of({ unit: null, playerHtml: null, definition: null, cacheStatus: 'miss' }),
      ),
      clear: vi.fn(),
    };
    const api = { getResponseStateWithFallback: vi.fn(() => of({ state: null })) };
    const coordinator = new ItemExplorerPreviewCoordinator(
      api as any,
      loader as any,
      createDiagnostics() as any,
    );
    const item = { ...createItem('ITEM_1', 'UNIT_1'), partId: 'math' };
    coordinator.select({
      acpId: 'acp-1',
      perspective: 'editor',
      item,
      itemList: [],
      reuseUnit: false,
    });
    expect(loader.load).toHaveBeenCalledWith('acp-1', 'editor', 'UNIT_1', 'math');
    coordinator.ngOnDestroy();
  });

  it('loads only the response state when the unit can be reused', () => {
    const loader = { load: vi.fn(), clear: vi.fn() };
    const api = { getResponseStateWithFallback: vi.fn(() => of({ state: null })) };
    const coordinator = new ItemExplorerPreviewCoordinator(
      api as any,
      loader as any,
      createDiagnostics() as any,
    );
    const item = createItem('ITEM_2', 'UNIT_1');

    coordinator.select({
      acpId: 'acp-1',
      perspective: 'read-only',
      item,
      itemList: [],
      reuseUnit: true,
    });

    expect(loader.load).not.toHaveBeenCalled();
    expect(coordinator.status).toEqual({ kind: 'ready', item });
  });

  it('continues without a response state but exposes unit-load failures as errors', () => {
    const item = createItem('ITEM_3', 'UNIT_3');
    const loader = {
      load: vi
        .fn()
        .mockReturnValueOnce(
          of({
            unit: { id: item.unitId },
            playerHtml: '<html></html>',
            definition: '{}',
            cacheStatus: 'miss',
          }),
        )
        .mockReturnValueOnce(throwError(() => ({ status: 403 }))),
      clear: vi.fn(),
    };
    const api = {
      getResponseStateWithFallback: vi.fn(() => throwError(() => new Error('state failed'))),
    };
    const coordinator = new ItemExplorerPreviewCoordinator(
      api as any,
      loader as any,
      createDiagnostics() as any,
    );
    const request = {
      acpId: 'acp-1',
      perspective: 'editor' as const,
      item,
      itemList: [],
      reuseUnit: false,
    };

    coordinator.select(request);
    expect(coordinator.status).toEqual({ kind: 'ready', item });

    coordinator.select(request);
    expect(coordinator.status).toEqual({
      kind: 'error',
      reason: 'Die Aufgaben-Vorschau ist für diese Ansicht nicht freigegeben.',
    });
  });
});
