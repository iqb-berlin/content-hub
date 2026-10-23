import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ItemExplorerPlayerService,
  ItemExplorerPlayerStartRequest,
} from './item-explorer-player.service';
import { ItemExplorerPlayerDomPort } from './item-explorer.dom-ports';
import { VoudService } from '../../core/services/voud.service';

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
    expect(player.currentResponseData).toBeNull();
    expect((player as any).savedResponseData).toEqual({ answer: 'saved' });
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

  it('preserves edited saved answers across a frame restart and rejects the old session', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.applyResponseState({ answer: 'saved' });
    player.start(request);
    const sessionId = player.activePlayerSessionId;
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId,
        unitState: { dataParts: { answer: 'edited' } },
      },
      { ready: true, solutionActive: false },
    );
    player.onPagingModeChange();
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId,
        unitState: { dataParts: { answer: 'stale' } },
      },
      { ready: true, solutionActive: false },
    );
    vi.advanceTimersByTime(50);
    player.onPlayerLoaded();
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({ answer: 'edited' });
    expect(player.currentResponseData).toBeNull();
    player.ngOnDestroy();
  });

  it('keeps synthetic data unsaveable while a replacement frame loads', () => {
    vi.useFakeTimers();
    const { player, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      stateVariables: [{ id: 'context', alias: 'Context', value: '0' }],
      pages: [
        {
          sections: [
            {
              visibilityRules: [{ id: 'context', operator: '=', value: '2' }],
              elements: [{ alias: 'v' }],
            },
          ],
        },
      ],
    });
    player.start(request);
    player.onPagingModeChange();
    expect(player.syntheticPreviewState).toBe(true);
    expect(player.isAnswerSession).toBe(false);
    expect(player.activePlayerSessionId).toBeNull();
    player.ngOnDestroy();
  });

  it('replays the original page sequence, acknowledges string page IDs and cancels stale work', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      stateVariables: [{ id: 's', value: '0' }],
      pages: [
        {
          alwaysVisible: true,
          sections: [
            {
              elements: [
                {
                  type: 'trigger',
                  action: 'stateVariableChange',
                  actionParam: { id: 's', value: '1' },
                },
              ],
            },
          ],
        },
        { sections: [{ elements: [{ alias: 'intro' }] }] },
        {
          sections: [
            {
              visibilityRules: [{ id: 's', operator: '=', value: '1' }],
              elements: [
                {
                  type: 'trigger',
                  action: 'stateVariableChange',
                  actionParam: { id: 's', value: '2' },
                },
              ],
            },
            {
              visibilityRules: [{ id: 's', operator: '=', value: '2' }],
              elements: [{ alias: 'v' }],
            },
          ],
        },
      ],
    });
    expect(player.start(request)).toEqual({ kind: 'started' });
    const sessionId = player.activePlayerSessionId;
    expect(player.preparingPresentation).toBe(true);
    player.handlePlayerMessage(
      { type: 'vopStateChangedNotification', sessionId, playerState: { currentPage: '0' } },
      { ready: true, solutionActive: false },
    );
    vi.advanceTimersByTime(180);
    expect(dom.postMessage).toHaveBeenLastCalledWith({
      type: 'vopPageNavigationCommand',
      sessionId,
      target: '1',
    });
    player.handlePlayerMessage(
      { type: 'vopStateChangedNotification', sessionId, playerState: { currentPage: '1' } },
      { ready: true, solutionActive: false },
    );
    vi.advanceTimersByTime(180);
    expect(player.currentPage).toBe(2);
    expect(player.preparingPresentation).toBe(false);
    player.start(request);
    player.beginSelection();
    const calls = dom.postMessage.mock.calls.length;
    vi.runAllTimers();
    expect(dom.postMessage).toHaveBeenCalledTimes(calls);
    player.ngOnDestroy();
  });

  it('keeps reference, stored answers and captured contexts separate', () => {
    vi.useFakeTimers();
    const { player, dom, request, voud } = createPlayer();
    voud.resolvePlayerTargetLocation.mockReturnValue({ absolutePageIndex: 0, scrollPageIndex: 0 });
    Object.assign(dom, { isTargetVisible: vi.fn(() => true) });
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [{ sections: [{ elements: [{ alias: 'v' }] }] }],
    });
    player.applyResponseState({ elementCodes: '[{"id":"saved","value":1}]' }, true);
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({});
    expect(player.syntheticPreviewState).toBe(true);
    player.changePreviewMode('answers');
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({
      elementCodes: '[{"id":"saved","value":1}]',
    });
    expect(player.isAnswerSession).toBe(true);
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '0' },
        unitState: { dataParts: { elementCodes: '[{"id":"edited","value":2}]' } },
      },
      { ready: true, solutionActive: false },
    );
    const context = player.capturePreviewContext({ item: request.item, target: request.target });
    expect(context).toMatchObject({
      target: 'v',
      page: 0,
      dataParts: { elementCodes: '[{"id":"edited","value":2}]' },
    });
    player.changePreviewMode('reference');
    player.start({
      ...request,
      item: { ...request.item, previewStart: { values: {}, context: context! } },
    });
    expect(player.syntheticPreviewState).toBe(true);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(context!.dataParts);
    player.changePreviewMode('answers');
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(context!.dataParts);
    player.ngOnDestroy();
  });

  it('rejects a visible context until the player confirms the latest input', () => {
    vi.useFakeTimers();
    const { player, dom, request, voud } = createPlayer();
    voud.resolvePlayerTargetLocation.mockReturnValue({ absolutePageIndex: 0, scrollPageIndex: 0 });
    const changedAt = vi.fn(() => 100);
    Object.assign(dom, { isTargetVisible: () => true, getLastInteractionTime: changedAt });
    player.definitionContent = JSON.stringify({
      pages: [{ sections: [{ elements: [{ alias: 'v' }] }] }],
    });
    player.start(request);
    const respond = (timeStamp: number, value: string, sessionId = player.activePlayerSessionId) =>
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId,
          timeStamp,
          unitState: { dataParts: { elementCodes: JSON.stringify([{ id: 'gate', value }]) } },
        },
        { ready: true, solutionActive: false },
      );
    respond(90, '');
    expect(player.hasCurrentResponseState).toBe(false);
    expect(player.capturePreviewContext(request)).toBeNull();
    // Receipt after the input is insufficient, including a timestamp in the same millisecond.
    respond(100, '');
    expect(player.capturePreviewContext(request)).toBeNull();
    respond(110, 'stale session', 'other');
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        timeStamp: 115,
        playerState: { currentPage: 0 },
      },
      { ready: true, solutionActive: false },
    );
    expect(player.capturePreviewContext(request)).toBeNull();
    respond(120, 'open');
    expect(player.hasCurrentResponseState).toBe(true);
    expect(player.capturePreviewContext(request)?.dataParts).toEqual({
      elementCodes: JSON.stringify([{ id: 'gate', value: 'open' }]),
    });
    changedAt.mockReturnValue(130);
    expect(player.capturePreviewContext(request)).toBeNull();
    player.beginSelection();
    expect(player.hasCurrentResponseState).toBe(false);
    player.ngOnDestroy();
  });

  it('opens the original flow for an unmapped item without guessing a target', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.changePreviewMode('flow');
    expect(player.start({ ...request, target: '' })).toEqual({ kind: 'started' });
    expect(dom.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      playerConfig: { startPage: '0' },
      unitState: { dataParts: {} },
    });
    expect(player.capturePreviewContext({ item: request.item, target: '' })).toBeNull();
    player.ngOnDestroy();
  });

  it('rejects a context from an ID/alias collision and captures only the resolved item', () => {
    vi.useFakeTimers();
    const { player, dom, request, voud } = createPlayer();
    const resolver = new VoudService();
    voud.resolvePlayerTargetLocation.mockImplementation(
      (...args: unknown[]) =>
        resolver.resolvePlayerTargetLocation(args[0] as string, args[1] as string) as any,
    );
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [
        { sections: [{ elements: [{ id: 'other', alias: '04' }] }] },
        { sections: [{ elements: [{ id: '04', alias: '05' }] }] },
      ],
    });
    const root = document.createElement('div');
    root.innerHTML =
      '<div data-element-id="other" data-element-alias="04"></div>' +
      '<div data-element-id="04" data-element-alias="05" hidden></div>';
    const isTargetVisible = (selectors: string[]) =>
      selectors.some((selector) => {
        const element = root.querySelector<HTMLElement>(selector);
        return !!element && !element.hidden;
      });
    Object.assign(dom, { isTargetVisible });
    const selected = { ...request, target: '05' };
    player.changePreviewMode('flow');
    player.start(selected);
    const dataParts = { elementCodes: '[]' };
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '0' },
        unitState: { dataParts },
      },
      { ready: true, solutionActive: false },
    );
    expect(player.capturePreviewContext(selected)).toBeNull();
    // Even a stale page report on the target page cannot validate the wrong visible element.
    player.currentPage = 2;
    expect(player.capturePreviewContext(selected)).toBeNull();
    root.children[0].setAttribute('hidden', '');
    root.children[1].removeAttribute('hidden');
    player.currentPage = 1;
    expect(player.capturePreviewContext(selected)).toBeNull();
    player.currentPage = 2;
    const context = player.capturePreviewContext(selected);
    expect(context).toMatchObject({ target: '05', page: 1, dataParts });
    player.changePreviewMode('reference');
    expect(
      player.start({
        ...selected,
        item: { ...request.item, previewStart: { values: {}, context: context! } },
      }),
    ).toEqual({ kind: 'started' });
    player.ngOnDestroy();
  });

  it('retains newer edits after returning to answers and restarting the frame', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [{ sections: [{ elements: [{ alias: 'v' }] }] }],
    });
    player.changePreviewMode('answers');
    player.start(request);
    const respond = (value: string, sessionId = player.activePlayerSessionId) =>
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId,
          unitState: { dataParts: { elementCodes: value } },
        },
        { ready: true, solutionActive: false },
      );
    const first = '[{"id":"v","value":"first input"}]';
    const edited = '[{"id":"v","value":"new input"}]';
    respond(first);
    player.changePreviewMode('reference');
    player.start(request);
    player.changePreviewMode('answers');
    player.start(request);
    respond(edited);
    const oldSession = player.activePlayerSessionId;
    player.onPagingModeChange();
    vi.advanceTimersByTime(50);
    player.onPlayerLoaded();
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({
      elementCodes: edited,
    });
    respond(first, oldSession);
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({
      elementCodes: edited,
    });
    player.ngOnDestroy();
  });

  it('retains the latest answers when changing view before the recreated frame reports', () => {
    vi.useFakeTimers();
    const { player, dom, request, voud } = createPlayer();
    voud.resolvePlayerTargetLocation.mockReturnValue({ absolutePageIndex: 0, scrollPageIndex: 0 });
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [{ sections: [{ elements: [{ id: 'v', alias: 'v', type: 'text-area' }] }] }],
    });
    const response = (value: string) => ({
      elementCodes: JSON.stringify([{ id: 'v', status: 'VALUE_CHANGED', value }]),
    });
    const report = (value: string) =>
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId: player.activePlayerSessionId,
          unitState: { dataParts: response(value) },
        },
        { ready: true, solutionActive: false },
      );
    try {
      player.applyResponseState(response('saved'));
      player.changePreviewMode('answers');
      player.start(request);
      report('first edit');
      // Retain an older answer cache before receiving the latest edit.
      player.changePreviewMode('reference');
      player.start(request);
      player.changePreviewMode('answers');
      player.start(request);
      report('latest edit');

      player.onPagingModeChange();
      vi.advanceTimersByTime(50);
      player.onPlayerLoaded();
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(
        response('latest edit'),
      );
      expect(player.currentResponseData).toBeNull();

      // Neither a restored-session report nor a solution snapshot may refresh the cache.
      player.changePreviewMode('reference');
      player.start(request);
      player.changePreviewMode('answers');
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(
        response('latest edit'),
      );
      expect(player.isAnswerSession).toBe(true);
    } finally {
      player.ngOnDestroy();
    }
  });

  it.each([
    ['while showing the solution', false],
    ['immediately after hiding the solution before its first report', true],
  ])('retains the latest answers when changing view %s', (_label, restoreFirst) => {
    vi.useFakeTimers();
    const { player, dom, request, voud } = createPlayer();
    voud.resolvePlayerTargetLocation.mockReturnValue({ absolutePageIndex: 0, scrollPageIndex: 0 });
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [{ sections: [{ elements: [{ id: 'v', alias: 'v', type: 'text-area' }] }] }],
    });
    const response = (value: string) => ({
      elementCodes: JSON.stringify([{ id: 'v', status: 'VALUE_CHANGED', value }]),
    });
    const report = (value: string, sessionId = player.activePlayerSessionId) =>
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId,
          unitState: { dataParts: response(value) },
        },
        { ready: true, solutionActive: false },
      );
    try {
      player.applyResponseState(response('saved'));
      player.changePreviewMode('answers');
      player.start(request);
      report('first edit');
      player.changePreviewMode('reference');
      player.start(request);
      player.changePreviewMode('answers');
      player.start(request);
      report('latest edit');
      player.captureAnswersForSolution();
      player.start({
        ...request,
        solution: {
          status: 'available',
          message: '',
          responses: [{ id: 'v', status: 'VALUE_CHANGED', value: 'solution' }],
        },
      });
      const solutionSession = player.activePlayerSessionId;
      report('solution');
      if (restoreFirst) player.start(request);
      // No response from the restored answer session has arrived at this point.
      player.changePreviewMode('reference');
      player.start(request);
      report('reference-only');
      player.changePreviewMode('answers');
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(
        response('latest edit'),
      );
      expect(player.isAnswerSession).toBe(true);
      report('stale solution', solutionSession);
      expect(player.currentResponseData).toBeNull();
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(
        response('latest edit'),
      );
      // A further view change before any answer report must retain the initial snapshot too.
      player.changePreviewMode('reference');
      player.start(request);
      player.changePreviewMode('answers');
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(
        response('latest edit'),
      );
    } finally {
      player.ngOnDestroy();
    }
  });

  it('preserves flow inputs and its page across solution toggles and frame recreation', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.applyResponseState({ elementCodes: '[{"id":"v","value":"stored"}]' });
    player.changePreviewMode('flow');
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({});
    const dataParts = {
      elementCodes: '[{"id":"v","status":"VALUE_CHANGED","value":"real input"}]',
    };
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '2' },
        unitState: { dataParts },
      },
      { ready: true, solutionActive: false },
    );
    const solution = {
      status: 'available' as const,
      message: '',
      responses: [{ id: 'v', status: 'VALUE_CHANGED' as const, value: 'solution' }],
    };
    for (let i = 0; i < 2; i++) {
      player.captureAnswersForSolution();
      player.start({ ...request, solution });
      player.handlePlayerMessage(
        {
          type: 'vopStateChangedNotification',
          sessionId: player.activePlayerSessionId,
          playerState: { currentPage: '0' },
        },
        { ready: true, solutionActive: true },
      );
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0]).toMatchObject({
        unitState: { dataParts },
        playerConfig: { startPage: '2' },
      });
    }
    player.onPagingModeChange();
    vi.advanceTimersByTime(50);
    player.onPlayerLoaded();
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      unitState: { dataParts },
      playerConfig: { startPage: '2' },
    });
    // Entering flow again is an explicit fresh start, independent of stored answers.
    player.changePreviewMode('reference');
    player.changePreviewMode('flow');
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      unitState: { dataParts: {} },
      playerConfig: { startPage: '0' },
    });
    player.ngOnDestroy();
  });

  it('does not import saved answers into an empty flow when toggling the solution before a report', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.applyResponseState({ elementCodes: '[{"id":"v","value":"stored"}]' });
    player.changePreviewMode('flow');
    player.start(request);
    player.captureAnswersForSolution();
    player.start({ ...request, solution: { status: 'available', message: '', responses: [] } });
    player.start(request);
    expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual({});
    player.ngOnDestroy();
  });

  it('prepares viewport triggers and focuses a target on page zero without navigation', async () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    const preparePage = vi.fn(async () => {});
    Object.assign(dom, { preparePage });
    dom.focus.mockReturnValue(true);
    player.itemExplorerConditionalVisibilityEnabled = true;
    const rule = (value: string) => [{ id: 's', operator: '=', value }];
    const trigger = (id: string, value: string) => ({
      type: 'trigger',
      id,
      action: 'stateVariableChange',
      actionParam: { id: 's', value },
    });
    player.definitionContent = JSON.stringify({
      stateVariables: [{ id: 's', value: '0' }],
      pages: [
        {
          sections: [
            { elements: [trigger('initial', '1')] },
            { visibilityRules: rule('1'), elements: [trigger('open', '2')] },
            { visibilityRules: rule('2'), elements: [{ alias: 'v' }] },
          ],
        },
      ],
    });
    player.start(request);
    expect(player.preparingPresentation).toBe(true);
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '0' },
      },
      { ready: true, solutionActive: false },
    );
    await vi.runAllTimersAsync();
    expect(preparePage).toHaveBeenCalledExactlyOnceWith(
      ['initial', 'open'],
      expect.any(AbortSignal),
    );
    expect(dom.focus).toHaveBeenCalledOnce();
    expect(dom.postMessage).toHaveBeenCalledOnce();
    expect(player.preparingPresentation).toBe(false);
    player.ngOnDestroy();
  });

  it('bounds replay attempts when the player never acknowledges navigation', () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [
        { sections: [{ elements: [{ type: 'audio', id: 'media', alias: 'media' }] }] },
        {
          sections: [
            {
              enableReHide: true,
              visibilityRules: [{ id: 'media', operator: '>', value: '0' }],
              elements: [{ alias: 'v' }],
            },
          ],
        },
      ],
    });
    player.start(request);
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '0' },
      },
      { ready: true, solutionActive: false },
    );
    vi.runAllTimers();
    expect(player.preparingPresentation).toBe(false);
    expect(player.presentationMessage).toContain('nicht vollständig');
    expect(
      dom.postMessage.mock.calls.filter(([message]) => message.type === 'vopPageNavigationCommand'),
    ).toHaveLength(4);
    player.ngOnDestroy();
  });

  it('aborts pending viewport preparation when another item is selected', async () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    let finish!: () => void;
    const preparePage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.assign(dom, { preparePage });
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      stateVariables: [{ id: 's', value: '0' }],
      pages: [
        {
          alwaysVisible: true,
          sections: [
            {
              elements: [
                {
                  type: 'trigger',
                  id: 'initial',
                  action: 'stateVariableChange',
                  actionParam: { id: 's', value: '1' },
                },
              ],
            },
          ],
        },
        { sections: [{ elements: [{ alias: 'intro' }] }] },
        {
          sections: [
            {
              visibilityRules: [{ id: 's', operator: '=', value: '1' }],
              elements: [
                {
                  type: 'trigger',
                  id: 'open',
                  action: 'stateVariableChange',
                  actionParam: { id: 's', value: '2' },
                },
              ],
            },
            {
              visibilityRules: [{ id: 's', operator: '=', value: '2' }],
              elements: [{ alias: 'v' }],
            },
          ],
        },
      ],
    });
    player.start(request);
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '0' },
      },
      { ready: true, solutionActive: false },
    );
    expect(preparePage).toHaveBeenCalledOnce();
    const signal = (preparePage.mock.calls[0] as unknown as [string[], AbortSignal])[1];
    player.beginSelection();
    expect(signal.aborted).toBe(true);
    finish();
    await vi.runAllTimersAsync();
    expect(dom.postMessage).toHaveBeenCalledOnce();
    expect(player.activePlayerSessionId).toBeNull();
    player.ngOnDestroy();
  });

  it('stops replay when viewport preparation fails and cancels a detached frame', async () => {
    vi.useFakeTimers();
    const { player, dom, request } = createPlayer();
    Object.assign(dom, {
      preparePage: vi.fn(async () => {
        throw new Error('frame unavailable');
      }),
    });
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      stateVariables: [{ id: 's', value: '0' }],
      pages: [
        {
          sections: [
            {
              elements: [
                { type: 'audio', id: 'audio', alias: 'audio' },
                {
                  type: 'trigger',
                  id: 'initial',
                  action: 'stateVariableChange',
                  actionParam: { id: 's', value: '1' },
                },
              ],
            },
          ],
        },
        {
          sections: [
            {
              enableReHide: true,
              visibilityRules: [{ id: 'audio', operator: '>', value: '0' }],
              elements: [{ alias: 'v' }],
            },
          ],
        },
      ],
    });
    player.start(request);
    player.handlePlayerMessage(
      {
        type: 'vopStateChangedNotification',
        sessionId: player.activePlayerSessionId,
        playerState: { currentPage: '0' },
      },
      { ready: true, solutionActive: false },
    );
    await vi.runAllTimersAsync();
    expect(player.preparingPresentation).toBe(false);
    expect(player.presentationMessage).toContain('regulären Aufgabenablauf');
    expect(dom.postMessage).toHaveBeenCalledOnce();
    player.playerFrameChanged(false);
    expect(player.activePlayerSessionId).toBeNull();
    expect(player.playerFrameReady).toBe(false);
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

  it('uses reloaded saved answers instead of an older answer view cache', () => {
    vi.useFakeTimers();
    const { player, dom, request, voud } = createPlayer();
    voud.resolvePlayerTargetLocation.mockReturnValue({ absolutePageIndex: 0, scrollPageIndex: 0 });
    player.itemExplorerConditionalVisibilityEnabled = true;
    player.definitionContent = JSON.stringify({
      pages: [{ sections: [{ elements: [{ id: 'v', alias: 'v' }] }] }],
    });
    const response = (value: string) => ({
      elementCodes: JSON.stringify([{ id: 'v', status: 'VALUE_CHANGED', value }]),
    });
    try {
      player.applyResponseState(response('old saved answer'));
      player.changePreviewMode('answers');
      player.start(request);
      player.changePreviewMode('reference');
      player.start(request);
      player.applyResponseState(response('new saved answer'));
      player.changePreviewMode('answers');
      player.start(request);
      expect(dom.postMessage.mock.calls.at(-1)![0].unitState.dataParts).toEqual(
        response('new saved answer'),
      );
    } finally {
      player.ngOnDestroy();
    }
  });

  it('updates the available visibility configuration when the task definition changes', () => {
    const { player } = createPlayer();
    player.definitionContent = JSON.stringify({
      pages: [],
      stateVariables: [{ id: 'context-a', alias: 'Context A', value: '1' }],
    });
    expect(player.previewDefinition?.stateVariables?.map((v) => v.id)).toEqual(['context-a']);
    player.definitionContent = JSON.stringify({
      pages: [],
      stateVariables: [{ id: 'context-b', alias: 'Context B', value: '2' }],
    });
    expect(player.previewDefinition?.stateVariables?.map((v) => v.id)).toEqual(['context-b']);
    player.reset();
    expect(player.previewDefinition).toBeNull();
    player.ngOnDestroy();
  });
});
