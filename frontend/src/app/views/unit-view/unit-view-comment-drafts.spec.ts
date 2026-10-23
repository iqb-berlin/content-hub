import { provideZonelessChangeDetection, ɵresolveComponentResources } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import threadTemplate from '../comment-thread/item-comment-thread.component.html?raw';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { UnitViewComponent } from './unit-view.component';
import { ItemCommentThreadComponent } from '../comment-thread/item-comment-thread.component';

// Use the real child: a stub cannot detect draft loss when Angular destroys the view.
describe('Unit review comment drafts', () => {
  let fixture: ComponentFixture<UnitViewComponent>;
  const currentUser$ = new BehaviorSubject(null);
  let token: string | null;
  const session = (sub: string) =>
    `header.${btoa(JSON.stringify({ sub, type: 'oidc' }))}.signature`;
  const thread = () =>
    fixture.debugElement.query(By.directive(ItemCommentThreadComponent))?.componentInstance as
      | ItemCommentThreadComponent
      | undefined;
  const detect = () => {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };
  const root = {
    id: 'root',
    commentText: 'Original',
    version: 1,
    createdAt: '2026-09-01T12:00:00Z',
    canEdit: true,
  };
  const api = {
    getViewUnit: vi.fn(),
    getReviewCommentThread: vi.fn(),
    getItemCommentThread: vi.fn(),
    getItemCommentCounts: vi.fn(),
    createItemComment: vi.fn(),
    updateItemComment: vi.fn(),
  };

  beforeEach(async () => {
    token = session('user-1');
    api.getViewUnit.mockImplementation((_acpId: string, unitId: string) =>
      of({ id: unitId, name: unitId, items: [], dependencies: [] }),
    );
    api.getReviewCommentThread.mockImplementation((_acpId: string, target: unknown) =>
      of({
        revision: '1',
        target,
        comments: [root],
        visibilityMode: 'GROUP',
        groups: [
          { id: 'G1', name: 'Gruppe 1' },
          { id: 'G2', name: 'Gruppe 2' },
        ],
        defaultGroupId: 'G1',
      }),
    );
    api.updateItemComment.mockReturnValue(of({}));
    api.getItemCommentCounts.mockReturnValue(
      of({
        revision: '1',
        counts: [
          { unitId: 'U', itemId: 'I2', count: 0, codingCount: 0 },
          { unitId: 'U', itemId: 'I1', count: 0, codingCount: 0 },
          { unitId: 'V', itemId: 'I1', count: 0, codingCount: 0 },
        ],
      }),
    );
    api.getItemCommentThread.mockImplementation((_acpId: string, unitId: string, itemId: string) =>
      api.getReviewCommentThread(_acpId, { targetType: 'ITEM', unitId, itemId }),
    );
    api.createItemComment.mockReturnValue(of({}));
    (ItemCommentThreadComponent as any).ctorParameters = () => [{ type: ApiService }];
    await ɵresolveComponentResources(async (url: string) =>
      url.endsWith('.html') ? threadTemplate : '',
    );
    await TestBed.configureTestingModule({
      imports: [UnitViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser$, getToken: () => token } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '' } } } },
        { provide: ApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(UnitViewComponent);
    fixture.componentRef.setInput('acpId', 'A');
    fixture.componentRef.setInput('unitId', 'U');
    fixture.componentRef.setInput('bookletId', 'B');
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('reviewMode', true);
    fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['UNIT', 'BOOKLET'],
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  function enterDrafts() {
    thread()!.newCommentText = 'Neuer Kommentar';
    thread()!.selectedGroupId = 'G2';
    thread()!.startReply('root');
    thread()!.setReplyText('root', 'Antwortentwurf');
    thread()!.startEdit(root as any);
    thread()!.editText = 'Bearbeitungsentwurf';
    detect();
  }

  function expectDrafts() {
    expect(thread()!.newCommentText).toBe('Neuer Kommentar');
    expect(thread()!.selectedGroupId).toBe('G2');
    expect(thread()!.replyingTo).toBe('root');
    expect(thread()!.replyText('root')).toBe('Antwortentwurf');
    expect(thread()!.editingCommentId).toBe('root');
    expect(thread()!.editText).toBe('Bearbeitungsentwurf');
  }

  function enableItemComments(targets = ['UNIT', 'ITEM', 'BOOKLET']) {
    fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: targets,
    });
    detect();
  }

  function select(selector: string, value: string) {
    const element = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    expect(element).not.toBeNull();
    element.value = value;
    element.dispatchEvent(new Event('change'));
    detect();
  }

  it('uses canonical item IDs for the current unit and submits to the selected item', () => {
    api.getViewUnit.mockReturnValue(
      of({
        id: 'U',
        name: 'Aufgabe U',
        items: [
          { id: 'I1', name: 'Erstes Item' },
          { id: 'not-in-catalog', name: 'Veraltet' },
        ],
        dependencies: [],
      }),
    );
    fixture.componentInstance['loadUnit']();
    enableItemComments();
    select('.comment-scope-select select', 'item');
    const options = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.comment-item-select option',
      ) as NodeListOf<HTMLOptionElement>,
    );
    expect(options.map((option) => option.value)).toEqual(['I1', 'I2']);
    expect(options[0].textContent).toContain('Erstes Item');
    expect(options[0].textContent).toContain('I1');
    expect(fixture.nativeElement.textContent).not.toContain('Veraltet');
    expect(thread()!.targetType).toBe('ITEM');
    expect(thread()!.unitId).toBe('U');
    expect(thread()!.itemId).toBe('I1');

    select('.comment-item-select select', 'I2');
    thread()!.newCommentText = 'Kommentar zum zweiten Item';
    thread()!.submitComment();

    expect(api.createItemComment).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        unitId: 'U',
        itemId: 'I2',
        commentText: 'Kommentar zum zweiten Item',
      }),
    );
  });

  it('uses the canonical task label and singular reply text in the real review thread', () => {
    api.getViewUnit.mockReturnValue(of({ id: 'U', name: 'Zaubern', items: [], dependencies: [] }));
    fixture.componentInstance['loadUnit']();
    const child = thread()!;
    child.snapshot!.comments = [root, { ...root, id: 'reply', parentCommentId: 'root' }] as any;
    detect();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Zaubern (U)');
    expect(fixture.nativeElement.querySelector('.comment-panel-header strong').textContent).toBe(
      'Kommentare zur Aufgabe Zaubern (U)',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Bewertungen sind nur');
    const toggle = fixture.nativeElement.querySelector(
      '.thread-actions .link-button',
    ) as HTMLButtonElement;
    expect(toggle.textContent?.trim()).toBe('1 Antwort aufklappen');
    toggle.click();
    detect();
    expect(toggle.textContent?.trim()).toBe('Antwort einklappen');
    expect(fixture.nativeElement.querySelectorAll('.reply-card')).toHaveLength(1);
  });

  it('keeps item, unit and booklet drafts separate and restores the selected item on return', () => {
    enableItemComments();
    select('.comment-scope-select select', 'item');
    enterDrafts();
    select('.comment-item-select select', 'I2');
    expect(thread()!.newCommentText).toBe('');
    thread()!.newCommentText = 'Zweites Item';
    select('.comment-scope-select select', 'unit');
    expect(thread()!.newCommentText).toBe('');
    thread()!.newCommentText = 'Aufgabenentwurf';
    select('.comment-scope-select select', 'booklet');
    expect(thread()!.newCommentText).toBe('');
    thread()!.newCommentText = 'Testheftentwurf';
    select('.comment-scope-select select', 'item');
    expect(thread()!.itemId).toBe('I2');
    expect(thread()!.newCommentText).toBe('Zweites Item');
    select('.comment-item-select select', 'I1');
    expectDrafts();

    fixture.componentRef.setInput('unitId', 'V');
    detect();
    expect(thread()!.unitId).toBe('V');
    expect(thread()!.newCommentText).toBe('');
    fixture.componentRef.setInput('unitId', 'U');
    detect();
    expect(thread()!.itemId).toBe('I1');
    expectDrafts();
  });

  it('discards delayed item catalogs after changing the unit', () => {
    const oldCatalog = new Subject<any>();
    const currentCatalog = new Subject<any>();
    api.getItemCommentCounts.mockReturnValueOnce(oldCatalog).mockReturnValueOnce(currentCatalog);
    enableItemComments(['ITEM']);
    expect(thread()).toBeUndefined();
    fixture.componentRef.setInput('unitId', 'V');
    detect();
    oldCatalog.next({ revision: 'old', counts: [{ unitId: 'U', itemId: 'OLD' }] });
    detect();
    expect(thread()).toBeUndefined();

    currentCatalog.next({
      revision: 'new',
      counts: [
        { unitId: 'V', itemId: 'I1' },
        { unitId: 'U', itemId: 'OLD' },
      ],
    });
    detect();
    expect(thread()!.unitId).toBe('V');
    expect(thread()!.itemId).toBe('I1');
    expect(api.getItemCommentThread).not.toHaveBeenCalledWith('A', 'V', 'OLD', expect.anything());
  });

  it('supports item-only review, retries catalog errors and respects disabled targets', () => {
    api.getItemCommentCounts.mockReturnValueOnce(throwError(() => new Error('offline')));
    enableItemComments(['ITEM']);
    expect(thread()).toBeUndefined();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Items für die Kommentierung konnten nicht geladen werden.',
    );
    const retry = fixture.nativeElement.querySelector('.comment-items-retry') as HTMLButtonElement;
    retry.click();
    detect();
    expect(thread()!.targetType).toBe('ITEM');

    const calls = api.getItemCommentCounts.mock.calls.length;
    enableItemComments(['UNIT', 'BOOKLET']);
    expect(thread()!.targetType).toBe('UNIT');
    expect(fixture.nativeElement.querySelector('.comment-item-select')).toBeNull();
    expect(api.getItemCommentCounts).toHaveBeenCalledTimes(calls);

    api.getItemCommentCounts.mockReturnValue(of({ revision: 'empty', counts: [] }));
    enableItemComments(['ITEM']);
    expect(thread()).toBeUndefined();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(
      'Für diese Aufgabe sind keine kommentierbaren Items verfügbar.',
    );
  });

  it.each(['tab', 'collapse'] as const)(
    'preserves all drafts and their group through %s changes',
    (change) => {
      enterDrafts();
      const original = thread();
      if (change === 'tab') fixture.componentInstance.activeTab = 'coding';
      else fixture.componentInstance.reviewPanelCollapsed = true;
      detect();
      expect(thread()).toBeUndefined();
      if (change === 'tab') fixture.componentInstance.activeTab = 'comments';
      else fixture.componentInstance.reviewPanelCollapsed = false;
      detect();
      expect(thread()).not.toBe(original);
      expectDrafts();
    },
  );

  it('keeps unit and booklet drafts separate when switching comment scope', () => {
    enterDrafts();
    fixture.componentInstance.commentScope = 'booklet';
    detect();
    expect(thread()!.newCommentText).toBe('');
    expect(thread()!.editText).toBe('');
    thread()!.newCommentText = 'Testheftentwurf';
    fixture.componentInstance.commentScope = 'unit';
    detect();
    expectDrafts();
    fixture.componentInstance.commentScope = 'booklet';
    detect();
    expect(thread()!.newCommentText).toBe('Testheftentwurf');
  });

  it('preserves drafts across asynchronous unit loads and isolates package identities', () => {
    enterDrafts();
    const response = new Subject<any>();
    api.getViewUnit.mockReturnValueOnce(response);
    fixture.componentRef.setInput('unitId', 'V');
    detect();
    expect(thread()).toBeUndefined();
    response.next({ id: 'V', name: 'V', items: [], dependencies: [] });
    detect();
    expect(thread()!.newCommentText).toBe('');
    thread()!.newCommentText = 'Andere Unit';
    fixture.componentRef.setInput('unitId', 'U');
    detect();
    expectDrafts();
    fixture.componentRef.setInput('acpId', 'OTHER');
    detect();
    expect(thread()!.newCommentText).toBe('');
    fixture.componentRef.setInput('acpId', 'A');
    detect();
    expectDrafts();
  });

  it('keeps the original edit version after remount and clears only successfully saved drafts', () => {
    enterDrafts();
    fixture.componentInstance.activeTab = 'coding';
    detect();
    api.getReviewCommentThread.mockReturnValue(
      of({
        revision: '2',
        target: { targetType: 'UNIT', unitId: 'U' },
        comments: [{ ...root, version: 2, commentText: 'Concurrent edit' }],
        visibilityMode: 'SHARED',
      }),
    );
    fixture.componentInstance.activeTab = 'comments';
    detect();
    thread()!.saveEdit(thread()!.threadGroups[0].root!);
    expect(api.updateItemComment).toHaveBeenCalledWith('A', 'root', {
      commentText: 'Bearbeitungsentwurf',
      version: 1,
    });
    expect(thread()!.editText).toBe('');
    expect(thread()!.newCommentText).toBe('Neuer Kommentar');
    expect(thread()!.replyText('root')).toBe('Antwortentwurf');
  });

  it.each([null, session('user-2')])(
    'clears hidden drafts when the session changes',
    (nextToken) => {
      enterDrafts();
      fixture.componentInstance.activeTab = 'coding';
      detect();
      token = nextToken;
      currentUser$.next(null);
      fixture.componentInstance.activeTab = 'comments';
      detect();
      expect(thread()!.newCommentText).toBe('');
      expect(thread()!.replyText('root')).toBe('');
      expect(thread()!.editText).toBe('');
      expect(thread()!.replyingTo).toBeNull();
    },
  );

  it('retains drafts when the same identity refreshes its profile', () => {
    enterDrafts();
    currentUser$.next(null);
    detect();
    expectDrafts();
  });
});
