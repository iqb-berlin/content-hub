import { afterEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import {
  ItemExplorerResponseStateContext,
  ItemExplorerResponseStateService,
} from './item-explorer-response-state.service';

function createService() {
  const mutation = new Subject<unknown>();
  const states = new Subject<any[]>();
  const api = {
    saveResponseState: vi.fn(() => mutation),
    deleteResponseState: vi.fn(() => mutation),
    getAllResponseStates: vi.fn(() => states),
  };
  const player = {
    sessionChanges$: new Subject<void>(),
    syntheticPreviewState: false,
    isAnswerSession: true,
    activePlayerSessionId: 'session' as string | null,
    responseSessionToken: {},
    currentResponseData: { answers: 'current' } as Record<string, unknown> | null,
    markResponseStateSaved: vi.fn(),
    clearResponseState: vi.fn(),
  };
  const context: ItemExplorerResponseStateContext = {
    acpId: 'package',
    selectedItem: { itemId: 'ITEM', unitId: 'UNIT', rowKey: 'row::1' } as any,
    isCorrectSolutionActive: false,
    previewReady: true,
  };
  const service = new ItemExplorerResponseStateService(api as any, player as any);
  service.connect(() => context);
  const closed = vi.fn();
  service.dialogClosed$.subscribe(closed);
  return { service, api, player, context, mutation, states, closed };
}

afterEach(() => vi.restoreAllMocks());

describe('response-state save rules', () => {
  it('opens confirmation for a loaded answer and saves its snapshot with the row identity', () => {
    const { service, api, player, mutation, closed } = createService();
    service.saveCurrentResponseState();
    expect(service.showSaveConfirmDialog).toBe(true);
    expect(service.confirmDialogError).toBe('');
    service.confirmSaveResponseState();
    expect(api.saveResponseState).toHaveBeenCalledWith(
      'package',
      'ITEM',
      'UNIT',
      { answers: 'current' },
      'row::1',
    );
    expect(service.confirmDialogState).toBe('saving');
    player.currentResponseData = { answers: 'new unsaved edit' };
    mutation.next({});
    expect(player.markResponseStateSaved).toHaveBeenCalledWith({ answers: 'current' });
    expect(service.confirmDialogState).toBe('idle');
    expect(service.showSaveConfirmDialog).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
  });

  it.each([
    ['synthetic', 'Vorschauzustand'],
    ['solution', 'Musterlösung'],
    ['loading', 'noch geladen'],
    ['no item', 'Kein Zustand'],
    ['no answers', 'Kein Zustand'],
  ])('explains why %s cannot be saved', (condition, message) => {
    const { service, api, player, context } = createService();
    if (condition === 'synthetic') player.syntheticPreviewState = true;
    if (condition === 'solution') context.isCorrectSolutionActive = true;
    if (condition === 'loading') context.previewReady = false;
    if (condition === 'no item') context.selectedItem = null;
    if (condition === 'no answers') player.currentResponseData = null;
    service.saveCurrentResponseState();
    expect(service.showSaveConfirmDialog).toBe(true);
    expect(service.confirmDialogError).toContain(message);
    service.confirmSaveResponseState();
    expect(api.saveResponseState).not.toHaveBeenCalled();
  });

  it.each(['no session', 'non-answer session'])('rejects confirmation with %s', (condition) => {
    const { service, api, player } = createService();
    if (condition === 'no session') player.activePlayerSessionId = null;
    else player.isAnswerSession = false;
    service.confirmSaveResponseState();
    expect(api.saveResponseState).not.toHaveBeenCalled();
    expect(service.confirmDialogError).toContain('nicht vollständig geladen');
  });

  it('rechecks the live context between opening and confirming the dialog', () => {
    const { service, api, context } = createService();
    service.saveCurrentResponseState();
    context.previewReady = false;
    service.confirmSaveResponseState();
    expect(api.saveResponseState).not.toHaveBeenCalled();
    expect(service.confirmDialogError).toContain('nicht vollständig geladen');
  });
});

describe('response-state mutation ownership', () => {
  it.each(['save', 'delete'] as const)(
    'retains the dialog after a current %s error',
    (operation) => {
      const { service, mutation, player, closed } = createService();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      if (operation === 'save') {
        service.saveCurrentResponseState();
        service.confirmSaveResponseState();
      } else {
        service.resetResponseState();
        service.confirmDeleteResponseState();
      }
      mutation.error(new Error('offline'));
      expect(service.confirmDialogState).toBe('idle');
      expect(service.confirmDialogError).toContain('Fehler');
      expect(
        operation === 'save' ? service.showSaveConfirmDialog : service.showDeleteConfirmDialog,
      ).toBe(true);
      expect(player.markResponseStateSaved).not.toHaveBeenCalled();
      expect(player.clearResponseState).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
    },
  );

  it('clears player data only when the current delete succeeds', () => {
    const { service, api, mutation, player, closed } = createService();
    service.resetResponseState();
    service.confirmDeleteResponseState();
    expect(api.deleteResponseState).toHaveBeenCalledWith('package', 'ITEM', 'UNIT', 'row::1');
    expect(service.confirmDialogState).toBe('deleting');
    expect(player.clearResponseState).not.toHaveBeenCalled();
    mutation.next({});
    expect(player.clearResponseState).toHaveBeenCalledOnce();
    expect(service.showDeleteConfirmDialog).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
  });

  it.each(['save', 'delete'] as const)(
    'ignores late %s success and errors after an item, session or package change',
    (operation) => {
      for (const change of ['item', 'session', 'package']) {
        for (const result of ['success', 'error']) {
          const { service, mutation, player, context, closed } = createService();
          if (operation === 'save') service.confirmSaveResponseState();
          else service.confirmDeleteResponseState();
          if (change === 'item') context.selectedItem = { ...context.selectedItem! };
          if (change === 'session') {
            player.responseSessionToken = {};
            player.sessionChanges$.next();
          }
          if (change === 'package') context.acpId = 'another package';
          service.confirmDialogError = 'new dialog';
          if (result === 'success') mutation.next({});
          else mutation.error(new Error('old request'));
          expect(player.markResponseStateSaved).not.toHaveBeenCalled();
          expect(player.clearResponseState).not.toHaveBeenCalled();
          expect(service.confirmDialogError).toBe('new dialog');
          expect(closed).not.toHaveBeenCalled();
          service.ngOnDestroy();
        }
      }
    },
  );

  it('resets confirmations on a player session change without requesting DOM focus', () => {
    const { service, player, closed } = createService();
    service.showSaveConfirmDialog = true;
    service.showDeleteConfirmDialog = true;
    service.confirmDialogError = 'old error';
    service.confirmDialogState = 'saving';
    player.sessionChanges$.next();
    expect(service.showSaveConfirmDialog).toBe(false);
    expect(service.showDeleteConfirmDialog).toBe(false);
    expect(service.confirmDialogError).toBe('');
    expect(service.confirmDialogState).toBe('idle');
    expect(closed).not.toHaveBeenCalled();
  });

  it('keeps busy dialogs open and requests focus restoration after closing an idle dialog', () => {
    const { service, closed } = createService();
    service.showSaveConfirmDialog = true;
    service.confirmDialogState = 'saving';
    service.closeSaveConfirmDialog();
    expect(service.showSaveConfirmDialog).toBe(true);
    service.confirmDialogState = 'idle';
    service.closeSaveConfirmDialog();
    expect(service.showSaveConfirmDialog).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
    service.showDeleteConfirmDialog = true;
    service.confirmDialogState = 'deleting';
    service.closeDeleteConfirmDialog();
    expect(service.showDeleteConfirmDialog).toBe(true);
    service.confirmDialogState = 'idle';
    service.closeDeleteConfirmDialog();
    expect(service.showDeleteConfirmDialog).toBe(false);
    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe('saved response list and lifecycle', () => {
  it('loads the package response list and requests focus restoration when it is closed', () => {
    const { service, api, states, closed } = createService();
    service.loadAllResponseStates();
    expect(api.getAllResponseStates).toHaveBeenCalledWith('package');
    states.next([{ id: 'state', responseData: { answers: 'saved' } }]);
    expect(service.allResponseStates).toEqual([
      { id: 'state', responseData: { answers: 'saved' } },
    ]);
    expect(service.showRawDataOverlay).toBe(true);
    service.closeRawDataOverlay();
    service.closeRawDataOverlay();
    expect(service.showRawDataOverlay).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('reports list failures to the UI without opening an overlay', () => {
    const { service, states } = createService();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = vi.fn();
    service.loadFailed$.subscribe(failed);
    service.loadAllResponseStates();
    states.error(new Error('offline'));
    expect(failed).toHaveBeenCalledOnce();
    expect(service.showRawDataOverlay).toBe(false);
  });

  it.each(['success', 'error'])('ignores list %s from an earlier package', (result) => {
    const { service, context, states } = createService();
    const failed = vi.fn();
    service.loadFailed$.subscribe(failed);
    service.loadAllResponseStates();
    context.acpId = 'another package';
    if (result === 'success') states.next([{ id: 'old state' }]);
    else states.error(new Error('old request'));
    expect(service.allResponseStates).toEqual([]);
    expect(service.showRawDataOverlay).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });

  it.each(['save', 'delete', 'list'] as const)(
    'cancels pending %s work on destroy',
    (operation) => {
      const { service, api, player, mutation, states, closed } = createService();
      const completed = vi.fn();
      service.dialogClosed$.subscribe({ complete: completed });
      if (operation === 'save') service.confirmSaveResponseState();
      else if (operation === 'delete') service.confirmDeleteResponseState();
      else service.loadAllResponseStates();
      service.ngOnDestroy();
      service.ngOnDestroy();
      expect(mutation.observed).toBe(false);
      expect(states.observed).toBe(false);
      expect(player.sessionChanges$.observed).toBe(false);
      expect(completed).toHaveBeenCalledOnce();
      mutation.next({});
      states.next([{ id: 'late state' }]);
      expect(player.markResponseStateSaved).not.toHaveBeenCalled();
      expect(player.clearResponseState).not.toHaveBeenCalled();
      expect(service.allResponseStates).toEqual([]);
      expect(closed).not.toHaveBeenCalled();
      api.saveResponseState.mockClear();
      api.deleteResponseState.mockClear();
      api.getAllResponseStates.mockClear();
      service.saveCurrentResponseState();
      service.confirmSaveResponseState();
      service.resetResponseState();
      service.confirmDeleteResponseState();
      service.loadAllResponseStates();
      expect(api.saveResponseState).not.toHaveBeenCalled();
      expect(api.deleteResponseState).not.toHaveBeenCalled();
      expect(api.getAllResponseStates).not.toHaveBeenCalled();
    },
  );

  it('does not start an action before the facade supplies its context', () => {
    const service = new ItemExplorerResponseStateService(
      {} as any,
      { sessionChanges$: of() } as any,
    );
    service.saveCurrentResponseState();
    service.confirmSaveResponseState();
    service.resetResponseState();
    service.confirmDeleteResponseState();
    service.loadAllResponseStates();
    expect(service.showSaveConfirmDialog).toBe(false);
    expect(service.showDeleteConfirmDialog).toBe(false);
    service.ngOnDestroy();
  });
});
