import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AcpStartComponent } from './acp-start.component';

function createRouteStub(acpId = 'acp-1') {
  return {
    snapshot: {
      paramMap: {
        get: vi.fn().mockReturnValue(acpId),
      },
    },
  };
}

function createApiStub() {
  return {
    getCapabilities: vi.fn().mockReturnValue(of({ canViewExplorer: true })),
    getAcpStartPage: vi.fn().mockReturnValue(
      of({
        name: 'ACP 1',
        featureConfig: {},
        units: [],
        sequences: [],
      }),
    ),
    getMyComments: vi.fn().mockReturnValue(of([])),
  };
}

function createAuthStub(overrides: Record<string, unknown> = {}) {
  return {
    isLoggedIn: false,
    isAdmin: false,
    currentUser$: of(null),
    hasAcpRole: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('AcpStartComponent', () => {
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  beforeEach(() => router.navigate.mockClear());
  afterEach(() => TestBed.resetTestingModule());

  it('redirects managers directly to the ACP overview', () => {
    const route = createRouteStub();
    const api = createApiStub();
    const auth = createAuthStub({ hasAcpRole: vi.fn().mockReturnValue(true) });

    const component = new AcpStartComponent(router as any, route as any, api as any, auth as any);
    component.ngOnInit();

    expect(router.navigate).toHaveBeenCalledWith(['/manage', 'acp-1'], { replaceUrl: true });
    expect(component.canManageAcp).toBe(true);
    expect(component.breadcrumbs).toEqual([
      { label: 'Content Hub', route: ['/'] },
      { label: 'Verwaltung', route: ['/manage', 'acp-1'] },
      { label: 'ACP 1' },
    ]);
  });

  it('keeps public breadcrumbs for non-managers', () => {
    const route = createRouteStub();
    const api = createApiStub();
    const auth = createAuthStub();

    const component = new AcpStartComponent(router as any, route as any, api as any, auth as any);
    component.ngOnInit();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.canManageAcp).toBe(false);
    expect(component.breadcrumbs).toEqual([
      { label: 'Content Hub', route: ['/'] },
      { label: 'ACP 1' },
    ]);
  });

  it('does not load my comments for anonymous users even when commenting is enabled', () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getCapabilities: vi.fn().mockReturnValue(of({ canViewExplorer: true })),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { enableCommenting: true },
          units: [],
          sequences: [],
        }),
      ),
    };
    const auth = createAuthStub();

    const component = new AcpStartComponent(router as any, route as any, api as any, auth as any);
    component.ngOnInit();

    expect(api.getMyComments).not.toHaveBeenCalled();
  });

  it('does not load comments on the start page for logged-in users', () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getCapabilities: vi.fn().mockReturnValue(of({ canViewExplorer: true })),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { enableCommenting: true },
          units: [],
          sequences: [],
        }),
      ),
    };
    const auth = createAuthStub({ isLoggedIn: true });

    const component = new AcpStartComponent(router as any, route as any, api as any, auth as any);
    component.ngOnInit();

    expect(api.getMyComments).not.toHaveBeenCalled();
  });

  it('offers the Item Explorer without a duplicate comment card or exports', async () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getCapabilities: vi.fn().mockReturnValue(of({ canViewExplorer: true })),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { enableCommenting: true, commentTargets: ['ITEM'] },
          units: [],
          sequences: [],
        }),
      ),
      exportMyReviewCommentsCsv: vi.fn(),
      exportMyReviewCommentsXlsx: vi.fn(),
      exportAllReviewCommentsXlsx: vi.fn(),
      getMyComments: vi.fn().mockReturnValue(
        of([
          {
            id: 'comment-1',
            targetType: 'ITEM',
            unitId: 'unit-1',
            itemId: 'item-1',
            commentText: 'Prüfen',
          },
        ]),
      ),
    };
    const auth = createAuthStub({ isLoggedIn: true });

    await TestBed.configureTestingModule({
      imports: [AcpStartComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AcpStartComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const explorerLink = element.querySelector('a[href="/view/acp-1/item-explorer"]');
    expect(explorerLink).not.toBeNull();
    expect(element.querySelector('a[href="/view/acp-1/items"]')).toBeNull();
    expect(element.textContent).not.toContain('Meine Kommentare');
    expect(element.textContent).not.toContain('Prüfen');
    expect(
      Array.from(element.querySelectorAll('h3')).map((heading) => heading.textContent),
    ).not.toContain('Kommentare');
    expect(api.getMyComments).not.toHaveBeenCalled();
    expect(element.querySelector('app-comment-dialog')).toBeNull();
  });

  it('reveals manager navigation after a delayed profile load', () => {
    const route = createRouteStub();
    const api = createApiStub();
    const currentUser$ = new BehaviorSubject<any>(null);
    let managerProfileLoaded = false;
    const auth = createAuthStub({
      isLoggedIn: true,
      currentUser$,
      hasAcpRole: vi.fn(() => managerProfileLoaded),
    });
    const component = new AcpStartComponent(router as any, route as any, api as any, auth as any);

    component.ngOnInit();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.canManageAcp).toBe(false);

    managerProfileLoaded = true;
    currentUser$.next({ acpRoles: [{ acpId: 'acp-1', role: 'ACP_MANAGER' }] });

    expect(router.navigate).toHaveBeenCalledWith(['/manage', 'acp-1'], { replaceUrl: true });
    expect(component.canManageAcp).toBe(true);
    expect(component.breadcrumbs).toContainEqual({
      label: 'Verwaltung',
      route: ['/manage', 'acp-1'],
    });
    component.ngOnDestroy();
  });

  it('links Review participants directly to Booklet workspaces without duplicate Booklet cards', async () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getCapabilities: vi.fn().mockReturnValue(of({ canReview: true, canViewExplorer: false })),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { enableReview: true, enableSequenceNavigation: true },
          units: [],
          sequences: [
            { id: 'booklet-10', name: 'Teil 2', kind: 'booklet' },
            { id: 'booklet-2', name: 'Teil 1', kind: 'booklet' },
            { id: 'sequence-1', name: 'Folge A' },
          ],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AcpStartComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: createAuthStub({ isLoggedIn: true }) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AcpStartComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const reviewLinks = Array.from(element.querySelectorAll('.review-card a'));
    expect(
      reviewLinks.some(
        (link) =>
          link.getAttribute('href') === '/view/acp-1/sequence/booklet-2?kind=booklet' &&
          link.textContent?.includes('Review öffnen'),
      ),
    ).toBe(true);
    expect(
      Array.from(element.querySelectorAll('.booklet-id')).map((node) => node.textContent),
    ).toEqual(['booklet-2', 'booklet-10']);
    expect(
      Array.from(element.querySelectorAll('.booklet-name')).map((node) => node.textContent),
    ).toEqual(['Teil 1', 'Teil 2']);
    expect(
      element.querySelector('input[placeholder="Bezeichnung oder Booklet-ID"]'),
    ).not.toBeNull();
    expect(element.querySelector('.review-card select')).toBeNull();
    expect(element.textContent).toContain('2 von 2 Testheften');
    expect(element.textContent).toContain('Folge A');
  });

  it('places general entries before Review when a participant can also use the Item Explorer', async () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getCapabilities: vi.fn().mockReturnValue(of({ canReview: true, canViewExplorer: true })),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { enableReview: true },
          units: [{ id: 'unit-1', name: 'Aufgabe 1' }],
          sequences: [{ id: 'booklet-1', name: 'Testheft 1', kind: 'booklet' }],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AcpStartComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: createAuthStub({ isLoggedIn: true }) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AcpStartComponent);
    fixture.detectChanges();
    const entries = Array.from(
      fixture.nativeElement.querySelectorAll('.sections-grid > .section-card'),
    ) as HTMLElement[];

    expect(entries.map((entry) => entry.querySelector('h3')?.textContent)).toEqual([
      'Item-Explorer',
      'Aufgaben ansehen',
      'Review',
    ]);
    expect(entries.at(-1)?.classList.contains('review-card')).toBe(true);
  });

  it('offers capability-only Review managers a visible management entry', async () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getCapabilities: vi
        .fn()
        .mockReturnValue(of({ canReview: true, canManageReview: true, canViewExplorer: false })),
    };

    await TestBed.configureTestingModule({
      imports: [AcpStartComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: createAuthStub({ isLoggedIn: true }) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AcpStartComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const managementLink = element.querySelector(
      'a[href="/view/acp-1/review/manage"]',
    ) as HTMLAnchorElement | null;
    expect(managementLink?.textContent).toContain('Review verwalten');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['showItemExplorerOnStartPage', 'a[href="/view/acp-1/item-explorer"]'],
    ['showUnitListOnStartPage', 'a[href="/view/acp-1/units"]'],
    ['showSequencesOnStartPage', 'a[href="/view/acp-1/sequence/sequence-1"]'],
    ['showIndexOnStartPage', 'a[href="/view/acp-1/index"]'],
  ])('hides only the configured start-page entry for %s', async (flag, selector) => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { [flag]: false },
          units: [{ id: 'unit-1', name: 'Aufgabe 1' }],
          sequences: [{ id: 'sequence-1', name: 'Folge 1' }],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AcpStartComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: createAuthStub() },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AcpStartComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector(selector)).toBeNull();

    const allEntrySelectors = [
      'a[href="/view/acp-1/item-explorer"]',
      'a[href="/view/acp-1/units"]',
      'a[href="/view/acp-1/sequence/sequence-1"]',
      'a[href="/view/acp-1/index"]',
    ];
    expect(
      allEntrySelectors.filter((entrySelector) => element.querySelector(entrySelector)),
    ).toHaveLength(3);
  });

  it('uses the legacy unit-list navigation flag until the new visibility flag is saved', async () => {
    const route = createRouteStub();
    const api = {
      ...createApiStub(),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          name: 'ACP 1',
          featureConfig: { enableUnitListNavigation: false },
          units: [{ id: 'unit-1', name: 'Aufgabe 1' }],
          sequences: [],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AcpStartComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: createAuthStub() },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AcpStartComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/view/acp-1/units"]')).toBeNull();
  });
});
