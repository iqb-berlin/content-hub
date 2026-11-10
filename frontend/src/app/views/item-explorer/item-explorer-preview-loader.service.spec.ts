import { firstValueFrom, Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemExplorerPreviewLoader } from './item-explorer-preview-loader.service';

describe('ItemExplorerPreviewLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates in-flight unit and asset requests and replays the completed result', async () => {
    const unitView$ = new Subject<any>();
    const api = {
      getFileUnitView: vi.fn(() => unitView$),
      appendAuthToken: vi.fn((url: string) => url),
    };
    const diagnostics = {
      start: vi.fn((phase: string) => ({ phase })),
      finish: vi.fn(),
    };
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => (url.includes('player') ? '<html>player</html>' : '{"pages":[]}'),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const loader = new ItemExplorerPreviewLoader(api as any, diagnostics as any);

    const first = firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'));
    const second = firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'));
    unitView$.next({
      id: 'UNIT_1',
      dependencies: [
        { type: 'PLAYER', fileId: 'player-1', downloadUrl: '/player' },
        { type: 'UNIT_DEFINITION', fileId: 'definition-1', downloadUrl: '/definition' },
      ],
    });
    unitView$.complete();

    await expect(first).resolves.toEqual(
      expect.objectContaining({
        playerHtml: '<html>player</html>',
        definition: '{"pages":[]}',
      }),
    );
    await expect(second).resolves.toEqual(expect.objectContaining({ cacheStatus: 'coalesced' }));

    await expect(firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'))).resolves.toEqual(
      expect.objectContaining({ cacheStatus: 'hit' }),
    );
    expect(api.getFileUnitView).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retain failed asset requests', async () => {
    const api = {
      getFileUnitView: vi.fn(() =>
        of({
          id: 'UNIT_1',
          dependencies: [{ type: 'PLAYER', fileId: 'player-1', downloadUrl: '/player' }],
        }),
      ),
      appendAuthToken: vi.fn((url: string) => url),
    };
    const diagnostics = {
      start: vi.fn((phase: string) => ({ phase })),
      finish: vi.fn(),
    };
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
    const loader = new ItemExplorerPreviewLoader(api as any, diagnostics as any);

    await expect(firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'))).rejects.toThrow();
    await expect(firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retain unit results with missing dependencies', async () => {
    const api = {
      getFileUnitView: vi.fn(() =>
        of({
          id: 'UNIT_1',
          dependencies: [{ type: 'PLAYER', fileId: 'player-1', downloadUrl: '/player' }],
        }),
      ),
      appendAuthToken: vi.fn((url: string) => url),
    };
    const diagnostics = {
      start: vi.fn((phase: string) => ({ phase })),
      finish: vi.fn(),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>player</html>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const loader = new ItemExplorerPreviewLoader(api as any, diagnostics as any);

    await expect(firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'))).resolves.toEqual(
      expect.objectContaining({ definition: null }),
    );
    await expect(firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'))).resolves.toEqual(
      expect.objectContaining({ definition: null, cacheStatus: 'miss' }),
    );

    expect(api.getFileUnitView).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels and removes an abandoned unit-view request', async () => {
    const teardown = vi.fn();
    const api = {
      getFileUnitView: vi.fn(
        () =>
          new Observable<any>(() => {
            return teardown;
          }),
      ),
      appendAuthToken: vi.fn((url: string) => url),
    };
    const diagnostics = {
      start: vi.fn((phase: string) => ({ phase })),
      finish: vi.fn(),
    };
    const loader = new ItemExplorerPreviewLoader(api as any, diagnostics as any);

    const first = loader.load('ap-1', 'editor', 'UNIT_1').subscribe();
    first.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = loader.load('ap-1', 'editor', 'UNIT_1').subscribe();
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(api.getFileUnitView).toHaveBeenCalledTimes(2);
    second.unsubscribe();
  });

  it('keeps an in-flight unit request across a synchronous same-key hand-off', async () => {
    let sourceSubscriber: any;
    let sourceSubscriptions = 0;
    const teardown = vi.fn();
    const unitView$ = new Observable<any>((subscriber) => {
      sourceSubscriptions += 1;
      sourceSubscriber = subscriber;
      return teardown;
    });
    const api = {
      getFileUnitView: vi.fn(() => unitView$),
      appendAuthToken: vi.fn((url: string) => url),
    };
    const diagnostics = {
      start: vi.fn((phase: string) => ({ phase })),
      finish: vi.fn(),
    };
    const loader = new ItemExplorerPreviewLoader(api as any, diagnostics as any);

    const first = loader.load('ap-1', 'editor', 'UNIT_1').subscribe();
    first.unsubscribe();
    const second = firstValueFrom(loader.load('ap-1', 'editor', 'UNIT_1'));

    expect(sourceSubscriptions).toBe(1);
    expect(teardown).not.toHaveBeenCalled();
    sourceSubscriber.next(null);
    sourceSubscriber.complete();
    await expect(second).resolves.toEqual(expect.objectContaining({ cacheStatus: 'coalesced' }));
  });

  it('aborts abandoned player and definition downloads', async () => {
    const api = {
      getFileUnitView: vi.fn(() =>
        of({
          id: 'UNIT_1',
          dependencies: [
            { type: 'PLAYER', fileId: 'player-1', downloadUrl: '/player' },
            {
              type: 'UNIT_DEFINITION',
              fileId: 'definition-1',
              downloadUrl: '/definition',
            },
          ],
        }),
      ),
      appendAuthToken: vi.fn((url: string) => url),
    };
    const diagnostics = {
      start: vi.fn((phase: string) => ({ phase })),
      finish: vi.fn(),
    };
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const loader = new ItemExplorerPreviewLoader(api as any, diagnostics as any);

    const subscription = loader.load('ap-1', 'editor', 'UNIT_1').subscribe();
    subscription.unsubscribe();
    await vi.waitFor(() => {
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });
  });
});
