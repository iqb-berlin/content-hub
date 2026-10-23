import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { ItemExplorerDraftService } from './item-explorer-draft.service';
import { ItemExplorerStateEnvelope } from '../../core/models/api.models';

function envelope(version: number, status = 'DIRTY'): ItemExplorerStateEnvelope {
  return {
    version,
    publishedVersion: 1,
    status,
    canEdit: true,
    canPublish: true,
    draftState: {},
    publishedState: {},
    updatedAt: '2026-09-22T12:00:00Z',
  } as ItemExplorerStateEnvelope;
}

describe('ItemExplorerDraftService', () => {
  let service: ItemExplorerDraftService;
  let api: {
    patchItemExplorerDraft: ReturnType<typeof vi.fn>;
    saveItemExplorerDraft: ReturnType<typeof vi.fn>;
    discardItemExplorerDraft: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      patchItemExplorerDraft: vi.fn().mockReturnValue(of(envelope(2))),
      saveItemExplorerDraft: vi.fn().mockReturnValue(of(envelope(3, 'CLEAN'))),
      discardItemExplorerDraft: vi.fn().mockReturnValue(of(envelope(3, 'CLEAN'))),
    };
    service = new ItemExplorerDraftService(api as any);
    service.configure({ acpId: 'a', canEdit: true, canPublish: true });
    service.acceptEnvelope(envelope(1, 'CLEAN'));
  });
  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
  });

  it('merges UI and per-item changes and requests one debounced flush', async () => {
    const flush = vi.fn();
    service.flushRequested$.subscribe(flush);
    service.queueDraftPatch('UI_UPDATE', {
      ui: { sortField: 'a' },
      itemPropertiesPatch: { row: { excluded: true } },
    });
    service.queueDraftPatch('ITEM_UPDATE', {
      ui: { filterText: 'b' },
      itemPropertiesPatch: { row: { previewTargetId: 'x' } },
    });
    vi.advanceTimersByTime(249);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    await service.flushDraftPatch();
    expect(api.patchItemExplorerDraft).toHaveBeenCalledWith('a', {
      baseVersion: 1,
      changeType: 'ITEM_UPDATE',
      patch: {
        ui: { sortField: 'a', filterText: 'b' },
        itemPropertiesPatch: { row: { excluded: true, previewTargetId: 'x' } },
      },
    });
  });

  it('shares the running flush and serializes newer changes using the returned version', async () => {
    const first = new Subject<ItemExplorerStateEnvelope>();
    const second = new Subject<ItemExplorerStateEnvelope>();
    api.patchItemExplorerDraft.mockReturnValueOnce(first).mockReturnValueOnce(second);
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'first' } });
    const flushed = service.flushDraftPatch();
    expect(service.flushDraftPatch()).toBe(flushed);
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'second' } });
    first.next(envelope(2));
    await vi.waitFor(() => expect(api.patchItemExplorerDraft).toHaveBeenCalledTimes(2));
    expect(api.patchItemExplorerDraft.mock.calls[1][1].baseVersion).toBe(2);
    expect(service.canApplyEnvelope(service.latestExplorerState!)).toBe(false);
    second.next(envelope(3));
    expect(await flushed).toMatchObject({ kind: 'applied', envelope: { version: 3 } });
  });

  it('rejects an old envelope when another edit was queued before it could be applied', async () => {
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'first' } });
    const result = await service.flushDraftPatch();
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'newer' } });
    expect(result.kind).toBe('applied');
    if (result.kind === 'applied') expect(service.canApplyEnvelope(result.envelope)).toBe(false);
  });

  it('waits for the active patch before discard and blocks new patches until coordination finishes', async () => {
    const patch = new Subject<ItemExplorerStateEnvelope>();
    api.patchItemExplorerDraft.mockReturnValueOnce(patch);
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'first' } });
    const flushed = service.flushDraftPatch();
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'pending' } });
    const discarded = service.discardExplorerDraft();
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'blocked' } });
    expect(api.discardItemExplorerDraft).not.toHaveBeenCalled();
    patch.next(envelope(7));
    expect(await flushed).toEqual({ kind: 'cancelled' });
    expect(await discarded).toMatchObject({ kind: 'applied' });
    expect(api.discardItemExplorerDraft).toHaveBeenCalledWith('a', 7);
    expect(api.patchItemExplorerDraft).toHaveBeenCalledTimes(1);
    expect(service.discarding).toBe(true);
    service.finishOperation();
    expect(service.discarding).toBe(false);
  });

  it('returns a conflict from a running patch instead of discarding with an obsolete version', async () => {
    const patch = new Subject<ItemExplorerStateEnvelope>();
    api.patchItemExplorerDraft.mockReturnValueOnce(patch);
    service.queueDraftPatch('UI_UPDATE', { ui: {} });
    const flushed = service.flushDraftPatch();
    const discarded = service.discardExplorerDraft();
    patch.error({ status: 409 });
    expect(await flushed).toEqual({ kind: 'conflict' });
    expect(await discarded).toEqual({ kind: 'conflict' });
    expect(api.discardItemExplorerDraft).not.toHaveBeenCalled();
    service.finishOperation();
  });

  it('keeps later saves waiting until patch conflict recovery finishes', async () => {
    api.patchItemExplorerDraft.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    service.queueDraftPatch('UI_UPDATE', { ui: {} });
    expect(await service.flushDraftPatch()).toEqual({ kind: 'conflict' });

    let settled = false;
    const saving = service.saveExplorerDraft().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(api.saveItemExplorerDraft).not.toHaveBeenCalled();

    service.finishConflictRecovery(true);
    expect(await saving).toEqual({ kind: 'conflict' });
    expect(api.saveItemExplorerDraft).not.toHaveBeenCalled();
    service.finishOperation();
  });

  it('flushes edits queued while patch conflict recovery is in progress', async () => {
    api.patchItemExplorerDraft.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'conflicting' } });
    expect(await service.flushDraftPatch()).toEqual({ kind: 'conflict' });

    const requested = vi.fn();
    service.flushRequested$.subscribe(requested);
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'after-reload' } });
    expect(requested).not.toHaveBeenCalled();

    service.finishConflictRecovery(true);
    expect(requested).toHaveBeenCalledOnce();
  });

  it('allows another patch after conflict recovery could not reload the state', async () => {
    api.patchItemExplorerDraft.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'conflicting' } });
    expect(await service.flushDraftPatch()).toEqual({ kind: 'conflict' });

    service.finishConflictRecovery(false);
    expect(service.lastDraftOperationError).toContain('konnte nicht neu geladen werden');
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'retry' } });

    expect(await service.flushDraftPatch()).toMatchObject({ kind: 'applied' });
    expect(api.patchItemExplorerDraft).toHaveBeenCalledTimes(2);
    expect(api.patchItemExplorerDraft.mock.calls[1][1].patch).toEqual({
      ui: { filterText: 'retry' },
    });
  });

  it('keeps retryable changes but requests an explicit tag rollback on a non-conflict error', async () => {
    api.patchItemExplorerDraft.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    service.queueDraftPatch('TAGS_UPDATE', { tags: { row: ['tag'] }, ui: { filterText: 'keep' } });
    expect(await service.flushDraftPatch()).toEqual({ kind: 'failed', rollbackTags: true });
    await service.flushDraftPatch();
    expect(api.patchItemExplorerDraft.mock.calls[1][1].patch).toEqual({
      ui: { filterText: 'keep' },
    });
  });

  it('flushes before publishing and does not publish when flushing fails', async () => {
    service.queueDraftPatch('UI_UPDATE', { ui: {} });
    expect(await service.saveExplorerDraft()).toMatchObject({ kind: 'applied', markSaved: true });
    expect(api.saveItemExplorerDraft).toHaveBeenCalledWith('a', 2);
    service.finishOperation();
    api.patchItemExplorerDraft.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    service.queueDraftPatch('UI_UPDATE', { ui: {} });
    expect(await service.saveExplorerDraft()).toEqual({ kind: 'conflict' });
    expect(api.saveItemExplorerDraft).toHaveBeenCalledTimes(1);
    service.finishOperation();
  });

  it('cancels requests and timers on destruction without changing state from late responses', async () => {
    const response = new Subject<ItemExplorerStateEnvelope>();
    api.patchItemExplorerDraft.mockReturnValue(response);
    service.queueDraftPatch('UI_UPDATE', { ui: {} });
    const pending = service.flushDraftPatch();
    service.ngOnDestroy();
    service.ngOnDestroy();
    response.next(envelope(9));
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(service.explorerVersion).toBe(1);
    expect(response.observed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps edits queued during publication and flushes them against the published version', async () => {
    const publication = new Subject<ItemExplorerStateEnvelope>();
    api.saveItemExplorerDraft.mockReturnValue(publication);
    service.acceptEnvelope(envelope(2));
    const saved = service.saveExplorerDraft();
    await Promise.resolve();
    service.queueDraftPatch('UI_UPDATE', { ui: { filterText: 'newer' } });
    expect(await service.flushDraftPatch()).toEqual({ kind: 'busy' });
    expect(api.patchItemExplorerDraft).not.toHaveBeenCalled();
    publication.next(envelope(3, 'CLEAN'));
    expect(await saved).toEqual({ kind: 'version-only' });
    expect(service.explorerUiStatus).toBe('DIRTY');
    const requested = vi.fn();
    service.flushRequested$.subscribe(requested);
    service.finishOperation();
    expect(requested).toHaveBeenCalledOnce();
    await service.flushDraftPatch();
    expect(api.patchItemExplorerDraft.mock.calls[0][1].baseVersion).toBe(3);
  });
});
