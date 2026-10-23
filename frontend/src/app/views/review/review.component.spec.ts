import { describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { ReviewComponent } from './review.component';

function setup() {
  const api = {
    getCapabilities: vi.fn().mockReturnValue(of({ canManageReview: true, canReview: true })),
    getReview: vi.fn().mockReturnValue(of({ booklets: [] })),
    getVisibleReviewComments: vi.fn().mockReturnValue(of([])),
    getReviewConfig: vi.fn(),
    getReviewReadiness: vi.fn().mockReturnValue(of(null)),
    getReviewMembers: vi.fn().mockReturnValue(of([])),
    checkReviewReadiness: vi.fn().mockReturnValue(
      of({
        status: 'READY',
        checkedAt: '2026-09-14T12:00:00.000Z',
        blockers: [],
        warnings: [],
        summary: { totalFiles: 1, validFiles: 1, invalidFiles: 0, bookletCount: 1, unitCount: 1 },
      }),
    ),
    configureReview: vi.fn(),
    exportMyReviewCommentsCsv: vi.fn().mockReturnValue(new Subject()),
    exportMyReviewCommentsXlsx: vi.fn().mockReturnValue(new Subject()),
    exportVisibleReviewComments: vi.fn().mockReturnValue(new Subject()),
  };
  const component = new ReviewComponent(
    { snapshot: { paramMap: { get: () => 'acp' } } } as any,
    api as any,
  );
  component.acpId = 'acp';
  component.config = {
    enableReview: true,
    visibilityMode: 'PRIVATE',
    configVersion: 1,
    groups: [],
  };
  (component as any).savedEnabled = true;
  return { component, api };
}

describe('Review configuration', () => {
  it('restores category and group deletions together after a rejected save', () => {
    const { component, api } = setup();
    const category = { id: 'c', name: 'Fachlich', archived: false };
    const group = { id: 'g', name: 'Group', archived: false, members: [] };
    component.config!.categories = [category];
    component.config!.groups = [group];
    component.removeCategory(category);
    component.groupToDelete = group;
    component.confirmGroupDeletion();
    api.configureReview.mockReturnValue(
      throwError(() => ({ status: 400, error: { message: 'Kategorie wird verwendet' } })),
    );
    component.configure();
    expect(api.configureReview).toHaveBeenCalledWith(
      'acp',
      expect.objectContaining({ deletedCategoryIds: ['c'] }),
    );
    expect(component.config!.categories).toEqual([category]);
    expect(component.config!.groups).toEqual([group]);
    expect(component.deletedCategoryIds).toEqual([]);
    component.config!.categories![0].archived = true;
    expect(component.config!.categories![0].id).toBe('c');
    component.ngOnDestroy();
  });

  it('uses the category filter for display and exports, including uncategorized comments', () => {
    const { component, api } = setup();
    component.comments = [
      { id: 'a', categoryId: 'c', categoryName: 'Fachlich', commentText: 'A' },
      { id: 'b', categoryId: null, commentText: 'B' },
    ];
    component.categoryFilter = 'c';
    expect(component.filteredComments.map((comment) => comment.id)).toEqual(['a']);
    component.exportComments('csv');
    expect(api.exportMyReviewCommentsCsv).toHaveBeenLastCalledWith('acp', { categoryId: 'c' });
    component.categoryFilter = 'uncategorized';
    expect(component.filteredComments.map((comment) => comment.id)).toEqual(['b']);
    component.exportComments();
    expect(api.exportVisibleReviewComments).toHaveBeenLastCalledWith('acp', {
      categoryId: 'uncategorized',
    });
    component.resetFilters();
    expect(component.filteredComments).toHaveLength(2);
    expect(component.displayFilters).toEqual({});
    component.ngOnDestroy();
  });

  it('loads, saves and restores the developer-name visibility setting', () => {
    const { component, api } = setup();
    const config = { ...component.config!, hideReviewDeveloperNames: true };
    api.getReviewConfig.mockReturnValue(of(config));
    component.loadConfig();
    expect(component.config!.hideReviewDeveloperNames).toBe(true);
    component.config!.hideReviewDeveloperNames = false;
    api.configureReview.mockReturnValue(of({ ...component.config!, configVersion: 2 }));
    component.configure();
    expect(api.configureReview).toHaveBeenCalledWith(
      'acp',
      expect.objectContaining({
        hideReviewDeveloperNames: false,
      }),
    );
    expect(component.config!.hideReviewDeveloperNames).toBe(false);
    component.ngOnDestroy();
  });
  it('keeps both personal formats separate from the manager export', () => {
    const { component, api } = setup();
    component.access = { canManageReview: true, canReview: true } as any;
    component.exportComments('csv');
    expect(api.exportMyReviewCommentsCsv).toHaveBeenCalledWith('acp', {});
    component.exportComments('xlsx');
    expect(api.exportMyReviewCommentsXlsx).toHaveBeenCalledWith('acp', {});
    expect(api.exportVisibleReviewComments).not.toHaveBeenCalled();
    component.exportComments();
    expect(api.exportVisibleReviewComments).toHaveBeenCalledWith('acp', {});
    component.ngOnDestroy();
  });

  it('reports personal export errors and clears them on retry', () => {
    const { component, api } = setup();
    api.exportMyReviewCommentsCsv.mockReturnValue(throwError(() => new Error('offline')));
    component.exportComments('csv');
    expect(component.commentsError).toBe('Export konnte nicht erstellt werden.');
    component.exportComments('xlsx');
    expect(component.commentsError).toBe('');
    component.ngOnDestroy();
  });

  it('leaves private visibility unchanged when sharing is not confirmed', () => {
    const { component, api } = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.config!.visibilityMode = 'SHARED';
    component.configure();
    expect(api.configureReview).not.toHaveBeenCalled();
    component.ngOnDestroy();
    vi.restoreAllMocks();
  });

  it('does not refetch configuration after save and overwrite the next unsaved choice', () => {
    const { component, api } = setup();
    const saved = new Subject<any>();
    api.configureReview.mockReturnValue(saved);
    component.configure();
    saved.next({ enableReview: true, visibilityMode: 'PRIVATE', configVersion: 2, groups: [] });
    component.config!.visibilityMode = 'GROUP';
    expect(api.getReviewConfig).not.toHaveBeenCalled();
    expect(component.config!.visibilityMode).toBe('GROUP');
    expect(component.config!.configVersion).toBe(2);
    component.ngOnDestroy();
  });

  it('preserves edited group membership when saving reports a conflict', () => {
    const { component, api } = setup();
    const saved = new Subject<any>();
    api.configureReview.mockReturnValue(saved);
    component.config!.groups.push({
      name: 'Fachgruppe',
      archived: false,
      members: [{ id: 'u', kind: 'user' }],
    });
    component.configure();
    saved.error({ status: 409, error: { message: 'Bitte neu laden' } });
    expect(component.config!.groups[0].members).toEqual([{ id: 'u', kind: 'user' }]);
    expect(component.error).toBe('Bitte neu laden');
    expect(component.busy).toBe(false);
    component.ngOnDestroy();
  });

  it('checks readiness before activating Review', () => {
    const { component, api } = setup();
    component.config!.enableReview = true;
    (component as any).savedEnabled = false;
    api.configureReview.mockReturnValue(
      of({
        enableReview: true,
        visibilityMode: 'PRIVATE',
        configVersion: 2,
        groups: [],
      }),
    );

    component.configure();

    expect(api.checkReviewReadiness).toHaveBeenCalledWith('acp');
    expect(api.configureReview).toHaveBeenCalledWith(
      'acp',
      expect.objectContaining({ enableReview: true, confirmReadinessWarnings: false }),
    );
    component.ngOnDestroy();
  });
});

describe('review filters and group removal', () => {
  it('uses the same selection for display and export, unless explicitly ignored', () => {
    const { component, api } = setup();
    component.comments = [
      {
        id: '1',
        commentText: 'Bitte prüfen',
        authorLabel: 'Alex',
        targetType: 'UNIT',
        groupId: 'g',
      },
      { id: '2', commentText: 'Andere', authorLabel: 'Sam', targetType: 'ITEM' },
    ];
    component.textFilter = ' PRÜFEN ';
    component.authorFilter = 'Alex';
    component.groupFilter = 'g';
    component.targetFilter = 'UNIT';
    expect(component.filteredComments.map((c) => c.id)).toEqual(['1']);
    component.exportComments();
    expect(api.exportVisibleReviewComments).toHaveBeenLastCalledWith('acp', {
      q: 'PRÜFEN',
      author: 'Alex',
      groupId: 'g',
      targetType: 'UNIT',
    });
    component.exportAll = true;
    component.exportComments();
    expect(api.exportVisibleReviewComments).toHaveBeenLastCalledWith('acp', {});
  });
  it('only stages a persisted group deletion after confirmation', () => {
    const { component } = setup();
    const group = { id: 'g', name: 'Group', archived: false, members: [] };
    component.config!.groups = [group];
    component.deleteGroup(group);
    expect(component.groupToDelete).toBe(group);
    component.cancelGroupDeletion();
    expect(component.config!.groups).toHaveLength(1);
    component.deleteGroup(group);
    component.confirmGroupDeletion();
    expect(component.config!.groups).toHaveLength(0);
    expect(component.deletedGroupIds).toEqual(['g']);
    vi.restoreAllMocks();
  });
});

it('restores a staged group when the server rejects deletion', () => {
  const { component, api } = setup();
  const group = { id: 'g', name: 'Group', archived: false, members: [] };
  component.config!.groups = [group];
  component.deleteGroup(group);
  component.confirmGroupDeletion();
  api.configureReview.mockReturnValue(
    throwError(() => ({ status: 400, error: { message: 'Die Gruppe enthält Kommentare.' } })),
  );
  component.configure();
  expect(component.config!.groups).toEqual([group]);
  expect(component.deletedGroupIds).toEqual([]);
  expect(component.error).toContain('enthält Kommentare');
  vi.restoreAllMocks();
});

it('does not let an older background response overwrite a fresh readiness check', () => {
  const { component, api } = setup();
  const pending = new Subject<any>();
  api.getReviewReadiness.mockReturnValue(pending);
  component.loadReadiness();
  component.checkReadiness();
  expect(component.readiness?.status).toBe('READY');
  pending.next({ status: 'BLOCKED' });
  expect(component.readiness?.status).toBe('READY');
  component.ngOnDestroy();
});

it('ignores an older background error after a successful readiness check', () => {
  const { component, api } = setup();
  const pending = new Subject<any>();
  api.getReviewReadiness.mockReturnValue(pending);
  component.loadReadiness();
  component.checkReadiness();
  expect(component.readinessLabel).toBe('Prüfbereit');
  pending.error(new Error('outdated timeout'));
  expect(component.readinessLabel).toBe('Prüfbereit');
  expect(component.readinessError).toBe('');
  component.ngOnDestroy();
});
it('still reports errors of the current readiness request', () => {
  const { component, api } = setup();
  api.getReviewReadiness.mockReturnValue(throwError(() => new Error('offline')));
  component.loadReadiness();
  expect(component.readinessLabel).toBe('Aktualität unbekannt');
  component.ngOnDestroy();
});
