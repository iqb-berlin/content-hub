import { ItemExplorerImportService } from './item-explorer-import.service';
import { ItemExplorerTableService } from './item-explorer-table.service';
import { ItemExplorerPlayerService } from './item-explorer-player.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { ItemExplorerDraftService } from './item-explorer-draft.service';
import { ItemExplorerCollectionsService } from './item-explorer-collections.service';
import { ItemExplorerPersonalDataService } from './item-explorer-personal-data.service';
import { ItemExplorerCommentsService } from './item-explorer-comments.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ItemExplorerFacade } from './item-explorer.facade';
import { VoudService } from '../../core/services/voud.service';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { ItemExplorerPreviewLoader } from './item-explorer-preview-loader.service';
import { ItemExplorerPreviewCoordinator } from './item-explorer-preview-coordinator.service';

function createJwt(sub: string, type = 'user', acpId = ''): string {
  const payload = btoa(
    JSON.stringify({
      sub,
      type,
      acpId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function createFacade(options?: {
  getStartPage?: (definition: string, variableId: string) => number | undefined;
  resolvePlayerTargetLocation?: (
    definition: string,
    variableId: string,
  ) =>
    | {
        absolutePageIndex: number;
        scrollPageIndex?: number;
        isAlwaysVisiblePage: boolean;
      }
    | undefined;
  getFocusIdentifiers?: (definition: string, variableId: string) => string[];
  resolvePlayerResponseTarget?: (
    definition: string,
    variableId: string,
  ) =>
    | {
        responseId: string;
        elementType: string;
        identifiers: string[];
        optionCount?: number;
      }
    | undefined;
  stripConditionalVisibility?: (definition: string) => string;
  api?: Record<string, unknown>;
  authService?: Record<string, unknown>;
  pendingPersonalSessionStorage?: PendingPersonalSessionStorageService;
  previewLoader?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}) {
  const api = options?.api || {};
  const sanitizer = { bypassSecurityTrustHtml: (html: string) => html };
  const getStartPage = options?.getStartPage || (() => 0);
  const voudService = {
    getStartPage,
    resolvePlayerTargetLocation:
      options?.resolvePlayerTargetLocation ||
      ((definition: string, variableId: string) => {
        const startPage = getStartPage(definition, variableId);
        return startPage === undefined
          ? undefined
          : {
              absolutePageIndex: startPage,
              scrollPageIndex: startPage,
              isAlwaysVisiblePage: false,
            };
      }),
    getFocusIdentifiers:
      options?.getFocusIdentifiers || ((_definition: string, variableId: string) => [variableId]),
    resolvePlayerResponseTarget:
      options?.resolvePlayerResponseTarget ||
      ((_definition: string, variableId: string) => ({
        responseId: variableId,
        elementType: 'radio',
        identifiers: [variableId],
        optionCount: 4,
      })),
    stripConditionalVisibility:
      options?.stripConditionalVisibility || ((definition: string) => definition),
  };
  const authOverrides = options?.authService || {};
  const defaultToken = authOverrides['isLoggedIn'] === true ? createJwt('test-user') : null;
  const authService = {
    hasAcpRole: () => false,
    isAdmin: false,
    isLoggedIn: false,
    currentUser$: of(null),
    getToken: () => defaultToken,
    ...authOverrides,
  };

  const diagnostics = {
    start: vi.fn(() => ({ phase: 'test', id: 1, startedAt: 0, startMark: 'test' })),
    finish: vi.fn(),
    ...(options?.diagnostics || {}),
  };
  const previewLoader =
    options?.previewLoader || new ItemExplorerPreviewLoader(api as any, diagnostics as any);
  const previewCoordinator = new ItemExplorerPreviewCoordinator(
    api as any,
    previewLoader as any,
    diagnostics as any,
  );
  const component = new ItemExplorerFacade(
    api as any,
    sanitizer as any,
    authService as any,
    options?.pendingPersonalSessionStorage || new PendingPersonalSessionStorageService(),
    previewCoordinator,
    new ItemExplorerCommentsService(api as any, new ItemExplorerBrowser()),
    new ItemExplorerPersonalDataService(
      api as any,
      options?.pendingPersonalSessionStorage || new PendingPersonalSessionStorageService(),
      new ItemExplorerBrowser(),
    ),
    new ItemExplorerCollectionsService(api as any, new ItemExplorerBrowser()),
    new ItemExplorerDraftService(api as any),
    new ItemExplorerCodingService(voudService as any),
    new ItemExplorerPlayerService(voudService as any),
    new ItemExplorerTableService(),
    new ItemExplorerImportService(api as any),
    diagnostics as any,
  );
  (component.personalData as any).personalDataSessionIdentity =
    new PendingPersonalSessionStorageService().resolveIdentityFromToken(authService.getToken());
  (component.collections as any).collectionSessionIdentity =
    new PendingPersonalSessionStorageService().resolveIdentityFromToken(authService.getToken());
  return component;
}

function destroyFacade(facade: ItemExplorerFacade): void {
  facade.ngOnDestroy();
  facade.comments.ngOnDestroy();
  facade.personalData.ngOnDestroy();
  facade.collections.ngOnDestroy();
  facade.draft.ngOnDestroy();
  facade.player.ngOnDestroy();
  facade.imports.ngOnDestroy();
}

function registerPlayerDom(component: ItemExplorerFacade, postMessage = vi.fn()) {
  const port = {
    hasFrame: vi.fn(() => true),
    postMessage,
    focus: vi.fn(() => true),
    setPrintLabelOverrides: vi.fn(),
    startAutoResize: vi.fn(),
    stopAutoResize: vi.fn(),
  };
  component.registerPlayerDom(port);
  return port;
}

function setPreviewStatus(
  component: ItemExplorerFacade,
  kind: 'idle' | 'loading-unit' | 'loading-response' | 'ready',
) {
  const item =
    component.selectedItem ||
    ({
      itemId: 'test-item',
      unitId: 'test-unit',
      rowKey: 'test-row',
      uuid: 'test-row',
      unitLabel: 'Test unit',
      description: '',
      variableId: 'test-variable',
      metadata: {},
    } as any);
  if (kind === 'idle') {
    (component as any).previewCoordinator.status = { kind: 'idle' };
  } else if (kind === 'loading-response') {
    (component as any).previewCoordinator.status = { kind, item, reuseUnit: true };
  } else {
    (component as any).previewCoordinator.status = { kind, item };
  }
}

describe('ItemExplorerFacade role initialization', () => {
  it('does not lock an OIDC manager into read-only while the profile is still loading', () => {
    const component = createFacade({
      authService: {
        hasAcpRole: () => false,
        isAdmin: false,
        isLoggedIn: true,
        isOidcUser: true,
        currentUser: null,
      },
    });

    component.viewPerspective = 'editor';
    component.checkUserRole();

    expect(component.viewPerspective).toBe('editor');
    expect(component.canEditExplorer).toBe(false);
  });

  it.each([false, true])('uses the server edit grant for credential sessions (%s)', (canEdit) => {
    const component = createFacade({
      authService: {
        hasAcpRole: () => false,
        isAdmin: false,
        isLoggedIn: true,
        isOidcUser: false,
        currentUser: null,
      },
    });

    (component as any).draft.latestExplorerState = { canEdit };
    component.checkUserRole();

    expect(component.viewPerspective).toBe(canEdit ? 'editor' : 'read-only');
    expect(component.canEditExplorer).toBe(canEdit);
  });

  it('synchronizes coding comments with login and logout', () => {
    const component = createFacade();
    const authService = (component as any).authService;
    (component.comments as any).itemCommentsConfigured = false;
    (component.comments as any).codingCommentsConfigured = true;

    authService.isLoggedIn = true;
    component.checkUserRole();

    expect(component.comments.itemCommentsEnabled).toBe(false);
    expect(component.comments.codingCommentsEnabled).toBe(true);

    authService.isLoggedIn = false;
    component.checkUserRole();

    expect(component.comments.codingCommentsEnabled).toBe(false);
  });
});

describe('ItemExplorerFacade automatic comment refresh', () => {
  let component: ItemExplorerFacade;
  let getCounts: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    getCounts = vi.fn().mockReturnValue(of({ revision: '1', counts: [] }));
    component = createFacade({
      api: { getItemCommentCounts: getCounts },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    (component as any).syncItemCommentCountSession();
  });
  afterEach(() => {
    destroyFacade(component);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('refreshes counts and the selected thread every five seconds', () => {
    const token = component.comments.itemCommentRefreshToken;
    const sessionToken = component.comments.itemCommentSessionToken;
    vi.advanceTimersByTime(5000);
    expect(getCounts).toHaveBeenCalledTimes(2);
    expect(component.comments.itemCommentRefreshToken).toBe(token + 1);
    expect(component.comments.itemCommentSessionToken).toBe(sessionToken);
  });
  it('pauses hidden tabs and refreshes immediately on return or focus', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.advanceTimersByTime(15000);
    window.dispatchEvent(new Event('focus'));
    expect(getCounts).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getCounts).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    expect(getCounts).toHaveBeenCalledTimes(3);
  });
  it('does not supersede an in-flight batch on timer or focus events', () => {
    const response = new Subject<any>();
    getCounts.mockReturnValue(response);
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event('focus'));
    expect(getCounts).toHaveBeenCalledTimes(2);
    response.next({ revision: 'latest', counts: [{ unitId: 'U', itemId: 'I', count: 2 }] });
    expect(component.comments.itemCommentCounts['U\u0000I']).toBe(2);
  });
  it('recovers automatically after a failed batch', () => {
    getCounts.mockReturnValueOnce(throwError(() => new Error('offline')));
    vi.advanceTimersByTime(5000);
    expect(component.comments.itemCommentCountsError).not.toBe('');
    vi.advanceTimersByTime(5000);
    expect(component.comments.itemCommentCountsError).toBe('');
    expect(getCounts).toHaveBeenCalledTimes(3);
  });
  it('stops polling and listeners on logout and destruction', () => {
    const sessionToken = component.comments.itemCommentSessionToken;
    component.comments.itemCommentsEnabled = false;
    (component as any).syncItemCommentCountSession();
    expect(component.comments.itemCommentSessionToken).toBe(sessionToken + 1);
    vi.advanceTimersByTime(10000);
    window.dispatchEvent(new Event('focus'));
    expect(getCounts).toHaveBeenCalledTimes(1);
    component.comments.itemCommentsEnabled = true;
    (component as any).syncItemCommentCountSession();
    expect(getCounts).toHaveBeenCalledTimes(2);
    destroyFacade(component);
    vi.advanceTimersByTime(10000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getCounts).toHaveBeenCalledTimes(2);
  });
});

describe('ItemExplorerFacade comment counts', () => {
  const item = (rowKey: string, itemId: string, subId = '') =>
    ({
      rowKey,
      uuid: rowKey,
      unitId: 'unit-1',
      itemId,
      subId,
      unitLabel: 'Unit 1',
      description: '',
      variableId: itemId,
      metadata: {},
    }) as any;

  it('uses the full backend catalog even when a canonical item has no table row', () => {
    const component = createFacade({
      api: {
        getItemCommentCounts: () =>
          of({
            revision: 'catalog',
            counts: [
              { unitId: 'unit-1', itemId: 'item-1', count: 2 },
              { unitId: 'unit-1', itemId: 'unit-1_item-1', count: 0 },
            ],
          }),
      },
    });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    component.items = [item('prefixed', 'unit-1_item-1')];
    component.refreshItemComments(false);
    expect(component.getItemCommentCount(component.items[0])).toBe(0);
    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'unit-1_item-1', count: 0 });
    expect(component.comments.itemCommentCounts['unit-1\u0000item-1']).toBe(2);
    component.columnFilters['comments'] = 'with';
    component.applyFilter(false);
    expect(component.filteredItems).toEqual([]);
    component.columnFilters['comments'] = 'without';
    component.applyFilter(false);
    expect(component.filteredItems).toHaveLength(1);
  });

  it('keeps canonical thread updates separate before the catalog arrives', () => {
    const response = new Subject<any>();
    const component = createFacade({ api: { getItemCommentCounts: () => response } });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    component.items = [item('prefixed', 'unit-1_item-1')];
    component.refreshItemComments(false);
    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'unit-1_item-1', count: 0 });
    response.next({
      revision: 'old',
      counts: [
        { unitId: 'unit-1', itemId: 'item-1', count: 2 },
        { unitId: 'unit-1', itemId: 'unit-1_item-1', count: 1 },
      ],
    });
    expect(component.getItemCommentCount(component.items[0])).toBe(0);
    expect(component.comments.itemCommentCounts['unit-1\u0000item-1']).toBe(2);
  });

  it('keeps distinct raw and prefixed item IDs separate', () => {
    const component = createFacade();
    component.items = [item('raw', 'item-1'), item('prefixed', 'unit-1_item-1')];
    component.comments.itemCommentCounts = {
      'unit-1\u0000item-1': 2,
      'unit-1\u0000unit-1_item-1': 0,
    };
    expect(component.getItemCommentCount(component.items[1])).toBe(0);
  });

  it('loading an empty colliding item does not erase another item count', () => {
    const component = createFacade();
    component.items = [item('raw', 'item-1'), item('prefixed', 'unit-1_item-1')];
    component.comments.itemCommentCounts = {
      'unit-1\u0000item-1': 2,
      'unit-1\u0000unit-1_item-1': 0,
    };
    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'unit-1_item-1', count: 0 });
    expect(component.getItemCommentCount(component.items[0])).toBe(2);
  });

  it.each(['item-1', 'unit-1_item-1'])(
    'preserves a canonical zero count for requested item %s against an initial stale batch',
    (threadItemId) => {
      const response = new Subject<any>();
      const component = createFacade({ api: { getItemCommentCounts: () => response } });
      component.acpId = 'acp-1';
      component.comments.itemCommentsEnabled = true;
      component.refreshItemComments(false);
      component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'item-1', count: 0 });
      response.next({
        revision: 'before-deletion',
        counts: [{ unitId: 'unit-1', itemId: 'item-1', count: 1 }],
      });
      expect(component.getItemCommentCount(item('row', threadItemId))).toBe(0);
    },
  );

  it('preserves an unchanged positive thread count against an older batch', () => {
    const response = new Subject<any>();
    const component = createFacade({ api: { getItemCommentCounts: () => response } });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    component.comments.itemCommentCounts = { 'unit-1\u0000item-1': 1 };
    component.refreshItemComments(false);
    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'item-1', count: 1 });
    response.next({ revision: 'old', counts: [] });
    expect(component.getItemCommentCount(item('row', 'item-1'))).toBe(1);
  });

  it('keeps colliding item counts separate when merging a delayed batch', () => {
    const response = new Subject<any>();
    const component = createFacade({ api: { getItemCommentCounts: () => response } });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    component.items = [item('raw', 'item-1'), item('prefixed', 'unit-1_item-1')];
    component.refreshItemComments(false);
    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'unit-1_item-1', count: 0 });
    response.next({ revision: 'old', counts: [{ unitId: 'unit-1', itemId: 'item-1', count: 2 }] });
    expect(component.getItemCommentCount(component.items[0])).toBe(2);
    expect(component.getItemCommentCount(component.items[1])).toBe(0);
  });

  it('shares one item count across partial-credit rows and filters by status', () => {
    const component = createFacade();
    component.comments.itemCommentsEnabled = true;
    component.items = [
      item('row-a', 'item-1', '0'),
      item('row-b', 'item-1', '1'),
      item('row-c', 'item-2'),
    ];
    component.table.filteredItems = [...component.items];
    component.comments.itemCommentCountsAvailable = true;

    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'item-1', count: 3 });

    expect(component.getItemCommentCount(component.items[0])).toBe(3);
    expect(component.getItemCommentCount(component.items[1])).toBe(3);
    expect(component.getItemCommentCount(item('row-prefixed', 'unit-1_item-1'))).toBe(3);
    component.columnFilters['comments'] = 'with';
    component.applyFilter(false);
    expect(component.filteredItems.map((entry) => entry.rowKey)).toEqual(['row-a', 'row-b']);
    component.columnFilters['comments'] = 'without';
    component.applyFilter(false);
    expect(component.filteredItems.map((entry) => entry.rowKey)).toEqual(['row-c']);
  });

  it('replaces counts from the batch endpoint and refreshes the selected thread', () => {
    const getItemCommentCounts = vi.fn().mockReturnValue(
      of({
        revision: '1',
        counts: [{ unitId: 'unit-1', itemId: 'item-1', count: 2 }],
      }),
    );
    const component = createFacade({ api: { getItemCommentCounts } });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;

    component.refreshItemComments();

    expect(getItemCommentCounts).toHaveBeenCalledWith('acp-1');
    expect(component.comments.itemCommentRefreshToken).toBe(1);
    expect(component.comments.itemCommentCounts).toEqual({ 'unit-1\u0000item-1': 2 });
  });

  it('does not apply a persisted comment filter when comments are unavailable', () => {
    const component = createFacade();
    component.items = [item('row-a', 'item-1')];
    component.columnFilters['comments'] = 'with';
    component.comments.itemCommentsEnabled = false;

    component.applyFilter(false);

    expect(component.filteredItems).toHaveLength(1);
  });

  it('does not let an older batch response overwrite a newer thread count', () => {
    const response = new Subject<any>();
    const component = createFacade({
      api: { getItemCommentCounts: vi.fn().mockReturnValue(response) },
    });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    component.refreshItemComments(false);

    component.updateItemCommentCount({ unitId: 'unit-1', itemId: 'item-1', count: 1 });
    response.next({ revision: 'old', counts: [] });

    expect(component.comments.itemCommentCounts).toEqual({ 'unit-1\u0000item-1': 1 });
  });

  it('keeps comment filters inactive when the initial count request fails', () => {
    const component = createFacade({
      api: {
        getItemCommentCounts: vi.fn().mockReturnValue(throwError(() => new Error('offline'))),
      },
    });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;
    component.items = [item('row-a', 'item-1')];
    component.columnFilters['comments'] = 'with';

    component.refreshItemComments(false);

    expect(component.comments.itemCommentCountsAvailable).toBe(false);
    expect(component.comments.itemCommentCountsError).toContain('nicht geladen');
    expect(component.filteredItems).toHaveLength(1);
  });

  it('invalidates private counts and old responses when the token identity changes', () => {
    const firstResponse = new Subject<any>();
    const secondResponse = new Subject<any>();
    const getItemCommentCounts = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);
    let token = createJwt('user-a');
    const component = createFacade({
      api: { getItemCommentCounts },
      authService: {
        isLoggedIn: true,
        getToken: () => token,
      },
    });
    component.acpId = 'acp-1';
    component.comments.itemCommentsEnabled = true;

    (component as any).syncItemCommentCountSession();
    token = createJwt('user-b');
    (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);

    expect(component.comments.itemCommentCounts).toEqual({});
    expect(component.comments.itemCommentCountsAvailable).toBe(false);
    expect(getItemCommentCounts).toHaveBeenCalledTimes(2);

    firstResponse.next({
      revision: 'old-user',
      counts: [{ unitId: 'unit-1', itemId: 'item-1', count: 4 }],
    });
    expect(component.comments.itemCommentCounts).toEqual({});

    secondResponse.next({
      revision: 'new-user',
      counts: [{ unitId: 'unit-1', itemId: 'item-2', count: 1 }],
    });
    expect(component.comments.itemCommentCounts).toEqual({ 'unit-1\u0000item-2': 1 });
  });

  it('ignores a thread count emitted for an earlier comment refresh session', () => {
    const component = createFacade();
    component.comments.itemCommentRefreshToken = 2;

    component.updateItemCommentCount({
      unitId: 'unit-1',
      itemId: 'item-1',
      count: 3,
      refreshToken: 1,
    });

    expect(component.comments.itemCommentCounts).toEqual({});
  });

  it('adds the comment column after hydrating a configured shared layout', () => {
    const component = createFacade();
    component.comments.itemCommentsEnabled = true;
    const envelope = createExplorerEnvelope();
    envelope.draftState.metadataColumns = {
      layout: {
        configured: true,
        visible: ['system:itemId'],
        order: ['system:itemId'],
        widths: {},
      },
    };

    (component as any).applySharedExplorerEnvelope(envelope);

    expect(component.metadataSettings.layout?.visible).toContain('system:comments');
    expect(component.metadataSettings.layout?.order).toContain('system:comments');
  });

  it('keeps position visible when migrating an explicitly empty legacy column selection', () => {
    const component = createFacade();
    component.comments.itemCommentsEnabled = true;
    const envelope = createExplorerEnvelope();
    envelope.draftState.metadataColumns = {
      layout: {
        configured: true,
        visible: [],
        order: [],
        widths: {},
      },
    };

    (component as any).applySharedExplorerEnvelope(envelope);

    expect(component.metadataSettings.layout?.visible).toEqual(['system:position']);
    expect(component.metadataSettings.layout?.order).toEqual(['system:position']);
    expect(component.metadataSettings.layout?.schemaVersion).toBe(3);
  });

  it('resolves a filtered deep link and consumes its automatic-open state on navigation', () => {
    const component = createFacade();
    (component as any).previewCoordinator.select = vi.fn();
    const target = item('row-target', 'item-1');
    const other = item('row-other', 'item-2');
    component.items = [target, other];
    component.table.filterText = 'does-not-match';
    component.applyFilter(false);
    component.commentThreadInitiallyOpen = true;
    (component as any).initialCommentTarget = {
      unitId: 'unit-1',
      itemId: 'item-1',
    };

    (component as any).selectInitialCommentTarget();

    expect(component.filterText).toBe('');
    expect(component.selectedItem?.rowKey).toBe('row-target');
    expect(component.commentThreadInitiallyOpen).toBe(true);

    component.selectItem(other, 1);

    expect(component.commentThreadInitiallyOpen).toBe(false);
  });
});

function createExplorerEnvelope(
  overrides?: Partial<{
    canEdit: boolean;
    canPublish: boolean;
    status: 'CLEAN' | 'DIRTY';
    publishedFilterText: string;
    draftFilterText: string;
  }>,
) {
  const canEdit = overrides?.canEdit ?? true;
  const canPublish = overrides?.canPublish ?? true;
  const status = overrides?.status ?? 'DIRTY';
  const publishedFilterText = overrides?.publishedFilterText ?? 'published';
  const draftFilterText = overrides?.draftFilterText ?? 'draft';

  return {
    status,
    version: 3,
    publishedVersion: 2,
    canEdit,
    canPublish,
    updatedAt: '2026-04-22T10:00:00.000Z',
    updatedByUsername: 'alice',
    updatedByRole: 'ACP_MANAGER',
    activeState: {
      ui: { filterText: draftFilterText },
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: {},
    },
    publishedState: {
      ui: { filterText: publishedFilterText },
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: {},
    },
    draftState: {
      ui: { filterText: draftFilterText },
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: {},
    },
  } as any;
}

describe('ItemExplorerFacade', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('initializes exactly once and ignores pending responses after destroy', async () => {
    const startPage$ = new Subject<any>();
    const explorerState$ = new Subject<any>();
    const itemList$ = new Subject<any>();
    const currentUser$ = new Subject<unknown>();
    const getAcpStartPage = vi.fn(() => startPage$);
    const getItemExplorerState = vi.fn(() => explorerState$);
    const getFileItemList = vi.fn(() => itemList$);
    const component = createFacade({
      api: { getAcpStartPage, getItemExplorerState, getFileItemList },
      authService: { currentUser$ },
    });

    component.init('');
    component.init('acp-ignored');

    expect(getAcpStartPage).toHaveBeenCalledOnce();
    expect(getAcpStartPage).toHaveBeenCalledWith('');
    expect(getFileItemList).not.toHaveBeenCalled();

    startPage$.next({ featureConfig: { enableItemListTags: true, showStudioItemComments: true } });
    explorerState$.next(createExplorerEnvelope());
    await vi.waitFor(() => expect(getFileItemList).toHaveBeenCalledOnce());

    destroyFacade(component);
    itemList$.next({
      items: [
        {
          itemId: 'late',
          uuid: 'late',
          rowKey: 'late',
          unitId: 'late',
          unitLabel: 'Late response',
          description: '',
          variableId: 'late',
          metadata: {},
        },
      ],
      columns: [],
    });
    currentUser$.next(null);

    expect(component.enableTags).toBe(true);
    expect(component.showStudioItemComments).toBe(true);
    expect(component.itemExplorerPlayerTargetInfoEnabled).toBe(false);
    expect(component.items).toEqual([]);
    expect((component.personalData as any).personalDataSessionIdentity).toBeNull();
    expect((component.collections as any).collectionSessionIdentity).toBeNull();
  });

  it('shows a visible error and skips dependent loads when feature configuration fails', () => {
    const error = new Error('configuration unavailable');
    const getAcpStartPage = vi.fn(() => throwError(() => error));
    const getItemExplorerState = vi.fn();
    const getFileItemList = vi.fn();
    const component = createFacade({
      api: { getAcpStartPage, getItemExplorerState, getFileItemList },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    component.init('acp-1');

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load Item Explorer feature configuration',
      error,
    );
    expect(component.itemListError).toBe(
      'Die Konfiguration des Item-Explorers konnte nicht geladen werden.',
    );
    expect(component.draft.explorerUiStatus).toBe('ERROR');
    expect(getItemExplorerState).not.toHaveBeenCalled();
    expect(getFileItemList).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    { canEdit: true, perspective: 'editor', expected: 'editor' },
    { canEdit: true, perspective: 'read-only', expected: 'read-only' },
    { canEdit: false, perspective: 'editor', expected: 'read-only' },
  ] as const)(
    'loads the initial list using freshly resolved permissions: $canEdit/$perspective',
    async ({ canEdit, perspective, expected }) => {
      const envelope = createExplorerEnvelope({ canEdit });
      const getFileItemList = vi.fn((_id, options) =>
        of({
          itemExplorerStateVersion:
            options.perspective === 'editor' ? envelope.version : envelope.publishedVersion,
          columns: [],
          items: [],
          unitMetadata: {},
          codingSchemes: {},
        }),
      );
      const component = createFacade({
        api: {
          getItemExplorerState: vi.fn().mockReturnValue(of(envelope)),
          getFileItemList,
        },
      });
      component.acpId = 'acp-1';
      component.draft.latestExplorerState = null;
      component.hasExplorerEditPermission = false;
      component.viewPerspective = perspective;
      expect(await (component as any).reloadSharedExplorerStateAndItems()).toBe(true);
      expect(getFileItemList).toHaveBeenCalledExactlyOnceWith('acp-1', { perspective: expected });
      expect(component.itemListError).toBe('');
    },
  );

  it('rejects an item list from another explorer-state version and reloads a consistent pair', async () => {
    const firstEnvelope = createExplorerEnvelope();
    const secondEnvelope = { ...createExplorerEnvelope(), version: 4 };
    const getItemExplorerState = vi
      .fn()
      .mockReturnValueOnce(of(firstEnvelope))
      .mockReturnValueOnce(of(secondEnvelope));
    const getFileItemList = vi
      .fn()
      .mockReturnValueOnce(
        of({
          itemExplorerStateVersion: 2,
          columns: [],
          items: [
            {
              itemId: 'stale',
              unitId: 'u1',
              unitLabel: 'Unit 1',
              description: '',
              metadata: {},
              meanTaskDifficulty: -1,
            },
          ],
          unitMetadata: {},
          codingSchemes: {},
        }),
      )
      .mockReturnValueOnce(
        of({
          itemExplorerStateVersion: 4,
          columns: [],
          items: [
            {
              itemId: 'current',
              unitId: 'u1',
              unitLabel: 'Unit 1',
              description: '',
              metadata: {},
              meanTaskDifficulty: 0.75,
            },
          ],
          unitMetadata: {},
          codingSchemes: {},
        }),
      );
    const component = createFacade({ api: { getItemExplorerState, getFileItemList } });
    component.acpId = 'acp-1';

    const reloaded = await (component as any).reloadSharedExplorerStateAndItems();

    expect(reloaded).toBe(true);
    expect(getItemExplorerState).toHaveBeenCalledTimes(2);
    expect(getFileItemList).toHaveBeenCalledTimes(2);
    expect(component.items).toEqual([
      expect.objectContaining({
        itemId: 'current',
        meanTaskDifficulty: 0.75,
      }),
    ]);
  });

  it('suspends pending personal changes instead of saving after destroy', () => {
    const patchViewItemPreferenceRow = vi.fn().mockReturnValue(of({ rowData: {} }));
    const component = createFacade({
      api: { patchViewItemPreferenceRow },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.setPersonalItemNote('uuid::1', 'Später speichern');

    destroyFacade(component);

    expect(patchViewItemPreferenceRow).not.toHaveBeenCalled();
    expect((component.personalData as any).pendingPersonalRowUpdates.size).toBe(0);
    expect(sessionStorage.getItem('cp_item_explorer_pending_personal:acp-1')).toContain(
      'Später speichern',
    );
  });

  it('stores personal category, colored tags and plain-text notes by row key', () => {
    const patchViewItemPreferenceRow = vi.fn().mockReturnValue(
      of({
        rowData: {
          'uuid-1::2': {
            category: 'II',
            tags: ['Prüfen'],
            note: 'Nur Text',
          },
        },
      }),
    );
    const component = createFacade({
      api: { patchViewItemPreferenceRow },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.personalData.personalItemTags = [{ label: 'Prüfen', color: '#ff0000' }];

    component.setPersonalItemCategory('uuid-1::2', 'II');
    component.addPersonalItemTagToRow('uuid-1::2', {
      target: { value: 'Prüfen' },
    } as any);
    component.setPersonalItemNote('uuid-1::2', 'Nur Text');
    component.flushPersonalItemDataSave();

    expect(patchViewItemPreferenceRow).toHaveBeenCalledWith(
      'acp-1',
      'uuid-1::2',
      {
        category: 'II',
        tags: ['Prüfen'],
        note: 'Nur Text',
      },
      'read-only',
    );
    expect(component.getPersonalTagColor('Prüfen')).toBe('#ff0000');
  });

  it('exports the filtered item order after pending personal changes are saved', async () => {
    const patchViewItemPreferenceRow = vi.fn().mockReturnValue(of({ rowData: {} }));
    const exportViewPersonalItemDataXlsx = vi.fn().mockReturnValue(of(new Blob(['xlsx'])));
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const component = createFacade({
      api: { patchViewItemPreferenceRow, exportViewPersonalItemDataXlsx },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.items = [
      {
        itemId: 'item-2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2::1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'var-2',
        metadata: {},
      },
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'var-1',
        metadata: {},
      },
    ];
    component.table.sortField = '__manual__';
    component.table.itemOrder = ['uuid-2::1', 'uuid-1::1'];
    component.table.filteredItems = [...component.items];
    component.setPersonalItemNote('uuid-1::1', 'Noch zu speichern');

    await component.exportPersonalItemDataXlsx();

    expect(patchViewItemPreferenceRow).toHaveBeenCalledWith(
      'acp-1',
      'uuid-1::1',
      { note: 'Noch zu speichern' },
      'read-only',
    );
    expect(exportViewPersonalItemDataXlsx).toHaveBeenCalledWith(
      'acp-1',
      ['uuid-2::1', 'uuid-1::1'],
      'read-only',
    );
    expect(createObjectUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:export');
    expect(component.personalData.personalExportError).toBe('');
    expect(component.personalData.personalExportInProgress).toBe(false);

    destroyFacade(component);
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it('exports all participants personal data only for ACP managers', async () => {
    const exportAllViewPersonalItemDataCsv = vi.fn().mockReturnValue(of(new Blob(['csv'])));
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:all-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const component = createFacade({ api: { exportAllViewPersonalItemDataCsv } });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.hasExplorerEditPermission = true;
    component.viewPerspective = 'editor';

    expect(component.canExportAllPersonalItemData).toBe(true);
    await component.exportAllPersonalItemDataCsv();

    expect(exportAllViewPersonalItemDataCsv).toHaveBeenCalledWith('acp-1', 'editor', undefined);
    expect(createObjectUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:all-export');
    expect(component.personalData.allPersonalDataExportError).toBe('');
    expect(component.personalData.allPersonalDataExportInProgress).toBe(false);

    component.hasExplorerEditPermission = false;
    expect(component.canExportAllPersonalItemData).toBe(false);
    destroyFacade(component);
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it('exports the active shared list independently of displayed rows and refuses a missing list', async () => {
    const exportAllViewPersonalItemDataCsv = vi.fn().mockReturnValue(of(new Blob(['csv'])));
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:collection-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let filename = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
    });
    const component = createFacade({ api: { exportAllViewPersonalItemDataCsv } });
    Object.assign(component, {
      acpId: 'acp-1',
      hasExplorerEditPermission: true,
      viewPerspective: 'editor',
    });
    Object.assign(component.personalData, { enablePersonalItemData: true });
    Object.assign(component.collections, {
      enableItemCollections: true,
      collectionLoadState: 'loaded',
      activeCollectionId: 'shared-1',
      itemCollections: [
        {
          id: 'shared-1',
          name: 'Auswahl A',
          rowKeys: ['uuid::A', 'uuid::B'],
          ownedByCurrentUser: false,
        },
      ],
    });
    await component.exportAllPersonalItemDataCsv('collection');
    expect(exportAllViewPersonalItemDataCsv).toHaveBeenCalledWith('acp-1', 'editor', 'shared-1');
    expect(filename).toContain('collection-Auswahl-A-shared-1.csv');
    component.collections.activeCollectionId = 'removed';
    await component.exportAllPersonalItemDataCsv('collection');
    expect(exportAllViewPersonalItemDataCsv).toHaveBeenCalledTimes(1);
    destroyFacade(component);
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it('shows a scoped export failure beside collections without leaving the export busy', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const component = createFacade({
      api: {
        exportAllViewPersonalItemDataCsv: vi
          .fn()
          .mockReturnValue(throwError(() => ({ status: 404 }))),
      },
    });
    Object.assign(component, { acpId: 'acp-1', hasExplorerEditPermission: true });
    Object.assign(component.personalData, { enablePersonalItemData: true });
    Object.assign(component.collections, {
      enableItemCollections: true,
      collectionLoadState: 'loaded',
      activeCollectionId: 'removed',
      itemCollections: [{ id: 'removed', name: 'Removed', rowKeys: [] }],
    });
    await component.exportAllPersonalItemDataCsv('collection');
    expect(component.personalData.collectionDataExportError).toContain('nicht mehr verfügbar');
    expect(component.personalData.allPersonalDataExportError).toBe('');
    expect(component.personalData.allPersonalDataExportInProgress).toBe(false);
    destroyFacade(component);
    log.mockRestore();
  });

  it('does not expose personal working-data controls to anonymous visitors', () => {
    const component = createFacade({ authService: { isLoggedIn: false } });
    component.personalData.enablePersonalItemData = true;

    expect(component.showPersonalItemData).toBe(false);
  });

  it('saves manager personal data against the current editor perspective', () => {
    const patchViewItemPreferenceRow = vi.fn().mockReturnValue(of({ rowData: {} }));
    const component = createFacade({
      api: { patchViewItemPreferenceRow },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.hasExplorerEditPermission = true;
    component.viewPerspective = 'editor';

    component.setPersonalItemNote('uuid-1', 'Draft-Notiz');
    component.flushPersonalItemDataSave();

    expect(patchViewItemPreferenceRow).toHaveBeenCalledWith(
      'acp-1',
      'uuid-1',
      { note: 'Draft-Notiz' },
      'editor',
    );
  });

  it('keeps the queued perspective when it changes before the debounce is flushed', () => {
    const patchViewItemPreferenceRow = vi.fn().mockReturnValue(of({ rowData: {} }));
    const component = createFacade({
      api: { patchViewItemPreferenceRow },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.hasExplorerEditPermission = true;
    component.viewPerspective = 'editor';

    component.setPersonalItemNote('uuid-draft', 'Draft-Notiz');
    component.viewPerspective = 'read-only';
    component.flushPersonalItemDataSave();

    expect(patchViewItemPreferenceRow).toHaveBeenCalledWith(
      'acp-1',
      'uuid-draft',
      { note: 'Draft-Notiz' },
      'editor',
    );
  });

  it('blocks personal edits while the perspective is switching', () => {
    const component = createFacade({
      api: { patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({ rowData: {} })) },
      authService: { isLoggedIn: true },
    });
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.perspectiveSwitchBusy = true;

    component.setPersonalItemNote('uuid-1', 'Nicht übernehmen');

    expect(component.canChangePersonalItemData).toBe(false);
    expect(component.personalData.personalItemData).toEqual({});
    expect((component.personalData as any).pendingPersonalRowUpdates.size).toBe(0);
  });

  it('keeps local search and personal filters out of the shared Explorer UI state', () => {
    const component = createFacade({ authService: { isLoggedIn: true } });
    component.table.filterText = 'lokale Suche';
    component.table.columnFilters = {
      unitLabel: 'Mathematik',
      personalNote: 'vertraulich',
    };
    component.personalData.personalColumnFilters = { personalNote: 'vertraulich' };

    const sharedUi = (component as any).buildUiPreferences();
    expect(sharedUi).not.toHaveProperty('filterText');
    expect(sharedUi.columnFilters).toEqual({
      unitLabel: 'Mathematik',
    });

    (component as any).applyUiPreferences({
      filterText: 'fremde gespeicherte Suche',
      columnFilters: { unitLabel: 'Deutsch', personalCategory: 'III' },
    });
    expect(component.filterText).toBe('lokale Suche');
    expect(component.columnFilters).toEqual({ unitLabel: 'Deutsch' });
    expect(component.personalData.personalColumnFilters).toEqual({ personalNote: 'vertraulich' });
  });

  it('disables personal edits after a load failure without clearing known data', () => {
    const patchViewItemPreferenceRow = vi.fn();
    const component = createFacade({
      api: {
        getViewItemPreferences: vi.fn().mockReturnValue(throwError(() => new Error('offline'))),
        patchViewItemPreferenceRow,
      },
      authService: { isLoggedIn: true },
    });
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalItemData = { 'uuid::1': { note: 'bestehend' } };

    (component.personalData as any).loadPersonalItemData();
    component.setPersonalItemNote('uuid::1', 'überschrieben');

    expect(component.personalData.personalDataLoadState).toBe('error');
    expect(component.personalData.personalItemData).toEqual({ 'uuid::1': { note: 'bestehend' } });
    expect(patchViewItemPreferenceRow).not.toHaveBeenCalled();
  });

  it('keeps the newest edit after an older save succeeds and retries it after a failure', async () => {
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    const retry = new Subject<unknown>();
    const patch = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(retry);
    const component = createFacade({
      api: { patchViewItemPreferenceRow: patch },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    try {
      component.setPersonalItemNote('row-1', 'first');
      component.flushPersonalItemDataSave();
      component.setPersonalItemNote('row-1', 'latest');
      component.flushPersonalItemDataSave();
      expect(patch).toHaveBeenCalledTimes(1);
      first.next({});
      first.complete();
      expect(patch).toHaveBeenNthCalledWith(2, 'acp-1', 'row-1', { note: 'latest' }, 'read-only');
      const leaving = component.canDeactivate();
      second.error(new Error('offline'));
      await expect(leaving).resolves.toBe(false);
      expect(component.personalData.personalItemData['row-1'].note).toBe('latest');
      const retriedNavigation = component.canDeactivate();
      expect(patch).toHaveBeenNthCalledWith(3, 'acp-1', 'row-1', { note: 'latest' }, 'read-only');
      retry.next({});
      retry.complete();
      await expect(retriedNavigation).resolves.toBe(true);
      expect(component.personalData.personalDataSaveState).toBe('saved');
      expect(component.personalData.personalItemData['row-1'].note).toBe('latest');
    } finally {
      destroyFacade(component);
    }
  });

  it.each(['success', 'error'])('ignores a late save %s from the previous identity', (outcome) => {
    let token = createJwt('user-a');
    const oldSave = new Subject<unknown>();
    const newSave = new Subject<unknown>();
    const patch = vi.fn().mockReturnValueOnce(oldSave).mockReturnValueOnce(newSave);
    const component = createFacade({
      api: { patchViewItemPreferenceRow: patch, getViewItemPreferences: () => of({ rowData: {} }) },
      authService: { isLoggedIn: true, getToken: () => token },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    try {
      component.setPersonalItemNote('row-1', 'private A');
      component.flushPersonalItemDataSave();
      token = createJwt('user-b');
      (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);
      component.setPersonalItemNote('row-1', 'private B');
      component.flushPersonalItemDataSave();
      expect(patch).toHaveBeenCalledTimes(2);
      if (outcome === 'success') {
        oldSave.next({});
        oldSave.complete();
      } else {
        oldSave.error(new Error('late failure'));
      }
      expect(component.personalData.personalItemData).toEqual({ 'row-1': { note: 'private B' } });
      expect(component.personalData.personalDataSaveState).toBe('saving');
      expect(component.personalData.personalDataError).toBe('');
      newSave.next({});
      newSave.complete();
      expect(component.personalData.personalDataSaveState).toBe('saved');
      expect(component.canDeactivate()).toBe(true);
    } finally {
      destroyFacade(component);
    }
  });

  it('blocks navigation while a personal autosave keeps failing', async () => {
    const component = createFacade({
      api: {
        patchViewItemPreferenceRow: vi.fn().mockReturnValue(throwError(() => new Error('offline'))),
      },
      authService: { isLoggedIn: true },
    });
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.setPersonalItemNote('uuid::1', 'ungespeichert');
    component.flushPersonalItemDataSave();

    expect(component.personalData.personalDataSaveState).toBe('error');
    await expect(component.canDeactivate()).resolves.toBe(false);
  });

  it('allows navigation after failed personal changes are explicitly discarded', () => {
    const getViewItemPreferences = vi.fn().mockReturnValue(
      of({
        rowData: {
          'uuid::1': { note: 'Gespeicherter Stand' },
        },
      }),
    );
    const component = createFacade({
      api: {
        getViewItemPreferences,
        patchViewItemPreferenceRow: vi.fn().mockReturnValue(throwError(() => new Error('offline'))),
      },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.setPersonalItemNote('uuid::1', 'Ungespeicherter Stand');
    component.flushPersonalItemDataSave();

    component.openDiscardPersonalItemDataDialog();
    expect(component.personalData.showDiscardPersonalItemDataDialog).toBe(true);

    component.confirmDiscardPersonalItemDataChanges();

    expect((component.personalData as any).pendingPersonalRowUpdates.size).toBe(0);
    expect(component.personalData.personalItemData).toEqual({
      'uuid::1': { note: 'Gespeicherter Stand' },
    });
    expect(getViewItemPreferences).toHaveBeenCalledWith('acp-1', 'item-explorer');
    expect(component.canDeactivate()).toBe(true);
  });

  it('does not wait indefinitely when pending personal data can no longer be saved', async () => {
    const component = createFacade({
      api: { patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({ rowData: {} })) },
      authService: { isLoggedIn: true },
    });
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.setPersonalItemNote('uuid::1', 'ungespeichert');
    (component.personalData as any).personalDataSessionIdentity = null;

    await expect(component.canDeactivate()).resolves.toBe(false);
    destroyFacade(component);
  });

  it('clears personal data before loading a different session identity', () => {
    let token = createJwt('user-a');
    const secondLoad = new Subject<any>();
    const getViewItemPreferences = vi
      .fn()
      .mockReturnValueOnce(of({ rowData: { 'uuid::1': { note: 'Nur A' } } }))
      .mockReturnValueOnce(secondLoad);
    const component = createFacade({
      api: { getViewItemPreferences },
      authService: {
        isLoggedIn: true,
        getToken: () => token,
      },
    });
    component.personalData.enablePersonalItemData = true;
    (component as any).syncPersonalItemDataSession();
    expect(component.personalData.personalItemData).toEqual({ 'uuid::1': { note: 'Nur A' } });

    token = createJwt('user-b');
    (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);

    expect(component.personalData.personalItemData).toEqual({});
    expect(component.personalData.personalDataLoadState).toBe('loading');

    secondLoad.next({ rowData: { 'uuid::1': { note: 'Nur B' } } });
    secondLoad.complete();
    expect(component.personalData.personalItemData).toEqual({ 'uuid::1': { note: 'Nur B' } });
  });

  it('restores pending personal changes after the same identity logs in again', () => {
    let token: string | null = createJwt('user-a');
    const patchViewItemPreferenceRow = vi.fn().mockReturnValue(of({ rowData: {} }));
    const component = createFacade({
      api: {
        getViewItemPreferences: vi
          .fn()
          .mockReturnValue(of({ rowData: { 'uuid::1': { note: 'Serverwert' } } })),
        patchViewItemPreferenceRow,
      },
      authService: {
        isLoggedIn: true,
        getToken: () => token,
      },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.hasExplorerEditPermission = true;
    component.viewPerspective = 'read-only';
    component.setPersonalItemNote('uuid::1', 'Noch nicht gespeichert');

    token = null;
    (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);
    expect(component.personalData.personalItemData).toEqual({});

    token = createJwt('user-a');
    (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);

    expect(component.personalData.personalItemData).toEqual({
      'uuid::1': { note: 'Noch nicht gespeichert' },
    });
    expect((component.personalData as any).pendingPersonalRowUpdates.size).toBe(1);
    expect(component.personalData.personalDataSaveState).toBe('pending');
    component.viewPerspective = 'editor';
    component.flushPersonalItemDataSave();
    expect(patchViewItemPreferenceRow).toHaveBeenCalledWith(
      'acp-1',
      'uuid::1',
      { note: 'Noch nicht gespeichert' },
      'read-only',
    );
    destroyFacade(component);
  });

  it('restores pending changes from memory when session storage is unavailable', () => {
    const setItem = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    const getItem = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    const removeItem = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    try {
      const pendingStorage = new PendingPersonalSessionStorageService();
      let firstToken: string | null = createJwt('user-a');
      const firstComponent = createFacade({
        api: { patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({ rowData: {} })) },
        authService: {
          isLoggedIn: true,
          getToken: () => firstToken,
        },
        pendingPersonalSessionStorage: pendingStorage,
      });
      firstComponent.acpId = 'acp-1';
      firstComponent.personalData.enablePersonalItemData = true;
      firstComponent.personalData.personalDataLoadState = 'loaded';
      firstComponent.setPersonalItemNote('uuid::1', 'Fallback-Notiz');
      firstToken = null;
      (firstComponent as any).authStorageListener({ key: 'cp_token' } as StorageEvent);
      firstComponent.comments.ngOnDestroy();
      firstComponent.personalData.ngOnDestroy();
      firstComponent.collections.ngOnDestroy();
      firstComponent.draft.ngOnDestroy();
      firstComponent.comments.ngOnDestroy();
      firstComponent.personalData.ngOnDestroy();
      firstComponent.collections.ngOnDestroy();
      firstComponent.ngOnDestroy();

      const secondComponent = createFacade({
        api: {
          getViewItemPreferences: vi.fn().mockReturnValue(of({ rowData: {} })),
          patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({ rowData: {} })),
        },
        authService: {
          isLoggedIn: true,
          getToken: () => createJwt('user-a'),
        },
        pendingPersonalSessionStorage: pendingStorage,
      });
      secondComponent.acpId = 'acp-1';
      secondComponent.personalData.enablePersonalItemData = true;
      (secondComponent as any).syncPersonalItemDataSession();

      expect(secondComponent.personalData.personalItemData).toEqual({
        'uuid::1': { note: 'Fallback-Notiz' },
      });
      expect((secondComponent as any).personalData.pendingPersonalRowUpdates.size).toBe(1);
      secondComponent.comments.ngOnDestroy();
      secondComponent.personalData.ngOnDestroy();
      secondComponent.collections.ngOnDestroy();
      secondComponent.draft.ngOnDestroy();
      secondComponent.comments.ngOnDestroy();
      secondComponent.personalData.ngOnDestroy();
      secondComponent.collections.ngOnDestroy();
      secondComponent.ngOnDestroy();
      expect(setItem).toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalled();
      expect(removeItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
      removeItem.mockRestore();
    }
  });

  it('discards suspended personal changes when a different identity logs in', () => {
    let token: string | null = createJwt('user-a');
    const component = createFacade({
      api: {
        getViewItemPreferences: vi
          .fn()
          .mockReturnValue(of({ rowData: { 'uuid::1': { note: 'Nur B' } } })),
        patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({ rowData: {} })),
      },
      authService: {
        isLoggedIn: true,
        getToken: () => token,
      },
    });
    component.acpId = 'acp-1';
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.setPersonalItemNote('uuid::1', 'Nur A');

    token = null;
    (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);
    token = createJwt('user-b');
    (component as any).authStorageListener({ key: 'cp_token' } as StorageEvent);

    expect(component.personalData.personalItemData).toEqual({ 'uuid::1': { note: 'Nur B' } });
    expect((component.personalData as any).pendingPersonalRowUpdates.size).toBe(0);
    expect(sessionStorage.getItem('cp_item_explorer_pending_personal:acp-1')).toBeNull();
    destroyFacade(component);
  });

  it('reapplies an active personal note filter when a note changes', () => {
    const component = createFacade({
      api: { patchViewItemPreferenceRow: vi.fn().mockReturnValue(of({ rowData: {} })) },
      authService: { isLoggedIn: true },
    });
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalDataLoadState = 'loaded';
    component.personalData.personalColumnFilters = { personalNote: 'prüfen' };
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid',
        rowKey: 'uuid::1',
        subId: '1',
        subIdDisplay: '',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.applyFilter(false);
    expect(component.filteredItems).toEqual([]);

    component.setPersonalItemNote('uuid::1', 'Später prüfen');

    expect(component.filteredItems).toEqual(component.items);
    component.flushPersonalItemDataSave();
  });

  it('defaults to sorting by task label', () => {
    const component = createFacade();

    expect(component.sortField).toBe('unitLabel');
    expect(component.sortDir).toBe('asc');
    expect(component.sortIsMeta).toBe(false);
  });

  describe('manual sorting toggle', () => {
    function createSortingFacade() {
      const component = createFacade();
      (component as any).explorerEditingAllowed = true;
      component.table.allColumns = [{ id: 'level', label: 'Level', kind: 'number' }];
      component.table.columns = [...component.allColumns];
      component.items = [1, 2, 3].map((index) => ({
        itemId: `ITEM_${index}`,
        uuid: `uuid-${index}`,
        rowKey: `uuid-${index}`,
        unitId: `UNIT_${index}`,
        unitLabel: `Aufgabe ${index}`,
        description: '',
        variableId: '',
        metadata: { level: index },
      }));
      component.table.filteredItems = [...component.items];
      component.table.itemOrder = ['uuid-2', 'uuid-1', 'uuid-3'];
      vi.spyOn(component as any, 'syncSelectionAfterListMutation').mockImplementation(() => {});
      const queueDraftPatch = vi
        .spyOn(component as any, 'queueDraftPatch')
        .mockImplementation(() => {});
      return { component, queueDraftPatch };
    }

    it.each(['asc', 'desc'] as const)('restores a system column sorted %s', (direction) => {
      const { component, queueDraftPatch } = createSortingFacade();
      component.sortBy('itemId');
      if (direction === 'desc') component.sortBy('itemId');
      const previousRows = component.filteredItems.map((item) => item.rowKey);
      queueDraftPatch.mockClear();

      component.toggleManualOrderMode();
      expect(component.sortField).toBe('__manual__');
      expect(component.filteredItems.map((item) => item.rowKey)).toEqual(component.itemOrder);

      component.toggleManualOrderMode();
      expect(component.sortField).toBe('itemId');
      expect(component.sortDir).toBe(direction);
      expect(component.sortIsMeta).toBe(false);
      expect(component.filteredItems.map((item) => item.rowKey)).toEqual(previousRows);
      expect(queueDraftPatch.mock.calls.map(([type]) => type)).toEqual([
        'UI_STATE_CHANGED',
        'UI_STATE_CHANGED',
      ]);
      expect(queueDraftPatch).toHaveBeenLastCalledWith('UI_STATE_CHANGED', {
        ui: expect.objectContaining({ sortField: 'itemId', sortDir: direction, sortIsMeta: false }),
      });
    });

    it('restores the metadata sort column and direction', () => {
      const { component } = createSortingFacade();
      component.sortByMeta('level');
      component.sortByMeta('level');
      const previousRows = component.filteredItems.map((item) => item.rowKey);

      component.toggleManualOrderMode();
      component.toggleManualOrderMode();

      expect(component.sortField).toBe('level');
      expect(component.sortDir).toBe('desc');
      expect(component.sortIsMeta).toBe(true);
      expect(component.filteredItems.map((item) => item.rowKey)).toEqual(previousRows);
    });

    it('retains edited manual order when leaving and re-entering the mode', () => {
      const { component, queueDraftPatch } = createSortingFacade();
      component.toggleManualOrderMode();
      component.selectedItem = component.items[1];
      component.moveSelectedItem(1);
      const editedOrder = [...component.itemOrder];
      expect(editedOrder).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
      expect(queueDraftPatch).toHaveBeenLastCalledWith(
        'ITEM_ORDER_CHANGED',
        { itemOrder: editedOrder },
        true,
      );
      queueDraftPatch.mockClear();

      component.toggleManualOrderMode();
      component.moveSelectedItem(1);
      expect(component.itemOrder).toEqual(editedOrder);
      component.toggleManualOrderMode();

      expect(component.itemOrder).toEqual(editedOrder);
      expect(component.filteredItems.map((item) => item.rowKey)).toEqual(editedOrder);
      expect(queueDraftPatch.mock.calls.every(([type]) => type === 'UI_STATE_CHANGED')).toBe(true);
    });

    it('remembers a newly selected column on the next toggle cycle', () => {
      const { component } = createSortingFacade();
      component.toggleManualOrderMode();
      component.sortBy('itemId');
      component.sortBy('itemId');

      component.toggleManualOrderMode();
      component.toggleManualOrderMode();

      expect(component.sortField).toBe('itemId');
      expect(component.sortDir).toBe('desc');
    });

    it('falls back to task ascending after reloading a saved manual mode', () => {
      const { component } = createSortingFacade();
      (component as any).applyUiPreferences({
        sortField: '__manual__',
        sortDir: 'asc',
        sortIsMeta: false,
      });
      const savedOrder = [...component.itemOrder];

      component.toggleManualOrderMode();

      expect(component.sortField).toBe('unitLabel');
      expect(component.sortDir).toBe('asc');
      expect(component.sortIsMeta).toBe(false);
      expect(component.itemOrder).toEqual(savedOrder);
    });

    it('uses a visible fallback if the previous column was hidden meanwhile', () => {
      const { component } = createSortingFacade();
      component.metadataSettings.referenceNumberVisible = true;
      component.sortBy('rowNumber');
      component.toggleManualOrderMode();
      component.metadataSettings.referenceNumberVisible = false;

      component.toggleManualOrderMode();

      expect(component.sortField).toBe('unitLabel');
      expect(component.sortDir).toBe('asc');
    });

    it('initializes an absent manual order only once', () => {
      const { component } = createSortingFacade();
      component.table.itemOrder = [];
      component.toggleManualOrderMode();
      const order = component.itemOrder;
      component.toggleManualOrderMode();
      component.toggleManualOrderMode();
      expect(component.itemOrder).toBe(order);
      expect(order).toEqual(component.items.map((item) => item.rowKey));
    });

    it('disables movement without a selection, edit permission or manual mode', () => {
      const { component } = createSortingFacade();
      component.toggleManualOrderMode();
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(false);

      component.selectedItem = component.items[0];
      expect(component.canMoveSelectedItem(-1)).toBe(true);
      expect(component.canMoveSelectedItem(1)).toBe(true);
      (component as any).explorerEditingAllowed = false;
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(false);

      (component as any).explorerEditingAllowed = true;
      component.toggleManualOrderMode();
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(false);
    });

    it('disables movement at the manual order boundaries and prevents changes', () => {
      const { component, queueDraftPatch } = createSortingFacade();
      component.toggleManualOrderMode();
      queueDraftPatch.mockClear();
      component.selectedItem = component.items[1];
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(true);
      component.moveSelectedItem(-1);

      component.selectedItem = component.items[2];
      expect(component.canMoveSelectedItem(-1)).toBe(true);
      expect(component.canMoveSelectedItem(1)).toBe(false);
      component.moveSelectedItem(1);
      expect(component.itemOrder).toEqual(['uuid-2', 'uuid-1', 'uuid-3']);
      expect(queueDraftPatch).not.toHaveBeenCalled();
    });

    it('handles missing and single-item orders without enabling impossible movement', () => {
      const { component } = createSortingFacade();
      component.toggleManualOrderMode();
      component.selectedItem = component.items[0];
      component.table.itemOrder = ['uuid-2'];
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(false);

      component.table.itemOrder = [];
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(true);
      component.items = [component.selectedItem];
      expect(component.canMoveSelectedItem(-1)).toBe(false);
      expect(component.canMoveSelectedItem(1)).toBe(false);
    });
  });

  it('keeps the task default when shared ui state is empty', () => {
    const component = createFacade();

    (component as any).applyUiPreferences({});

    expect(component.sortField).toBe('unitLabel');
    expect(component.sortDir).toBe('asc');
    expect(component.sortIsMeta).toBe(false);
  });

  it('lets shared ui preferences override the default sorting', () => {
    const component = createFacade();

    (component as any).applyUiPreferences({
      sortField: 'itemId',
      sortDir: 'desc',
      sortIsMeta: false,
    });

    expect(component.sortField).toBe('itemId');
    expect(component.sortDir).toBe('desc');
    expect(component.sortIsMeta).toBe(false);
  });

  it('filters and sorts partial-credit rows independently by Sub-ID label', () => {
    const component = createFacade();
    component.table.hasPartialCredit = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::2',
        subId: '2',
        subIdDisplay: 'vollständig richtig',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
        empiricalDifficulty: 0.8,
      },
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::1',
        subId: '1',
        subIdDisplay: 'teilweise richtig',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
        empiricalDifficulty: 0.2,
      },
    ];
    component.table.filteredItems = [...component.items];

    component.sortBy('subIdDisplay');
    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['uuid-1::1', 'uuid-1::2']);

    component.columnFilters['subId'] = 'vollständig';
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['uuid-1::2']);
    expect(component.filteredItems[0].empiricalDifficulty).toBe(0.8);
  });

  it('keeps persisted row numbers attached while filtering and sorting', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'ITEM_10',
        uuid: 'uuid-10',
        rowKey: 'uuid-10',
        rowNumber: 8,
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        rowNumber: 3,
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.table.filteredItems = [...component.items];

    component.sortBy('itemId');
    expect(component.filteredItems.map((item) => [item.rowKey, item.rowNumber])).toEqual([
      ['uuid-2', 3],
      ['uuid-10', 8],
    ]);

    component.table.filterText = '10';
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => [item.rowKey, item.rowNumber])).toEqual([
      ['uuid-10', 8],
    ]);
  });

  it('sorts VERA rows by the complete visible item id with deterministic tie-breakers', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: '01',
        uuid: 'uuid-mdv010-01',
        rowKey: 'uuid-mdv010-01',
        rowNumber: 6,
        unitId: 'MDV010',
        unitLabel: 'Aufgabe 10',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: '10',
        uuid: 'uuid-mdv002-10',
        rowKey: 'uuid-mdv002-10',
        rowNumber: 5,
        unitId: 'MDV002',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: '01',
        uuid: 'uuid-mdv002-01',
        rowKey: 'uuid-mdv002-01::10',
        rowNumber: 3,
        subId: '10',
        subIdDisplay: '10',
        unitId: 'MDV002',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: '02',
        uuid: 'uuid-mdv002-02',
        rowKey: 'uuid-mdv002-02',
        rowNumber: 4,
        unitId: 'MDV002',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: '01',
        uuid: 'uuid-mdv002-01',
        rowKey: 'uuid-mdv002-01::2-b',
        rowNumber: 2,
        subId: '2',
        subIdDisplay: '2',
        unitId: 'MDV002',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: '01',
        uuid: 'uuid-mdv002-01',
        rowKey: 'uuid-mdv002-01::2-a',
        rowNumber: 1,
        subId: '2',
        subIdDisplay: '2',
        unitId: 'MDV002',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.table.filteredItems = [...component.items];
    (component as any).applyUiPreferences({
      sortField: 'itemId',
      sortDir: 'asc',
      sortIsMeta: false,
    });

    (component as any).applySort(false);

    const ascendingRowKeys = component.filteredItems.map((item) => item.rowKey);
    expect(ascendingRowKeys).toEqual([
      'uuid-mdv002-01::2-a',
      'uuid-mdv002-01::2-b',
      'uuid-mdv002-01::10',
      'uuid-mdv002-02',
      'uuid-mdv002-10',
      'uuid-mdv010-01',
    ]);
    expect(component.filteredItems.map((item) => item.rowNumber)).toEqual([1, 2, 3, 4, 5, 6]);

    (component as any).applyUiPreferences({
      sortField: 'itemId',
      sortDir: 'desc',
      sortIsMeta: false,
    });
    (component as any).applySort(false);

    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(
      [...ascendingRowKeys].reverse(),
    );
    expect(component.filteredItems.map((item) => item.rowNumber)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('falls back to task sorting when the saved reference-number sort is hidden', () => {
    const component = createFacade();
    component.table.sortField = 'rowNumber';
    component.table.sortDir = 'desc';
    component.metadataSettings.referenceNumberVisible = false;
    component.items = [
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        rowNumber: 2,
        unitId: 'UNIT_2',
        unitLabel: 'Aufgabe B',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        rowNumber: 9,
        unitId: 'UNIT_1',
        unitLabel: 'Aufgabe A',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];

    component.applyFilter(false);

    expect(component.sortField).toBe('unitLabel');
    expect(component.sortDir).toBe('asc');
    expect(component.filteredItems.map((item) => item.rowNumber)).toEqual([9, 2]);
  });

  it('keeps stable reference numbers sortable when their column is visible', () => {
    const component = createFacade();
    component.metadataSettings.referenceNumberVisible = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        rowNumber: 8,
        unitId: 'UNIT_1',
        unitLabel: 'Aufgabe A',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        rowNumber: 3,
        unitId: 'UNIT_2',
        unitLabel: 'Aufgabe B',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.table.filteredItems = [...component.items];

    component.sortBy('rowNumber');

    expect(component.filteredItems.map((item) => item.rowNumber)).toEqual([3, 8]);
  });

  it('treats reference-number visibility as an opt-in ACP setting', () => {
    const component = createFacade();

    expect((component as any).resolveMetadataSettings({}).referenceNumberVisible).toBe(false);
    expect(
      (component as any).resolveMetadataSettings({
        metadataColumns: { referenceNumberVisible: true },
      }).referenceNumberVisible,
    ).toBe(true);
  });

  it('toggles position through the shared layout and restores its default visibility', () => {
    const component = createFacade();
    const positionColumn = component.allTableColumns.find(
      (column) => column.key === 'system:position',
    )!;

    expect(component.isColumnVisible(positionColumn)).toBe(true);
    expect(component.tableColumns[0].key).toBe('system:position');

    component.setColumnWidth(positionColumn, 120);
    const itemIdColumn = component.tableColumns.find((column) => column.key === 'system:itemId')!;
    expect(component.getStickyTableColumnLeft(itemIdColumn, component.tableColumns)).toBe(120);
    component.toggleColumnVisibility(positionColumn);

    expect(component.isColumnVisible(positionColumn)).toBe(false);
    expect(component.tableColumns.some((column) => column.key === 'system:position')).toBe(false);
    expect(
      component.getStickyTableColumnLeft(component.tableColumns[0], component.tableColumns),
    ).toBe(0);

    component.collections.enableItemCollections = true;
    component.toggleReferenceNumberVisibility();

    const visibleColumns = component.tableColumns;
    expect(visibleColumns.slice(0, 2).map((column) => column.key)).toEqual([
      'system:referenceNumber',
      'system:itemId',
    ]);
    expect(component.getStickyTableColumnLeft(visibleColumns[0], visibleColumns)).toBe(38);
    expect(component.getStickyTableColumnLeft(visibleColumns[1], visibleColumns)).toBe(178);

    component.resetToDefault();

    expect(component.isColumnVisible(positionColumn)).toBe(true);
    expect(component.tableColumns[0].key).toBe('system:position');
  });

  it('keeps an enabled reference number directly before the sticky Item-ID column', () => {
    const component = createFacade();

    component.toggleReferenceNumberVisibility();

    const tableColumns = component.tableColumns;
    const tableColumnsSpy = vi.spyOn(component, 'tableColumns', 'get');

    expect(tableColumns.slice(0, 3).map((column) => column.id)).toEqual([
      'position',
      'referenceNumber',
      'itemId',
    ]);
    expect(component.isStickyTableColumn(tableColumns[0], tableColumns)).toBe(true);
    expect(component.isStickyTableColumn(tableColumns[1], tableColumns)).toBe(true);
    expect(component.isStickyTableColumn(tableColumns[2], tableColumns)).toBe(true);
    expect(component.getStickyTableColumnLeft(tableColumns[2], tableColumns)).toBe(212);
    expect(tableColumnsSpy).not.toHaveBeenCalled();
  });

  it('offsets sticky table columns by the collection selection column when enabled', () => {
    const component = createFacade();
    component.collections.enableItemCollections = true;

    const itemIdColumn = component.tableColumns.find((column) => column.id === 'itemId')!;
    expect(component.getStickyTableColumnLeft(itemIdColumn, component.tableColumns)).toBe(110);

    component.toggleReferenceNumberVisibility();

    const tableColumns = component.tableColumns;

    expect(component.getStickyTableColumnLeft(tableColumns[0], tableColumns)).toBe(38);
    expect(component.getStickyTableColumnLeft(tableColumns[1], tableColumns)).toBe(110);
    expect(component.getStickyTableColumnLeft(tableColumns[2], tableColumns)).toBe(250);
  });

  it('normalizes persisted layouts to keep reference number and Item-ID pinned first', () => {
    const component = createFacade();
    component.table.metadataSettings = {
      visible: [],
      order: [],
      configured: true,
      widths: {},
      layout: {
        visible: ['system:itemId', 'system:unitLabel', 'system:referenceNumber', 'system:position'],
        order: ['system:unitLabel', 'system:itemId', 'system:referenceNumber', 'system:position'],
        configured: true,
        widths: {},
      },
    };

    const tableColumns = component.tableColumns;

    expect(tableColumns.map((column) => column.id)).toEqual([
      'position',
      'referenceNumber',
      'itemId',
      'unitLabel',
    ]);
    expect(component.isStickyTableColumn(tableColumns[0], tableColumns)).toBe(true);
    expect(component.isStickyTableColumn(tableColumns[1], tableColumns)).toBe(true);
    expect(component.isStickyTableColumn(tableColumns[2], tableColumns)).toBe(true);
    expect(component.canMoveTableColumn(tableColumns[0], 1)).toBe(false);
    expect(component.canMoveTableColumn(tableColumns[1], 1)).toBe(false);
    expect(component.canMoveTableColumn(tableColumns[2], 1)).toBe(false);
  });

  it('restores column settings when the column manager is cancelled', () => {
    const component = createFacade();
    component.table.metadataSettings = {
      visible: ['subject'],
      order: ['subject'],
      configured: true,
      widths: { subject: 220 },
      referenceNumberVisible: false,
    };

    component.openColumnManager();
    component.toggleReferenceNumberVisibility();
    expect(component.referenceNumberVisible).toBe(true);

    component.closeColumnManager();

    expect(component.metadataSettings).toEqual({
      visible: ['subject'],
      order: ['subject'],
      configured: true,
      widths: { subject: 220 },
      referenceNumberVisible: false,
    });
  });

  it('distinguishes the default column set from an explicitly empty selection', () => {
    const component = createFacade();
    component.table.allColumns = [
      { id: 'subject', label: 'Fach' },
      { id: 'custom', label: 'Eigene Spalte' },
    ];

    component.table.metadataSettings = {
      visible: [],
      order: [],
      configured: false,
      widths: {},
    };
    expect(component.filterVisibleColumns(component.allColumns)).toHaveLength(2);

    component.metadataSettings.configured = true;
    expect(component.filterVisibleColumns(component.allColumns)).toEqual([]);
  });

  it('adds access-configured columns and clamps widths without changing the default selection', () => {
    const component = createFacade();
    component.table.configuredMetadataColumns = [
      { id: 'custom', label: 'Eigene Spalte', kind: 'text' },
    ];
    const columns = (component as any).getAvailableMetadataColumns([
      { id: 'subject', label: 'Fach' },
    ]);
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'subject', label: 'Fach' }),
        expect.objectContaining({ id: 'custom', label: 'Eigene Spalte' }),
      ]),
    );

    component.setColumnWidth({ id: 'custom', label: 'Eigene Spalte' }, 900);
    expect(component.getColumnWidth({ id: 'custom', label: 'Eigene Spalte' })).toBe(600);
    expect(component.metadataSettings.configured).toBe(false);
    expect(component.filterVisibleColumns(component.allColumns)).toEqual(component.allColumns);
    expect(component.canResetMetadataSettings).toBe(true);
  });

  it('offers VOMD time metadata only through the canonical numeric columns', () => {
    const component = createFacade();
    component.table.configuredMetadataColumns = [
      { id: 'iqb_time_item', label: 'Konfigurierte Itemzeit', kind: 'text' },
      { id: 'iqb_item_time', label: 'Konfigurierte alte Itemzeit', kind: 'text' },
      { id: 'iqb_time_stimulus', label: 'Konfigurierte Stimuluszeit', kind: 'text' },
      { id: 'custom', label: 'Eigene Spalte', kind: 'text' },
    ];

    const columns = (component as any).getAvailableMetadataColumns([
      { id: 'iqb_time_item', label: 'Itemzeit' },
      { id: 'iqb_item_time', label: 'Alte Itemzeit' },
      { id: 'itemTimeSeconds', label: 'Itemzeit aus Import' },
      { id: 'iqb_time_stimulus', label: 'Stimuluszeit' },
      { id: 'subject', label: 'Fach' },
    ]);

    expect(columns.filter((column: { id: string }) => column.id === 'itemTimeSeconds')).toEqual([
      { id: 'itemTimeSeconds', label: 'Itemzeit (s)', kind: 'number' },
    ]);
    expect(columns.filter((column: { id: string }) => column.id === 'stimulusTimeSeconds')).toEqual(
      [{ id: 'stimulusTimeSeconds', label: 'Stimuluszeit (s)', kind: 'number' }],
    );
    expect(columns.map((column: { id: string }) => column.id)).not.toContain('iqb_time_item');
    expect(columns.map((column: { id: string }) => column.id)).not.toContain('iqb_item_time');
    expect(columns.map((column: { id: string }) => column.id)).not.toContain('iqb_time_stimulus');
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'subject', label: 'Fach' }),
        expect.objectContaining({ id: 'custom', label: 'Eigene Spalte' }),
      ]),
    );
  });

  it('displays and filters canonical time overrides instead of differing VOMD display metadata', () => {
    const component = createFacade();
    const columns = (component as any).getAvailableMetadataColumns([
      { id: 'iqb_time_item', label: 'Itemzeit' },
    ]);
    const itemTimeColumn = columns.find(
      (column: { id: string }) => column.id === 'itemTimeSeconds',
    );
    component.table.allColumns = columns;
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: { iqb_time_item: '00:30' },
        itemTimeSeconds: 40,
      },
      {
        itemId: 'item-2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'unit-2',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: 'v2',
        metadata: { iqb_time_item: '00:45' },
        itemTimeSeconds: 0,
      },
    ];
    component.table.columnFilters = { itemTimeSeconds: '40' };

    expect(component.getMetadataColumnDisplayValue(component.items[0], itemTimeColumn)).toBe('40');
    expect(component.getMetadataColumnDisplayValue(component.items[1], itemTimeColumn)).toBe('0');
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['item-1']);
  });

  it('materializes the default column order before moving a column', () => {
    const component = createFacade();
    component.table.allColumns = [
      { id: 'first', label: 'Zuerst' },
      { id: 'second', label: 'Danach' },
    ];
    component.table.metadataSettings = {
      visible: [],
      order: [],
      configured: false,
      widths: {},
    };

    component.moveColumnUp(component.allColumns[1]);

    expect(component.metadataSettings).toMatchObject({
      visible: ['first', 'second'],
      order: ['second', 'first'],
      configured: true,
    });
    expect(component.columns.map((column) => column.id)).toEqual(['second', 'first']);
  });

  it('enforces published reviewer columns against stale layouts and direct toggle calls', () => {
    const component = createFacade();
    (component as any).explorerEditingAllowed = false;
    component.table.allColumns = [
      { id: 'secret', label: 'Secret' },
      { id: 'skill', label: 'Skill' },
    ];
    component.personalData.enablePersonalItemData = true;
    (component.personalData as any).personalDataSessionIdentity = 'oidc:reader';
    (component as any).draft.latestExplorerState = {
      publishedState: {
        metadataColumns: {
          restrictReviewerColumnsToManagerSelection: true,
          layout: { configured: true, visible: ['system:itemId', 'metadata:skill'] },
        },
      },
    };
    component.metadataSettings.layout = {
      configured: true,
      visible: ['metadata:secret', 'metadata:skill'],
      order: ['metadata:secret', 'metadata:skill'],
      widths: {},
    };
    expect(component.tableColumns.map((c) => c.key)).toEqual(['system:itemId', 'metadata:skill']);
    expect(component.filteredAllColumns.some((c) => c.key === 'metadata:secret')).toBe(false);
    expect(component.filteredAllColumns.some((c) => c.key === 'personal:note')).toBe(true);
    component.toggleColumnVisibility({ id: 'secret', label: 'Secret' });
    expect(component.isColumnVisible({ id: 'secret', label: 'Secret' })).toBe(false);
    const skill = component.allTableColumns.find((c) => c.key === 'metadata:skill')!;
    component.toggleColumnVisibility(skill);
    expect(component.tableColumns.map((c) => c.key)).toEqual(['system:itemId']);
    component.resetToDefault();
    expect(component.tableColumns.some((c) => c.key === 'metadata:secret')).toBe(false);
  });

  it('materializes the manager selection and cancels restriction changes with the dialog', () => {
    const component = createFacade();
    (component as any).explorerEditingAllowed = true;
    component.openColumnManager();
    component.setRestrictReviewerColumns(true);
    expect(component.metadataSettings.restrictReviewerColumnsToManagerSelection).toBe(true);
    expect(component.metadataSettings.layout?.visible).toContain('system:itemId');
    expect(component.metadataSettings.layout?.visible).toContain('system:unitLabel');
    component.closeColumnManager();
    expect(component.metadataSettings.restrictReviewerColumnsToManagerSelection).not.toBe(true);
  });

  it('offers fixed, configured, and personal columns in one configurable table layout', () => {
    const component = createFacade();
    component.table.allColumns = [{ id: 'customQuality', label: 'Eigene Qualitätsspalte' }];
    component.table.columns = [...component.allColumns];
    component.enableTags = true;
    component.personalData.enablePersonalItemData = true;
    component.personalData.personalItemCategoryLabel = 'Kompetenzstufe';
    (component.personalData as any).personalDataSessionIdentity = 'oidc:test-user';

    expect(component.allTableColumns.map((column) => column.label)).toEqual([
      'Position',
      'Referenz-Nr.',
      'Item-ID',
      'Aufgabe',
      'Eigene Qualitätsspalte',
      'Tags',
      'Kompetenzstufe',
      'Markierungen',
      'Notiz',
    ]);

    const taskColumn = component.allTableColumns.find((column) => column.id === 'unitLabel')!;
    const competenceColumn = component.allTableColumns.find(
      (column) => column.id === 'personalCategory',
    )!;
    component.setColumnWidth(taskColumn, 310);
    component.setColumnWidth(competenceColumn, 230);
    component.moveColumnDown(taskColumn);

    expect(component.getColumnWidth(taskColumn)).toBe(310);
    expect(component.getColumnWidth(competenceColumn)).toBe(230);
    expect(component.tableColumns.map((column) => column.id)).toEqual([
      'position',
      'itemId',
      'customQuality',
      'unitLabel',
      'tags',
      'personalCategory',
      'personalTags',
      'personalNote',
    ]);
    expect(component.metadataSettings).toMatchObject({
      configured: true,
      visible: ['customQuality'],
      order: ['customQuality'],
      layout: {
        configured: true,
        widths: {
          'system:unitLabel': 310,
          'personal:category': 230,
        },
      },
    });
  });

  it('keeps Item-ID pinned while moving other visible columns', () => {
    const component = createFacade();
    component.table.hasPartialCredit = false;
    component.enableTags = true;
    component.table.metadataSettings = {
      visible: [],
      order: [],
      configured: true,
      widths: {},
      layout: {
        visible: ['system:itemId', 'system:subId', 'system:unitLabel', 'system:tags'],
        order: ['system:itemId', 'system:subId', 'system:unitLabel', 'system:tags'],
        configured: true,
        widths: {},
      },
    };
    const taskColumn = component.allTableColumns.find((column) => column.id === 'unitLabel')!;

    component.moveColumnUp(taskColumn);

    expect(component.tableColumns.map((column) => column.id)).toEqual([
      'itemId',
      'unitLabel',
      'tags',
    ]);
    expect(component.metadataSettings.layout?.order).toEqual([
      'system:itemId',
      'system:subId',
      'system:unitLabel',
      'system:tags',
    ]);

    component.moveColumnDown(taskColumn);

    expect(component.tableColumns.map((column) => column.id)).toEqual([
      'itemId',
      'tags',
      'unitLabel',
    ]);
  });

  it('clears hidden column filters and switches to a visible sort when settings are saved', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'UNIT_2',
        unitLabel: 'Beta',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Alpha',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.table.columnFilters = { unitLabel: 'Alpha' };
    component.table.sortField = 'unitLabel';
    component.table.filteredItems = [...component.items];
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['ITEM_1']);
    const queueDraftPatch = vi.spyOn(component as any, 'queueDraftPatch');
    const taskColumn = component.allTableColumns.find((column) => column.id === 'unitLabel')!;

    component.toggleColumnVisibility(taskColumn);
    component.saveMetadataSettings();

    expect(component.columnFilters).not.toHaveProperty('unitLabel');
    expect(component.sortField).toBe('itemId');
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['ITEM_1', 'ITEM_2']);
    expect(queueDraftPatch).toHaveBeenCalledWith(
      'METADATA_COLUMNS_CHANGED',
      expect.objectContaining({
        ui: expect.objectContaining({
          sortField: 'itemId',
          sortIsMeta: false,
          columnFilters: {},
        }),
      }),
      true,
    );
  });

  it('keeps legacy metadata-only column settings compatible with the unified layout', () => {
    const component = createFacade();
    component.table.allColumns = [
      { id: 'first', label: 'Erste Metadatenspalte' },
      { id: 'second', label: 'Zweite Metadatenspalte' },
    ];
    component.table.metadataSettings = (component as any).resolveMetadataSettings({
      metadataColumns: {
        visible: ['second'],
        order: ['second'],
        widths: { second: 260 },
      },
    });
    component.table.columns = component.filterVisibleColumns(component.allColumns);

    expect(component.metadataSettings.layout?.configured).toBe(false);
    expect(component.tableColumns.map((column) => column.id)).toEqual([
      'position',
      'itemId',
      'unitLabel',
      'second',
    ]);
    expect(component.getColumnWidth(component.tableColumns[3])).toBe(260);
  });

  it('normalizes legacy VOMD time settings without writing a draft', () => {
    const component = createFacade();
    component.table.allColumns = (component as any).getAvailableMetadataColumns([
      { id: 'iqb_time_item', label: 'Itemzeit' },
      { id: 'iqb_time_stimulus', label: 'Stimuluszeit' },
    ]);
    const envelope = createExplorerEnvelope();
    const state = {
      ui: {
        sortField: 'iqb_time_item',
        sortIsMeta: true,
        sortDir: 'desc',
        columnFilters: {
          iqb_time_item: '00:30',
          iqb_time_stimulus: 'nicht numerisch',
          unitLabel: 'Lesen',
        },
      },
      tags: {},
      metadataColumns: {
        visible: ['iqb_time_item', 'itemTimeSeconds'],
        order: ['iqb_time_item', 'subject', 'itemTimeSeconds'],
        widths: { iqb_time_item: 180, itemTimeSeconds: 220 },
        layout: {
          configured: true,
          visible: ['metadata:iqb_time_item', 'metadata:itemTimeSeconds'],
          order: ['metadata:iqb_time_item', 'system:itemId', 'metadata:itemTimeSeconds'],
          widths: { 'metadata:iqb_time_item': 190, 'metadata:itemTimeSeconds': 230 },
          schemaVersion: 3,
        },
      },
      itemOrder: [],
      itemProperties: {},
    };
    envelope.activeState = state;
    envelope.draftState = state;
    envelope.publishedState = state;
    const queueDraftPatch = vi.spyOn(component as any, 'queueDraftPatch');

    (component as any).applySharedExplorerEnvelope(envelope);

    expect(component.metadataSettings.visible).toEqual(['itemTimeSeconds']);
    expect(component.metadataSettings.order).toEqual(['itemTimeSeconds', 'subject']);
    expect(component.metadataSettings.widths).toEqual({ itemTimeSeconds: 220 });
    expect(component.metadataSettings.layout).toMatchObject({
      visible: ['metadata:itemTimeSeconds'],
      order: ['metadata:itemTimeSeconds', 'system:itemId'],
      widths: { 'metadata:itemTimeSeconds': 230 },
      schemaVersion: 3,
    });
    expect(component.sortField).toBe('itemTimeSeconds');
    expect(component.sortIsMeta).toBe(true);
    expect(component.sortDir).toBe('desc');
    expect(component.columnFilters).toEqual({ itemTimeSeconds: '30' });
    expect(queueDraftPatch).not.toHaveBeenCalled();
  });

  it('keeps canonical settings authoritative when legacy and current filters coexist', () => {
    const component = createFacade();

    (component as any).applyUiPreferences({
      sortField: 'iqb_time_stimulus',
      sortIsMeta: true,
      sortDir: 'asc',
      columnFilters: {
        iqb_time_item: '00:30',
        itemTimeSeconds: '',
        iqb_time_stimulus: '1:02:03',
      },
    });

    expect(component.sortField).toBe('stimulusTimeSeconds');
    expect(component.columnFilters).toEqual({
      itemTimeSeconds: '',
      stimulusTimeSeconds: '3723',
    });
  });

  it('honors legacy VOMD time keys in restricted published reviewer layouts', () => {
    const component = createFacade();
    (component as any).explorerEditingAllowed = false;
    component.table.allColumns = (component as any).getAvailableMetadataColumns([]);
    (component as any).draft.latestExplorerState = {
      publishedState: {
        metadataColumns: {
          restrictReviewerColumnsToManagerSelection: true,
          layout: {
            configured: true,
            visible: ['system:itemId', 'metadata:iqb_time_item'],
          },
        },
      },
    };
    component.metadataSettings.layout = {
      configured: true,
      visible: ['system:itemId', 'metadata:itemTimeSeconds'],
      order: ['system:itemId', 'metadata:itemTimeSeconds'],
      widths: {},
      schemaVersion: 3,
    };

    expect(component.tableColumns.map((column) => column.key)).toEqual([
      'system:itemId',
      'metadata:itemTimeSeconds',
    ]);
  });

  it('allows an explicitly empty selection to be reset to defaults', () => {
    const component = createFacade();
    component.table.metadataSettings = {
      visible: [],
      order: [],
      configured: true,
      widths: {},
    };

    expect(component.canResetMetadataSettings).toBe(true);
    component.resetToDefault();
    expect(component.canResetMetadataSettings).toBe(false);
  });

  it('keeps an empty tag tombstone visible in the draft state immediately', () => {
    const component = createFacade();
    (component as any).explorerEditingAllowed = true;
    (component as any).draft.suppressDraftPatch = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Aufgabe',
        description: '',
        variableId: 'V1',
        metadata: {},
        tags: ['Prüfen'],
      },
    ];
    component.itemTags = { 'uuid-1': ['Prüfen'] };

    component.removeItemTag('uuid-1', 'Prüfen');

    expect(component.itemTags).toEqual({ 'uuid-1': [] });
    expect(component.items[0].tags).toEqual([]);
    expect((component as any).normalizeTags({ 'uuid-1': [] })).toEqual({ 'uuid-1': [] });
  });

  it('ignores stale item-list responses after a newer reload completes', () => {
    const firstLoad = new Subject<any>();
    const secondLoad = new Subject<any>();
    const getFileItemList = vi
      .fn()
      .mockReturnValueOnce(firstLoad.asObservable())
      .mockReturnValueOnce(secondLoad.asObservable());
    const component = createFacade({ api: { getFileItemList } });
    component.acpId = 'acp-1';

    component.reloadItems();
    component.reloadItems();

    expect(component.itemListLoading).toBe(true);

    secondLoad.next({
      columns: [],
      items: [
        {
          itemId: 'ITEM_1',
          uuid: 'uuid-1',
          rowKey: 'uuid-1',
          rowNumber: 1,
          unitId: 'UNIT_1',
          unitLabel: 'Unit 1',
          description: '',
          variableId: '',
          metadata: {},
        },
      ],
      unitMetadata: {},
      codingSchemes: {},
    });

    expect(component.itemListLoading).toBe(false);
    expect(component.items.map((item) => item.rowNumber)).toEqual([1]);

    firstLoad.next({
      columns: [],
      items: [
        {
          itemId: 'ITEM_1',
          uuid: 'uuid-1',
          rowKey: 'uuid-1',
          rowNumber: 9,
          unitId: 'UNIT_1',
          unitLabel: 'Unit 1',
          description: '',
          variableId: '',
          metadata: {},
        },
      ],
      unitMetadata: {},
      codingSchemes: {},
    });

    expect(component.itemListLoading).toBe(false);
    expect(component.items.map((item) => item.rowNumber)).toEqual([1]);
  });

  it('shows and clears the slow-connection hint for a delayed item list', () => {
    vi.useFakeTimers();
    const itemList$ = new Subject<any>();
    const component = createFacade({
      api: { getFileItemList: vi.fn(() => itemList$) },
    });
    component.acpId = 'acp-1';

    try {
      component.reloadItems();
      vi.advanceTimersByTime(1500);
      expect(component.itemListSlow).toBe(true);

      itemList$.next({
        columns: [],
        items: [],
        unitMetadata: {},
        codingSchemes: {},
      });
      expect(component.itemListSlow).toBe(false);
    } finally {
      destroyFacade(component);
      vi.useRealTimers();
    }
  });

  it('lets ACP managers recalculate the numbering and reloads the rows', () => {
    const recalculateItemRowNumbers = vi.fn(() => of({ renumberedCount: 1 }));
    const component = createFacade({ api: { recalculateItemRowNumbers } });
    component.acpId = 'acp-1';
    (component as any).explorerEditingAllowed = true;
    component.draft.latestExplorerState = createExplorerEnvelope({ status: 'CLEAN' });
    const reloadItems = vi.spyOn(component, 'reloadItems').mockImplementation(() => undefined);

    component.openRenumberDialog();
    component.confirmRenumber();

    expect(recalculateItemRowNumbers).toHaveBeenCalledWith('acp-1');
    expect(component.showRenumberDialog).toBe(false);
    expect(component.numberingSuccessMessage).toBe(
      'Eine Referenznummer im vollständigen Itembestand wurde neu vergeben. 0 Zeilen werden aktuell angezeigt.',
    );
    expect(reloadItems).toHaveBeenCalledTimes(1);
  });

  it('reloads shared state and canonical item projections after a renumbering conflict', () => {
    const recalculateItemRowNumbers = vi.fn(() =>
      throwError(() => ({ status: 409, error: { message: 'Source files changed' } })),
    );
    const component = createFacade({ api: { recalculateItemRowNumbers } });
    component.acpId = 'acp-1';
    component.draft.latestExplorerState = createExplorerEnvelope({ status: 'CLEAN' });
    component.showRenumberDialog = true;
    const reloadSharedExplorerStateAndItems = vi
      .spyOn(component as any, 'reloadSharedExplorerStateAndItems')
      .mockResolvedValue(undefined);

    component.confirmRenumber();

    expect(component.renumberError).toBe('Source files changed');
    expect(reloadSharedExplorerStateAndItems).toHaveBeenCalledTimes(1);
  });

  it('keeps a draft patch conflict visible after reloading the shared state', async () => {
    const component = createFacade({
      api: {
        patchItemExplorerDraft: vi.fn(() => throwError(() => ({ status: 409 }))),
        getItemExplorerState: vi.fn(() => of(createExplorerEnvelope({ status: 'DIRTY' }))),
      },
    });
    component.acpId = 'acp-1';
    (component as any).explorerEditingAllowed = true;
    component.draft.explorerVersion = 3;
    (component as any).draft.pendingDraftPatch = { tags: { 'row-1': ['QA'] } };
    const reloadItems = vi
      .spyOn(component, 'reloadItems')
      .mockImplementation((onSettled) => onSettled?.('loaded'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const flushed = await (component as any).flushDraftPatch();

    expect(flushed).toBe(false);
    expect(component.draft.lastDraftOperationError).toBe(
      'Konflikt beim Aktualisieren des Entwurfs. Der Explorer wurde neu geladen.',
    );
    expect(component.draft.explorerUiStatus).toBe('ERROR');
    expect(reloadItems).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('serializes and merges draft patches without replacing the local search', async () => {
    const firstPatch$ = new Subject<any>();
    const secondPatch$ = new Subject<any>();
    const savedEnvelope = createExplorerEnvelope({
      status: 'CLEAN',
    });
    savedEnvelope.version = 6;
    savedEnvelope.publishedVersion = 3;
    const saveItemExplorerDraft = vi.fn(() => of(savedEnvelope));
    const patchItemExplorerDraft = vi
      .fn()
      .mockReturnValueOnce(firstPatch$)
      .mockReturnValueOnce(secondPatch$);
    const component = createFacade({ api: { patchItemExplorerDraft, saveItemExplorerDraft } });
    component.acpId = 'acp-1';
    (component as any).explorerEditingAllowed = true;
    component.canPublishExplorer = true;
    component.draft.explorerVersion = 3;
    vi.spyOn(component, 'reloadItems').mockImplementation(() => undefined);

    component.setFilterText('lokale Suche');
    (component as any).queueDraftPatch('UI_STATE_CHANGED', { ui: { sortField: 'itemId' } }, true);
    expect(patchItemExplorerDraft).toHaveBeenCalledTimes(1);
    expect(patchItemExplorerDraft).toHaveBeenLastCalledWith('acp-1', {
      changeType: 'UI_STATE_CHANGED',
      patch: { ui: { sortField: 'itemId' } },
      baseVersion: 3,
    });
    const savePromise = component.saveExplorerDraft(true);

    component.setFilterText('aktualisierte lokale Suche');
    (component as any).queueDraftPatch(
      'UI_STATE_CHANGED',
      { ui: { sortField: 'unitLabel' } },
      true,
    );
    (component as any).queueDraftPatch(
      'ITEM_EXCLUSION_CHANGED',
      { itemPropertiesPatch: { 'row-1': { excluded: true } } },
      true,
    );
    (component as any).queueDraftPatch(
      'ITEM_EXCLUSION_CHANGED',
      { itemPropertiesPatch: { 'row-2': { excluded: true } } },
      true,
    );
    (component as any).queueDraftPatch(
      'PREVIEW_TARGET_CHANGED',
      { itemPropertiesPatch: { 'row-1': { previewTargetId: 'V2' } } },
      true,
    );
    (component as any).queueDraftPatch(
      'ITEM_EXCLUSION_CHANGED',
      { itemPropertiesPatch: { 'row-2': null, 'row-3': null } },
      true,
    );
    (component as any).queueDraftPatch(
      'PREVIEW_TARGET_CHANGED',
      { itemPropertiesPatch: { 'row-3': { previewTargetId: 'V3' } } },
      true,
    );
    expect(patchItemExplorerDraft).toHaveBeenCalledTimes(1);

    const firstEnvelope = createExplorerEnvelope();
    firstEnvelope.version = 4;
    firstPatch$.next(firstEnvelope);
    firstPatch$.complete();

    await vi.waitFor(() => expect(patchItemExplorerDraft).toHaveBeenCalledTimes(2));
    expect(saveItemExplorerDraft).not.toHaveBeenCalled();
    expect(component.filterText).toBe('aktualisierte lokale Suche');
    expect(patchItemExplorerDraft).toHaveBeenLastCalledWith('acp-1', {
      changeType: 'PREVIEW_TARGET_CHANGED',
      patch: {
        ui: { sortField: 'unitLabel' },
        itemPropertiesPatch: {
          'row-1': { excluded: true, previewTargetId: 'V2' },
          'row-2': null,
          'row-3': { previewTargetId: 'V3' },
        },
      },
      baseVersion: 4,
    });

    const secondEnvelope = createExplorerEnvelope();
    secondEnvelope.version = 5;
    secondPatch$.next(secondEnvelope);
    secondPatch$.complete();

    await vi.waitFor(() => expect(saveItemExplorerDraft).toHaveBeenCalledWith('acp-1', 5));
    await expect(savePromise).resolves.toBe(true);
    expect(component.draft.explorerVersion).toBe(6);
    expect(component.filterText).toBe('aktualisierte lokale Suche');
    expect(component.draft.lastDraftOperationError).toBe('');
  });

  it('restores a removed tag when saving the optimistic change fails', async () => {
    const envelope = createExplorerEnvelope({ status: 'DIRTY' });
    envelope.draftState.tags = { 'row-1': ['Alt'] };
    envelope.activeState.tags = { 'row-1': ['Alt'] };
    const component = createFacade({
      api: {
        patchItemExplorerDraft: vi.fn(() =>
          throwError(() => ({
            status: 500,
            error: { message: 'Tag konnte nicht gespeichert werden' },
          })),
        ),
      },
    });
    component.acpId = 'acp-1';
    (component as any).explorerEditingAllowed = true;
    component.draft.explorerVersion = 3;
    component.draft.latestExplorerState = envelope;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'row-1',
        rowKey: 'row-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '01',
        metadata: {},
        tags: ['Alt'],
      },
    ];
    component.itemTags = { 'row-1': ['Alt'] };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    component.removeItemTag('row-1', 'Alt');
    expect(component.itemTags['row-1']).toEqual([]);
    expect(component.items[0].tags).toEqual([]);

    const flushed = await (component as any).flushDraftPatch();

    expect(flushed).toBe(false);
    expect(component.itemTags['row-1']).toEqual(['Alt']);
    expect(component.items[0].tags).toEqual(['Alt']);
    expect((component as any).draft.pendingDraftPatch).toBeNull();
    expect(component.draft.lastDraftOperationError).toBe('Tag konnte nicht gespeichert werden');
    consoleError.mockRestore();
  });

  it('blocks renumbering while draft changes are pending or being saved', () => {
    const recalculateItemRowNumbers = vi.fn(() => of({ renumberedCount: 0 }));

    for (const status of ['DIRTY', 'SAVING'] as const) {
      const component = createFacade({ api: { recalculateItemRowNumbers } });
      component.draft.latestExplorerState = createExplorerEnvelope({ status: 'CLEAN' });
      component.draft.explorerUiStatus = status;

      expect(component.isRenumberingBlocked()).toBe(true);
      expect(component.getRenumberingActionTitle()).toMatch(
        status === 'SAVING' ? /warten/i : /Entwurf/i,
      );

      component.openRenumberDialog();
      expect(component.showRenumberDialog).toBe(false);

      component.showRenumberDialog = true;
      component.confirmRenumber();
      expect(component.renumberError).toMatch(status === 'SAVING' ? /warten/i : /Entwurf/i);
    }

    expect(recalculateItemRowNumbers).not.toHaveBeenCalled();
  });

  it('blocks renumbering until state loading and perspective switching settle', () => {
    const recalculateItemRowNumbers = vi.fn(() => of({ renumberedCount: 0 }));
    const component = createFacade({ api: { recalculateItemRowNumbers } });

    expect(component.isRenumberingBlocked()).toBe(true);
    expect(component.getRenumberingActionTitle()).toMatch(/Status geladen/i);
    component.openRenumberDialog();
    expect(component.showRenumberDialog).toBe(false);

    component.draft.latestExplorerState = createExplorerEnvelope({ status: 'CLEAN' });
    component.perspectiveSwitchBusy = true;
    expect(component.isRenumberingBlocked()).toBe(true);
    expect(component.getRenumberingActionTitle()).toMatch(/Ansichtswechsel/i);
    component.openRenumberDialog();

    expect(component.showRenumberDialog).toBe(false);

    component.perspectiveSwitchBusy = false;
    component.itemListLoading = true;
    expect(component.isRenumberingBlocked()).toBe(true);
    expect(component.getRenumberingActionTitle()).toMatch(/Item-Liste geladen/i);
    component.openRenumberDialog();

    expect(component.showRenumberDialog).toBe(false);
    expect(recalculateItemRowNumbers).not.toHaveBeenCalled();
  });

  it('sorts partial-credit rows manually by stable row key', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::1',
        subId: '1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::2',
        subId: '2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.table.filteredItems = [...component.items];
    component.table.itemOrder = ['uuid-1::2', 'uuid-1::1'];
    component.table.sortField = '__manual__';

    (component as any).applySort(false);

    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['uuid-1::2', 'uuid-1::1']);
  });

  it('selects partial-credit rows with the same item UUID by stable row key', () => {
    const component = createFacade();
    const first = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1::1',
      subId: '1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: '',
      variableId: '',
      metadata: {},
    } as any;
    const second = { ...first, rowKey: 'uuid-1::2', subId: '2' };

    component.selectItem(first, 0);
    component.selectItem(second, 1);

    expect(component.selectedItem?.rowKey).toBe('uuid-1::2');
    expect(component.selectedIndex).toBe(1);
  });

  it('reuses the loaded player assets when selecting another item in the same unit', async () => {
    const getResponseStateWithFallback = vi.fn(() => of({ state: null, isFallback: false }));
    const previewLoader = { load: vi.fn(), clear: vi.fn() };
    const diagnostics = {
      start: vi.fn(() => ({ phase: 'test', id: 1, startedAt: 0, startMark: 'test' })),
      finish: vi.fn(),
    };
    const component = createFacade({
      api: { getResponseStateWithFallback },
      previewLoader,
      diagnostics,
    });
    component.acpId = 'acp-1';
    component.player.unit = { id: 'UNIT_1', dependencies: [] };
    component.player.playerSrcDoc = '<html>cached player</html>';
    component.player.definitionContent = '{"pages":[]}';
    const item = {
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      rowKey: 'uuid-2',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 2',
      variableId: 'VAR_2',
      metadata: {},
    } as any;
    component.table.filteredItems = [item];

    component.selectItem(item, 0);
    await vi.waitFor(() => expect(getResponseStateWithFallback).toHaveBeenCalledOnce());

    expect(previewLoader.load).not.toHaveBeenCalled();
    expect(component.playerSrcDoc).toBe('<html>cached player</html>');
    expect(component.previewUpdateInProgress).toBe(false);
  });

  it('ignores retained-player state while a same-unit response state is loading', async () => {
    const responseState$ = new Subject<any>();
    const getResponseStateWithFallback = vi.fn(() => responseState$);
    const previewLoader = { load: vi.fn(), clear: vi.fn() };
    const component = createFacade({
      api: { getResponseStateWithFallback },
      previewLoader,
    });
    component.acpId = 'acp-1';
    component.player.unit = { id: 'UNIT_1', dependencies: [] };
    component.player.playerSrcDoc = '<html>cached player</html>';
    component.player.definitionContent = '{"pages":[]}';
    setPreviewStatus(component, 'ready');
    component.player.activePlayerSessionId = 'old-session';
    component.selectedItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    } as any;
    const nextItem = {
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      rowKey: 'uuid-2',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 2',
      variableId: 'VAR_2',
      metadata: {},
    } as any;
    component.table.filteredItems = [component.selectedItem, nextItem] as any;

    component.selectItem(nextItem, 1);
    expect(component.previewUpdateInProgress).toBe(true);
    expect(component.isPreviewLoading).toBe(false);
    expect(component.shouldRenderPlayerFrame).toBe(true);

    component.handlePlayerMessage({
      type: 'vopStateChangedNotification',
      sessionId: 'old-session',
      unitState: { dataParts: { stale: true } },
    });
    component.saveCurrentResponseState();

    expect(component.currentResponseData).toBeNull();
    expect(component.confirmDialogError).toContain('noch geladen');

    responseState$.next({
      state: { responseData: { current: true } },
      isFallback: false,
    });
    responseState$.complete();
    await vi.waitFor(() => expect(component.currentResponseData).toEqual({ current: true }));
    destroyFacade(component);
  });

  it('accepts player state only from the active Verona session', () => {
    const component = createFacade();
    setPreviewStatus(component, 'ready');
    component.player.activePlayerSessionId = 'active-session';

    component.handlePlayerMessage({
      type: 'vopStateChangedNotification',
      unitState: { dataParts: { missingSession: true } },
    });
    component.handlePlayerMessage({
      type: 'vopStateChangedNotification',
      sessionId: 'stale-session',
      unitState: { dataParts: { staleSession: true } },
    });

    expect(component.currentResponseData).toBeNull();

    component.handlePlayerMessage({
      type: 'vopStateChangedNotification',
      sessionId: 'active-session',
      unitState: { dataParts: { current: true } },
    });

    expect(component.currentResponseData).toEqual({ current: true });
    destroyFacade(component);
  });

  it('cancels stale unit and response-state results after a newer selection', async () => {
    const unitRequests = new Map<string, Subject<any>>();
    const responseRequests = new Map<string, Subject<any>>();
    const previewLoader = {
      load: vi.fn((_acpId: string, _perspective: string, unitId: string) => {
        const request = new Subject<any>();
        unitRequests.set(unitId, request);
        return request;
      }),
      clear: vi.fn(),
    };
    const component = createFacade({
      api: {
        getResponseStateWithFallback: vi.fn((_acpId: string, itemId: string) => {
          const request = new Subject<any>();
          responseRequests.set(itemId, request);
          return request;
        }),
      },
      previewLoader,
    });
    component.acpId = 'acp-1';
    const firstItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    } as any;
    const secondItem = {
      ...firstItem,
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      rowKey: 'uuid-2',
      unitId: 'UNIT_2',
      unitLabel: 'Unit 2',
      variableId: 'VAR_2',
    };
    component.table.filteredItems = [firstItem, secondItem];

    component.selectItem(firstItem, 0);
    component.selectItem(secondItem, 1);

    unitRequests.get('UNIT_1')?.next({
      unit: { id: 'UNIT_1' },
      playerHtml: '<html>stale</html>',
      definition: '{"pages":[]}',
      cacheStatus: 'miss',
    });
    unitRequests.get('UNIT_1')?.complete();
    responseRequests.get('ITEM_1')?.next({
      state: { responseData: { stale: true } },
      isFallback: false,
    });
    responseRequests.get('ITEM_1')?.complete();

    unitRequests.get('UNIT_2')?.next({
      unit: { id: 'UNIT_2' },
      playerHtml: '<html>current</html>',
      definition: '{"pages":[]}',
      cacheStatus: 'miss',
    });
    unitRequests.get('UNIT_2')?.complete();
    responseRequests.get('ITEM_2')?.next({
      state: { responseData: { current: true } },
      isFallback: false,
    });
    responseRequests.get('ITEM_2')?.complete();

    await vi.waitFor(() => expect(component.unit?.id).toBe('UNIT_2'));
    expect(component.selectedItem?.itemId).toBe('ITEM_2');
    expect(component.currentResponseData).toEqual({ current: true });
    destroyFacade(component);
  });

  it('cancels in-flight preview requests when the next item has no player target', () => {
    const cancelAssets = vi.fn();
    const cancelResponseState = vi.fn();
    const previewLoader = {
      load: vi.fn(
        () =>
          new Observable<any>(() => {
            return cancelAssets;
          }),
      ),
      clear: vi.fn(),
    };
    const component = createFacade({
      api: {
        getResponseStateWithFallback: vi.fn(
          () =>
            new Observable<any>(() => {
              return cancelResponseState;
            }),
        ),
      },
      previewLoader,
    });
    component.acpId = 'acp-1';
    const previewableItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    } as any;
    const itemWithoutTarget = {
      ...previewableItem,
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      rowKey: 'uuid-2',
      variableId: '',
    };
    component.table.filteredItems = [previewableItem, itemWithoutTarget];

    component.selectItem(previewableItem, 0);
    component.selectItem(itemWithoutTarget, 1);

    expect(cancelAssets).toHaveBeenCalledOnce();
    expect(cancelResponseState).toHaveBeenCalledOnce();
    expect(previewLoader.load).toHaveBeenCalledOnce();
    expect(component.selectedItem?.itemId).toBe('ITEM_2');
    expect(component.previewUnavailableReason).toContain('keine Player-Variable');
    destroyFacade(component);
  });

  it('cancels in-flight preview requests when the selection is cleared', () => {
    const cancelAssets = vi.fn();
    const cancelResponseState = vi.fn();
    const component = createFacade({
      api: {
        getResponseStateWithFallback: vi.fn(
          () =>
            new Observable<any>(() => {
              return cancelResponseState;
            }),
        ),
      },
      previewLoader: {
        load: vi.fn(
          () =>
            new Observable<any>(() => {
              return cancelAssets;
            }),
        ),
        clear: vi.fn(),
      },
    });
    component.acpId = 'acp-1';
    const item = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    } as any;
    component.table.filteredItems = [item];

    component.selectItem(item, 0);
    (component as any).clearSelectedItem();

    expect(cancelAssets).toHaveBeenCalledOnce();
    expect(cancelResponseState).toHaveBeenCalledOnce();
    expect(component.selectedItem).toBeNull();
    expect(component.selectedIndex).toBe(-1);
    expect(component.loadingUnit).toBe(false);
    destroyFacade(component);
  });

  it('shows and clears the slow hint for a delayed same-unit response state', async () => {
    vi.useFakeTimers();
    const responseState$ = new Subject<any>();
    const component = createFacade({
      api: { getResponseStateWithFallback: vi.fn(() => responseState$) },
      previewLoader: { load: vi.fn(), clear: vi.fn() },
    });
    component.acpId = 'acp-1';
    component.player.unit = { id: 'UNIT_1', dependencies: [] };
    component.player.playerSrcDoc = '<html>cached player</html>';
    component.player.definitionContent = '{"pages":[]}';
    const item = {
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      rowKey: 'uuid-2',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 2',
      variableId: 'VAR_2',
      metadata: {},
    } as any;
    component.table.filteredItems = [item];

    try {
      component.selectItem(item, 0);
      vi.advanceTimersByTime(1500);
      expect(component.previewSlow).toBe(true);
      expect(component.previewLoadPhase).toBe('gespeicherter Zustand');

      responseState$.next({ state: null, isFallback: false });
      responseState$.complete();
      await vi.advanceTimersByTimeAsync(0);
      expect(component.previewSlow).toBe(false);
      expect(component.previewLoadPhase).toBe('');
    } finally {
      destroyFacade(component);
      vi.useRealTimers();
    }
  });

  it('finishes pending player-ready timings on a new selection and route destruction', () => {
    const diagnostics = {
      start: vi.fn(() => ({
        phase: 'item-selection-total',
        id: 2,
        startedAt: 0,
        startMark: 'selection',
      })),
      finish: vi.fn(),
    };
    const component = createFacade({ diagnostics });
    const pendingSelection = {
      phase: 'player-ready',
      id: 1,
      startedAt: 0,
      startMark: 'player-ready-1',
    };
    (component as any).playerReadyTiming = pendingSelection;

    component.selectItem(
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      } as any,
      0,
    );

    expect(diagnostics.finish).toHaveBeenCalledWith(pendingSelection, {
      outcome: 'cancelled',
    });

    const pendingDestruction = {
      phase: 'player-ready',
      id: 3,
      startedAt: 0,
      startMark: 'player-ready-3',
    };
    (component as any).playerReadyTiming = pendingDestruction;
    destroyFacade(component);

    expect(diagnostics.finish).toHaveBeenCalledWith(pendingDestruction, {
      outcome: 'cancelled',
    });
    expect((component as any).playerReadyTiming).toBeNull();
  });

  it('lets a partial-credit row clear inherited tags, exclusion and preview target', () => {
    const component = createFacade();
    const item = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1::1',
      subId: '1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: '',
      variableId: '',
      metadata: {},
      tags: ['base'],
      excluded: true,
      previewTargetId: 'BASE_A',
    } as any;
    component.items = [item];
    component.table.filteredItems = [item];

    const envelope = createExplorerEnvelope();
    envelope.draftState.tags = {
      'uuid-1': ['base'],
      'uuid-1::1': [],
    };
    envelope.draftState.itemProperties = {
      'uuid-1': {
        tags: ['base'],
        excluded: true,
        previewTargetId: 'BASE_A',
      },
      'uuid-1::1': {
        tags: [],
        excluded: false,
        previewTargetId: '',
      },
    };

    (component as any).applySharedExplorerEnvelope(envelope);

    expect(component.itemTags['uuid-1::1']).toEqual([]);
    expect(item.tags).toEqual([]);
    expect(item.excluded).toBeUndefined();
    expect(item.previewTargetId).toBeUndefined();
  });

  it('does not persist fullscreen mode in the shared ui preferences', () => {
    const component = createFacade();
    component.isFullscreen = true;

    const ui = (component as any).buildUiPreferences();

    expect(ui).not.toHaveProperty('isFullscreen');
  });

  it('hides items without empirical difficulty when the ACP filter is enabled', () => {
    const component = createFacade();
    component.table.showOnlyItemsWithEmpiricalDifficulty = true;
    component.table.hasEmpiricalDifficulty = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'With difficulty',
        variableId: 'VAR_1',
        metadata: {},
        empiricalDifficulty: 0.4,
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Without difficulty',
        variableId: 'VAR_2',
        metadata: {},
      },
    ] as any;

    component.applyFilter(false);

    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['ITEM_1']);
  });

  it('keeps all items visible when no empirical difficulties were imported yet', () => {
    const component = createFacade();
    component.table.showOnlyItemsWithEmpiricalDifficulty = true;
    component.table.hasEmpiricalDifficulty = false;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'First item',
        variableId: 'VAR_1',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Second item',
        variableId: 'VAR_2',
        metadata: {},
      },
    ] as any;

    component.applyFilter(false);

    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['ITEM_1', 'ITEM_2']);
  });

  it('sorts by task label and then item id by default', () => {
    const component = createFacade();
    component.table.filteredItems = [
      {
        itemId: 'ITEM_20',
        uuid: 'uuid-20',
        unitId: 'UNIT_B',
        unitLabel: 'B Task',
        description: 'Second task item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_3',
        uuid: 'uuid-3',
        unitId: 'UNIT_A',
        unitLabel: 'A Task',
        description: 'Third item in first task',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_A',
        unitLabel: 'A Task',
        description: 'First item in first task',
        variableId: '',
        metadata: {},
      },
    ] as any;

    (component as any).applySort(false);

    expect(component.filteredItems.map((item) => `${item.unitLabel}:${item.itemId}`)).toEqual([
      'A Task:ITEM_1',
      'A Task:ITEM_3',
      'B Task:ITEM_20',
    ]);
  });

  it('hides excluded items by default and can reveal them temporarily', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Visible item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Excluded item',
        variableId: '',
        metadata: {},
        excluded: true,
      },
    ] as any;

    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.uuid)).toEqual(['uuid-1']);
    expect(component.visibleItemsCount).toBe(1);

    component.toggleShowExcludedItems();
    expect(component.filteredItems.map((item) => item.uuid)).toEqual(['uuid-1', 'uuid-2']);
    expect(component.visibleItemsCount).toBe(2);
  });

  it('keeps the header total on the complete item base when filters narrow the list', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Visible alpha item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Visible beta item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_3',
        uuid: 'uuid-3',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Ignored gamma item',
        variableId: '',
        metadata: {},
        excluded: true,
      },
    ] as any;
    component.table.filterText = 'alpha';

    component.applyFilter(false);

    expect(component.filteredItems.map((item) => item.uuid)).toEqual(['uuid-1']);
    expect(component.visibleItemsCount).toBe(2);
    expect(component.totalItemsCount).toBe(3);
    expect(component.hiddenExcludedItemsCount).toBe(1);
  });

  it('reports mutually exclusive base-visibility reasons', () => {
    const component = createFacade();
    component.table.showOnlyItemsWithEmpiricalDifficulty = true;
    component.table.hasEmpiricalDifficulty = true;
    component.items = [
      { uuid: 'excluded-missing', excluded: true },
      { uuid: 'visible-missing' },
      { uuid: 'visible', empiricalDifficulty: 0.2 },
    ] as any;

    expect(component.hiddenExcludedItemsCount).toBe(1);
    expect(component.hiddenMissingDifficultyItemsCount).toBe(1);
    expect(component.hiddenExcludedItemsCount + component.hiddenMissingDifficultyItemsCount).toBe(
      2,
    );
  });

  it('counts only items with empirical difficulty when that visibility rule is active', () => {
    const component = createFacade();
    component.table.showOnlyItemsWithEmpiricalDifficulty = true;
    component.table.hasEmpiricalDifficulty = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'With difficulty',
        variableId: '',
        metadata: {},
        empiricalDifficulty: 0.4,
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Without difficulty',
        variableId: '',
        metadata: {},
      },
    ] as any;

    component.applyFilter(false);

    expect(component.filteredItems.map((item) => item.uuid)).toEqual(['uuid-1']);
    expect(component.visibleItemsCount).toBe(1);
  });

  it('excludes the selected item and moves selection to the next visible entry', () => {
    const component = createFacade();
    (component as any).explorerEditingAllowed = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'First item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Second item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_3',
        uuid: 'uuid-3',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Third item',
        variableId: '',
        metadata: {},
      },
    ] as any;
    component.table.filteredItems = [...component.items];
    component.selectedItem = component.items[0];
    component.selectedIndex = 0;
    const queueDraftPatch = vi
      .spyOn(component as any, 'queueDraftPatch')
      .mockImplementation(() => undefined);

    component.toggleSelectedItemExclusion();

    expect(component.items[0].excluded).toBe(true);
    expect(component.filteredItems.map((item) => item.uuid)).toEqual(['uuid-2', 'uuid-3']);
    expect(component.selectedItem?.uuid).toBe('uuid-2');
    expect(queueDraftPatch).toHaveBeenCalledWith(
      'ITEM_EXCLUSION_CHANGED',
      {
        itemPropertiesPatch: {
          'uuid-1': {
            excluded: true,
          },
        },
      },
      true,
    );
  });

  it('shows audio/video coding variables by default', () => {
    const component = createFacade();
    component.coding.currentCodingSchemeAsText = [
      { id: 'AUDIO_VAR', label: 'Audio prompt', codes: [] },
      { id: 'TEXT_VAR', label: 'Text prompt', codes: [] },
      { id: 'VIDEO_VAR', label: 'Video prompt', codes: [] },
    ] as any;

    const ids = component.filteredCodingSchemeAsText.map((coding) => coding.id);

    expect(ids).toEqual(['AUDIO_VAR', 'TEXT_VAR', 'VIDEO_VAR']);
  });

  it('hides audio/video coding variables when disabled', () => {
    const component = createFacade();
    component.coding.showAudioVideoCodingVariables = false;
    component.coding.currentCodingSchemeAsText = [
      { id: 'AUDIO_VAR', label: 'Prompt', codes: [] },
      { id: 'TEXT_VAR', label: 'Text prompt', codes: [] },
      { id: 'VAR_01', label: 'Video answer', codes: [] },
      { id: 'VAR_02', label: 'Other', codes: [] },
    ] as any;

    const ids = component.filteredCodingSchemeAsText.map((coding) => coding.id);

    expect(ids).toEqual(['TEXT_VAR', 'VAR_02']);
  });

  it('focuses the coding overlay on the variable assigned to the selected item', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'First item',
      variableId: 'IGNORED_FALLBACK',
      sourceVariable: 'result_alias',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', sourceType: 'BASE', deriveSources: [] },
        {
          id: 'RESULT',
          alias: 'RESULT_ALIAS',
          sourceType: 'SUM_SCORE',
          deriveSources: ['BASE_A'],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
      { id: 'RESULT_ALIAS', label: 'Ergebnis', codes: [] },
    ] as any;
    component.coding.codingSearchText = 'does-not-match';

    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: 'result_alias',
      codingId: 'RESULT_ALIAS',
      isDerived: true,
      sourceIds: ['BASE_A'],
    });
    expect(component.filteredCodingSchemeAsText.map((coding) => coding.id)).toEqual([
      'RESULT_ALIAS',
    ]);
  });

  it('shows the full coding scheme and an explanation when an item has no variable', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Unmapped item',
      variableId: '',
      metadata: {},
    } as any;
    component.coding.currentCodingSchemeAsText = [
      { id: 'VAR_A', label: 'A', codes: [] },
      { id: 'VAR_B', label: 'B', codes: [] },
    ] as any;

    expect(component.codingVariableFocus.status).toBe('missing-target');
    expect(component.codingVariableFocusMessage).toContain('keine Variable zugeordnet');
    expect(component.filteredCodingSchemeAsText.map((coding) => coding.id)).toEqual([
      'VAR_A',
      'VAR_B',
    ]);
  });

  it('prefers an exact variable id over an alias shadow for the item target', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: 'ITEM_3',
      uuid: 'uuid-3',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Ambiguous item',
      variableId: 'BASE_A',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', sourceType: 'BASE' },
        {
          id: 'TOTAL',
          alias: 'BASE_A',
          sourceType: 'SUM_SCORE',
          deriveSources: ['BASE_A'],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Basiswert', codes: [] },
      { id: 'BASE_A', label: 'Gesamtscore', codes: [] },
    ] as any;

    expect(component.codingVariableFocus.status).toBe('unique');
    expect(component.codingVariableFocus.codingId).toBe('BASE_A');
    expect(component.filteredCodingSchemeAsText).toEqual([
      expect.objectContaining({ label: 'Basiswert' }),
    ]);
  });

  it('focuses only MDB007 variable 01 when the aggregate uses 01 as its alias', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: '01',
      uuid: '596680ba-fccd-40d7-9886-d174873e43ef',
      unitId: 'MDB007',
      unitLabel: 'Lieblingsbücher_2',
      description: 'GeoGebra item',
      variableId: '01',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: '01', alias: '_01', sourceType: 'BASE' },
        {
          id: '01_1',
          alias: '01',
          sourceType: 'SUM_SCORE',
          deriveSources: ['01', '01_ggb_bilderbuecherAngeklickt'],
        },
        { id: '_button01', alias: '_button01', sourceType: 'BASE_NO_VALUE' },
        { id: '_intro01', alias: '_intro01', sourceType: 'BASE_NO_VALUE' },
        { id: '_outro01', alias: '_outro01', sourceType: 'BASE_NO_VALUE' },
        { id: '_source01', alias: '_source01', sourceType: 'BASE_NO_VALUE' },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: '_01', label: 'Variable 01', codes: [] },
      { id: '01', label: 'Aggregat', codes: [] },
      { id: '_button01', label: '', codes: [] },
      { id: '_intro01', label: '', codes: [] },
      { id: '_outro01', label: '', codes: [] },
      { id: '_source01', label: '', codes: [] },
    ] as any;

    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: '01',
      codingId: '_01',
      isDerived: false,
    });
    expect(component.filteredCodingSchemeAsText.map((coding) => coding.label)).toEqual([
      'Variable 01',
    ]);
  });

  it('uses the internal MDB007 variable id for the player and its coded source for instructions', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: '01',
      uuid: '596680ba-fccd-40d7-9886-d174873e43ef',
      unitId: 'MDB007',
      unitLabel: 'Lieblingsbücher_2',
      description: 'GeoGebra item',
      variableId: '01',
      variableReadOnlyId: '01_1',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: '01',
          alias: '_01',
          sourceType: 'BASE',
          deriveSources: [],
          manualInstruction: '<p>Nur Segment Bilderbücher markieren.</p>',
          codes: [
            {
              id: 1,
              score: 1,
              label: 'richtig',
              ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['true'] }] }],
            },
          ],
        },
        {
          id: '01_1',
          alias: '01',
          sourceType: 'SUM_SCORE',
          deriveSources: ['01', '01_ggb_bilderbuecherAngeklickt'],
        },
        {
          id: '01_ggb_bilderbuecherAngeklickt',
          alias: 'ggb-source',
          sourceType: 'BASE',
          deriveSources: [],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      {
        id: '_01',
        label: 'Variable 01',
        generalInstructionText: '<p>Nur Segment Bilderbücher markieren.</p>',
        codes: [{ id: '1', label: 'richtig', ruleSetDescriptions: ['MATCH true'] }],
      },
      { id: '01', label: 'Aggregat', codes: [] },
      { id: 'ggb-source', label: 'GeoGebra-Quelle', codes: [] },
    ] as any;

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: '01_1',
      codingId: '01',
      isDerived: true,
    });
    expect(component.filteredCodingSchemeAsText.map((coding) => coding.label)).toEqual([
      'Aggregat',
    ]);
    expect(
      component.shouldShowGeneralCodingInstruction(component.filteredCodingSchemeAsText[0]),
    ).toBe(false);
    expect(
      component.shouldShowAutomaticCodingRules(component.filteredCodingSchemeAsText[0].codes[0]),
    ).toBe(true);
    component.coding.showGeneralCodingInstructions = true;
    expect(
      component.shouldShowGeneralCodingInstruction(component.filteredCodingSchemeAsText[0]),
    ).toBe(true);
    expect(
      component.shouldShowAutomaticCodingRules(component.filteredCodingSchemeAsText[0].codes[0]),
    ).toBe(true);
    expect(component.selectedItemTarget).toBe('01_1');
    expect(component.selectedPreviewTarget).toBe('01');
  });

  it('uses the visible player alias after identifying a base variable by its internal id', () => {
    const component = createFacade({
      resolvePlayerTargetLocation: (_definition, variableId) =>
        variableId === 'PLAYER_04'
          ? { absolutePageIndex: 0, scrollPageIndex: 0, isAlwaysVisiblePage: false }
          : undefined,
    });
    component.selectedItem = {
      itemId: '03',
      uuid: 'uuid-03',
      unitId: 'DLB013',
      unitLabel: 'DLB013',
      description: 'Base item',
      variableId: 'PLAYER_04',
      variableReadOnlyId: 'internal-04',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: 'internal-04',
          alias: 'PLAYER_04',
          sourceType: 'BASE',
          deriveSources: [],
        },
      ],
    };
    component.player.definitionContent = '{"pages":[]}';

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.selectedItemTarget).toBe('internal-04');
    expect(component.selectedPreviewTarget).toBe('PLAYER_04');
  });

  it('shows DSB02210 player target 06 while keeping internal coding id 05', () => {
    const component = createFacade({
      resolvePlayerTargetLocation: (_definition, variableId) =>
        variableId === '06'
          ? { absolutePageIndex: 0, scrollPageIndex: 0, isAlwaysVisiblePage: false }
          : undefined,
    });
    component.selectedItem = {
      itemId: '10',
      uuid: 'dsb02210',
      unitId: 'DSB022',
      unitLabel: 'Zoo',
      description: 'Item 10',
      variableId: '06',
      variableReadOnlyId: '05',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: '05',
          alias: '06',
          sourceType: 'BASE',
          deriveSources: [],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: '06', label: 'Aufgabe 6', codes: [] },
    ] as any;
    component.player.definitionContent = '{"pages":[]}';

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.getPlayerTarget(component.selectedItem)).toBe('06');
    expect(component.selectedItemTarget).toBe('05');
    expect(component.selectedPreviewTarget).toBe('06');
    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: '05',
      internalId: '05',
      codingId: '06',
      playerTargetId: '06',
      usedLegacyFallback: false,
    });
  });

  it('starts DHB00311 at alias 07 instead of the earlier element id 07', () => {
    vi.useFakeTimers();
    const realVoudService = new VoudService();
    const component = createFacade({
      resolvePlayerTargetLocation:
        realVoudService.resolvePlayerTargetLocation.bind(realVoudService),
      getFocusIdentifiers: realVoudService.getFocusIdentifiers.bind(realVoudService),
    });
    const postMessage = vi.fn();

    try {
      component.selectedItem = {
        itemId: '11',
        uuid: 'dhb00311',
        rowKey: 'dhb00311',
        unitId: 'DHB003',
        unitLabel: 'Ressel',
        description: 'Item 11',
        variableId: '07',
        variableReadOnlyId: '11',
        metadata: {},
      } as any;
      component.coding.currentCodingScheme = {
        variableCodings: [
          { id: '07', alias: '04', sourceType: 'BASE', deriveSources: [] },
          { id: '11', alias: '07', sourceType: 'BASE', deriveSources: [] },
        ],
      };
      component.coding.currentCodingSchemeAsText = [
        { id: '04', label: 'Item 4', codes: [] },
        { id: '07', label: 'Item 11', codes: [] },
      ] as any;
      component.player.unit = { id: 'DHB003', dependencies: [] } as any;
      component.player.definitionContent = JSON.stringify({
        pages: [
          { sections: [{ elements: [{ id: '07', alias: '04' }] }] },
          { sections: [{ elements: [{ id: '11', alias: '07' }] }] },
        ],
      });
      (component as any).syncPreviewTargetResolution(component.selectedItem);
      registerPlayerDom(component, postMessage);
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');

      (component as any).startPlayerIfReady();

      expect(component.selectedPreviewTarget).toBe('07');
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        playerConfig: expect.objectContaining({ startPage: '1' }),
      });
      expect(
        component.player.getFocusSelectors(component.selectedItem, component.selectedPreviewTarget),
      ).toEqual(expect.arrayContaining(['[data-variable-id="07"]', '[data-variable-id="11"]']));
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not present numeric coding labels as item or variable identities', () => {
    const component = createFacade();

    expect(
      component.getCodingVariableDisplayLabel({ id: '02', label: '1', codes: [] } as any),
    ).toBe('');
    expect(
      component.getCodingVariableDisplayLabel({
        id: 'internal-02',
        label: 'Aufgabe 2',
        codes: [],
      } as any),
    ).toBe('Aufgabe 2');
  });

  it('recovers DSB04101 through its unique legacy player alias', () => {
    const component = createFacade({
      resolvePlayerTargetLocation: (_definition, variableId) =>
        variableId === '01'
          ? { absolutePageIndex: 0, scrollPageIndex: 0, isAlwaysVisiblePage: false }
          : undefined,
    });
    component.selectedItem = {
      itemId: '01',
      uuid: 'dsb04101',
      unitId: 'DSB041',
      unitLabel: 'DSB041',
      description: 'Item with stale internal reference',
      variableId: '01',
      variableReadOnlyId: 'text-field_1765284526968_1',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: 'text-area_1769771943595_1',
          alias: '01',
          sourceType: 'BASE',
          deriveSources: [],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: '01', label: 'Aufgabe 1', codes: [] },
    ] as any;
    component.player.definitionContent = '{"pages":[]}';

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.selectedItemTarget).toBe('text-area_1769771943595_1');
    expect(component.selectedPreviewTarget).toBe('01');
    expect(component.canPreviewItem(component.selectedItem)).toBe(true);
    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: 'text-field_1765284526968_1',
      internalId: 'text-area_1769771943595_1',
      codingId: '01',
      playerTargetId: '01',
      usedLegacyFallback: true,
      requestedInternalId: 'text-field_1765284526968_1',
    });
  });

  it('does not use a legacy fallback when an id and another alias share the same value', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: '01',
      uuid: 'ambiguous-legacy',
      unitId: 'UNIT',
      unitLabel: 'UNIT',
      description: 'Ambiguous legacy target',
      variableId: '01',
      variableReadOnlyId: 'stale-internal-id',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: '01', alias: 'PLAYER_A', sourceType: 'BASE', deriveSources: [] },
        { id: 'internal-b', alias: '01', sourceType: 'BASE', deriveSources: [] },
      ],
    };

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.codingVariableFocus.status).toBe('not-found');
    expect(component.selectedPreviewTarget).toBe('');
    expect(component.canPreviewItem(component.selectedItem)).toBe(false);
  });

  it('keeps aggregate codes while inheriting a missing manual instruction from its source', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: '15',
      uuid: 'uuid-15',
      unitId: 'DHB023',
      unitLabel: 'DHB023',
      description: 'Partial-credit aggregate',
      variableId: 'BASE_A',
      variableReadOnlyId: 'TOTAL',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: 'BASE_A',
          sourceType: 'BASE',
          manualInstruction: '<p>Source instruction</p>',
          codes: [{ id: 1 }],
        },
        {
          id: 'TOTAL',
          alias: 'BASE_A',
          sourceType: 'SUM_SCORE',
          deriveSources: ['BASE_A'],
          codes: [{ id: 'PARTIAL_CREDIT' }],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      {
        id: 'BASE_A',
        label: 'Source',
        generalInstructionText: '<p>Source instruction</p>',
        codes: [{ id: '1', ruleSetDescriptions: [] }],
      },
      {
        id: 'BASE_A',
        label: 'Partial-Credit-Aggregat',
        codes: [{ id: 'PARTIAL_CREDIT', ruleSetDescriptions: [] }],
      },
    ] as any;

    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: 'TOTAL',
      codingId: 'BASE_A',
      isDerived: true,
    });
    expect(component.filteredCodingSchemeAsText.map((coding) => coding.label)).toEqual([
      'Partial-Credit-Aggregat',
    ]);
    expect((component.filteredCodingSchemeAsText[0] as any).generalInstructionText).toBe(
      '<p>Source instruction</p>',
    );
    expect(component.filteredCodingSchemeAsText[0].codes.map((code) => code.id)).toEqual([
      'PARTIAL_CREDIT',
    ]);
  });

  it('prefers a base-variable player alias when both alias and internal id exist in VOUD', () => {
    const component = createFacade({
      resolvePlayerTargetLocation: (_definition, variableId) =>
        variableId === '05a' || variableId === '04a'
          ? { absolutePageIndex: 0, scrollPageIndex: 0, isAlwaysVisiblePage: false }
          : undefined,
    });
    component.selectedItem = {
      itemId: '15',
      uuid: 'uuid-15',
      unitId: 'DHB023',
      unitLabel: 'DHB023',
      description: 'Derived item',
      variableId: '05',
      variableReadOnlyId: '04',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: '04a',
          alias: '05a',
          sourceType: 'BASE',
          deriveSources: [],
        },
        {
          id: '04',
          alias: '05',
          sourceType: 'SUM_SCORE',
          deriveSources: ['04a'],
        },
      ],
    };
    component.player.definitionContent = '{"pages":[]}';

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.selectedItemTarget).toBe('04');
    expect(component.selectedPreviewTarget).toBe('05a');
  });

  it('blocks alias fallback when an explicitly internal variable id is missing', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: 'ITEM_404',
      uuid: 'uuid-404',
      unitId: 'UNIT_404',
      unitLabel: 'UNIT_404',
      description: 'Item with stale internal variable id',
      variableId: 'VISIBLE_TARGET',
      variableReadOnlyId: 'missing-internal-id',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: 'different-internal-id',
          alias: 'missing-internal-id',
          sourceType: 'BASE',
          deriveSources: [],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'missing-internal-id', label: 'Wrong alias match', codes: [] },
    ] as any;

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.codingVariableFocus).toMatchObject({
      status: 'not-found',
      targetId: 'missing-internal-id',
      matches: [],
    });
    expect(component.selectedPreviewTarget).toBe('');
    expect(component.canPreviewItem(component.selectedItem)).toBe(false);
  });

  it('shows DLB01313 automatic coding independently from its general hint', () => {
    const component = createFacade();
    const coding = {
      id: '01',
      label: 'Variable 01',
      generalInstructionText: '<p>Spinne</p>',
      codes: [
        {
          id: '1',
          score: 1,
          label: 'richtig',
          manualInstructionText: null,
          ruleSetDescriptions: ["Übereinstimmung (numerisch) mit '3'"],
        },
      ],
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [{ id: '01', sourceType: 'BASE' }],
    };
    component.coding.currentCodingSchemeAsText = [coding];
    component.selectedItem = {
      itemId: '13',
      uuid: 'DLB01313',
      unitId: 'DLB013',
      unitLabel: 'Frida',
      variableId: '01',
      metadata: {},
    } as any;

    component.coding.showGeneralCodingInstructions = false;
    component.coding.preferManualCodingInstructions = true;
    expect(component.shouldShowGeneralCodingInstruction(coding)).toBe(false);
    expect(component.shouldShowAutomaticCodingRules(coding.codes[0])).toBe(true);

    component.coding.showGeneralCodingInstructions = true;
    expect(component.shouldShowGeneralCodingInstruction(coding)).toBe(true);
    expect(component.shouldShowAutomaticCodingRules(coding.codes[0])).toBe(true);
  });

  it('replaces only a code automatic rule with that code manual instruction', () => {
    const component = createFacade();
    const code = {
      id: '1',
      score: 1,
      label: 'richtig',
      manualInstructionText: '<p>Antwort fachlich prüfen.</p>',
      ruleSetDescriptions: ["Übereinstimmung (numerisch) mit '3'"],
    } as any;

    component.coding.preferManualCodingInstructions = true;
    expect(component.shouldShowAutomaticCodingRules(code)).toBe(false);

    component.coding.preferManualCodingInstructions = false;
    expect(component.shouldShowAutomaticCodingRules(code)).toBe(true);
  });

  it('focuses a valid alias-shadowing aggregate when its internal id is targeted', () => {
    const component = createFacade();
    component.selectedItem = {
      itemId: 'ITEM_4',
      uuid: 'uuid-4',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Aggregate item',
      variableId: 'TOTAL',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', sourceType: 'BASE' },
        {
          id: 'TOTAL',
          alias: 'BASE_A',
          sourceType: 'SUM_SCORE',
          deriveSources: ['BASE_A'],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Basiswert', codes: [] },
      { id: 'BASE_A', label: 'Gesamtscore', codes: [] },
    ] as any;

    expect(component.codingVariableFocus).toMatchObject({
      status: 'unique',
      targetId: 'TOTAL',
      codingId: 'BASE_A',
      isDerived: true,
      sourceIds: ['BASE_A'],
    });
    expect(component.filteredCodingSchemeAsText.map((coding) => coding.label)).toEqual([
      'Gesamtscore',
    ]);
  });

  it('clears a previous coding search when the overlay is opened', () => {
    const component = createFacade();
    component.coding.codingSearchText = 'old search';

    component.openCodingOverlay();

    expect(component.codingSearchText).toBe('');
    expect(component.showOverlay).toBe('coding');
  });

  it('adds the player highlight class when player focus highlighting is enabled', () => {
    const component = createFacade();
    component.player.playerFocusHighlightEnabled = true;
    component.selectedItem = {
      itemId: 'ITEM_1',
      rowKey: 'row-1',
      uuid: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    };
    const playerDom = registerPlayerDom(component);

    component.player.tryFocusItemInPlayer(component.selectedItem, component.selectedPreviewTarget);

    expect(playerDom.focus).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), true);
  });

  it('keeps player focus without the highlight class when the ACP flag disables it', () => {
    const component = createFacade();
    component.player.playerFocusHighlightEnabled = false;
    component.selectedItem = {
      itemId: 'ITEM_1',
      rowKey: 'row-1',
      uuid: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    };
    const playerDom = registerPlayerDom(component);

    component.player.tryFocusItemInPlayer(component.selectedItem, component.selectedPreviewTarget);

    expect(playerDom.focus).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), false);
  });

  it('keeps the preview in loading state until both player assets are ready', () => {
    const component = createFacade();

    component.selectedItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Item 1',
      variableId: 'VAR_1',
      metadata: {},
    } as any;
    setPreviewStatus(component, 'loading-unit');

    expect(component.isPreviewLoading).toBe(true);
    expect(component.shouldRenderPlayerFrame).toBe(false);

    component.player.playerSrcDoc = '<html></html>';

    expect(component.isPreviewLoading).toBe(true);
    expect(component.shouldRenderPlayerFrame).toBe(false);

    component.player.definitionContent = '{"pages":[]}';
    setPreviewStatus(component, 'ready');

    expect(component.isPreviewLoading).toBe(false);
    expect(component.shouldRenderPlayerFrame).toBe(true);
  });

  it('stops the loading state immediately when preview assets are missing', () => {
    const component = createFacade();

    component.selectedItem = {
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      unitId: 'UNIT_2',
      unitLabel: 'Unit 2',
      description: 'Item 2',
      variableId: 'VAR_2',
      metadata: {},
    } as any;
    (component as any).previewCoordinator.markUnavailable('Player fehlt');

    expect(component.isPreviewLoading).toBe(false);
    expect(component.shouldRenderPlayerFrame).toBe(false);
  });

  it('treats iframe refreshes as loading during paging-mode changes', () => {
    vi.useFakeTimers();
    const component = createFacade();

    try {
      component.selectedItem = {
        itemId: 'ITEM_3',
        uuid: 'uuid-3',
        unitId: 'UNIT_3',
        unitLabel: 'Unit 3',
        description: 'Item 3',
        variableId: 'VAR_3',
        metadata: {},
      } as any;
      component.player.playerSrcDoc = '<html></html>';
      component.player.definitionContent = '{"pages":[]}';
      setPreviewStatus(component, 'ready');

      component.onPagingModeChange();

      expect(component.isPreviewLoading).toBe(true);
      expect(component.shouldRenderPlayerFrame).toBe(false);

      vi.advanceTimersByTime(50);

      expect(component.isPreviewLoading).toBe(false);
      expect(component.shouldRenderPlayerFrame).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for response state before starting the player preview', () => {
    vi.useFakeTimers();
    const component = createFacade({ getStartPage: () => 2 });
    const postMessage = vi.fn();

    try {
      component.selectedItem = {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Item 1',
        variableId: 'VAR_1',
        metadata: {},
      };
      registerPlayerDom(component, postMessage);
      component.player.unit = { id: 'UNIT_1', dependencies: [] };
      component.player.definitionContent = JSON.stringify({ pages: [] });
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'loading-response');

      (component as any).startPlayerIfReady();
      expect(postMessage).not.toHaveBeenCalled();

      setPreviewStatus(component, 'ready');
      (component as any).startPlayerIfReady();

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        sessionId: 'explorer-uuid-1-1',
        playerConfig: expect.objectContaining({
          startPage: '2',
        }),
      });

      vi.runAllTimers();

      expect(postMessage.mock.calls.slice(1).map((call) => call[0])).toEqual([
        {
          type: 'vopPageNavigationCommand',
          sessionId: 'explorer-uuid-1-1',
          target: '2',
        },
        {
          type: 'vopPageNavigationCommand',
          sessionId: 'explorer-uuid-1-1',
          target: '2',
        },
        {
          type: 'vopPageNavigationCommand',
          sessionId: 'explorer-uuid-1-1',
          target: '2',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a validated solution without replacing or saving the persisted player state', () => {
    vi.useFakeTimers();
    const component = createFacade();
    const postMessage = vi.fn();
    const persistedDataParts = {
      elementCodes: JSON.stringify([
        { id: 'A1', status: 'VALUE_CHANGED', value: 1 },
        { id: 'B1', status: 'VALUE_CHANGED', value: 'keep' },
      ]),
    };

    try {
      component.selectedItem = {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Single choice',
        variableId: 'A1',
        metadata: {},
      };
      component.coding.currentCodingScheme = {
        variableCodings: [
          {
            id: 'A1',
            alias: 'A1',
            sourceType: 'BASE',
            codes: [
              {
                id: 1,
                type: 'FULL_CREDIT',
                score: 1,
                ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['2'] }] }],
              },
              { id: 0, type: 'RESIDUAL_AUTO', score: 0, ruleSets: [] },
            ],
          },
        ],
      };
      component.player.currentResponseData = persistedDataParts;
      component.player.hasResponseState = true;
      component.player.unit = { id: 'UNIT_1', dependencies: [] };
      component.player.definitionContent = JSON.stringify({ pages: [] });
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');
      (component as any).refreshCorrectSolutionPrefill();
      registerPlayerDom(component, postMessage);
      postMessage.mockClear();

      component.toggleCorrectSolution();

      expect(component.isCorrectSolutionActive).toBe(true);
      const solutionStart = postMessage.mock.calls[0][0];
      expect(solutionStart.type).toBe('vopStartCommand');
      expect(JSON.parse(solutionStart.unitState.dataParts.elementCodes)).toEqual([
        { id: 'B1', status: 'VALUE_CHANGED', value: 'keep' },
        { id: 'A1', status: 'VALUE_CHANGED', value: 2 },
      ]);

      component.handlePlayerMessage({
        type: 'vopStateChangedNotification',
        sessionId: solutionStart.sessionId,
        unitState: { dataParts: { elementCodes: 'synthetic-state' } },
      });
      expect(component.currentResponseData).toBe(persistedDataParts);

      component.saveCurrentResponseState();
      expect(component.showSaveConfirmDialog).toBe(true);
      expect(component.confirmDialogError).toContain('Musterlösung ist nur eine Vorschau');

      component.closeSaveConfirmDialog();
      postMessage.mockClear();
      component.toggleCorrectSolution();

      expect(component.isCorrectSolutionActive).toBe(false);
      expect(postMessage.mock.calls[0][0].unitState.dataParts).toBe(persistedDataParts);
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the player usable when no unique correct solution can be derived', () => {
    const component = createFacade();
    const startPlayerIfReady = vi.fn();
    component.selectedItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'Ambiguous item',
      variableId: 'A1',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: 'A1',
          sourceType: 'BASE',
          codes: [
            {
              id: 1,
              type: 'FULL_CREDIT',
              ruleSets: [{ rules: [{ method: 'MATCH_REGEX', parameters: ['[12]'] }] }],
            },
          ],
        },
      ],
    };
    component.player.definitionContent = JSON.stringify({ pages: [] });
    (component as any).startPlayerIfReady = startPlayerIfReady;
    setPreviewStatus(component, 'ready');
    (component as any).refreshCorrectSolutionPrefill();

    component.toggleCorrectSolution();

    expect(component.correctSolutionRequested).toBe(true);
    expect(component.correctSolutionAvailable).toBe(false);
    expect(component.isCorrectSolutionActive).toBe(false);
    expect(startPlayerIfReady).not.toHaveBeenCalled();
  });

  it('keeps the requested mode and recalculates the solution for the newly selected item', () => {
    const component = createFacade();
    const solutionVariable = (id: string, answer: string) => ({
      id,
      alias: id,
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          score: 1,
          ruleSets: [{ rules: [{ method: 'MATCH', parameters: [answer] }] }],
        },
        { id: 0, type: 'RESIDUAL_AUTO', score: 0, ruleSets: [] },
      ],
    });
    const firstItem = {
      itemId: 'ITEM_1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'UNIT_1',
      unitLabel: 'Unit 1',
      description: 'First item',
      variableId: 'A1',
      metadata: {},
    } as any;
    const secondItem = {
      ...firstItem,
      itemId: 'ITEM_2',
      uuid: 'uuid-2',
      rowKey: 'uuid-2',
      variableId: 'B1',
      description: 'Second item',
    };
    component.coding.currentCodingScheme = {
      variableCodings: [solutionVariable('A1', '1'), solutionVariable('B1', '2')],
    };
    component.player.definitionContent = JSON.stringify({ pages: [] });
    component.correctSolutionRequested = true;

    component.selectedItem = firstItem;
    setPreviewStatus(component, 'ready');
    (component as any).applyPreviewResult({
      item: firstItem,
      reuseUnit: true,
      responseState: null,
    });
    expect(component.correctSolutionPrefill).toMatchObject({
      status: 'available',
      responses: [{ id: 'A1', value: 1 }],
    });

    component.selectedItem = secondItem;
    setPreviewStatus(component, 'ready');
    (component as any).applyPreviewResult({
      item: secondItem,
      reuseUnit: true,
      responseState: null,
    });
    expect(component.correctSolutionRequested).toBe(true);
    expect(component.correctSolutionPrefill).toMatchObject({
      status: 'available',
      responses: [{ id: 'B1', value: 2 }],
    });
  });

  it('uses the scroll-page index from the VOUD service in the player preview', () => {
    vi.useFakeTimers();
    const realVoudService = new VoudService();
    const component = createFacade({
      getStartPage: realVoudService.getStartPage.bind(realVoudService),
      resolvePlayerTargetLocation:
        realVoudService.resolvePlayerTargetLocation.bind(realVoudService),
    });
    const postMessage = vi.fn();

    try {
      component.selectedItem = {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'UNIT_2',
        unitLabel: 'Unit 2',
        description: 'Item on second logical page',
        variableId: 'B2',
        metadata: {},
      };
      registerPlayerDom(component, postMessage);
      component.player.unit = { id: 'UNIT_2', dependencies: [] };
      component.player.definitionContent = JSON.stringify({
        pages: [
          {
            alwaysVisible: true,
            sections: [{ elements: [{ id: 'cover-text' }, { id: 'cover-image' }] }],
          },
          {
            sections: [{ elements: [{ alias: 'A1', id: 'page-a-1' }] }],
          },
          {
            sections: [{ elements: [{ alias: 'B2', id: 'page-b-2' }] }],
          },
        ],
      });
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');

      (component as any).startPlayerIfReady();

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        playerConfig: expect.objectContaining({
          startPage: '1',
        }),
      });

      vi.runAllTimers();

      expect(postMessage.mock.calls.slice(1).map((call) => call[0])).toEqual([
        {
          type: 'vopPageNavigationCommand',
          sessionId: 'explorer-uuid-2-1',
          target: '1',
        },
        {
          type: 'vopPageNavigationCommand',
          sessionId: 'explorer-uuid-2-1',
          target: '1',
        },
        {
          type: 'vopPageNavigationCommand',
          sessionId: 'explorer-uuid-2-1',
          target: '1',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the preview without startPage when the target is on an always-visible page', () => {
    vi.useFakeTimers();
    const realVoudService = new VoudService();
    const component = createFacade({
      getStartPage: realVoudService.getStartPage.bind(realVoudService),
      resolvePlayerTargetLocation:
        realVoudService.resolvePlayerTargetLocation.bind(realVoudService),
    });
    const postMessage = vi.fn();

    try {
      component.selectedItem = {
        itemId: 'ITEM_2A',
        uuid: 'uuid-2a',
        rowKey: 'uuid-2a',
        unitId: 'UNIT_2',
        unitLabel: 'Unit 2',
        description: 'Item on always-visible page',
        variableId: 'INTRO',
        metadata: {},
      };
      registerPlayerDom(component, postMessage);
      component.player.unit = { id: 'UNIT_2', dependencies: [] };
      component.player.definitionContent = JSON.stringify({
        pages: [
          {
            alwaysVisible: true,
            sections: [{ elements: [{ alias: 'INTRO', id: 'cover-text' }] }],
          },
          {
            sections: [{ elements: [{ alias: 'A1', id: 'page-a-1' }] }],
          },
        ],
      });
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');

      (component as any).startPlayerIfReady();

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
      });
      expect(postMessage.mock.calls[0][0].playerConfig.startPage).toBeUndefined();

      vi.runAllTimers();

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(component.previewUnavailableReason).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('strips conditional visibility from the item explorer preview by default', () => {
    vi.useFakeTimers();
    const stripConditionalVisibility = vi.fn().mockReturnValue('sanitized-definition');
    const component = createFacade({
      getStartPage: () => 2,
      stripConditionalVisibility,
    });
    const postMessage = vi.fn();

    try {
      component.selectedItem = {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Item 1',
        variableId: 'VAR_1',
        metadata: {},
      } as any;
      registerPlayerDom(component, postMessage);
      component.player.unit = { id: 'UNIT_1', dependencies: [] };
      component.player.definitionContent = 'original-definition';
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');

      (component as any).startPlayerIfReady();

      expect(stripConditionalVisibility).toHaveBeenCalledWith('original-definition');
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        unitDefinition: 'sanitized-definition',
      });

      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps conditional visibility when the ACP flag is enabled', () => {
    vi.useFakeTimers();
    const stripConditionalVisibility = vi.fn().mockReturnValue('sanitized-definition');
    const component = createFacade({
      getStartPage: () => 2,
      stripConditionalVisibility,
    });
    const postMessage = vi.fn();

    try {
      component.player.itemExplorerConditionalVisibilityEnabled = true;
      component.selectedItem = {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Item 1',
        variableId: 'VAR_1',
        metadata: {},
      } as any;
      registerPlayerDom(component, postMessage);
      component.player.unit = { id: 'UNIT_1', dependencies: [] };
      component.player.definitionContent = 'original-definition';
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');

      (component as any).startPlayerIfReady();

      expect(stripConditionalVisibility).not.toHaveBeenCalled();
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        unitDefinition: 'original-definition',
      });

      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows player target diagnostics for privileged users when enabled', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = true;
    component.itemExplorerPlayerTargetInfoEnabled = true;

    expect(component.showPlayerTargetInfo).toBe(true);
  });

  it('hides player target diagnostics for read-only users', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = false;
    component.itemExplorerPlayerTargetInfoEnabled = true;

    expect(component.showPlayerTargetInfo).toBe(false);
  });

  it('hides the draft status bar for read-only users', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = false;

    expect(component.showExplorerDraftStatus).toBe(false);
  });

  it('shows the draft status bar for editors', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = true;

    expect(component.showExplorerDraftStatus).toBe(true);
  });

  it('hides keyboard hints for read-only users', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = false;

    expect(component.showExplorerKeyboardHints).toBe(false);
  });

  it('shows keyboard hints for editors', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = true;

    expect(component.showExplorerKeyboardHints).toBe(true);
  });

  it('keeps the local search when switching to the published explorer state', async () => {
    const envelope = createExplorerEnvelope();
    const getItemExplorerState = vi.fn(() => of(envelope));
    const getFileItemList = vi.fn(() =>
      of({ columns: [], items: [], unitMetadata: {}, codingSchemes: {} }),
    );
    const component = createFacade({
      api: {
        getItemExplorerState,
        getFileItemList,
      },
    });
    component.acpId = 'acp-1';
    component.table.filterText = 'lokale Suche';

    (component as any).applySharedExplorerEnvelope(envelope);
    expect(component.filterText).toBe('lokale Suche');

    const flushDraftPatch = vi.fn().mockResolvedValue(true);
    (component as any).flushDraftPatch = flushDraftPatch;

    await component.toggleReadOnlyPreview();

    expect(flushDraftPatch).toHaveBeenCalledTimes(1);
    expect(component.isReadOnlyPreview).toBe(true);
    expect(component.canEditExplorer).toBe(false);
    expect(component.filterText).toBe('lokale Suche');
    expect(getItemExplorerState).toHaveBeenCalledWith('acp-1', 'read-only');
    expect(getFileItemList).toHaveBeenCalledWith('acp-1', {
      perspective: 'read-only',
    });
  });

  it('keeps the local search when switching back to the draft explorer state', async () => {
    const envelope = createExplorerEnvelope();
    const getItemExplorerState = vi.fn(() => of(envelope));
    const getFileItemList = vi.fn(() =>
      of({ columns: [], items: [], unitMetadata: {}, codingSchemes: {} }),
    );
    const component = createFacade({
      api: {
        getItemExplorerState,
        getFileItemList,
      },
    });
    component.acpId = 'acp-1';
    component.table.filterText = 'lokale Suche';

    (component as any).applySharedExplorerEnvelope(envelope);
    (component as any).flushDraftPatch = vi.fn().mockResolvedValue(true);

    await component.toggleReadOnlyPreview();
    await component.toggleReadOnlyPreview();

    expect(component.isReadOnlyPreview).toBe(false);
    expect(component.canEditExplorer).toBe(true);
    expect(component.filterText).toBe('lokale Suche');
    expect(getFileItemList).toHaveBeenLastCalledWith('acp-1', {
      perspective: 'editor',
    });
  });

  it('restores a partial-credit manual order only after editor rows are loaded', async () => {
    const envelope = createExplorerEnvelope();
    envelope.draftState.ui = {
      filterText: '',
      sortField: '__manual__',
      sortDir: 'asc',
      sortIsMeta: false,
    };
    envelope.draftState.itemOrder = ['uuid-1::2', 'uuid-1::1'];
    const editorRows = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::1',
        subId: '1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::2',
        subId: '2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    const component = createFacade({
      api: {
        getItemExplorerState: vi.fn(() => of(envelope)),
        getFileItemList: vi.fn(() =>
          of({ columns: [], items: editorRows, unitMetadata: {}, codingSchemes: {} }),
        ),
      },
    });
    component.acpId = 'acp-1';
    component.hasExplorerEditPermission = true;
    component.viewPerspective = 'read-only';
    component.items = [
      {
        ...editorRows[0],
        rowKey: 'uuid-1',
        subId: undefined,
      },
    ];
    component.table.filteredItems = [...component.items];
    (component as any).applySharedExplorerEnvelope(envelope);

    await component.toggleReadOnlyPreview();

    expect(component.itemOrder).toEqual(['uuid-1::2', 'uuid-1::1']);
    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['uuid-1::2', 'uuid-1::1']);
  });

  it('does not enter read-only preview when the pending draft patch cannot be flushed', async () => {
    const envelope = createExplorerEnvelope();
    const getItemExplorerState = vi.fn(() => of(envelope));
    const getFileItemList = vi.fn(() =>
      of({ columns: [], items: [], unitMetadata: {}, codingSchemes: {} }),
    );
    const component = createFacade({
      api: {
        getItemExplorerState,
        getFileItemList,
      },
    });

    (component as any).applySharedExplorerEnvelope(envelope);
    (component as any).flushDraftPatch = vi.fn().mockResolvedValue(false);

    await component.toggleReadOnlyPreview();

    expect(component.isReadOnlyPreview).toBe(false);
    expect(component.canEditExplorer).toBe(true);
    expect(getItemExplorerState).not.toHaveBeenCalled();
    expect(getFileItemList).not.toHaveBeenCalled();
  });

  it('keeps the editor open and flushes newer edits after an ongoing publication', async () => {
    const publication = new Subject<any>();
    const envelope = createExplorerEnvelope();
    const published = { ...envelope, version: 4, status: 'CLEAN' as const };
    const patchItemExplorerDraft = vi.fn(() => of({ ...envelope, version: 5 }));
    const getItemExplorerState = vi.fn(() => of(published));
    const component = createFacade({
      api: {
        saveItemExplorerDraft: vi.fn(() => publication),
        patchItemExplorerDraft,
        getItemExplorerState,
        getFileItemList: vi.fn(() => of({ columns: [], items: [] })),
      },
    });
    component.acpId = 'acp-1';
    (component as any).applySharedExplorerEnvelope(envelope);
    const saved = component.saveExplorerDraft(true);
    await Promise.resolve();
    await Promise.resolve();
    (component as any).queueDraftPatch('UI_UPDATE', { ui: { filterText: 'new edit' } });

    expect(await (component as any).flushDraftPatch()).toBe(false);
    await component.toggleReadOnlyPreview();
    expect(component.isReadOnlyPreview).toBe(false);
    expect(getItemExplorerState).not.toHaveBeenCalled();
    expect(patchItemExplorerDraft).not.toHaveBeenCalled();

    publication.next(published);
    expect(await saved).toBe(false);
    await vi.waitFor(() => expect(patchItemExplorerDraft).toHaveBeenCalledOnce());
    expect(patchItemExplorerDraft).toHaveBeenCalledWith(
      'acp-1',
      expect.objectContaining({
        baseVersion: 4,
        patch: { ui: { filterText: 'new edit' } },
      }),
    );
    expect(component.canEditExplorer).toBe(true);
    expect(component.hasPendingDraftChanges()).toBe(true);
    destroyFacade(component);
  });

  it('computes cell geometry without consulting the user session for every cell', () => {
    const getToken = vi.fn(() => null);
    const component = createFacade({ authService: { getToken } });
    const column = {
      key: 'system:itemId',
      id: 'itemId',
      label: 'Item-ID',
      source: 'system' as const,
      defaultWidth: 220,
    };
    getToken.mockClear();
    expect(component.isStickyTableColumn(column, [column])).toBe(true);
    expect(component.getStickyTableColumnLeft(column, [column])).toBe(0);
    expect(getToken).not.toHaveBeenCalled();
    destroyFacade(component);
  });

  it('does not switch perspective when an edit arrives between flush completion and result application', async () => {
    const patch = new Subject<any>();
    const envelope = createExplorerEnvelope();
    const getItemExplorerState = vi.fn(() => of(envelope));
    const component = createFacade({
      api: {
        patchItemExplorerDraft: vi.fn(() => patch),
        getItemExplorerState,
        getFileItemList: vi.fn(() => of({ columns: [], items: [] })),
      },
    });
    component.acpId = 'acp-1';
    (component as any).applySharedExplorerEnvelope(envelope);
    component.draft.queueDraftPatch('UI_UPDATE', { ui: { sortField: 'itemId' } });
    const flush = component.draft.flushDraftPatch();
    void flush.then(() =>
      component.draft.queueDraftPatch('UI_UPDATE', { ui: { sortField: 'unitLabel' } }),
    );
    const switching = component.toggleReadOnlyPreview();
    patch.next({ ...envelope, version: 4 });
    await switching;
    expect(component.isReadOnlyPreview).toBe(false);
    expect(getItemExplorerState).not.toHaveBeenCalled();
    expect(component.hasPendingDraftChanges()).toBe(true);
    destroyFacade(component);
  });

  it('hides player target diagnostics when the ACP flag is disabled', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = true;
    component.itemExplorerPlayerTargetInfoEnabled = false;

    expect(component.showPlayerTargetInfo).toBe(false);
  });

  it('marks items without a player target as unavailable and skips preview loading', () => {
    const getFileUnitView = vi.fn();
    const getResponseStateWithFallback = vi.fn();
    const component = createFacade({
      api: {
        getFileUnitView,
        getResponseStateWithFallback,
      },
    });

    component.selectItem(
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_2',
        unitLabel: 'Unit 2',
        description: 'Item without mapping',
        variableId: '',
        metadata: {},
      } as any,
      0,
    );

    expect(component.selectedPreviewTarget).toBe('');
    expect(component.previewUnavailableReason).toContain('keine Player-Variable');
    expect(getResponseStateWithFallback).not.toHaveBeenCalled();
    expect(getFileUnitView).not.toHaveBeenCalled();
  });

  it('shows an explanatory message when the player target is missing in the definition', () => {
    const component = createFacade({ resolvePlayerTargetLocation: () => undefined });
    const postMessage = vi.fn();
    (component as any).explorerEditingAllowed = true;
    component.itemExplorerPlayerTargetInfoEnabled = true;

    component.selectedItem = {
      itemId: 'ITEM_3',
      uuid: 'uuid-3',
      unitId: 'UNIT_3',
      unitLabel: 'Unit 3',
      description: 'Mapped item',
      variableId: 'VAR_404',
      metadata: {},
    } as any;
    registerPlayerDom(component, postMessage);
    component.player.unit = { id: 'UNIT_3', dependencies: [] };
    component.player.definitionContent = JSON.stringify({ pages: [] });
    component.player.playerFrameReady = true;
    setPreviewStatus(component, 'ready');

    (component as any).startPlayerIfReady();

    expect(postMessage).not.toHaveBeenCalled();
    expect(component.previewUnavailableReason).toContain('VAR_404');
    expect(component.previewUnavailableMessage).toContain('VAR_404');
  });

  it('resolves dependent coding variables to selectable base variables', () => {
    const component = createFacade();

    component.selectedItem = {
      itemId: 'ITEM_5',
      uuid: 'uuid-5',
      unitId: 'UNIT_5',
      unitLabel: 'Unit 5',
      description: 'Dependent coding variable',
      variableId: 'TOTAL',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', label: 'Teil A', sourceType: 'BASE', deriveSources: [] },
        { id: 'BASE_B', label: 'Teil B', sourceType: 'BASE', deriveSources: [] },
        { id: 'GROUP', sourceType: 'SUM_SCORE', deriveSources: ['BASE_A', 'BASE_B'] },
        { id: 'TOTAL', sourceType: 'SUM_SCORE', deriveSources: ['GROUP'] },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
      { id: 'BASE_B', label: 'Teil B', codes: [] },
      { id: 'GROUP', label: 'Zwischensumme', codes: [] },
      { id: 'TOTAL', label: 'Gesamtsumme', codes: [] },
    ] as any;

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.selectedItemUsesDerivedTarget).toBe(true);
    expect(component.showPreviewTargetSelector).toBe(true);
    expect(component.selectedItemTarget).toBe('TOTAL');
    expect(component.previewTargetOptions.map((option) => option.id)).toEqual([
      'BASE_A',
      'BASE_B',
      'GROUP',
      'TOTAL',
    ]);
    expect(component.selectedPreviewTarget).toBe('BASE_A');
  });

  it.each([
    {
      unitId: 'DHB023',
      itemId: '15',
      visibleAlias: '09',
      internalId: 'd_1755788097974',
      wrongBaseAlias: '10',
      sources: ['08a', '08b', '08c', '08d', '08e'],
    },
    {
      unitId: 'DHB002',
      itemId: '09',
      visibleAlias: '02',
      internalId: 'd_1755785953558',
      wrongBaseAlias: '03',
      sources: ['01a', '01b', '01c', '01d', '01e'],
    },
  ])(
    'resolves $unitId$itemId by internal id despite the $visibleAlias id/alias collision',
    ({ unitId, itemId, visibleAlias, internalId, wrongBaseAlias, sources }) => {
      const component = createFacade();
      component.selectedItem = {
        itemId,
        uuid: `${unitId}-${itemId}`,
        unitId,
        unitLabel: unitId,
        description: 'Summenitem',
        variableId: visibleAlias,
        variableReadOnlyId: internalId,
        metadata: {},
      } as any;
      component.coding.currentCodingScheme = {
        variableCodings: [
          {
            id: visibleAlias,
            alias: wrongBaseAlias,
            sourceType: 'BASE',
            deriveSources: [],
          },
          ...sources.map((source) => ({
            id: source,
            alias: source,
            sourceType: 'BASE',
            deriveSources: [],
          })),
          {
            id: internalId,
            alias: visibleAlias,
            sourceType: 'SUM_SCORE',
            deriveSources: sources,
          },
        ],
      };
      component.coding.currentCodingSchemeAsText = [
        { id: wrongBaseAlias, label: 'Falsche Basisvariable', codes: [] },
        ...sources.map((source) => ({ id: source, label: source, codes: [] })),
        { id: visibleAlias, label: 'Summenvariable', codes: [] },
      ] as any;

      (component as any).syncPreviewTargetResolution(component.selectedItem);

      expect(component.selectedItemTarget).toBe(internalId);
      expect(component.selectedPreviewTarget).toBe(sources[0]);
      expect(component.codingVariableFocus).toMatchObject({
        status: 'unique',
        targetId: internalId,
        codingId: visibleAlias,
        isDerived: true,
        sourceIds: sources,
      });
    },
  );

  it('maps Aspect print aliases to the fachliche DLB013 item ids', () => {
    const component = createFacade();
    component.player.unit = { id: 'DLB013' };
    component.items = [
      {
        itemId: '03',
        uuid: 'uuid-03',
        rowKey: 'uuid-03',
        unitId: 'DLB013',
        unitLabel: 'DLB013',
        description: 'Item 03',
        variableId: '04',
        variableReadOnlyId: 'internal-04',
        metadata: {},
      },
      {
        itemId: '04',
        uuid: 'uuid-04',
        rowKey: 'uuid-04',
        unitId: 'DLB013',
        unitLabel: 'DLB013',
        description: 'Item 04',
        variableId: '05',
        variableReadOnlyId: 'internal-05',
        metadata: {},
      },
    ] as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'internal-04', alias: '04', sourceType: 'BASE', deriveSources: [] },
        { id: 'internal-05', alias: '05', sourceType: 'BASE', deriveSources: [] },
      ],
    };

    expect((component as any).buildPrintLabelOverrides()).toEqual({
      '04': 'DLB01303',
      '05': 'DLB01304',
    });
  });

  it('keeps unprefixed item ids unchanged in Aspect print labels', () => {
    const component = createFacade();
    component.player.unit = { id: 'MDB007', dependencies: [] } as any;
    component.items = [
      {
        itemId: '01',
        uuid: 'uuid-01',
        rowKey: 'uuid-01',
        unitId: 'MDB007',
        unitLabel: 'MDB007',
        description: 'GeoGebra item',
        variableId: '01',
        variableReadOnlyId: '01_1',
        useUnitAliasAsPrefix: false,
        metadata: {},
      },
    ] as any;
    component.coding.currentCodingScheme = {
      variableCodings: [{ id: '01_1', alias: '01', sourceType: 'BASE', deriveSources: [] }],
    };

    expect((component as any).buildPrintLabelOverrides()).toEqual({
      '01': '01',
    });
  });

  it('offers known coding variables even when no standard preview target exists', () => {
    const component = createFacade();

    component.selectedItem = {
      itemId: 'ITEM_5',
      uuid: 'uuid-5',
      unitId: 'UNIT_5',
      unitLabel: 'Unit 5',
      description: 'Item without mapped target',
      variableId: '',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', label: 'Teil A', sourceType: 'BASE', deriveSources: [] },
        { id: 'BASE_B', label: 'Teil B', sourceType: 'BASE', deriveSources: [] },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
      { id: 'BASE_B', label: 'Teil B', codes: [] },
    ] as any;

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.previewTargetOptions.map((option) => option.id)).toEqual(['BASE_A', 'BASE_B']);
    expect(component.selectedPreviewTarget).toBe('');
    expect(component.previewTargetDefaultOptionLabel).toBe('Kein Standardziel hinterlegt');
  });

  it('recognizes a legacy text element id as the labeled alias option for DOB04402', () => {
    const realVoudService = new VoudService();
    const component = createFacade({
      resolvePlayerTargetLocation:
        realVoudService.resolvePlayerTargetLocation.bind(realVoudService),
      getFocusIdentifiers: realVoudService.getFocusIdentifiers.bind(realVoudService),
    });
    const textVariableId = 'text_1764855140992_1';
    const markingVariableId = 'marking-panel_1764067601517_1';

    component.selectedItem = {
      itemId: '02',
      uuid: 'dob04402',
      rowKey: 'dob04402',
      unitId: 'DOB044',
      unitLabel: 'Satzkorrektur',
      description: 'Satz 2',
      variableId: '02',
      variableReadOnlyId: 'd_1765987036018',
      previewTargetId: textVariableId,
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        {
          id: markingVariableId,
          alias: markingVariableId,
          sourceType: 'BASE',
          deriveSources: [],
        },
        { id: textVariableId, alias: '02a', sourceType: 'BASE', deriveSources: [] },
        {
          id: 'd_1765987036018',
          alias: '02',
          sourceType: 'CONCAT_CODE',
          deriveSources: [markingVariableId, textVariableId],
        },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: markingVariableId, label: 'Markierungsbereich', codes: [] },
      { id: '02a', label: 'Satz 2', codes: [] },
      { id: '02', label: 'Satzkorrektur 2', codes: [] },
    ] as any;
    component.player.definitionContent = JSON.stringify({
      pages: [
        {
          sections: [
            {
              elements: [
                { id: markingVariableId, alias: markingVariableId },
                { id: textVariableId, alias: '02a' },
              ],
            },
          ],
        },
      ],
    });

    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.selectedPreviewTarget).toBe(textVariableId);
    expect(component.selectedPreviewTargetId).toBe('02a');
    expect(component.customPreviewTargetDraft).toBe('');
    expect(component.previewTargetOptions.find((option) => option.id === '02a')?.label).toBe(
      'Satz 2 (02a)',
    );
  });

  it('stores the selected base variable as shared item state', () => {
    const component = createFacade();
    const queueDraftPatch = vi.fn();
    const startPlayerIfReady = vi.fn();

    (component as any).explorerEditingAllowed = true;
    component.selectedItem = {
      itemId: 'ITEM_6',
      uuid: 'uuid-6',
      unitId: 'UNIT_6',
      unitLabel: 'Unit 6',
      description: 'Dependent preview',
      variableId: 'TOTAL',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', sourceType: 'BASE', deriveSources: [] },
        { id: 'BASE_B', sourceType: 'BASE', deriveSources: [] },
        { id: 'TOTAL', sourceType: 'SUM_SCORE', deriveSources: ['BASE_A', 'BASE_B'] },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
      { id: 'BASE_B', label: 'Teil B', codes: [] },
      { id: 'TOTAL', label: 'Gesamtsumme', codes: [] },
    ] as any;
    (component as any).draft.latestExplorerState = {
      activeState: {
        itemProperties: {
          UNIT_6_ITEM_6: {
            empiricalDifficulty: 1.5,
          },
        },
      },
    };
    (component as any).queueDraftPatch = queueDraftPatch;
    (component as any).startPlayerIfReady = startPlayerIfReady;
    setPreviewStatus(component, 'loading-unit');

    (component as any).syncPreviewTargetResolution(component.selectedItem);
    component.coding.selectedPreviewTargetId = 'BASE_B';
    component.onPreviewTargetSelectionChange();

    expect(component.selectedItem?.previewTargetId).toBe('BASE_B');
    expect(queueDraftPatch).toHaveBeenCalledWith(
      'PREVIEW_TARGET_CHANGED',
      {
        itemPropertiesPatch: {
          UNIT_6_ITEM_6: {
            previewTargetId: 'BASE_B',
          },
        },
      },
      true,
    );
    expect(startPlayerIfReady).not.toHaveBeenCalled();
  });

  it('stores a manual preview target outside the coding scheme as shared item state', () => {
    const component = createFacade();
    const queueDraftPatch = vi.fn();

    (component as any).explorerEditingAllowed = true;
    component.selectedItem = {
      itemId: 'ITEM_6',
      uuid: 'uuid-6',
      unitId: 'UNIT_6',
      unitLabel: 'Unit 6',
      description: 'Manual preview target',
      variableId: 'TOTAL',
      metadata: {},
    } as any;
    (component as any).draft.latestExplorerState = {
      activeState: {
        itemProperties: {
          UNIT_6_ITEM_6: {
            empiricalDifficulty: 1.5,
          },
        },
      },
    };
    (component as any).queueDraftPatch = queueDraftPatch;
    setPreviewStatus(component, 'loading-unit');

    component.coding.customPreviewTargetDraft = '  alias.custom.target  ';
    component.applyCustomPreviewTarget();

    expect(component.selectedItem?.previewTargetId).toBe('alias.custom.target');
    expect(component.selectedPreviewTarget).toBe('alias.custom.target');
    expect(component.customPreviewTargetDraft).toBe('alias.custom.target');
    expect(queueDraftPatch).toHaveBeenCalledWith(
      'PREVIEW_TARGET_CHANGED',
      {
        itemPropertiesPatch: {
          UNIT_6_ITEM_6: {
            previewTargetId: 'alias.custom.target',
          },
        },
      },
      true,
    );
  });

  it('removes the stored preview target override when reset is triggered', () => {
    const component = createFacade();
    const queueDraftPatch = vi.fn();

    (component as any).explorerEditingAllowed = true;
    component.selectedItem = {
      itemId: 'ITEM_6',
      uuid: 'uuid-6',
      unitId: 'UNIT_6',
      unitLabel: 'Unit 6',
      description: 'Manual preview target',
      variableId: 'TOTAL',
      previewTargetId: 'BASE_B',
      metadata: {},
    } as any;
    (component as any).draft.latestExplorerState = {
      activeState: {
        itemProperties: {
          UNIT_6_ITEM_6: {
            previewTargetId: 'BASE_B',
          },
        },
      },
    };
    (component as any).queueDraftPatch = queueDraftPatch;
    setPreviewStatus(component, 'loading-unit');

    component.resetPreviewTargetSelection();

    expect(component.selectedItem?.previewTargetId).toBeUndefined();
    expect(component.selectedPreviewTarget).toBe('TOTAL');
    expect(queueDraftPatch).toHaveBeenCalledWith(
      'PREVIEW_TARGET_CHANGED',
      {
        itemPropertiesPatch: {
          UNIT_6_ITEM_6: {
            previewTargetId: '',
          },
        },
      },
      true,
    );
  });

  it('restores the persisted base variable selection from shared explorer state', () => {
    const component = createFacade();
    const item = {
      itemId: 'ITEM_7',
      uuid: 'uuid-7',
      unitId: 'UNIT_7',
      unitLabel: 'Unit 7',
      description: 'Persisted dependent preview',
      variableId: 'TOTAL',
      metadata: {},
    } as any;
    const state = {
      ui: {},
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: {
        'uuid-7': {
          previewTargetId: 'BASE_B',
        },
      },
    };

    component.items = [item];
    component.table.filteredItems = [item];
    component.selectedItem = item;
    component.coding.currentCodingScheme = {
      variableCodings: [
        { id: 'BASE_A', sourceType: 'BASE', deriveSources: [] },
        { id: 'BASE_B', sourceType: 'BASE', deriveSources: [] },
        { id: 'TOTAL', sourceType: 'SUM_SCORE', deriveSources: ['BASE_A', 'BASE_B'] },
      ],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
      { id: 'BASE_B', label: 'Teil B', codes: [] },
      { id: 'TOTAL', label: 'Gesamtsumme', codes: [] },
    ] as any;
    (component as any).applyFilter = vi.fn();
    (component as any).syncPreviewTargetResolution(component.selectedItem);

    expect(component.selectedPreviewTarget).toBe('BASE_A');

    (component as any).applySharedExplorerEnvelope({
      status: 'CLEAN',
      version: 2,
      publishedVersion: 1,
      canEdit: true,
      canPublish: true,
      updatedAt: '2026-04-21T15:00:00.000Z',
      updatedByUsername: 'alice',
      updatedByRole: 'ACP_MANAGER',
      activeState: state,
      publishedState: state,
      draftState: state,
    });

    expect(component.items[0].previewTargetId).toBe('BASE_B');
    expect(component.selectedPreviewTarget).toBe('BASE_B');
  });

  it('reloads the response state when shared state repairs an unavailable preview target', () => {
    const responseState$ = new Subject<any>();
    const getResponseStateWithFallback = vi.fn(() => responseState$);
    const previewLoader = { load: vi.fn(), clear: vi.fn() };
    const component = createFacade({
      api: { getResponseStateWithFallback },
      previewLoader,
    });
    const item = {
      itemId: 'ITEM_6',
      uuid: 'uuid-6',
      rowKey: 'uuid-6',
      unitId: 'UNIT_6',
      unitLabel: 'Unit 6',
      description: 'Preview target recovery',
      variableId: 'VAR_BAD',
      previewTargetId: 'VAR_BAD',
      metadata: {},
    } as any;
    component.acpId = 'acp-1';
    component.items = [item];
    component.table.filteredItems = [item];
    component.selectedItem = item;
    component.selectedIndex = 0;
    component.player.unit = { id: 'UNIT_6', dependencies: [] };
    component.player.playerSrcDoc = '<html>cached player</html>';
    component.player.definitionContent = '{"pages":[]}';
    component.player.playerFrameReady = true;
    (component as any).previewCoordinator.markUnavailable(
      'Das Player-Ziel "VAR_BAD" kommt in der Aufgabendefinition nicht vor.',
    );

    const envelope = createExplorerEnvelope();
    for (const state of [envelope.activeState, envelope.draftState, envelope.publishedState]) {
      state.ui = { filterText: '' };
      state.itemProperties = {
        'uuid-6': { previewTargetId: 'VAR_GOOD' },
      };
    }

    (component as any).applySharedExplorerEnvelope(envelope);

    expect(component.selectedPreviewTarget).toBe('VAR_GOOD');
    expect(getResponseStateWithFallback).toHaveBeenCalledOnce();
    expect(previewLoader.load).not.toHaveBeenCalled();
    expect(component.previewUpdateInProgress).toBe(true);
    destroyFacade(component);
  });

  it('restarts the preview when a different base variable is chosen', () => {
    vi.useFakeTimers();
    const component = createFacade({
      getStartPage: (_definition, variableId) => {
        if (variableId === 'BASE_A') return 1;
        if (variableId === 'BASE_B') return 4;
        return undefined;
      },
    });
    const postMessage = vi.fn();

    try {
      component.selectedItem = {
        itemId: 'ITEM_6',
        uuid: 'uuid-6',
        unitId: 'UNIT_6',
        unitLabel: 'Unit 6',
        description: 'Dependent preview',
        variableId: 'TOTAL',
        metadata: {},
      } as any;
      component.coding.currentCodingScheme = {
        variableCodings: [
          { id: 'BASE_A', sourceType: 'BASE', deriveSources: [] },
          { id: 'BASE_B', sourceType: 'BASE', deriveSources: [] },
          { id: 'TOTAL', sourceType: 'SUM_SCORE', deriveSources: ['BASE_A', 'BASE_B'] },
        ],
      };
      component.coding.currentCodingSchemeAsText = [
        { id: 'BASE_A', label: 'Teil A', codes: [] },
        { id: 'BASE_B', label: 'Teil B', codes: [] },
        { id: 'TOTAL', label: 'Gesamtsumme', codes: [] },
      ] as any;
      (component as any).syncPreviewTargetResolution(component.selectedItem);
      registerPlayerDom(component, postMessage);
      component.player.unit = { id: 'UNIT_6', dependencies: [] };
      component.player.playerSrcDoc = '<html></html>';
      component.player.definitionContent = JSON.stringify({ pages: [] });
      component.player.playerFrameReady = true;
      setPreviewStatus(component, 'ready');

      (component as any).startPlayerIfReady();

      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        playerConfig: expect.objectContaining({
          startPage: '1',
        }),
      });

      postMessage.mockClear();
      component.coding.selectedPreviewTargetId = 'BASE_B';
      component.onPreviewTargetSelectionChange();

      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        playerConfig: expect.objectContaining({
          startPage: '4',
        }),
      });
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('loads preview context after setting a manual target for an unmapped item', () => {
    const getResponseStateWithFallback = vi.fn(() => of({ state: null, isFallback: false }));
    const getFileUnitView = vi.fn(() => of({ id: 'UNIT_9', dependencies: [] }));
    const component = createFacade({
      api: {
        getResponseStateWithFallback,
        getFileUnitView,
        appendAuthToken: (url: string) => url,
      },
    });
    component.acpId = 'acp-1';

    component.selectedItem = {
      itemId: 'ITEM_9',
      uuid: 'uuid-9',
      unitId: 'UNIT_9',
      unitLabel: 'Unit 9',
      description: 'Item without mapped target',
      variableId: '',
      metadata: {},
    } as any;
    component.coding.currentCodingScheme = {
      variableCodings: [{ id: 'BASE_A', label: 'Teil A', sourceType: 'BASE', deriveSources: [] }],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
    ] as any;
    component.selectedIndex = 0;
    (component as any).unitLoadToken = 7;
    (component as any).syncPreviewTargetResolution(component.selectedItem);

    component.coding.customPreviewTargetDraft = 'BASE_A';
    component.applyCustomPreviewTarget();

    expect(getResponseStateWithFallback).toHaveBeenCalledWith('acp-1', 'ITEM_9', 'UNIT_9', []);
    expect(getFileUnitView).toHaveBeenCalledWith('acp-1', 'UNIT_9', {
      perspective: 'read-only',
    });
  });

  it('cancels a manual-target preview reload when the target is removed', () => {
    const cancelAssets = vi.fn();
    const cancelResponseState = vi.fn();
    const previewLoader = {
      load: vi.fn(
        () =>
          new Observable<any>(() => {
            return cancelAssets;
          }),
      ),
      clear: vi.fn(),
    };
    const component = createFacade({
      api: {
        getResponseStateWithFallback: vi.fn(
          () =>
            new Observable<any>(() => {
              return cancelResponseState;
            }),
        ),
      },
      previewLoader,
    });
    component.acpId = 'acp-1';
    const item = {
      itemId: 'ITEM_9',
      uuid: 'uuid-9',
      unitId: 'UNIT_9',
      unitLabel: 'Unit 9',
      description: 'Item without mapped target',
      variableId: '',
      metadata: {},
    } as any;
    component.selectedItem = item;
    component.table.filteredItems = [item];
    component.coding.currentCodingScheme = {
      variableCodings: [{ id: 'BASE_A', label: 'Teil A', sourceType: 'BASE', deriveSources: [] }],
    };
    component.coding.currentCodingSchemeAsText = [
      { id: 'BASE_A', label: 'Teil A', codes: [] },
    ] as any;
    component.selectedIndex = 0;
    (component as any).syncPreviewTargetResolution(component.selectedItem);

    component.coding.customPreviewTargetDraft = 'BASE_A';
    component.applyCustomPreviewTarget();
    expect(previewLoader.load).toHaveBeenCalledWith('acp-1', 'read-only', 'UNIT_9');
    expect(component.loadingUnit).toBe(true);

    component.resetPreviewTargetSelection();

    expect(cancelAssets).toHaveBeenCalledOnce();
    expect(cancelResponseState).toHaveBeenCalledOnce();
    expect(component.loadingUnit).toBe(false);
    expect(component.previewUnavailableReason).toContain('keine Player-Variable');
    destroyFacade(component);
  });

  it('reuses same-unit assets when a manual target enables the preview', () => {
    const responseState$ = new Subject<any>();
    const getResponseStateWithFallback = vi.fn(() => responseState$);
    const previewLoader = { load: vi.fn(), clear: vi.fn() };
    const component = createFacade({
      api: { getResponseStateWithFallback },
      previewLoader,
    });
    component.acpId = 'acp-1';
    const item = {
      itemId: 'ITEM_9',
      uuid: 'uuid-9',
      rowKey: 'uuid-9',
      unitId: 'UNIT_9',
      unitLabel: 'Unit 9',
      description: 'Item without mapped target',
      variableId: '',
      metadata: {},
    } as any;
    component.selectedItem = item;
    component.table.filteredItems = [item];
    component.selectedIndex = 0;
    component.player.unit = { id: 'UNIT_9', dependencies: [] };
    component.player.playerSrcDoc = '<html>cached player</html>';
    component.player.definitionContent = '{"pages":[]}';
    (component as any).syncPreviewTargetResolution(item);

    component.coding.customPreviewTargetDraft = 'BASE_A';
    component.applyCustomPreviewTarget();

    expect(getResponseStateWithFallback).toHaveBeenCalledOnce();
    expect(previewLoader.load).not.toHaveBeenCalled();
    expect(component.playerSrcDoc).toBe('<html>cached player</html>');
    expect(component.previewUpdateInProgress).toBe(true);
    destroyFacade(component);
  });

  it('uses a generic preview warning when diagnostics are hidden', () => {
    const component = createFacade();

    (component as any).explorerEditingAllowed = false;
    component.itemExplorerPlayerTargetInfoEnabled = true;
    (component as any).previewCoordinator.markUnavailable(
      'Das Player-Ziel "VAR_404" kommt in der Aufgabendefinition nicht vor.',
    );

    expect(component.previewUnavailableMessage).toBe(
      'Für dieses Item ist keine zielgenaue Player-Vorschau verfügbar.',
    );
    expect(component.previewUnavailableMessage).not.toContain('VAR_404');
  });

  it('uses resolved VOUD identifiers and legacy player attributes for focus selection', () => {
    const component = createFacade({
      getFocusIdentifiers: () => ['alias-1', 'element-id-1'],
    });

    component.selectedItem = {
      itemId: 'ITEM_4',
      uuid: 'uuid-4',
      unitId: 'UNIT_4',
      unitLabel: 'Unit 4',
      description: 'Focusable item',
      variableId: 'alias-1',
      metadata: {},
    } as any;
    component.player.definitionContent = JSON.stringify({ pages: [] });

    const selectors = component.player.getFocusSelectors(
      component.selectedItem,
      component.selectedPreviewTarget,
    );

    expect(selectors).toContain('[data-element-id="element-id-1"]');
    expect(selectors).toContain('[data-element-alias="alias-1"]');
    expect(selectors).toContain('[data-list-alias="alias-1"]');
    expect(selectors).toContain('[id="element-id-1"]');
  });

  it('supports keyboard navigation in the item list', () => {
    const component = createFacade();
    component.table.filteredItems = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'First item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Second item',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_3',
        uuid: 'uuid-3',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'Third item',
        variableId: '',
        metadata: {},
      },
    ] as any;

    const downEvent = {
      key: 'ArrowDown',
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      target: null,
    } as any;
    component.onTableKeydown(downEvent);

    expect(component.selectedIndex).toBe(0);
    expect(component.selectedItem?.uuid).toBe('uuid-1');
    expect(downEvent.preventDefault).toHaveBeenCalled();

    const endEvent = {
      key: 'End',
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      target: null,
    } as any;
    component.onTableKeydown(endEvent);

    expect(component.selectedIndex).toBe(2);
    expect(component.selectedItem?.uuid).toBe('uuid-3');
  });

  it('leaves modified navigation keys to the browser', () => {
    const component = createFacade();
    component.table.filteredItems = [{}] as any;
    for (const modifiers of [
      { altKey: true },
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { key: 'Home', cancelable: true, ...modifiers });
      component.onTableKeydown(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('routes manual ordering shortcuts to moveSelectedItem', () => {
    const component = createFacade();
    component.table.filteredItems = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Unit 1',
        description: 'First item',
        variableId: '',
        metadata: {},
      },
    ] as any;
    const moveSelectedItem = vi.spyOn(component, 'moveSelectedItem');

    component.onTableKeydown({
      key: 'ArrowUp',
      ctrlKey: true,
      metaKey: false,
      preventDefault: vi.fn(),
      target: null,
    } as any);

    expect(moveSelectedItem).toHaveBeenCalledWith(-1);
  });

  it('keeps review and discard closed when there are no unpublished changes', () => {
    const component = createFacade();
    component.canPublishExplorer = true;
    component.draft.explorerUiStatus = 'CLEAN';
    component.draft.latestExplorerState = { status: 'CLEAN' } as any;
    expect(component.explorerStatusLabel).toBe('Keine unveröffentlichten Änderungen');
    expect(component.hasPendingDraftChanges()).toBe(false);
    component.openSavePreviewDialog();
    component.openDiscardExplorerDraftDialog();
    expect(component.draft.showSavePreviewDialog).toBe(false);
    expect(component.draft.showDiscardDraftDialog).toBe(false);
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    component.handleWindowKeydown(event);
    expect(component.draft.showSavePreviewDialog).toBe(false);
  });

  it('opens the draft save preview with Ctrl/Cmd+S', () => {
    const component = createFacade();
    component.canPublishExplorer = true;
    const openSavePreviewDialog = vi
      .spyOn(component, 'openSavePreviewDialog')
      .mockImplementation(() => {});

    const event = {
      key: 's',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: null,
    } as any;

    component.handleWindowKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(openSavePreviewDialog).toHaveBeenCalled();
  });

  it('closes open overlays with Escape', () => {
    const component = createFacade();
    component.showHistoryOverlay = true;

    const event = {
      key: 'Escape',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: null,
    } as any;

    component.handleWindowKeydown(event);

    expect(component.showHistoryOverlay).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('keeps native dialog keyboard events out of the explorer shortcuts', () => {
    const component = createFacade();
    component.canPublishExplorer = true;
    component.showHistoryOverlay = true;
    const openSave = vi.spyOn(component, 'openSavePreviewDialog').mockImplementation(() => {});
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const input = document.createElement('input');
    dialog.appendChild(input);
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const event = new KeyboardEvent('keydown', { key: 's', [modifier]: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: input });
      component.handleWindowKeydown(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    Object.defineProperty(escape, 'target', { value: input });
    component.handleWindowKeydown(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(component.showHistoryOverlay).toBe(true);
    expect(openSave).not.toHaveBeenCalled();
  });

  it('blocks global shortcuts when a pending native dialog has lost focus', () => {
    const component = createFacade();
    component.canPublishExplorer = true;
    component.showHistoryOverlay = true;
    const openSave = vi.spyOn(component, 'openSavePreviewDialog').mockImplementation(() => {});
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const input = document.createElement('input');
    input.disabled = true;
    dialog.appendChild(input);
    document.body.appendChild(dialog);
    try {
      for (const modifier of ['ctrlKey', 'metaKey']) {
        const event = new KeyboardEvent('keydown', {
          key: 's',
          [modifier]: true,
          cancelable: true,
        });
        Object.defineProperty(event, 'target', { value: document.body });
        component.handleWindowKeydown(event);
        expect(event.defaultPrevented).toBe(true);
      }
      const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      Object.defineProperty(escape, 'target', { value: document.body });
      component.handleWindowKeydown(escape);
      expect(escape.defaultPrevented).toBe(false);
      expect(component.showHistoryOverlay).toBe(true);
      expect(openSave).not.toHaveBeenCalled();
      dialog.removeAttribute('open');
      component.handleWindowKeydown(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      // The separate history overlay still prevents opening another overlay.
      component.showHistoryOverlay = false;
      component.handleWindowKeydown(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      expect(openSave).toHaveBeenCalledOnce();
    } finally {
      dialog.remove();
    }
  });

  it('enters fullscreen on the explorer root and keeps the fullscreen state local', async () => {
    const component = createFacade();
    const shellDom = {
      toggleFullscreen: vi.fn().mockResolvedValue(true),
      isFullscreen: vi.fn(() => true),
      rememberFocusBeforeOverlay: vi.fn(),
      restoreFocusAfterOverlayClose: vi.fn(() => false),
    };
    component.registerShellDom(shellDom);

    await component.toggleFullscreen();
    component.handleFullscreenChange();

    expect(shellDom.toggleFullscreen).toHaveBeenCalledOnce();
    expect(component.isFullscreen).toBe(true);
  });

  it('leaves fullscreen when the toggle is used again', async () => {
    const component = createFacade();
    const shellDom = {
      toggleFullscreen: vi.fn().mockResolvedValue(false),
      isFullscreen: vi.fn(() => false),
      rememberFocusBeforeOverlay: vi.fn(),
      restoreFocusAfterOverlayClose: vi.fn(() => false),
    };
    component.registerShellDom(shellDom);
    component.isFullscreen = true;

    await component.toggleFullscreen();
    component.handleFullscreenChange();

    expect(shellDom.toggleFullscreen).toHaveBeenCalledOnce();
    expect(component.isFullscreen).toBe(false);
  });

  it('filters imported numeric values and paired booklet occurrences', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        infit: 1.05,
        bookletOccurrences: [
          { booklet: 'B1', position: 5 },
          { booklet: 'B2', position: 2 },
          { booklet: 'B3', position: null },
        ],
      },
    ];
    component.table.allColumns = [
      { id: 'infit', label: 'Infit', kind: 'number' },
      { id: 'booklet', label: 'Booklet', kind: 'booklet' },
      { id: 'bookletPosition', label: 'Position', kind: 'position' },
    ];
    component.table.columnFilters = {
      infit: '1,0..1,1',
      booklet: 'B1',
      bookletPosition: '1..3',
    };

    component.applyFilter(false);
    expect(component.filteredItems).toEqual([]);

    component.columnFilters['booklet'] = 'B2';
    component.applyFilter(false);
    expect(component.filteredItems).toHaveLength(1);

    component.table.columnFilters = { booklet: 'B3' };
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['item-1']);
    expect(
      component.getMetadataColumnDisplayValue(component.items[0], component.allColumns[2]),
    ).toBe('5 | 2 | ');

    component.table.columnFilters = { booklet: 'B3', bookletPosition: '1..10' };
    component.applyFilter(false);
    expect(component.filteredItems).toEqual([]);
  });

  it('calculates combined collection time once per item and unit', () => {
    const component = createFacade();
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        itemTimeSeconds: 10,
        stimulusTimeSeconds: 5,
      },
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1::2',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        itemTimeSeconds: 10,
        stimulusTimeSeconds: 5,
      },
      {
        itemId: 'item-2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v2',
        metadata: {},
        stimulusTimeSeconds: 5,
      },
    ];
    component.collections.itemCollections = [
      {
        id: 'collection-1',
        name: 'Auswahl',
        rowKeys: ['uuid-1::1', 'uuid-1::2', 'uuid-2', 'removed'],
        version: 1,
        createdAt: '',
        updatedAt: '',
        unavailableRowKeys: [],
        summary: {} as any,
      },
    ];
    component.collections.activeCollectionId = 'collection-1';

    (component as any).recalculateCollectionSummaries();

    expect(component.activeItemCollection?.summary).toEqual({
      rowCount: 4,
      itemCount: 2,
      unitCount: 1,
      itemTimeSeconds: 10,
      stimulusTimeSeconds: 5,
      testTimeSeconds: 15,
      missingItemTimeCount: 1,
      missingStimulusTimeUnitCount: 0,
      complete: false,
    });
    expect(component.activeItemCollection?.unavailableRowKeys).toEqual(['removed']);
  });

  it('persists selection changes against the active collection version', async () => {
    const summary = {
      rowCount: 1,
      itemCount: 1,
      unitCount: 1,
      itemTimeSeconds: 10,
      stimulusTimeSeconds: 5,
      testTimeSeconds: 15,
      missingItemTimeCount: 0,
      missingStimulusTimeUnitCount: 0,
      complete: true,
    };
    const mutateItemCollectionRows = vi.fn().mockReturnValue(
      of({
        collectionId: 'collection-1',
        version: 2,
        updatedAt: '2026-07-22T10:00:00.000Z',
        summary,
      }),
    );
    const component = createFacade({
      api: { mutateItemCollectionRows },
      authService: { isLoggedIn: true },
    });
    const item = {
      itemId: 'item-1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'unit-1',
      unitLabel: 'Aufgabe 1',
      description: '',
      variableId: 'v1',
      metadata: {},
      itemTimeSeconds: 10,
      stimulusTimeSeconds: 5,
    };
    component.acpId = 'acp-1';
    component.items = [item];
    component.collections.itemCollections = [
      {
        id: 'collection-1',
        name: 'Auswahl',
        rowKeys: [],
        version: 1,
        createdAt: '',
        updatedAt: '',
        unavailableRowKeys: [],
        summary: { ...summary, rowCount: 0 },
      },
    ];
    component.collections.activeCollectionId = 'collection-1';
    component.collections.collectionLoadState = 'loaded';

    await component.toggleItemInActiveCollection(item);

    expect(mutateItemCollectionRows).toHaveBeenCalledWith('acp-1', 'collection-1', {
      baseVersion: 1,
      addRowKeys: ['uuid-1'],
      perspective: 'read-only',
    });
    expect(component.activeItemCollection?.version).toBe(2);
    expect(component.activeItemCollection?.rowKeys).toEqual(['uuid-1']);
  });

  it('caches collection item lookups and membership sets until their sources change', () => {
    const component = createFacade();
    const item = {
      itemId: 'item-1',
      uuid: 'uuid-1',
      rowKey: 'uuid-1',
      unitId: 'unit-1',
      unitLabel: 'Aufgabe 1',
      description: '',
      variableId: 'v1',
      metadata: {},
    };
    component.items = [item];
    component.collections.itemCollections = [
      {
        id: 'collection-1',
        name: 'Auswahl',
        rowKeys: ['uuid-1'],
        version: 1,
        createdAt: '',
        updatedAt: '',
        unavailableRowKeys: [],
        summary: {} as any,
      },
    ];
    component.collections.activeCollectionId = 'collection-1';

    const firstEntries = component.activeCollectionItems;
    expect(component.activeCollectionItems).toBe(firstEntries);
    expect(component.isItemInActiveCollection(item)).toBe(true);

    component.activeItemCollection!.rowKeys = [];
    expect(component.activeCollectionItems).not.toBe(firstEntries);
    expect(component.isItemInActiveCollection(item)).toBe(false);
  });

  it('rolls back failed batch removals and sends clear as a compact mutation', async () => {
    const summary = {
      rowCount: 2,
      itemCount: 2,
      unitCount: 1,
      itemTimeSeconds: 0,
      stimulusTimeSeconds: 0,
      testTimeSeconds: 0,
      missingItemTimeCount: 2,
      missingStimulusTimeUnitCount: 1,
      complete: false,
    };
    const mutateItemCollectionRows = vi
      .fn()
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValueOnce(
        of({
          collectionId: 'collection-1',
          version: 2,
          updatedAt: '2026-07-22T10:00:00.000Z',
          summary: { ...summary, rowCount: 0, itemCount: 0, unitCount: 0 },
        }),
      );
    const component = createFacade({
      api: { mutateItemCollectionRows },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.collections.itemCollections = [
      {
        id: 'collection-1',
        name: 'Auswahl',
        rowKeys: ['row-1', 'row-2'],
        version: 1,
        createdAt: '',
        updatedAt: '',
        unavailableRowKeys: ['row-2'],
        summary,
      },
    ];
    component.collections.activeCollectionId = 'collection-1';

    await expect(component.removeRowsFromActiveCollection(['row-1', 'row-2'])).resolves.toBe(false);
    expect(component.activeItemCollection?.rowKeys).toEqual(['row-1', 'row-2']);
    expect(component.activeItemCollection?.unavailableRowKeys).toEqual(['row-2']);
    expect(component.collections.collectionError).toContain('konnte nicht gespeichert werden');

    await expect(component.clearActiveCollection()).resolves.toBe(true);
    expect(mutateItemCollectionRows).toHaveBeenLastCalledWith('acp-1', 'collection-1', {
      baseVersion: 1,
      clear: true,
      perspective: 'read-only',
    });
    expect(component.activeItemCollection?.rowKeys).toEqual([]);
  });

  it('persists and applies the active personal selection view after base visibility rules', async () => {
    const payload = {
      activeCollectionId: 'collection-1',
      collectionViewMode: 'active' as const,
      collections: [
        {
          id: 'collection-1',
          name: 'Auswahl',
          rowKeys: ['visible', 'excluded'],
          version: 1,
          createdAt: '',
          updatedAt: '',
          unavailableRowKeys: [],
          summary: {} as any,
        },
      ],
    };
    const activateItemCollection = vi.fn().mockReturnValue(of(payload));
    const component = createFacade({
      api: { activateItemCollection },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.items = [
      {
        itemId: 'VISIBLE',
        uuid: 'visible',
        rowKey: 'visible',
        unitId: 'UNIT_1',
        unitLabel: 'Aufgabe A',
        description: 'Treffer',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'EXCLUDED',
        uuid: 'excluded',
        rowKey: 'excluded',
        unitId: 'UNIT_2',
        unitLabel: 'Aufgabe B',
        description: 'Treffer',
        variableId: '',
        metadata: {},
        excluded: true,
      },
      {
        itemId: 'OTHER',
        uuid: 'other',
        rowKey: 'other',
        unitId: 'UNIT_3',
        unitLabel: 'Aufgabe C',
        description: 'Treffer',
        variableId: '',
        metadata: {},
      },
    ];
    component.collections.itemCollections = payload.collections;
    component.collections.activeCollectionId = 'collection-1';
    component.collections.collectionLoadState = 'loaded';

    await component.setCollectionViewMode('active');

    expect(activateItemCollection).toHaveBeenCalledWith(
      'acp-1',
      'collection-1',
      'read-only',
      'active',
    );
    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['visible']);
  });

  it('rolls the personal selection view back when persistence fails', async () => {
    const component = createFacade({
      api: { activateItemCollection: vi.fn(() => throwError(() => new Error('offline'))) },
      authService: { isLoggedIn: true },
    });
    component.items = [
      {
        itemId: 'ITEM',
        uuid: 'item',
        rowKey: 'item',
        unitId: 'UNIT',
        unitLabel: 'Aufgabe',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.collections.itemCollections = [
      {
        id: 'collection-1',
        name: 'Auswahl',
        rowKeys: [],
        version: 1,
        createdAt: '',
        updatedAt: '',
        unavailableRowKeys: [],
        summary: {} as any,
      },
    ];
    component.collections.activeCollectionId = 'collection-1';
    component.applyFilter(false);

    await component.setCollectionViewMode('active');

    expect(component.collections.collectionViewMode).toBe('all');
    expect(component.filteredItems).toHaveLength(1);
    expect(component.collections.collectionError).toContain('konnte nicht gespeichert werden');
  });

  it('keeps the collection conflict visible while reloading the latest version', async () => {
    const freshCollection = {
      id: 'collection-1',
      name: 'Server-Auswahl',
      rowKeys: [],
      version: 2,
      createdAt: '',
      updatedAt: '',
      unavailableRowKeys: [],
      summary: {} as any,
    };
    const getItemCollections = vi
      .fn()
      .mockReturnValue(of({ activeCollectionId: 'collection-1', collections: [freshCollection] }));
    const updateItemCollection = vi.fn().mockReturnValue(throwError(() => ({ status: 409 })));
    const component = createFacade({
      api: { getItemCollections, updateItemCollection },
      authService: { isLoggedIn: true },
    });
    component.acpId = 'acp-1';
    component.collections.enableItemCollections = true;
    component.collections.itemCollections = [
      { ...freshCollection, name: 'Lokale Auswahl', version: 1 },
    ];
    component.collections.activeCollectionId = 'collection-1';
    component.collections.collectionLoadState = 'loaded';

    await component.renameActiveCollection('Geändert');

    expect(getItemCollections).toHaveBeenCalledWith('acp-1', 'read-only');
    expect(component.activeItemCollection?.name).toBe('Server-Auswahl');
    expect(component.collections.collectionLoadState).toBe('loaded');
    expect(component.collections.collectionError).toBe(
      'Die Auswahlliste wurde parallel geändert und wird neu geladen.',
    );
  });

  it('filters empirical difficulty numerically and keeps missing values last', () => {
    const component = createFacade();
    const baseItem = {
      unitId: 'unit-1',
      unitLabel: 'Aufgabe 1',
      description: '',
      variableId: 'v1',
      metadata: {},
    };
    component.items = [
      { ...baseItem, itemId: 'missing', uuid: 'uuid-0', rowKey: 'uuid-0' },
      {
        ...baseItem,
        itemId: 'negative',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        empiricalDifficulty: -1,
      },
      {
        ...baseItem,
        itemId: 'positive',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        empiricalDifficulty: 2,
      },
    ];
    component.table.hasEmpiricalDifficulty = true;
    component.table.columnFilters = { empiricalDifficulty: '-2..0' };

    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['negative']);

    component.table.columnFilters = {};
    component.applyFilter(false);
    component.sortBy('empiricalDifficulty');
    expect(component.filteredItems.map((item) => item.itemId)).toEqual([
      'negative',
      'positive',
      'missing',
    ]);
  });

  it('uses backend-provided mean task difficulties without deriving replacements', () => {
    const component = createFacade();
    const baseItem = {
      unitLabel: 'Aufgabe',
      description: '',
      variableId: 'v1',
      metadata: {},
    };
    component.items = [
      {
        ...baseItem,
        itemId: 'unit-1-a',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        empiricalDifficulty: -1,
        meanTaskDifficulty: 0.4,
      },
      {
        ...baseItem,
        itemId: 'unit-1-b',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'unit-1',
        empiricalDifficulty: 0.5,
        meanTaskDifficulty: 0.4,
      },
      {
        ...baseItem,
        itemId: 'unit-1-missing',
        uuid: 'uuid-3',
        rowKey: 'uuid-3',
        unitId: 'unit-1',
        meanTaskDifficulty: 0.4,
      },
      {
        ...baseItem,
        itemId: 'unit-2',
        uuid: 'uuid-4',
        rowKey: 'uuid-4',
        unitId: 'unit-2',
        empiricalDifficulty: 1,
        meanTaskDifficulty: -0.2,
      },
      {
        ...baseItem,
        itemId: 'unit-3-missing',
        uuid: 'uuid-5',
        rowKey: 'uuid-5',
        unitId: 'unit-3',
      },
    ];

    (component as any).reconcileMeanTaskDifficultyState();

    expect(component.hasMeanTaskDifficulty).toBe(true);
    expect(component.items.slice(0, 3).map((item) => item.meanTaskDifficulty)).toEqual([
      0.4, 0.4, 0.4,
    ]);
    expect(component.items[4].meanTaskDifficulty).toBeUndefined();

    component.table.columnFilters = { meanTaskDifficulty: '0.3..0.5' };
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.unitId)).toEqual([
      'unit-1',
      'unit-1',
      'unit-1',
    ]);

    component.table.columnFilters = {};
    component.applyFilter(false);
    component.sortBy('meanTaskDifficulty');
    expect(component.filteredItems.map((item) => item.unitId)).toEqual([
      'unit-2',
      'unit-1',
      'unit-1',
      'unit-1',
      'unit-3',
    ]);
  });

  it('removes a hidden mean task difficulty filter after all difficulties are cleared', () => {
    const component = createFacade();
    (component as any).explorerEditingAllowed = true;
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        empiricalDifficulty: 0.5,
        meanTaskDifficulty: 0.5,
      },
    ];
    component.table.columnFilters = { meanTaskDifficulty: '0..1' };
    component.table.sortField = 'meanTaskDifficulty';
    component.table.sortIsMeta = false;
    component.table.sortDir = 'desc';
    const queueDraftPatch = vi.spyOn(component as any, 'queueDraftPatch');

    (component as any).reconcileMeanTaskDifficultyState();
    component.applyFilter(false);
    expect(component.filteredItems).toHaveLength(1);

    delete component.items[0].meanTaskDifficulty;
    (component as any).reconcileMeanTaskDifficultyState();
    component.applyFilter(false);

    expect(component.hasMeanTaskDifficulty).toBe(false);
    expect(component.columnFilters['meanTaskDifficulty']).toBeUndefined();
    expect(component.sortField).toBe('unitLabel');
    expect(component.sortIsMeta).toBe(false);
    expect(component.sortDir).toBe('asc');
    expect(component.filteredItems).toHaveLength(1);
    expect(queueDraftPatch).toHaveBeenCalledWith('UI_STATE_CHANGED', {
      ui: expect.objectContaining({
        sortField: 'unitLabel',
        sortDir: 'asc',
        columnFilters: {},
      }),
    });
  });

  it('keeps all integrated parameter columns configurable when values are missing', () => {
    const component = createFacade();

    const columns = (component as any).getAvailableMetadataColumns([]);
    const bistaColumn = columns.find((column: { id: string }) => column.id === 'bista');

    expect(columns.map((column: { id: string }) => column.id)).toEqual([
      'bista',
      'infit',
      'discrimination',
      'solutionRate',
      'textComplexity',
      'competenceLevel',
      'itemTimeSeconds',
      'stimulusTimeSeconds',
      'booklet',
      'bookletPosition',
    ]);
    expect(bistaColumn).toEqual({
      id: 'bista',
      label: 'BiSta-Wert',
      kind: 'number',
      visible: false,
    });
    expect(component.filterVisibleColumns(columns)).not.toContain(bistaColumn);
    expect(component.isColumnVisible(bistaColumn)).toBe(false);

    component.table.metadataSettings = {
      visible: ['bista'],
      order: ['bista'],
      configured: true,
      widths: {},
    };
    expect(component.filterVisibleColumns(columns)).toEqual([{ ...bistaColumn, visible: true }]);
    expect(component.isColumnVisible(bistaColumn)).toBe(true);
  });

  it('filters and sorts BiSta values numerically', () => {
    const component = createFacade();
    const columns = (component as any).getAvailableMetadataColumns([]);
    const bistaColumn = columns.find((column: { id: string }) => column.id === 'bista');
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        bista: 503.25,
      },
      {
        itemId: 'item-2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'unit-2',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: 'v2',
        metadata: {},
        bista: 499,
      },
    ];
    component.table.allColumns = columns;
    component.table.columnFilters = { bista: '500..504' };

    expect(bistaColumn).toEqual({
      id: 'bista',
      label: 'BiSta-Wert',
      kind: 'number',
      visible: false,
    });
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['item-1']);

    component.table.columnFilters = {};
    component.applyFilter(false);
    component.sortBy('bista');
    expect(component.filteredItems.map((item) => item.bista)).toEqual([499, 503.25]);
  });

  it('treats imported text complexity as a configurable text column', () => {
    const component = createFacade();
    const columns = (component as any).getAvailableMetadataColumns([]);
    const textComplexityColumn = columns.find(
      (column: { id: string }) => column.id === 'textComplexity',
    );
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        textComplexity: '3.5 – anspruchsvoll',
      },
      {
        itemId: 'item-2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'unit-2',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: 'v2',
        metadata: {},
        textComplexity: 'niedrig',
      },
    ];
    component.table.allColumns = columns;
    component.table.columnFilters = { textComplexity: 'ANSPRUCH' };

    expect(textComplexityColumn).toEqual({
      id: 'textComplexity',
      label: 'Textkomplexität',
      kind: 'text',
    });
    expect(component.getMetadataColumnDisplayValue(component.items[0], textComplexityColumn)).toBe(
      '3.5 – anspruchsvoll',
    );
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['item-1']);
  });

  it('filters and sorts the shared competence level as imported text', () => {
    const component = createFacade();
    const columns = (component as any).getAvailableMetadataColumns([]);
    const competenceLevelColumn = columns.find(
      (column: { id: string }) => column.id === 'competenceLevel',
    );
    component.items = [
      {
        itemId: 'item-1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'unit-1',
        unitLabel: 'Aufgabe 1',
        description: '',
        variableId: 'v1',
        metadata: {},
        competenceLevel: 'IV',
      },
      {
        itemId: 'item-2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'unit-2',
        unitLabel: 'Aufgabe 2',
        description: '',
        variableId: 'v2',
        metadata: {},
        competenceLevel: 'II',
      },
    ];
    component.table.allColumns = columns;
    component.table.columnFilters = { competenceLevel: 'IV' };

    expect(competenceLevelColumn).toEqual({
      id: 'competenceLevel',
      label: 'Kompetenzstufe',
      kind: 'text',
    });
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.itemId)).toEqual(['item-1']);

    component.table.columnFilters = {};
    component.applyFilter(false);
    component.sortBy('competenceLevel');
    expect(component.filteredItems.map((item) => item.competenceLevel)).toEqual(['II', 'IV']);
  });

  it('formats wide and legacy upload successes without losing imported details', () => {
    const component = createFacade();
    const wideSuccess = {
      unitId: 'unit-1',
      itemId: 'item-1',
      subId: 'A',
      fields: [
        'bista',
        'infit',
        'discrimination',
        'text_complexity',
        'kstufe',
        'booklet',
        'position',
      ],
      bookletOccurrences: [
        { booklet: 'B1', position: 2 },
        { booklet: 'B2', position: null },
      ],
    };

    expect(component.getUploadSuccessFieldSummary(wideSuccess)).toBe(
      'BiSta-Wert, Infit, Trennschärfe, Textkomplexität, Kompetenzstufe, Booklet / Position',
    );
    expect(component.getUploadSuccessBookletSummary(wideSuccess)).toBe('B1 / 2 | B2');
    const clearedBooklets = {
      fields: ['booklet', 'position'],
      bookletOccurrences: [],
    };
    expect(component.getUploadSuccessFieldSummary(clearedBooklets)).toBe(
      'Booklet / Position gelöscht',
    );
    expect(component.getUploadSuccessBookletSummary(clearedBooklets)).toBe('Gelöscht');
    expect(component.getUploadSuccessFieldSummary({ value: -0.4 })).toBe(
      'Empirische Itemschwierigkeit: -0.4',
    );
    expect(component.getUploadSuccessBookletSummary({ value: -0.4 })).toBe('–');
  });

  it('applies the item-list visibility returned by a wide difficulty import', async () => {
    const uploadItemParameters = vi.fn().mockReturnValue(
      of({
        updated: 1,
        failed: [],
        successes: [{ fields: ['est'], value: -0.4 }],
        showOnlyItemsWithEmpiricalDifficulty: true,
      }),
    );
    const getFileItemList = vi
      .fn()
      .mockReturnValue(of({ items: [], columns: [], unitMetadata: {}, codingSchemes: {} }));
    const component = createFacade({
      api: { uploadItemParameters, getFileItemList },
    });
    component.acpId = 'acp-1';
    component.draft.explorerVersion = 7;
    component.table.showOnlyItemsWithEmpiricalDifficulty = false;
    const file = new File(['item;est\nI1;-0.4'], 'parameters.csv', { type: 'text/csv' });
    const input = { files: [file], value: 'parameters.csv' };

    await component.onCsvFileSelected({ target: input } as unknown as Event);

    expect(uploadItemParameters).toHaveBeenCalledWith('acp-1', file, {
      draft: true,
      baseVersion: 7,
    });
    expect(component.showOnlyItemsWithEmpiricalDifficulty).toBe(true);
    expect(input.value).toBe('');
  });

  it('ignores an import response after the explorer is destroyed', async () => {
    const response = new Subject<any>();
    const component = createFacade({ api: { uploadItemParameters: vi.fn(() => response) } });
    const reload = vi.spyOn(component as any, 'reloadItems');
    const apply = vi.spyOn(component as any, 'applySharedExplorerEnvelope');
    const pending = component.onCsvFileSelected({
      target: { files: [new File(['item;est'], 'parameters.csv')], value: 'parameters.csv' },
    } as unknown as Event);

    destroyFacade(component);
    response.next({ updated: 1, failed: [], successes: [], explorerState: {} });
    await pending;

    expect(reload).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(component.showUploadReport).toBe(false);
  });

  it('waits for an initial import conflict reload before accepting another file', async () => {
    let finishReload!: (reloaded: boolean) => void;
    const reload = new Promise<boolean>((resolve) => {
      finishReload = resolve;
    });
    const uploadItemParameters = vi.fn(() => throwError(() => ({ status: 409 })));
    const component = createFacade({ api: { uploadItemParameters } });
    const reloadSpy = vi
      .spyOn(component as any, 'reloadSharedExplorerStateAndItems')
      .mockReturnValue(reload);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const event = {
      target: { files: [new File(['item;est'], 'parameters.csv')], value: 'parameters.csv' },
    } as unknown as Event;
    let finished = false;
    const pending = component.onCsvFileSelected(event).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledOnce());

    await component.onCsvFileSelected(event);
    expect(uploadItemParameters).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(component.isUploading).toBe(true);
    finishReload(true);
    await pending;
    expect(component.isUploading).toBe(false);
    consoleError.mockRestore();
    destroyFacade(component);
  });

  it('requires confirmation before importing parameters with skipped booklet data', async () => {
    const uploadItemParameters = vi
      .fn()
      .mockReturnValueOnce(
        of({
          updated: 1,
          failed: [],
          successes: [{ fields: ['est'], value: 0.5 }],
          warnings: [
            {
              code: 'BOOKLET_OCCURRENCES_SKIPPED',
              message: 'Die Spalte "booklet" fehlt.',
            },
          ],
          requiresConfirmation: true,
        }),
      )
      .mockReturnValueOnce(
        of({
          updated: 1,
          failed: [],
          successes: [{ fields: ['est'], value: 0.5 }],
          warnings: [
            {
              code: 'BOOKLET_OCCURRENCES_SKIPPED',
              message: 'Die Spalte "booklet" fehlt.',
            },
          ],
          requiresConfirmation: false,
        }),
      );
    const getFileItemList = vi
      .fn()
      .mockReturnValue(of({ items: [], columns: [], unitMetadata: {}, codingSchemes: {} }));
    const component = createFacade({ api: { uploadItemParameters, getFileItemList } });
    component.acpId = 'acp-1';
    component.draft.explorerVersion = 7;
    const file = new File(['item;est;position\nI1;0.5;4'], 'parameters.csv', {
      type: 'text/csv',
    });

    await component.onCsvFileSelected({
      target: { files: [file], value: 'parameters.csv' },
    } as unknown as Event);

    expect(component.showUploadWarningDialog).toBe(true);
    expect(component.showUploadReport).toBe(false);
    expect(getFileItemList).not.toHaveBeenCalled();

    await component.confirmItemParameterUploadWarnings();

    expect(uploadItemParameters).toHaveBeenLastCalledWith('acp-1', file, {
      draft: true,
      baseVersion: 7,
      confirmWarnings: true,
    });
    expect(component.showUploadWarningDialog).toBe(false);
    expect(component.showUploadReport).toBe(true);
    expect(component.uploadResult?.warnings).toHaveLength(1);
    expect(getFileItemList).toHaveBeenCalledTimes(1);
  });

  it('treats the parameter warning as the topmost keyboard-controlled overlay', () => {
    const component = createFacade();
    component.canPublishExplorer = true;
    component.imports.showUploadWarningDialog = true;
    const openSavePreviewDialog = vi
      .spyOn(component, 'openSavePreviewDialog')
      .mockImplementation(() => {});
    const saveEvent = {
      key: 's',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any;

    component.handleWindowKeydown(saveEvent);

    expect(saveEvent.preventDefault).toHaveBeenCalled();
    expect(openSavePreviewDialog).not.toHaveBeenCalled();

    const escapeEvent = {
      key: 'Escape',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any;
    component.handleWindowKeydown(escapeEvent);

    expect(component.showUploadWarningDialog).toBe(false);
    expect(escapeEvent.preventDefault).toHaveBeenCalled();
    expect(escapeEvent.stopPropagation).toHaveBeenCalled();
  });

  it('keeps warning confirmation locked until a conflict reload finishes', async () => {
    let finishReload!: (reloaded: boolean) => void;
    const reload = new Promise<boolean>((resolve) => {
      finishReload = resolve;
    });
    const uploadItemParameters = vi
      .fn()
      .mockReturnValueOnce(
        of({
          updated: 1,
          failed: [],
          successes: [{ fields: ['est'], value: 0.5 }],
          warnings: [
            {
              code: 'BOOKLET_OCCURRENCES_SKIPPED',
              message: 'Die Spalte "booklet" fehlt.',
            },
          ],
          requiresConfirmation: true,
        }),
      )
      .mockReturnValueOnce(throwError(() => ({ status: 409 })));
    const component = createFacade({ api: { uploadItemParameters } });
    component.acpId = 'acp-1';
    component.draft.explorerVersion = 7;
    vi.spyOn(component as any, 'reloadSharedExplorerStateAndItems').mockReturnValue(reload);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = new File(['item;est;position\nI1;0.5;4'], 'parameters.csv', {
      type: 'text/csv',
    });

    await component.onCsvFileSelected({
      target: { files: [file], value: 'parameters.csv' },
    } as unknown as Event);
    const confirmed = component.confirmItemParameterUploadWarnings();
    await vi.waitFor(() => expect(component.uploadWarningError).toContain('wird neu geladen'));

    expect(component.uploadWarningBusy).toBe(true);
    expect(component.uploadWarningError).toContain('wird neu geladen');
    component.confirmItemParameterUploadWarnings();
    expect(uploadItemParameters).toHaveBeenCalledTimes(2);

    finishReload(true);
    await confirmed;

    expect(component.uploadWarningBusy).toBe(false);
    expect(component.uploadWarningError).toContain('Bitte bestätige den Import erneut');
    consoleError.mockRestore();
  });

  it('abandons warning confirmation when the conflict reload fails', async () => {
    const uploadItemParameters = vi
      .fn()
      .mockReturnValueOnce(
        of({
          updated: 1,
          failed: [],
          successes: [{ fields: ['est'], value: 0.5 }],
          warnings: [
            {
              code: 'BOOKLET_OCCURRENCES_SKIPPED',
              message: 'Die Spalte "booklet" fehlt.',
            },
          ],
          requiresConfirmation: true,
        }),
      )
      .mockReturnValueOnce(throwError(() => ({ status: 409 })));
    const component = createFacade({ api: { uploadItemParameters } });
    component.acpId = 'acp-1';
    component.draft.explorerVersion = 7;
    vi.spyOn(component as any, 'reloadSharedExplorerStateAndItems').mockResolvedValue(false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = new File(['item;est;position\nI1;0.5;4'], 'parameters.csv', {
      type: 'text/csv',
    });

    await component.onCsvFileSelected({
      target: { files: [file], value: 'parameters.csv' },
    } as unknown as Event);
    await component.confirmItemParameterUploadWarnings();
    await Promise.resolve();

    expect(component.showUploadWarningDialog).toBe(false);
    expect(component.showErrorDialog).toBe(true);
    expect(component.errorMessage).toContain('Bitte lade die Seite neu');
    await component.confirmItemParameterUploadWarnings();
    expect(uploadItemParameters).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('keeps server collection summaries while the item list is loading', () => {
    const summary = {
      rowCount: 2,
      itemCount: 2,
      unitCount: 1,
      itemTimeSeconds: 20,
      stimulusTimeSeconds: 5,
      testTimeSeconds: 25,
      missingItemTimeCount: 0,
      missingStimulusTimeUnitCount: 0,
      complete: true,
    };
    const getItemCollections = vi.fn().mockReturnValue(
      of({
        activeCollectionId: 'collection-1',
        collections: [
          {
            id: 'collection-1',
            name: 'Auswahl',
            rowKeys: ['uuid-1', 'uuid-2'],
            version: 1,
            createdAt: '',
            updatedAt: '',
            unavailableRowKeys: [],
            summary,
          },
        ],
      }),
    );
    const token = createJwt('user-1');
    const component = createFacade({
      api: { getItemCollections },
      authService: { getToken: () => token },
    });
    component.collections.enableItemCollections = true;
    component.itemListLoading = true;

    (component as any).syncItemCollectionSession();

    expect(component.activeItemCollection?.summary).toEqual(summary);
    expect(component.activeItemCollection?.unavailableRowKeys).toEqual([]);
  });

  it('clears collections on identity changes and ignores stale responses', () => {
    const userAResponse = new Subject<any>();
    const userBResponse = new Subject<any>();
    const getItemCollections = vi
      .fn()
      .mockReturnValueOnce(userAResponse)
      .mockReturnValueOnce(userBResponse);
    let token: string | null = createJwt('user-a');
    const component = createFacade({
      api: { getItemCollections },
      authService: { getToken: () => token },
    });
    component.collections.enableItemCollections = true;

    (component as any).syncItemCollectionSession();
    expect(component.collections.collectionLoadState).toBe('loading');

    token = null;
    (component as any).syncItemCollectionSession();
    expect(component.collections.itemCollections).toEqual([]);
    expect(component.collections.collectionLoadState).toBe('error');

    userAResponse.next({
      activeCollectionId: 'collection-a',
      collections: [{ id: 'collection-a', name: 'User A', rowKeys: [] }],
    });
    expect(component.collections.itemCollections).toEqual([]);

    token = createJwt('user-b');
    (component as any).syncItemCollectionSession();
    userBResponse.next({
      activeCollectionId: 'collection-b',
      collections: [{ id: 'collection-b', name: 'User B', rowKeys: [] }],
    });
    expect(component.collections.itemCollections).toEqual([
      expect.objectContaining({ id: 'collection-b', name: 'User B' }),
    ]);
    expect(component.collections.activeCollectionId).toBe('collection-b');
  });

  it('immediately removes the previous identity collection filter on logout', () => {
    let token: string | null = createJwt('user-a');
    const component = createFacade({
      authService: { getToken: () => token },
    });
    component.collections.enableItemCollections = true;
    component.items = [
      {
        itemId: 'ITEM_1',
        uuid: 'uuid-1',
        rowKey: 'uuid-1',
        unitId: 'UNIT_1',
        unitLabel: 'Aufgabe A',
        description: '',
        variableId: '',
        metadata: {},
      },
      {
        itemId: 'ITEM_2',
        uuid: 'uuid-2',
        rowKey: 'uuid-2',
        unitId: 'UNIT_2',
        unitLabel: 'Aufgabe B',
        description: '',
        variableId: '',
        metadata: {},
      },
    ];
    component.collections.itemCollections = [
      {
        id: 'collection-a',
        name: 'User A',
        rowKeys: ['uuid-1'],
      } as any,
    ];
    component.collections.activeCollectionId = 'collection-a';
    component.collections.collectionViewMode = 'active';
    component.applyFilter(false);
    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['uuid-1']);

    token = null;
    (component as any).syncItemCollectionSession();

    expect(component.collections.collectionViewMode).toBe('all');
    expect(component.filteredItems.map((item) => item.rowKey)).toEqual(['uuid-1', 'uuid-2']);
  });
});

describe('ItemExplorer draft coordination', () => {
  it('keeps saving blocked until automatic conflict recovery has reloaded the version', async () => {
    const patch = new Subject<any>();
    const saveItemExplorerDraft = vi.fn(() => of({}));
    const component = createFacade({
      api: { patchItemExplorerDraft: () => patch, saveItemExplorerDraft },
    });
    component.acpId = 'a';
    (component as any).explorerEditingAllowed = true;
    component.canPublishExplorer = true;
    let finishReload!: (loaded: boolean) => void;
    vi.spyOn(component as any, 'reloadSharedExplorerStateAndItems').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishReload = resolve;
        }),
    );

    (component as any).queueDraftPatch('UI_UPDATE', { ui: {} });
    const flushing = (component as any).flushDraftPatch();
    patch.error({ status: 409 });
    await vi.waitFor(() => expect(finishReload).toBeTypeOf('function'));

    let saveFinished = false;
    const saving = component.saveExplorerDraft(true).then((saved) => {
      saveFinished = true;
      return saved;
    });
    await Promise.resolve();

    expect(saveFinished).toBe(false);
    expect(saveItemExplorerDraft).not.toHaveBeenCalled();

    finishReload(true);
    expect(await saving).toBe(false);
    expect(await flushing).toBe(false);
    expect(saveItemExplorerDraft).not.toHaveBeenCalled();
    destroyFacade(component);
  });

  it('waits for conflict reload before finishing discard, and reloads once for shared flush results', async () => {
    const patch = new Subject<any>();
    const component = createFacade({ api: { patchItemExplorerDraft: () => patch } });
    component.acpId = 'a';
    (component as any).explorerEditingAllowed = true;
    component.canPublishExplorer = true;
    let finishReload!: (loaded: boolean) => void;
    const reload = vi
      .spyOn(component as any, 'reloadSharedExplorerStateAndItems')
      .mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishReload = resolve;
          }),
      );
    (component as any).queueDraftPatch('UI_UPDATE', { ui: {} });
    const flushing = (component as any).flushDraftPatch();
    const discarding = component.discardExplorerDraft(true);
    let finished = false;
    void discarding.then(() => {
      finished = true;
    });
    patch.error({ status: 409 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    expect(component.draft.discarding).toBe(true);
    finishReload(true);
    expect(await discarding).toBe(false);
    expect(await flushing).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(component.draft.discarding).toBe(false);
    destroyFacade(component);
  });
  it('does not update a discard dialog after its provider scope has been destroyed', async () => {
    const response = new Subject<any>();
    const component = createFacade({ api: { discardItemExplorerDraft: () => response } });
    component.acpId = 'a';
    component.canPublishExplorer = true;
    const pending = component.confirmDiscardDraftDialog();
    destroyFacade(component);
    const errorAfterDestroy = component.discardDraftDialogError;
    response.next({ version: 9 });
    await pending;
    expect(component.discardDraftDialogError).toBe(errorAfterDestroy);
    expect(component.explorerVersion).toBe(1);
  });
});
