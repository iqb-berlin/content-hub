import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ItemExplorerPlayerService,
  ItemExplorerPlayerStartRequest,
} from './item-explorer-player.service';
import { ItemExplorerPlayerDomPort } from './item-explorer.dom-ports';

function createPlayer() {
  const voud = {
    resolvePlayerTargetLocation: vi.fn(() => ({ absolutePageIndex: 2, scrollPageIndex: 2 })),
    stripConditionalVisibility: vi.fn((definition: string) => definition),
    getFocusIdentifiers: vi.fn((_definition: string, target: string) => [target]),
  };
  const player = new ItemExplorerPlayerService(voud as any);
  const dom = {
    hasFrame: vi.fn(() => true),
    postMessage: vi.fn<(message: any) => void>(),
    focus: vi.fn(() => false),
    setPrintLabelOverrides: vi.fn(),
    startAutoResize: vi.fn<(callback: (height: number) => void) => void>(),
    stopAutoResize: vi.fn(),
  } satisfies ItemExplorerPlayerDomPort;
  player.registerPlayerDom(dom);
  player.applyAssets({ unit: { id: 'u' }, srcDoc: '<html></html>', definition: '{}' });
  player.onPlayerLoaded();
  const request: ItemExplorerPlayerStartRequest = {
    item: {
      uuid: 'uuid',
      rowKey: 'row',
      itemId: 'i',
      unitId: 'u',
      unitLabel: 'U',
      description: '',
      variableId: 'v',
      metadata: {},
    },
    rowKey: 'row-1',
    target: 'v',
    printLabels: {},
    solution: null,
  };
  return { player, dom, request, voud };
}

describe('ItemExplorerPlayerService', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts responses only from the active, ready session and preserves responses during solution preview', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.start(request);
    const sessionId = dom.postMessage.mock.calls[0][0].sessionId;
    const message = {
      type: 'vopStateChangedNotification',
      sessionId,
      playerState: { currentPage: 2, validPages: [0, 1, 2] },
      unitState: { dataParts: { answer: 'new' } },
    };
    player.applyResponseState({ answer: 'saved' });
    player.handlePlayerMessage(
      { ...message, sessionId: 'stale' },
      { ready: true, solutionActive: false },
    );
    player.handlePlayerMessage(message, { ready: false, solutionActive: false });
    player.handlePlayerMessage(message, { ready: true, solutionActive: true });
    expect(player.currentResponseData).toEqual({ answer: 'saved' });
    player.handlePlayerMessage(message, { ready: true, solutionActive: false });
    expect(player.currentResponseData).toEqual({ answer: 'new' });
    expect(player.currentPage).toBe(3);
    expect(player.totalPages).toBe(3);
    player.ngOnDestroy();
  });

  it('cancels navigation and focus work when selection changes within a loaded unit', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.start(request);
    player.beginSelection(true);
    vi.runAllTimers();
    expect(dom.postMessage).toHaveBeenCalledOnce();
    expect(dom.focus).not.toHaveBeenCalled();
    expect(player.activePlayerSessionId).toBeNull();
    expect(player.currentPage).toBe(1);
    expect(player.definitionContent).toBe('{}');
    player.ngOnDestroy();
  });

  it('cancels frame recreation and rejects late resize callbacks and messages after destruction', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.pagingMode = 'view-all';
    player.start(request);
    const resize = dom.startAutoResize.mock.calls[0][0];
    player.onPagingModeChange();
    player.ngOnDestroy();
    player.ngOnDestroy();
    const height = player.playerHeight;
    resize(900);
    player.handlePlayerMessage(
      { type: 'vopResizeNotification', height: 1000 },
      { ready: true, solutionActive: false },
    );
    player.applyAssets({ unit: { id: 'late' }, srcDoc: 'late', definition: 'late' });
    vi.runAllTimers();
    expect(player.playerHeight).toBe(height);
    expect(player.playerSrcDoc).toBeNull();
    expect(player.unit).toBeNull();
    expect(dom.postMessage).toHaveBeenCalledOnce();
    expect(dom.focus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let an old DOM port detach a replacement frame', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    const replacement = { ...dom, postMessage: vi.fn() };
    player.registerPlayerDom(replacement);
    player.unregisterPlayerDom(dom);
    expect(player.start(request)).toEqual({ kind: 'started' });
    expect(replacement.postMessage).toHaveBeenCalledOnce();
    expect(dom.postMessage).not.toHaveBeenCalled();
    player.unregisterPlayerDom(replacement);
    vi.runAllTimers();
    expect(replacement.postMessage).toHaveBeenCalledOnce();
    player.ngOnDestroy();
  });

  it('returns unavailable targets without starting a session', () => {
    const { player, dom, request, voud } = createPlayer();
    voud.resolvePlayerTargetLocation.mockReturnValue(undefined as any);
    expect(player.start(request)).toEqual({ kind: 'unavailable', reason: 'unresolved-target' });
    expect(player.start({ ...request, target: '' })).toEqual({
      kind: 'unavailable',
      reason: 'missing-target',
    });
    expect(dom.postMessage).not.toHaveBeenCalled();
    player.ngOnDestroy();
  });
});
