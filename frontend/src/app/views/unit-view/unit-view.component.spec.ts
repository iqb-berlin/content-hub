import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { FeatureConfig, UnitViewData } from '../../core/models/api.models';
import { UnitViewComponent } from './unit-view.component';

vi.mock('../comment-thread/item-comment-thread.component', async () => {
  const { Component } = await import('@angular/core');
  class ItemCommentThreadStub {
    acpId = '';
    targetType = '';
    unitId = '';
    bookletId = '';
    enabled = false;
    initiallyOpen = false;
    hideToggle = false;
    drafts: unknown;
    sessionToken = 0;
  }
  Component({
    selector: 'app-item-comment-thread',
    standalone: true,
    template:
      '<div class="comment-thread-stub" [attr.data-target-type]="targetType" [attr.data-unit-id]="unitId" [attr.data-booklet-id]="bookletId"></div>',
    inputs: [
      'acpId',
      'targetType',
      'unitId',
      'unitName',
      'bookletId',
      'bookletName',
      'enabled',
      'initiallyOpen',
      'hideToggle',
      'drafts',
      'sessionToken',
    ],
  })(ItemCommentThreadStub);
  return { ItemCommentThreadComponent: ItemCommentThreadStub };
});

describe('UnitViewComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function playerFixture(
    definition: string | Promise<string> = JSON.stringify({
      pages: [{ alwaysVisible: true }, {}, {}],
    }),
    codingScheme?: unknown,
  ) {
    const api = {
      appendAuthToken: (url: string) => url,
      getViewUnit: () =>
        of({
          id: 'u1',
          name: 'Aufgabe',
          items: [],
          codingScheme,
          dependencies: [
            { type: 'PLAYER', downloadUrl: '/player' },
            { type: 'UNIT_DEFINITION', downloadUrl: '/definition' },
          ],
        }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        text: async () => (url === '/definition' ? definition : '<p>Player</p>'),
      })),
    );
    await TestBed.configureTestingModule({
      imports: [UnitViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '' } } } },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser$: of(null), getToken: () => null } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UnitViewComponent);
    fixture.componentRef.setInput('acpId', 'acp');
    fixture.componentRef.setInput('unitId', 'u1');
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('reviewMode', true);
    fixture.componentRef.setInput('featureConfigOverride', {});
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull());
    await fixture.whenStable();
    const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    const message = async (data: object, source = frame.contentWindow!) => {
      window.dispatchEvent(new MessageEvent('message', { data, source }));
      await fixture.whenStable();
    };
    return { fixture, component: fixture.componentInstance, frame, postMessage, message };
  }

  const solutionScheme = {
    variableCodings: [
      {
        id: 'internal-answer',
        alias: 'ANSWER',
        label: 'Antwort',
        manualInstruction: '<p>Allgemeine Hinweise zur Antwort</p>',
        sourceType: 'BASE',
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            score: 1,
            label: 'Die Antwort nennt Berlin',
            manualInstruction: '<p>Sinngemäße Antworten akzeptieren</p>',
            ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Berlin'] }] }],
          },
          { id: 0, type: 'RESIDUAL_AUTO', score: 0 },
        ],
      },
    ],
  };

  it('shows aliased manual instructions, custom labels and searchable automatic rules', async () => {
    const { fixture, component } = await playerFixture(undefined, solutionScheme);
    component.activeTab = 'coding';
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    const panel = fixture.nativeElement.querySelector('.coding-content') as HTMLElement;
    expect(panel.textContent).toContain('Allgemeine Hinweise zur Antwort');
    expect(panel.textContent).toContain('Sinngemäße Antworten akzeptieren');
    expect(panel.textContent).toContain('Die Antwort nennt Berlin');
    expect(panel.textContent).toContain("Übereinstimmung (Zahl/Text) mit 'Berlin'");
    expect(panel.textContent).toContain('Alle anderen Antworten');
    component.codingFilterText = 'Berlin';
    expect(component.visibleCodingSchemeAsText).toHaveLength(1);
    component.codingFilterText = 'unbekannt';
    expect(component.visibleCodingSchemeAsText).toHaveLength(0);
  });

  it('restores personal data parts and the page after hiding the solution, ignoring stale and synthetic states', async () => {
    const definition = JSON.stringify({
      pages: [{}, { elements: [{ id: 'input', alias: 'ANSWER', type: 'text-field' }] }],
    });
    const { fixture, component, message } = await playerFixture(definition, solutionScheme);
    const send = vi.spyOn(component as any, 'sendToPlayer');
    await message({ type: 'vopReadyNotification' });
    const ownSession = component.playerSessionId;
    const ownAnswers = JSON.stringify([
      { id: 'ANSWER', value: 'Hamburg', status: 'VALUE_CHANGED' },
    ]);
    await message({
      type: 'vopStateChangedNotification',
      sessionId: ownSession,
      timeStamp: '2026-10-23T10:00:02Z',
      unitState: { dataParts: { elementCodes: ownAnswers } },
      playerState: { currentPage: '1' },
    });
    await message({
      type: 'vopStateChangedNotification',
      sessionId: ownSession,
      timeStamp: '2026-10-23T10:00:01Z',
      unitState: { dataParts: { elementCodes: '[]', other: 'retain me' } },
    });
    const ready = async () => {
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
      });
      const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { type: 'vopReadyNotification' },
        }),
      );
      await fixture.whenStable();
      return frame;
    };
    component.toggleSolution();
    const solutionFrame = await ready();
    const solutionStart = send.mock.calls.at(-1)![0];
    expect(solutionStart.playerConfig.startPage).toBe('1');
    expect(JSON.parse(solutionStart.unitState.dataParts.elementCodes)).toEqual([
      { id: 'ANSWER', value: 'Berlin', status: 'VALUE_CHANGED' },
    ]);
    expect(solutionStart.unitState.dataParts.other).toBeUndefined();
    for (const sessionId of [ownSession, component.playerSessionId]) {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: solutionFrame.contentWindow,
          data: {
            type: 'vopStateChangedNotification',
            sessionId,
            unitState: { dataParts: { elementCodes: '[]' } },
          },
        }),
      );
    }
    component.toggleSolution();
    await ready();
    const restoredStart = send.mock.calls.at(-1)![0];
    expect(restoredStart.unitState.dataParts).toEqual({
      elementCodes: ownAnswers,
      other: 'retain me',
    });
    expect(restoredStart.playerConfig.startPage).toBe('1');
    expect(component.solutionVisible).toBe(false);

    // A unit change cancels a pending frame restart and clears all solution/answer state.
    component.toggleSolution();
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    await ready();
    expect(component.solutionVisible).toBe(false);
    expect(send.mock.calls.at(-1)![0].unitState.dataParts).toEqual({});
    expect(send.mock.calls.at(-1)![0].sessionId).toContain('u2');
  });

  it('opens a readable explanation without changing the player for unsupported solutions', async () => {
    const { fixture, component, message, postMessage } = await playerFixture();
    await message({ type: 'vopReadyNotification' });
    component.reviewPanelCollapsed = true;
    component.toggleSolution();
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(component.solutionVisible).toBe(false);
    expect(component.reviewPanelCollapsed).toBe(false);
    expect(component.activeTab).toBe('coding');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.solution-info').textContent).toContain(
      'Keine eindeutige Musterlösung',
    );
  });

  it('shows the initial scroll-page count and synchronizes internal player navigation', async () => {
    const { fixture, component, postMessage, message } = await playerFixture();
    expect(fixture.nativeElement.querySelector('.page-info').textContent).toContain('Seite 1 / 2');
    component.onPlayerLoaded();
    expect(postMessage).not.toHaveBeenCalled();
    await message({ type: 'vopReadyNotification' });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const start = postMessage.mock.calls[0][0];
    expect(start).toMatchObject({ type: 'vopStartCommand', sessionId: expect.any(String) });
    await message({ type: 'vopReadyNotification' });
    expect(postMessage).toHaveBeenCalledTimes(1);
    await message({
      type: 'vopStateChangedNotification',
      sessionId: start.sessionId,
      playerState: { validPages: [{ id: '0' }, { id: '1' }], currentPage: '1' },
    });
    expect(fixture.nativeElement.querySelector('.page-info').textContent).toContain('Seite 2 / 2');
    component.navigateToPage(1);
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: 'vopPageNavigationCommand',
        sessionId: start.sessionId,
        target: '0',
      },
      '*',
    );
    await message({ type: 'vopStateChangedNotification', playerState: { currentPage: '0' } });
    expect(fixture.nativeElement.querySelector('.page-info').textContent).toContain('Seite 1 / 2');
    // Messages from another frame or an old unit cannot alter this unit's navigation.
    await message(
      { type: 'vopStateChangedNotification', playerState: { currentPage: '1' } },
      window,
    );
    await message({
      type: 'vopStateChangedNotification',
      sessionId: 'previous-unit',
      playerState: { currentPage: '1' },
    });
    expect(component.currentPage).toBe(1);
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    expect(component.currentPage).toBe(1);
    expect(component.totalPages).toBe(1);
  });

  it('uses ordered page IDs for Verona 6 and maps from older players', async () => {
    const { fixture, component, postMessage, message } = await playerFixture();
    await message({ type: 'vopReadyNotification' });
    await message({
      type: 'vopStateChangedNotification',
      playerState: { validPages: [{ id: 'intro' }, { id: 'question' }], currentPage: 'question' },
    });
    expect(component.currentPage).toBe(2);
    component.navigateToPage(1);
    expect(postMessage.mock.calls.at(-1)?.[0].target).toBe('intro');
    await message({
      type: 'vopStateChangedNotification',
      playerState: { validPages: { '2': 'Seite 3', '5': 'Seite 6' }, currentPage: '5' },
    });
    expect(component.totalPages).toBe(2);
    expect(component.currentPage).toBe(2);
    component.navigateToPage(1);
    expect(postMessage.mock.calls.at(-1)?.[0].target).toBe('2');
    await message({
      type: 'vopStateChangedNotification',
      playerState: { validPages: [0, 1], currentPage: 1 },
    });
    expect(component.currentPage).toBe(2);
    await message({ type: 'vopStateChangedNotification', playerState: { validPages: [] } });
    expect(fixture.nativeElement.querySelector('.page-nav')).toBeNull();
    expect(component.totalPages).toBe(0);
  });

  it('starts after the definition arrives when the player reports readiness first', async () => {
    let resolveDefinition!: (definition: string) => void;
    const definition = new Promise<string>((resolve) => {
      resolveDefinition = resolve;
    });
    const { component, postMessage, message } = await playerFixture(definition);
    await message({ type: 'vopReadyNotification' });
    expect(postMessage).not.toHaveBeenCalled();
    resolveDefinition(JSON.stringify({ pages: [{}, {}, {}] }));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(component.totalPages).toBe(3);
    expect(component.currentPage).toBe(1);
  });

  it.each([true, false])(
    'filters developer metadata only in Review (reviewMode: %s)',
    async (reviewMode) => {
      const { fixture, component } = await playerFixture();
      fixture.componentRef.setInput('reviewMode', reviewMode);
      fixture.componentRef.setInput('featureConfigOverride', {
        showMetadata: true,
        hideReviewDeveloperNames: true,
      } satisfies FeatureConfig);
      fixture.detectChanges();
      component.unitMetadata = [
        { id: 'iqb_author', label: 'Verantwortlich', value: 'EM' },
        { id: 'custom-author', label: 'Entwickler:in', value: 'Elsa Mignon' },
        { id: 'subject', label: 'Fach', value: 'Deutsch' },
      ];
      component.activeTab = 'metadata';
      component.panelVisible = true;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      const metadata = fixture.nativeElement.querySelector('.meta-dl').textContent;
      expect(metadata.includes('Elsa Mignon')).toBe(!reviewMode);
      expect(metadata.includes('EM')).toBe(!reviewMode);
      expect(metadata).toContain('Deutsch');
      fixture.componentRef.setInput('featureConfigOverride', { showMetadata: true });
      fixture.detectChanges();
      component.activeTab = 'metadata';
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.meta-dl').textContent).toContain('Elsa Mignon');
    },
  );

  it('renders changing booklet units inline with review metadata, coding and comments', async () => {
    const units: Record<string, UnitViewData> = {
      u1: {
        id: 'u1',
        name: 'Aufgabe 1',
        items: [{ id: 'item-1', name: 'Item 1' }],
        dependencies: [
          {
            type: 'CODING_SCHEME',
            fileId: 'coding-u1',
            originalName: 'u1.vocs',
            downloadUrl: '/coding-u1',
          },
          {
            type: 'METADATA',
            fileId: 'metadata-u1',
            originalName: 'u1.vomd',
            downloadUrl: '/metadata-u1',
          },
        ],
      },
      u2: {
        id: 'u2',
        name: 'Aufgabe 2',
        items: [],
        dependencies: [],
        codingScheme: {
          variableCodings: [
            {
              id: 'VAR_2',
              label: 'Variable 2',
              sourceType: 'BASE',
              deriveSources: [],
              codes: [{ id: 1, score: 1, label: 'richtig', ruleSets: [] }],
            },
          ],
        },
      },
    };
    const unitResponses: Record<string, Subject<UnitViewData>> = {
      u1: new Subject<UnitViewData>(),
      u2: new Subject<UnitViewData>(),
    };
    const api = {
      appendAuthToken: vi.fn((url: string) => url),
      getAcpStartPage: vi.fn().mockReturnValue(of({ featureConfig: {} })),
      getViewUnit: vi.fn((_acpId: string, unitId: string) => unitResponses[unitId]),
      getFilePreview: vi.fn().mockReturnValue(
        of({
          fileId: 'metadata-u1',
          fileName: 'u1.vomd',
          mode: 'structured',
          structuredData: {
            type: 'vomd',
            itemCount: 1,
            unitProfileCount: 1,
            metadataColumns: [],
            unitProfiles: [{ id: 'subject', label: 'Fach', value: 'Deutsch' }],
            items: [],
          },
        }),
      ),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          variableCodings: [
            {
              id: 'VAR_2',
              label: 'Variable 2',
              sourceType: 'BASE',
              deriveSources: [],
              manualInstruction: '<p>Variable prüfen.</p>',
              codes: [],
            },
            {
              id: 'VAR_1',
              label: 'Variable 1',
              sourceType: 'BASE',
              deriveSources: [],
              codes: [{ id: 1, score: 1, label: 'richtig', ruleSets: [] }],
            },
            {
              id: 'text_1',
              label: 'Textinhalt',
              sourceType: 'BASE',
              deriveSources: [],
              codes: [],
            },
            {
              id: '_audio01',
              label: 'Audio 1',
              sourceType: 'BASE',
              deriveSources: [],
              codes: [{ id: 1, score: 1, label: 'vorhanden', ruleSets: [] }],
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await TestBed.configureTestingModule({
      imports: [UnitViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => '' },
            },
          },
        },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser$: of(null), getToken: () => null } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UnitViewComponent);
    fixture.componentRef.setInput('acpId', 'acp-1');
    fixture.componentRef.setInput('unitId', 'u1');
    fixture.componentRef.setInput('bookletId', 'booklet-1');
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('reviewMode', true);
    fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['UNIT', 'BOOKLET'],
      showMetadata: false,
      showCodingScheme: false,
      showRichText: true,
      showAudioVideoCodingVariables: true,
    });
    fixture.detectChanges();
    unitResponses['u1'].next(units['u1']);
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.visibleCodingSchemeAsText).toHaveLength(2),
    );
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(api.getAcpStartPage).not.toHaveBeenCalled();
    expect(api.getViewUnit).toHaveBeenCalledWith('acp-1', 'u1');
    expect(fixture.nativeElement.querySelector('app-breadcrumb')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Aufgabe 1');
    expect(component.showMetadata).toBe(true);
    expect(component.showCodingScheme).toBe(true);
    expect(component.showCommentBtn).toBe(true);
    expect(component.showBookletCommentBtn).toBe(true);
    expect(api.getFilePreview).toHaveBeenCalledWith('acp-1', 'metadata-u1');
    expect(fetchMock).toHaveBeenCalledWith('/coding-u1', {
      signal: expect.any(AbortSignal),
    });
    expect(
      (fixture.nativeElement.querySelector('.comment-thread-stub') as HTMLElement).dataset[
        'unitId'
      ],
    ).toBe('u1');

    const tabs = Array.from(
      fixture.nativeElement.querySelectorAll('.panel-tabs .tab') as NodeListOf<HTMLButtonElement>,
    ).map((button) => button.textContent?.trim());
    expect(tabs).toEqual(['Kommentare', 'Metadaten', 'Kodierung']);
    expect(component.activeTab).toBe('comments');
    const commentScope = fixture.nativeElement.querySelector(
      '.comment-scope-select select',
    ) as HTMLSelectElement;
    expect(Array.from(commentScope.options).map((option) => option.value)).toEqual([
      'unit',
      'booklet',
    ]);
    expect(Array.from(commentScope.options).map((option) => option.textContent)).toEqual([
      'Aufgabe',
      'Testheft',
    ]);
    expect(
      (fixture.nativeElement.querySelector('.comment-thread-stub') as HTMLElement).dataset[
        'targetType'
      ],
    ).toBe('UNIT');
    commentScope.value = 'booklet';
    commentScope.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const bookletCommentThread = fixture.nativeElement.querySelector(
      '.comment-thread-stub',
    ) as HTMLElement;
    expect(bookletCommentThread.dataset['targetType']).toBe('BOOKLET');
    expect(bookletCommentThread.dataset['bookletId']).toBe('booklet-1');
    commentScope.value = 'unit';
    commentScope.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.panel-tabs .tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.meta-dl').textContent).toContain('Fach');
    expect(fixture.nativeElement.querySelector('.meta-dl').textContent).toContain('Deutsch');
    expect(fixture.nativeElement.textContent).not.toContain('Items (');
    expect(fixture.nativeElement.textContent).not.toContain('Abhängigkeiten');
    (fixture.nativeElement.querySelectorAll('.panel-tabs .tab')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.coding-variable h4') as NodeListOf<HTMLElement>,
      ).map((heading) => heading.textContent?.trim().replace(/\s+/g, ' ')),
    ).toEqual(['VAR_1 – Variable 1', 'VAR_2 – Variable 2']);
    expect(fixture.nativeElement.textContent).not.toContain('Audio 1');
    expect(fixture.nativeElement.textContent).not.toContain('Textinhalt');
    expect(fixture.nativeElement.querySelector('.coding-visibility-toggle')).toBeNull();
    component.showAllCodingVariables = true;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Textinhalt');
    expect(fixture.nativeElement.textContent).not.toContain('Audio 1');
    const codingFilter = fixture.nativeElement.querySelector(
      'input[aria-label="Kodiervariablen filtern"]',
    ) as HTMLInputElement;
    codingFilter.value = 'VAR_1';
    codingFilter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.coding-variable h4') as NodeListOf<HTMLElement>,
      ).map((heading) => heading.textContent?.trim().replace(/\s+/g, ' ')),
    ).toEqual(['VAR_1 – Variable 1']);
    codingFilter.value = '';
    codingFilter.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const pagingModes = Array.from(
      fixture.nativeElement.querySelectorAll(
        'select[aria-label="Seitendarstellung der Aufgabe"] option',
      ) as NodeListOf<HTMLOptionElement>,
    ).map((option) => option.value);
    expect(pagingModes).toEqual([
      'buttons',
      'separate',
      'concat-scroll',
      'concat-scroll-snap',
      'view-all',
      'print-ids',
    ]);
    component.pagingMode = 'view-all';
    expect(component.printMode).toBe('on');
    (component as any).applyPrintModeLayout();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(component.playerHeight).toBe('100%');
    expect(fixture.nativeElement.querySelector('.player-area.print-mode')).not.toBeNull();
    component.pagingMode = 'print-ids';
    expect(component.printMode).toBe('on-with-ids');

    const resizeHandle = fixture.nativeElement.querySelector(
      '.panel-resize-handle',
    ) as HTMLButtonElement;
    resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(component.reviewPanelWidth).toBe(444);
    component.toggleReviewPanel();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#unit-additional-data')).toBeNull();
    component.toggleReviewPanel();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();

    component.codingFilterText = 'VAR_1';
    component.showAllCodingVariables = true;
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    unitResponses['u2'].next(units['u2']);
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.codingSchemeAsText?.[0]?.label).toBe('Variable 2'),
    );
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(component.codingFilterText).toBe('');
    expect(component.showAllCodingVariables).toBe(false);
    expect(api.getViewUnit).toHaveBeenLastCalledWith('acp-1', 'u2');
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Aufgabe 2');
    (fixture.nativeElement.querySelectorAll('.panel-tabs .tab')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.comment-thread-stub') as HTMLElement).dataset[
        'unitId'
      ],
    ).toBe('u2');

    // Returning to ordinary booklet navigation must restore the ACP's hidden
    // metadata and coding settings even after review data has been loaded.
    fixture.componentRef.setInput('reviewMode', false);
    fixture.detectChanges();
    expect(component.showMetadata).toBe(false);
    expect(component.showCodingScheme).toBe(false);
    expect(component.showRichText).toBe(true);
    expect(fixture.nativeElement.querySelector('.meta-dl')).toBeNull();
    expect(fixture.nativeElement.querySelector('.coding-variable')).toBeNull();
  });
});

describe('Review panel interactions', () => {
  function component() {
    const result = new UnitViewComponent(
      null as any,
      null as any,
      null as any,
      { markForCheck: vi.fn() } as any,
      null as any,
      null as any,
    );
    result.reviewMode = true;
    return result;
  }

  function pointer(target: EventTarget, type: string, values: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: 1,
      clientX: 800,
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    });
    target.dispatchEvent(event);
  }

  it.each([
    'pointerup',
    'pointercancel',
    'lostpointercapture',
    'blur',
    'released-button',
    'collapse',
    'destroy',
  ])('stops dragging on %s and ignores subsequent movement', (ending) => {
    const view = component();
    const handle = document.createElement('button');
    const capture = vi.fn();
    const release = vi.fn();
    handle.setPointerCapture = capture;
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = release;
    handle.addEventListener('pointerdown', (event) => view.startReviewPanelResize(event));
    try {
      pointer(handle, 'pointerdown');
      expect(capture).toHaveBeenCalledWith(1);
      pointer(window, 'pointermove', { clientX: 750 });
      expect(view.reviewPanelWidth).toBe(470);
      pointer(window, 'pointerup', { pointerId: 2 });
      pointer(window, 'pointermove', { clientX: 730 });
      expect(view.reviewPanelWidth).toBe(490);
      if (ending === 'blur') window.dispatchEvent(new Event('blur'));
      else if (ending === 'released-button')
        pointer(window, 'pointermove', { buttons: 0, clientX: 600 });
      else if (ending === 'collapse') view.toggleReviewPanel();
      else if (ending === 'destroy') view.ngOnDestroy();
      else pointer(ending === 'lostpointercapture' ? handle : window, ending, { buttons: 0 });
      pointer(window, 'pointermove', { clientX: 600 });
      expect(view.reviewPanelWidth).toBe(490);
      expect(release).toHaveBeenCalledWith(1);
    } finally {
      view.ngOnDestroy();
    }
  });

  it.each([undefined, '', '  ', 42])(
    'reports a malformed coding ID %s without crashing the review',
    (id) => {
      const view = component();
      view['applyCodingScheme'](
        {
          variableCodings: [
            {
              id: 'V1',
              sourceType: 'BASE',
              codes: [{ id: 1, score: 1, label: 'richtig', ruleSets: [] }],
            },
            {
              id,
              sourceType: 'BASE',
              codes: [{ id: 1, score: 1, label: 'richtig', ruleSets: [] }],
            },
          ],
        },
        0,
      );
      expect(view.codingSchemeAsText).toBeNull();
      expect(view.codingSchemeError).toBe('Kodierung konnte nicht gelesen werden.');
      expect(view.visibleCodingSchemeAsText).toEqual([]);
      view.ngOnDestroy();
    },
  );

  it('sorts coded variables naturally in review while keeping ordinary visibility settings', () => {
    const view = component();
    view.codingSchemeAsText = ['V10', 'V2', 'V1', 'text'].map((id) => ({
      id,
      label: id,
      codes: id === 'text' ? [] : [{ id: 1 }],
    })) as any;
    view.showAllCodingVariables = true;
    expect(view.visibleCodingSchemeAsText.map((entry) => entry.id)).toEqual(['V1', 'V2', 'V10']);
    expect(view.codingSchemeAsText!.map((entry) => entry.id)).toEqual(['V10', 'V2', 'V1', 'text']);
    view.reviewMode = false;
    expect(view.visibleCodingSchemeAsText.map((entry) => entry.id)).toEqual([
      'V10',
      'V2',
      'V1',
      'text',
    ]);
    view.ngOnDestroy();
  });
});
