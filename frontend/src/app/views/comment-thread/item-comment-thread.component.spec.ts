import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ItemCommentThreadComponent } from './item-comment-thread.component';
import template from './item-comment-thread.component.html?raw';

function createComponent() {
  const api = {
    getItemCommentThread: vi.fn().mockReturnValue(
      of({
        revision: '1',
        target: { unitId: 'unit-1', itemId: 'item-1' },
        visibilityMode: 'SHARED',
        comments: [],
      }),
    ),
    getReviewCommentThread: vi.fn().mockReturnValue(
      of({
        revision: 'coding-1',
        target: { targetType: 'CODING', unitId: 'unit-1', itemId: 'item-1' },
        visibilityMode: 'SHARED',
        comments: [],
      }),
    ),
    createItemComment: vi.fn().mockReturnValue(of({ id: 'created' })),
    createReviewComment: vi.fn().mockReturnValue(of({ id: 'coding-created' })),
    updateItemComment: vi.fn().mockReturnValue(of({ id: 'updated' })),
    setCommentVote: vi.fn().mockReturnValue(of({})),
    deleteItemComment: vi.fn().mockReturnValue(of({ success: true })),
  } as any;
  const component = new ItemCommentThreadComponent(api);
  component.acpId = 'acp-1';
  component.unitId = 'unit-1';
  component.itemId = 'item-1';
  component.enabled = true;
  return { component, api };
}

describe('ItemCommentThreadComponent', () => {
  it('keeps category drafts per target and reply, and retains them after a failed request', () => {
    const { component, api } = createComponent();
    component.loadThread();
    component.snapshot!.categories = [{ id: 'category', name: 'Fachlich', archived: false }];
    component.selectedCategoryId = 'category';
    component.newCommentText = 'Root draft';
    component.setReplyText('root', 'Reply draft');
    component.setReplyCategoryId('root', 'category');
    component.itemId = 'item-2';
    expect(component.selectedCategoryId).toBe('');
    expect(component.replyCategoryId('root')).toBe('');
    component.itemId = 'item-1';
    api.createItemComment.mockReturnValue(throwError(() => ({ error: { message: 'Offline' } })));
    component.submitComment();
    expect(api.createItemComment).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({ categoryId: 'category' }),
    );
    expect(component.selectedCategoryId).toBe('category');
    expect(component.newCommentText).toBe('Root draft');
    component.snapshot!.categories[0].archived = true;
    component.submitComment('root');
    expect(api.createItemComment).toHaveBeenCalledTimes(1);
    expect(component.replyCategoryId('root')).toBe('category');
    expect(component.error).toContain('verfügbare Kategorie');
    component.setReplyCategoryId('root', '');
    api.createItemComment.mockReturnValue(of({}));
    component.submitComment('root');
    expect(api.createItemComment).toHaveBeenCalledTimes(2);
    expect(component.replyCategoryId('root')).toBe('');
    component.ngOnDestroy();
  });

  it('retains an archived assignment during text edits and sends null only when removing it', () => {
    const { component, api } = createComponent();
    const comment = {
      id: 'own',
      commentText: 'Original',
      version: 1,
      categoryId: 'archived',
    } as any;
    component.startEdit(comment);
    component.editText = 'New text';
    component.saveEdit(comment);
    expect(api.updateItemComment).toHaveBeenLastCalledWith('acp-1', 'own', {
      commentText: 'New text',
      version: 1,
    });
    component.startEdit(comment);
    component.editCategoryId = '';
    component.saveEdit(comment);
    expect(api.updateItemComment).toHaveBeenLastCalledWith('acp-1', 'own', {
      commentText: 'Original',
      version: 1,
      categoryId: null,
    });
    component.startEdit(comment);
    component.editCategoryId = 'active';
    component.saveEdit(comment);
    expect(api.updateItemComment).toHaveBeenLastCalledWith('acp-1', 'own', {
      commentText: 'Original',
      version: 1,
      categoryId: 'active',
    });
    component.ngOnDestroy();
  });

  it('sets, switches and removes votes while retaining drafts and refreshing the snapshot', () => {
    const { component, api } = createComponent();
    component.loadThread();
    component.newCommentText = 'Ungespeichert';
    const comment = { id: 'foreign', canVote: true, myVote: null } as any;
    component.vote(comment, 'UP');
    expect(api.setCommentVote).toHaveBeenLastCalledWith('acp-1', 'foreign', 'UP');
    component.vote({ ...comment, myVote: 'UP' }, 'DOWN');
    expect(api.setCommentVote).toHaveBeenLastCalledWith('acp-1', 'foreign', 'DOWN');
    component.vote({ ...comment, myVote: 'DOWN' }, 'DOWN');
    expect(api.setCommentVote).toHaveBeenLastCalledWith('acp-1', 'foreign', null);
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(4);
    expect(component.newCommentText).toBe('Ungespeichert');
    component.ngOnDestroy();
  });

  it('blocks disabled votes and ignores responses after switching sessions', () => {
    const { component, api } = createComponent();
    component.loadThread();
    const comment = { id: 'foreign', canVote: true } as any;
    component.vote({ ...comment, canVote: false }, 'UP');
    component.snapshot!.visibilityMode = 'GROUP';
    component.vote(comment, 'UP');
    expect(api.setCommentVote).not.toHaveBeenCalled();
    component.snapshot!.visibilityMode = 'SHARED';
    const response = new Subject();
    api.setCommentVote.mockReturnValue(response);
    component.vote(comment, 'UP');
    component.vote(comment, 'DOWN');
    expect(api.setCommentVote).toHaveBeenCalledTimes(1);
    component.ngOnChanges({ sessionToken: { firstChange: false } as any });
    const loads = api.getItemCommentThread.mock.calls.length;
    response.next({});
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(loads);
    expect(component.busy).toBe(false);
    component.ngOnDestroy();
  });

  it('preserves vote failures while refreshing revoked access', () => {
    const { component, api } = createComponent();
    component.loadThread();
    component.newCommentText = 'Entwurf';
    api.setCommentVote.mockReturnValue(
      throwError(() => ({ status: 403, error: { message: 'Review deaktiviert' } })),
    );
    component.vote({ id: 'foreign', canVote: true } as any, 'UP');
    expect(component.error).toBe('Review deaktiviert');
    expect(component.busy).toBe(false);
    expect(component.newCommentText).toBe('Entwurf');
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it('requires a new group choice after membership changes without moving a draft automatically', () => {
    const { component, api } = createComponent();
    component.selectedGroupId = 'A';
    component.newCommentText = 'Entwurf für A';
    component.startEdit({
      id: 'old',
      groupId: 'A',
      commentText: 'Gespeicherter Text',
      version: 1,
    } as any);
    component.editText = 'Ungespeicherte Änderung';
    api.getItemCommentThread.mockReturnValue(
      of({
        revision: 'new-membership',
        visibilityMode: 'GROUP',
        target: { unitId: 'unit-1', itemId: 'item-1' },
        comments: [],
        groups: [{ id: 'B', name: 'B', archived: false }],
        defaultGroupId: 'B',
      }),
    );
    component.loadThread(true);
    expect(component.selectedGroupId).toBe('');
    expect(component.newCommentText).toBe('Entwurf für A');
    expect(component.editText).toBe('Ungespeicherte Änderung');
    expect(component.editAccessLost).toBe(true);
    expect(component.threadGroups).toEqual([]);
    component.submitComment();
    expect(api.createItemComment).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('polls after eight seconds without changing the target or unsaved input and stops on destroy', () => {
    vi.useFakeTimers();
    const { component, api } = createComponent();
    try {
      component.loadThread();
      component.newCommentText = 'Neuer Entwurf';
      component.setReplyText('root', 'Antwortentwurf');
      component.startEdit({ id: 'edit', commentText: 'Original', version: 1 } as any);
      component.editText = 'Bearbeitungsentwurf';
      api.getItemCommentThread.mockReturnValue(
        of({
          revision: '2',
          visibilityMode: 'SHARED',
          target: { unitId: 'unit-1', itemId: 'item-1' },
          comments: [],
        }),
      );
      vi.advanceTimersByTime(8000);
      expect(component.snapshot?.revision).toBe('2');
      expect(component.itemId).toBe('item-1');
      expect(component.newCommentText).toBe('Neuer Entwurf');
      expect(component.replyText('root')).toBe('Antwortentwurf');
      expect(component.editText).toBe('Bearbeitungsentwurf');
      component.ngOnDestroy();
      vi.advanceTimersByTime(16000);
      expect(api.getItemCommentThread).toHaveBeenCalledTimes(2);
    } finally {
      component.ngOnDestroy();
      vi.useRealTimers();
    }
  });

  it('clears load errors after distinct failures and a successful poll', () => {
    const { component, api } = createComponent();
    api.getItemCommentThread
      .mockReturnValueOnce(throwError(() => ({ error: { message: 'Service unavailable' } })))
      .mockReturnValueOnce(throwError(() => ({ error: { message: 'Gateway timeout' } })));
    component.loadThread(true);
    expect(component.error).toBe('Service unavailable');
    component.loadThread(true);
    expect(component.error).toBe('Gateway timeout');
    component.loadThread(true);
    expect(component.snapshot).not.toBeNull();
    expect(component.error).toBe('');
  });

  it('preserves a mutation error across failed and successful background loads', () => {
    const { component, api } = createComponent();
    api.updateItemComment.mockReturnValue(
      throwError(() => ({ status: 409, error: { message: 'Konflikt' } })),
    );
    api.getItemCommentThread.mockReturnValueOnce(throwError(() => new Error('offline')));
    component.startEdit({ id: 'c-1', version: 1, commentText: 'Original' } as any);
    component.editText = 'Entwurf';
    component.saveEdit({ id: 'c-1', version: 1 } as any);
    component.loadThread(true);
    expect(component.error).toBe('Konflikt');
    expect(component.editText).toBe('Entwurf');
  });

  it('invalidates pending loads and clears private edits and drafts on a session change', () => {
    const { component, api } = createComponent();
    const oldSession = new Subject<any>();
    const newSession = new Subject<any>();
    api.getItemCommentThread.mockReturnValueOnce(oldSession).mockReturnValueOnce(newSession);
    component.newCommentText = 'Privater Entwurf';
    component.setReplyText('root', 'Private Antwort');
    component.startReply('root');
    component.startEdit({ id: 'private', commentText: 'Privat', version: 1 } as any);
    component.loadThread();
    component.sessionToken += 1;
    component.ngOnChanges({ sessionToken: { firstChange: false } as any });
    expect(oldSession.observed).toBe(false);
    expect(component.snapshot).toBeNull();
    expect(component.threadGroups).toEqual([]);
    expect(component.newCommentText).toBe('');
    expect(component.replyText('root')).toBe('');
    expect(component.editText).toBe('');
    expect(component.replyingTo).toBeNull();
    oldSession.next({ revision: 'old-session' });
    newSession.next({
      revision: 'new-session',
      target: { unitId: 'unit-1', itemId: 'item-1' },
      visibilityMode: 'PRIVATE',
      comments: [],
    });
    expect(component.snapshot?.revision).toBe('new-session');
    component.ngOnDestroy();
  });

  it('ignores a previous session mutation response while loading the new session', () => {
    const { component, api } = createComponent();
    const save = new Subject<any>();
    api.createItemComment.mockReturnValue(save);
    component.newCommentText = 'Alter Entwurf';
    component.submitComment();
    component.sessionToken += 1;
    component.ngOnChanges({ sessionToken: { firstChange: false } as any });
    expect(component.busy).toBe(false);
    expect(save.observed).toBe(false);
    component.newCommentText = 'Neuer Entwurf';
    save.next({ id: 'created' });
    expect(component.newCommentText).toBe('Neuer Entwurf');
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('exposes the comment panel as a stateful disclosure', () => {
    expect(template).toContain('class="btn btn-outline btn-sm btn-state comment-toggle"');
    expect(template).toContain('[attr.aria-expanded]="open"');
    expect(template).toContain('[attr.aria-controls]="panelId"');
    expect(template).toContain('[id]="panelId"');
    expect(template).not.toContain('btn-state-indicator');
  });

  it('keeps the established Item labels while naming other comment contexts explicitly', () => {
    const { component } = createComponent();

    expect(component.panelAriaLabel).toBe('Kommentare zum ausgewählten Item');
    expect(component.newCommentPlaceholder).toBe('Kommentar zu diesem Item …');
    expect(component.emptyStateText).toBe('Noch keine Kommentare zu diesem Item.');

    component.targetType = 'BOOKLET';
    component.bookletId = 'testheft-1';
    expect(component.contextLabel).toBe('Testheft testheft-1');
    expect(component.panelAriaLabel).toBe('Kommentare zum Testheft testheft-1');
    expect(component.newCommentPlaceholder).toBe('Kommentar zum Testheft testheft-1 …');

    component.targetType = 'CODING';
    expect(component.panelAriaLabel).toBe('Kommentare zur Kodierung unit-1 · item-1');
    expect(component.newCommentPlaceholder).toBe('Kommentar zur Kodierung unit-1 · item-1 …');
    expect(component.emptyStateText).toBe('Noch keine Kommentare in diesem Kontext.');
  });

  it('loads only the selected item and ignores a superseded response', () => {
    const { component, api } = createComponent();
    const first = new Subject<any>();
    const second = new Subject<any>();
    api.getItemCommentThread.mockReturnValueOnce(first).mockReturnValueOnce(second);

    component.loadThread();
    component.itemId = 'item-2';
    component.loadThread();
    expect(first.observed).toBe(false);
    first.next({
      revision: 'old',
      target: { unitId: 'unit-1', itemId: 'item-1' },
      visibilityMode: 'SHARED',
      comments: [{ id: 'old' }],
    });
    second.next({
      revision: 'new',
      target: { unitId: 'unit-1', itemId: 'item-1' },
      visibilityMode: 'SHARED',
      comments: [{ id: 'new' }],
    });

    expect(component.snapshot?.revision).toBe('new');
    expect(api.getItemCommentThread).toHaveBeenNthCalledWith(1, 'acp-1', 'unit-1', 'item-1', null);
    expect(api.getItemCommentThread).toHaveBeenNthCalledWith(2, 'acp-1', 'unit-1', 'item-2', null);
    component.ngOnDestroy();
  });

  it('replaces the previous snapshot on target changes without reloading on open', () => {
    const { component, api } = createComponent();
    const response = new Subject<any>();
    component.snapshot = {
      revision: 'old',
      target: { unitId: 'unit-1', itemId: 'item-1' },
      visibilityMode: 'SHARED',
      comments: [],
    };
    api.getItemCommentThread.mockReturnValue(response);
    component.itemId = 'item-2';

    component.ngOnChanges({ itemId: {} as any });

    expect(component.snapshot).toBeNull();
    response.next({
      revision: 'new',
      target: { unitId: 'unit-1', itemId: 'item-1' },
      visibilityMode: 'SHARED',
      comments: [],
    });
    expect(component.snapshot?.revision).toBe('new');
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(1);
    component.toggleOpen();
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(1);
  });

  it('uses the deep-link open flag only for the initial target', () => {
    const { component } = createComponent();
    component.initiallyOpen = true;

    component.ngOnChanges({ itemId: {} as any });
    expect(component.open).toBe(true);

    component.open = false;
    component.itemId = 'item-2';
    component.ngOnChanges({ itemId: {} as any });

    expect(component.open).toBe(false);
  });

  it('groups replies below roots and keeps orphaned own replies visible', () => {
    const { component } = createComponent();
    component.snapshot = {
      revision: '1',
      target: { unitId: 'unit-1', itemId: 'item-1' },
      visibilityMode: 'PRIVATE',
      comments: [
        { id: 'root', parentCommentId: null, createdAt: '2026-01-01T10:00:00Z' },
        { id: 'reply', parentCommentId: 'root', createdAt: '2026-01-01T11:00:00Z' },
        { id: 'orphan', parentCommentId: 'hidden', createdAt: '2026-01-01T12:00:00Z' },
      ] as any,
    };

    expect(component.threadGroups).toEqual([
      expect.objectContaining({
        id: 'hidden',
        root: null,
        replies: [expect.objectContaining({ id: 'orphan' })],
      }),
      expect.objectContaining({
        id: 'root',
        root: expect.objectContaining({ id: 'root' }),
        replies: [expect.objectContaining({ id: 'reply' })],
      }),
    ]);
  });

  it.each([
    { requested: 'unit-1_item-1', canonical: 'item-1' },
    { requested: 'unit-1_item-1', canonical: 'unit-1_item-1' },
  ])(
    'emits the canonical target $canonical for request $requested, even for an empty thread',
    ({ requested, canonical }) => {
      const { component, api } = createComponent();
      component.itemId = requested;
      const countChanged = vi.fn();
      component.countChanged.subscribe(countChanged);
      api.getItemCommentThread.mockReturnValue(
        of({
          target: { unitId: 'unit-1', itemId: canonical },
          revision: 'empty',
          visibilityMode: 'SHARED',
          comments: [],
        }),
      );
      component.loadThread();
      expect(countChanged).toHaveBeenCalledWith({
        unitId: 'unit-1',
        itemId: canonical,
        count: 0,
        refreshToken: 0,
      });
    },
  );

  it('preserves drafts and the original edit version across background changes and deletion', () => {
    const { component, api } = createComponent();
    const original = {
      id: 'own',
      commentText: 'original',
      version: 1,
      isOwn: true,
      createdAt: '2026-01-01',
    } as any;
    component.snapshot = {
      target: { unitId: 'unit-1', itemId: 'item-1' },
      revision: '1',
      visibilityMode: 'SHARED',
      comments: [original],
    };
    component.startEdit(original);
    component.editText = 'unsaved edit';
    component.newCommentText = 'unsaved new comment';
    component.replyingTo = 'root';
    component.setReplyText('root', 'unsaved reply');
    api.getItemCommentThread.mockReturnValue(
      of({ ...component.snapshot, revision: '2', comments: [] }),
    );
    component.refreshToken = 2;
    component.ngOnChanges({ refreshToken: { firstChange: false } as any });
    expect(component.editText).toBe('unsaved edit');
    expect(component.newCommentText).toBe('unsaved new comment');
    expect(component.replyText('root')).toBe('unsaved reply');
    expect(component.threadGroups.some((group) => group.id === 'root')).toBe(true);
    expect(component.threadGroups.find((group) => group.id === 'own')?.root?.version).toBe(1);
    expect(component.commentCount).toBe(0);
    component.saveEdit({ ...original, version: 2 });
    expect(api.updateItemComment).toHaveBeenCalledWith('acp-1', 'own', {
      commentText: 'unsaved edit',
      version: 1,
    });
  });

  it('does not cancel active thread loads or interrupt comment saves for polling', () => {
    const { component, api } = createComponent();
    const response = new Subject<any>();
    api.getItemCommentThread.mockReturnValue(response);
    component.loadThread();
    component.ngOnChanges({ refreshToken: { firstChange: false } as any });
    expect(response.observed).toBe(true);
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(1);
    component.loading = false;
    component.busy = true;
    component.ngOnChanges({ refreshToken: { firstChange: false } as any });
    expect(api.getItemCommentThread).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('emits the visible non-deleted count after refreshing a thread', () => {
    const { component, api } = createComponent();
    const countChanged = vi.fn();
    component.countChanged.subscribe(countChanged);
    api.getItemCommentThread.mockReturnValue(
      of({
        revision: '2',
        target: { unitId: 'unit-1', itemId: 'item-1' },
        visibilityMode: 'SHARED',
        comments: [{ id: 'visible' }, { id: 'deleted', isDeleted: true }],
      }),
    );

    component.loadThread();

    expect(countChanged).toHaveBeenCalledWith({
      unitId: 'unit-1',
      itemId: 'item-1',
      count: 1,
      refreshToken: 0,
    });
  });

  it('keeps drafts per item and creates a reply for the selected target', () => {
    const { component, api } = createComponent();
    component.newCommentText = 'Entwurf 1';
    component.itemId = 'item-2';
    component.newCommentText = 'Entwurf 2';
    component.itemId = 'item-1';
    expect(component.newCommentText).toBe('Entwurf 1');

    component.setReplyText('root-1', 'Antwort');
    component.submitComment('root-1');
    expect(api.createItemComment).toHaveBeenCalledWith('acp-1', {
      unitId: 'unit-1',
      itemId: 'item-1',
      commentText: 'Antwort',
      parentCommentId: 'root-1',
    });
  });

  it('reports a version conflict and reloads the thread', () => {
    const { component, api } = createComponent();
    api.updateItemComment.mockReturnValue(
      throwError(() => ({ status: 409, error: { message: 'Konflikt' } })),
    );
    const loadSpy = vi.spyOn(component, 'loadThread');
    component.startEdit({ id: 'c-1', version: 2, commentText: 'Original' } as any);
    component.editText = 'Neue Fassung';

    component.saveEdit({ id: 'c-1', version: 2 } as any);

    expect(component.error).toBe('Konflikt');
    expect(loadSpy).toHaveBeenCalled();
  });

  it('does not clear or reload the newly selected item after an older save completes', () => {
    const { component, api } = createComponent();
    const save = new Subject<any>();
    api.createItemComment.mockReturnValue(save);
    component.newCommentText = 'Entwurf für Item 1';

    component.submitComment();
    component.itemId = 'item-2';
    component.newCommentText = 'Entwurf für Item 2';
    const loadSpy = vi.spyOn(component, 'loadThread');
    save.next({ id: 'created' });
    save.complete();

    expect(component.newCommentText).toBe('Entwurf für Item 2');
    expect(loadSpy).not.toHaveBeenCalled();
    component.itemId = 'item-1';
    expect(component.newCommentText).toBe('');
  });

  it('marks every versioned edit even when timestamps are less than a second apart', () => {
    const { component } = createComponent();
    expect(
      component.wasEdited({
        version: 2,
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.100Z',
      } as any),
    ).toBe(true);
    expect(
      component.wasEdited({
        version: 1,
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:05.000Z',
      } as any),
    ).toBe(false);
  });

  it('uses a separate coding thread for the selected item', () => {
    const { component, api } = createComponent();
    component.targetType = 'CODING';
    const countChanged = vi.fn();
    component.countChanged.subscribe(countChanged);

    component.loadThread();
    component.newCommentText = 'Kodierung prüfen';
    component.submitComment();

    expect(api.getReviewCommentThread).toHaveBeenCalledWith(
      'acp-1',
      {
        targetType: 'CODING',
        unitId: 'unit-1',
        itemId: 'item-1',
      },
      null,
    );
    expect(api.createReviewComment).toHaveBeenCalledWith('acp-1', {
      targetType: 'CODING',
      unitId: 'unit-1',
      itemId: 'item-1',
      commentText: 'Kodierung prüfen',
    });
    expect(countChanged).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'CODING', count: 0 }),
    );
  });
});
