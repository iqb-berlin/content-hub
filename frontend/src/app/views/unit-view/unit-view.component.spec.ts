import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { FeatureConfig, FilePreviewVomdData, UnitViewData } from '../../core/models/api.models';
import { UnitViewComponent } from './unit-view.component';
import { dhv004ReviewFixture } from './fixtures/dhv004-review.fixture';

vi.mock('../comment-thread/item-comment-thread.component', async () => {
  const { Component } = await import('@angular/core');
  class ItemCommentThreadStub {
    apId = '';
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
      'apId',
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
    metadataByUnit?: Record<string, FilePreviewVomdData['unitProfiles']>,
    options: {
      itemsByUnit?: Record<string, unknown[]>;
      metadataItemsByUnit?: Record<string, FilePreviewVomdData['items']>;
      previewsByUnit?: Record<string, Subject<any>>;
    } = {},
  ) {
    const api = {
      getReviewTranscripts: (_apId: string, _bookletId: string, unitId: string) =>
        of(
          (metadataByUnit?.[unitId] ?? [])
            .filter(
              (entry) =>
                ['iqb_transcript', 'iqb_final_transcript', 'iqb_copyright_original'].includes(
                  entry.id,
                ) ||
                (entry.id === 'k6' && entry.label === 'Transkript zur Aufgabe'),
            )
            .filter((entry) => entry.value.trim()),
        ),
      appendAuthToken: (url: string) => url,
      getViewUnit: (_apId: string, unitId: string) =>
        of({
          id: unitId,
          name: 'Aufgabe',
          items: options.itemsByUnit?.[unitId] || [],
          codingScheme,
          dependencies: [
            { type: 'PLAYER', downloadUrl: '/player' },
            { type: 'UNIT_DEFINITION', downloadUrl: '/definition' },
            ...(metadataByUnit || options.metadataItemsByUnit || options.previewsByUnit
              ? [{ type: 'METADATA', fileId: unitId }]
              : []),
          ],
        }),
      getFilePreview: (_apId: string, fileId: string) =>
        options.previewsByUnit?.[fileId] ||
        of({
          structuredData: {
            type: 'vomd',
            unitProfiles: metadataByUnit?.[fileId] || [],
            items: options.metadataItemsByUnit?.[fileId] || [],
            itemCount: options.metadataItemsByUnit?.[fileId]?.length || 0,
          },
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
    fixture.componentRef.setInput('apId', 'ap');
    fixture.componentRef.setInput('unitId', 'u1');
    fixture.componentRef.setInput('bookletId', 'booklet-1');
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

  function headings(fixture: { nativeElement: HTMLElement }): string[] {
    return [...fixture.nativeElement.querySelectorAll('.coding-variable h4')].map((heading) =>
      heading.textContent!.trim().replace(/\s+/g, ' '),
    );
  }

  function metadataPreview(description: string) {
    return {
      structuredData: {
        type: 'vomd',
        unitProfiles: [],
        itemCount: 1,
        items: [{ id: 'item', variableId: 'ANSWER', description }],
      },
    };
  }

  it('updates numbered cards, search and source references when entering and leaving both print modes', async () => {
    const base = solutionScheme.variableCodings[0];
    const scheme = {
      variableCodings: [
        base,
        {
          ...base,
          id: 'copy',
          alias: 'COPY',
          label: 'Übernahme',
          sourceType: 'COPY_VALUE',
          deriveSources: [base.id],
        },
      ],
    };
    const definition = JSON.stringify({
      type: 'aspect-unit-definition',
      version: '4.12.0',
      enableSectionNumbering: true,
      pages: [
        { alwaysVisible: true, sections: [{ elements: [{ id: 'stimulus', type: 'text' }] }] },
        { sections: [{ elements: [{ id: base.id, alias: base.alias, type: 'radio' }] }] },
      ],
    });
    const { fixture, component, message } = await playerFixture(definition, scheme);
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['1. – Antwort', '1. – Übernahme']);
    const copy = component.codingSchemeAsText!.find((entry) => entry.id === 'COPY')!;
    for (const mode of ['view-all', 'print-ids', 'buttons'] as const) {
      const previous = fixture.nativeElement.querySelector('iframe');
      component.pagingMode = mode;
      component.onPagingModeChange();
      const number = mode === 'buttons' ? '1.' : '2.';
      expect(component.reviewCodingSource(copy)).toBe(`Kopie von Variable '${number} – Antwort'`);
      component.codingFilterText = number;
      expect(component.visibleCodingSchemeAsText).toHaveLength(2);
      component.codingFilterText = '';
      await vi.waitFor(() => {
        expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('iframe')).not.toBe(previous);
      });
      const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
      const send = vi.spyOn(frame.contentWindow!, 'postMessage');
      await message({ type: 'vopReadyNotification' }, frame.contentWindow!);
      expect(
        send.mock.calls.find(([command]) => command.type === 'vopStartCommand')?.[0].unitDefinition,
      ).toBe(definition);
      expect(headings(fixture)).toEqual([`${number} – Antwort`, `${number} – Übernahme`]);
    }
    // A mode change must update cards even while the player source is unavailable.
    component.playerSrcDoc = null;
    component.pagingMode = 'view-all';
    component.onPagingModeChange();
    expect(component.reviewCodingTitle(component.codingSchemeAsText![0])).toBe('2.');
  });

  it.each(['4.11.0', '4.12.0'])(
    'keeps descriptions for state-variable conflicts in %s',
    async (version) => {
      const base = solutionScheme.variableCodings[0];
      const definition = JSON.stringify({
        type: 'aspect-unit-definition',
        version,
        enableSectionNumbering: true,
        stateVariables: [{ id: 'state', alias: base.alias, value: '0' }],
        pages: [{ sections: [{ elements: [{ id: base.id, alias: base.alias, type: 'radio' }] }] }],
      });
      const { fixture, component } = await playerFixture(definition, {
        variableCodings: [
          base,
          {
            ...base,
            id: 'copy',
            alias: 'COPY',
            label: 'Übernahme',
            sourceType: 'COPY_VALUE',
            deriveSources: [base.id],
          },
        ],
      });
      component.reviewCodingVisible = true;
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(headings(fixture)).toEqual(['Antwort', 'Übernahme']);
    },
  );

  it.each(['conflicting', 'duplicate'])(
    'shows the description without a number for %s VOUD aliases',
    async (ambiguity) => {
      const definition = JSON.stringify({
        type: 'aspect-unit-definition',
        version: '4.11.0',
        enableSectionNumbering: true,
        pages: [
          {
            alwaysVisible: false,
            sections: [
              {
                ignoreNumbering: false,
                elements: [
                  { id: 'A', alias: ambiguity === 'conflicting' ? 'X' : 'Y', type: 'radio' },
                ],
              },
              { ignoreNumbering: false, elements: [{ id: 'B', alias: 'Y', type: 'radio' }] },
            ],
          },
        ],
      });
      const scheme = {
        variableCodings: [{ ...solutionScheme.variableCodings[0], id: 'A', alias: 'Y' }],
      };
      const { fixture, component } = await playerFixture(definition, scheme);
      component.reviewCodingVisible = true;
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(headings(fixture)).toEqual(['Antwort']);
      expect(component.reviewCodingSource(component.codingSchemeAsText![0])).toBe(
        "Basisvariable 'Antwort'",
      );
    },
  );

  it.each([
    ['4.7.0', 'implicit Likert row'],
    ['4.11.0', 'implicit Likert row'],
    ['4.7.0', 'empty alias'],
    ['4.11.0', 'empty alias'],
    ['4.7.0', 'geometry variable'],
    ['4.11.0', 'geometry variable'],
  ])('omits task numbers for a %s conflict in %s', async (version, conflict) => {
    const duplicate =
      conflict === 'implicit Likert row'
        ? { type: 'likert', rows: [{ id: 'row', alias: 'G_x' }] }
        : conflict === 'empty alias'
          ? { id: 'G_x', alias: '', type: 'radio', isRelevantForPresentationComplete: true }
          : {
              id: 'g',
              alias: 'G',
              type: 'geometry',
              trackedVariables: version === '4.7.0' ? ['x'] : [{ id: 'x', value: '' }],
            };
    const definition = JSON.stringify({
      type: 'aspect-unit-definition',
      version,
      enableSectionNumbering: true,
      pages: [
        {
          sections: [
            { elements: [{ id: 'internal-answer', alias: 'G_x', type: 'radio' }] },
            { elements: [{ id: 'table', type: 'table', elements: [duplicate] }] },
          ],
        },
      ],
    });
    const scheme = { variableCodings: [{ ...solutionScheme.variableCodings[0], alias: 'G_x' }] };
    const { fixture, component } = await playerFixture(definition, scheme);
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['Antwort']);
    expect(component.reviewCodingSource(component.codingSchemeAsText![0])).toBe(
      "Basisvariable 'Antwort'",
    );
  });

  it.each(['4.6.0', '4.11.0'])(
    'renders the number for an ASPECT-2.x Checkbox in format %s',
    async (version) => {
      const definition = JSON.stringify({
        type: 'aspect-unit-definition',
        version,
        enableSectionNumbering: true,
        pages: [
          {
            alwaysVisible: false,
            sections: [
              {
                ignoreNumbering: false,
                elements: [
                  {
                    id: 'cloze',
                    type: 'cloze',
                    document: {
                      type: 'doc',
                      content: [
                        {
                          type: 'paragraph',
                          content: [
                            {
                              type: 'Checkbox',
                              attrs: {
                                model: {
                                  id: version === '4.6.0' ? 'ANSWER' : 'internal-answer',
                                  alias: 'ANSWER',
                                  type: 'checkbox',
                                  value: false,
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
      const scheme =
        version === '4.6.0'
          ? { variableCodings: [{ ...solutionScheme.variableCodings[0], id: 'ANSWER' }] }
          : solutionScheme;
      const { fixture, component } = await playerFixture(definition, scheme);
      component.reviewCodingVisible = true;
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(headings(fixture)).toEqual(['1. – Antwort']);
    },
  );

  it('renders original #290 beside comments and passes the exact VOUD through in both print modes', async () => {
    const original = dhv004ReviewFixture;
    const definition = `  ${JSON.stringify(original.definition)}\n`;
    const before = JSON.stringify(original);
    const { fixture, component, frame, message, postMessage } = await playerFixture(
      definition,
      original.codingScheme,
      undefined,
      {
        itemsByUnit: { u1: original.indexItems },
        metadataItemsByUnit: {
          u1: original.metadataItems.map((item) => ({
            ...item,
            description: item.description || '',
            metadata: {},
          })),
        },
      },
    );
    component.activeTab = 'comments';
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    const toggle = fixture.nativeElement.querySelector(
      '.review-coding-panel > button',
    ) as HTMLButtonElement;
    const comments = [...fixture.nativeElement.querySelectorAll('.panel-tabs button')].find(
      (button: any) => button.textContent.trim() === 'Kommentare',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(headings(fixture)).toEqual([]);
    toggle.click();
    await fixture.whenStable();
    expect(component.activeTab).toBe('comments');
    expect(comments.getAttribute('aria-pressed')).toBe('true');
    expect(headings(fixture)).toContain('4.');
    expect(
      component.reviewCodingTitle(
        component.codingSchemeAsText!.find((entry) => entry.id === '05')!,
      ),
    ).toBe('4.');
    expect(postMessage.mock.calls.some(([command]) => command.type === 'vopStartCommand')).toBe(
      false,
    );
    frame.contentDocument!.body.innerHTML = '<main>99. Arbitrary player markup</main>';
    await message({ type: 'vopReadyNotification' });
    expect(
      postMessage.mock.calls.find(([command]) => command.type === 'vopStartCommand')?.[0]
        .unitDefinition,
    ).toBe(definition);
    for (const mode of ['view-all', 'print-ids'] as const) {
      const previous = fixture.nativeElement.querySelector('iframe');
      component.pagingMode = mode;
      component.onPagingModeChange();
      await vi.waitFor(() => {
        expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('iframe')).not.toBe(previous);
      });
      const next = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
      const send = vi.spyOn(next.contentWindow!, 'postMessage');
      await message({ type: 'vopReadyNotification' }, next.contentWindow!);
      expect(
        send.mock.calls.find(([command]) => command.type === 'vopStartCommand')?.[0].unitDefinition,
      ).toBe(definition);
      expect(headings(fixture)).toContain('4.');
    }
    toggle.click();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual([]);
    expect(comments.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    await fixture.whenStable();
    expect(headings(fixture)).toContain('4.');
    expect(JSON.stringify(original)).toBe(before);
  });

  it('updates the original caption when the definition arrives late and clears it on task change', async () => {
    let finish!: (definition: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const original = dhv004ReviewFixture;
    const { fixture, component } = await playerFixture(pending, original.codingScheme, undefined, {
      itemsByUnit: { u1: original.indexItems },
    });
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture).some((value) => value === '4.')).toBe(false);
    finish(JSON.stringify(original.definition));
    await vi.waitFor(() => expect(headings(fixture)).toContain('4.'));
    vi.mocked(fetch).mockResolvedValue({ text: async () => '{}' } as Response);
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture).some((value) => value === '4.')).toBe(false);
  });

  it('keeps the original unnamed fallback when the audio-to-answer relation is ambiguous', async () => {
    const definition = structuredClone(dhv004ReviewFixture.definition);
    definition.pages[4].sections[1].visibilityRules = [];
    const { fixture, component } = await playerFixture(
      JSON.stringify(definition),
      dhv004ReviewFixture.codingScheme,
    );
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    const coding = component.codingSchemeAsText!.find((entry) => entry.id === '05')!;
    expect(component.reviewCodingTitle(coding)).toBe('Kodierung ohne Bezeichnung');
    expect(headings(fixture)).not.toContain('4.');
  });

  it('ignores an original VOUD arriving after the component has switched to another task', async () => {
    let finish!: (definition: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const { fixture, component } = await playerFixture(pending, dhv004ReviewFixture.codingScheme);
    vi.mocked(fetch).mockResolvedValue({ text: async () => '{}' } as Response);
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    finish(JSON.stringify(dhv004ReviewFixture.definition));
    await fixture.whenStable();
    expect(component.definitionContent).toBe('{}');
    expect(headings(fixture)).toEqual(['Kodierung ohne Bezeichnung']);
  });

  it('does not let a 20-item preview conceal conflicting metadata beyond its cutoff', async () => {
    const preview = new Subject<any>();
    const items = Array.from({ length: 21 }, (_, index) => ({
      sourceVariable: 'ANSWER',
      name: index < 20 ? '4.' : '7.',
    }));
    const { fixture, component } = await playerFixture(undefined, solutionScheme, undefined, {
      itemsByUnit: { u1: items },
      previewsByUnit: { u1: preview },
    });
    component.reviewCodingVisible = true;
    preview.next({
      structuredData: {
        type: 'vomd',
        itemCount: 21,
        unitProfiles: [],
        items: items.slice(0, 20).map((item) => ({ ...item, description: item.name })),
      },
    });
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['Antwort']);
  });

  it('shows metadata captions before player readiness without reading the player DOM', async () => {
    const definition = '  { "format": "another-player", "payload": "unchanged" }\n';
    const { fixture, component, frame, message, postMessage } = await playerFixture(
      definition,
      solutionScheme,
      undefined,
      {
        metadataItemsByUnit: {
          u1: [
            { id: 'item', variableReadOnlyId: 'internal-answer', description: '4.', metadata: {} },
          ],
        },
      },
    );
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['4. – Antwort']);
    expect(postMessage.mock.calls.some(([command]) => command.type === 'vopStartCommand')).toBe(
      false,
    );

    vi.spyOn(frame.contentDocument!, 'querySelectorAll').mockImplementation(() => {
      throw new Error('Coding captions must not inspect a player document');
    });
    frame.contentDocument!.body.innerHTML = '<main>Independent player markup: question 99</main>';
    await message({ type: 'vopReadyNotification' });
    const start = postMessage.mock.calls.find(
      ([command]) => command.type === 'vopStartCommand',
    )?.[0];
    expect(start.unitDefinition).toBe(definition);
    expect(headings(fixture)).toEqual(['4. – Antwort']);

    component.pagingMode = 'view-all';
    component.onPagingModeChange();
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('iframe')).not.toBe(frame));
    expect(headings(fixture)).toEqual(['4. – Antwort']);
  });

  it('updates captions and filtering when VOMD metadata arrives after the coding scheme', async () => {
    const preview = new Subject<any>();
    const { fixture, component } = await playerFixture(undefined, solutionScheme, undefined, {
      previewsByUnit: { u1: preview },
      itemsByUnit: { u1: [{ id: 'item', sourceVariable: 'ANSWER', name: 'Indexbezeichnung' }] },
    });
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['Indexbezeichnung – Antwort']);

    preview.next(metadataPreview('4. Haltestelle'));
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['4. Haltestelle – Antwort']);
    component.codingFilterText = 'Haltestelle';
    expect(component.visibleCodingSchemeAsText).toHaveLength(1);
    component.codingFilterText = 'internal-answer';
    expect(component.visibleCodingSchemeAsText).toHaveLength(0);
  });

  it('clears old captions and ignores delayed metadata after a unit change', async () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    const { fixture, component } = await playerFixture(undefined, solutionScheme, undefined, {
      previewsByUnit: { u1: first, u2: second },
    });
    component.reviewCodingVisible = true;
    first.next(metadataPreview('4.'));
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['4. – Antwort']);

    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['Antwort']);
    first.next(metadataPreview('99. Veraltete Antwort'));
    second.next(metadataPreview('7.'));
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['7. – Antwort']);
  });

  it('keeps index captions if the metadata preview fails', async () => {
    const preview = new Subject<any>();
    const { component, fixture } = await playerFixture(undefined, solutionScheme, undefined, {
      previewsByUnit: { u1: preview },
      itemsByUnit: { u1: [{ sourceVariable: 'ANSWER', name: '4. Index' }] },
    });
    component.reviewCodingVisible = true;
    preview.error(new Error('Unavailable metadata'));
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['4. Index – Antwort']);
  });

  it('keeps alias-based solution notices and internal-ID source references distinct', async () => {
    const base = solutionScheme.variableCodings[0];
    const scheme = {
      variableCodings: [
        { ...base, id: 'raw', alias: 'VALUE', label: 'Basis' },
        {
          ...base,
          id: 'derived',
          alias: 'raw',
          label: 'Abgeleitet',
          sourceType: 'COPY_VALUE',
          deriveSources: ['raw'],
          codeModel: 'MANUAL_ONLY',
          codes: [{ id: 1, type: 'FULL_CREDIT', score: 1, manualInstruction: 'Manuell prüfen' }],
        },
      ],
    };
    const { component, fixture } = await playerFixture(undefined, scheme, undefined, {
      metadataItemsByUnit: {
        u1: [
          { id: 'base', variableReadOnlyId: 'raw', description: '4.', metadata: {} },
          { id: 'derived', variableId: 'raw', description: '7.', metadata: {} },
        ],
      },
    });
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(headings(fixture)).toEqual(['4. – Basis', '7. – Abgeleitet']);
    expect(component.unavailableReviewCodingTitles).toEqual(['4. – Basis', '7. – Abgeleitet']);
    const derived = component.codingSchemeAsText!.find((entry) => entry.id === 'raw')!;
    expect(component.reviewCodingSource(derived)).toBe("Kopie von Variable '4. – Basis'");
  });

  it('distinguishes unnamed sources even if another caption resembles a generated name', async () => {
    const base = solutionScheme.variableCodings[0];
    const { component, fixture } = await playerFixture(undefined, {
      variableCodings: [
        { ...base, id: 'a', alias: 'A', label: '' },
        { ...base, id: 'b', alias: 'B', label: '' },
        { ...base, id: 'c', alias: 'C', label: 'Kodierung ohne Bezeichnung – Kodiervariable 1' },
        {
          ...base,
          id: 'sum',
          alias: 'SUM',
          label: 'Summe',
          sourceType: 'SUM_SCORE',
          deriveSources: ['b', 'a'],
        },
      ],
    });
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    const titles = headings(fixture);
    expect(new Set(titles).size).toBe(4);
    expect(titles).toContain('Kodierung ohne Bezeichnung – Kodiervariable 2');
    expect(titles).toContain('Kodierung ohne Bezeichnung – Kodiervariable 3');
    const sum = component.codingSchemeAsText!.find((entry) => entry.id === 'SUM')!;
    expect(component.reviewCodingSource(sum)).toContain(
      "'Kodierung ohne Bezeichnung – Kodiervariable 3, Kodierung ohne Bezeichnung – Kodiervariable 2'",
    );
  });

  it('maps solver tokens through aliases while keeping the original formula', async () => {
    const base = solutionScheme.variableCodings[0];
    const expression = '${ arrival[0]:0:INC } - ${departure}';
    const { component } = await playerFixture(undefined, {
      variableCodings: [
        { ...base, id: 'departure', alias: 'first', label: 'Abfahrt' },
        { ...base, id: 'internal-arrival', alias: 'arrival', label: 'Ankunft' },
        {
          ...base,
          id: 'duration',
          alias: 'duration',
          label: 'Fahrtdauer',
          sourceType: 'SOLVER',
          deriveSources: ['departure', 'internal-arrival'],
          sourceParameters: { solverExpression: expression },
        },
      ],
    });
    const formula = component.codingSchemeAsText!.find((entry) => entry.id === 'duration')!;
    expect(component.reviewSolverReferences(formula)).toBe(
      '${ arrival[0]:0:INC } → Ankunft; ${departure} → Abfahrt',
    );
    expect(component.reviewCodingSource(formula)).toContain(expression);
  });

  it('keeps duplicate captions distinct when returning to review mode', async () => {
    const base = solutionScheme.variableCodings[0];
    const { component, fixture } = await playerFixture(undefined, {
      variableCodings: [
        { ...base, id: 'a', alias: 'A', label: '' },
        { ...base, id: 'b', alias: 'B', label: '' },
      ],
    });
    fixture.componentRef.setInput('reviewMode', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('reviewMode', true);
    fixture.detectChanges();
    component.reviewCodingVisible = true;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(new Set(headings(fixture)).size).toBe(2);
    expect(headings(fixture).every((title) => title.includes('Kodiervariable'))).toBe(true);
  });

  it('shows aliased manual instructions, custom labels and searchable automatic rules', async () => {
    const { fixture, component } = await playerFixture(undefined, solutionScheme);
    component.reviewCodingVisible = true;
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

  it('keeps the coding tab available in the ordinary unit view', async () => {
    const { fixture, component } = await playerFixture(undefined, solutionScheme);
    fixture.componentRef.setInput('reviewMode', false);
    fixture.componentRef.setInput('featureConfigOverride', { showCodingScheme: true });
    fixture.detectChanges();
    component.togglePanel();
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.review-coding-panel')).toBeNull();
    const tab = fixture.nativeElement.querySelector('.panel-tabs button') as HTMLButtonElement;
    expect(tab.textContent?.trim()).toBe('Kodierung');
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.coding-content').textContent).toContain(
      'Allgemeine Hinweise zur Antwort',
    );
  });

  it('keeps toggle-button coding readable without claiming an unverified scalar player solution', async () => {
    const scheme = JSON.parse(JSON.stringify(solutionScheme));
    scheme.variableCodings[0].codes[0].ruleSets[0].rules[0].parameters = ['2'];
    const { component } = await playerFixture(
      JSON.stringify({
        pages: [
          {
            elements: [
              {
                id: 'input',
                alias: 'ANSWER',
                type: 'toggle-button',
                options: ['A', 'B', 'C'],
              },
            ],
          },
        ],
      }),
      scheme,
    );
    expect(component.reviewSolution.prefill.status).toBe('unavailable');
    expect(component.reviewSolution.unavailableVariables).toEqual(['ANSWER']);
    expect(component.visibleCodingSchemeAsText).toHaveLength(1);
  });

  it('starts a drag solution with a reconciled palette and restores the prior personal state', async () => {
    const scheme = structuredClone(solutionScheme);
    scheme.variableCodings[0].alias = 'A';
    scheme.variableCodings[0].codes[0].ruleSets![0].rules[0].parameters = ['X'];
    const definition = JSON.stringify({
      pages: [
        {
          elements: [
            {
              type: 'drop-list',
              id: 'pool',
              alias: 'POOL',
              onlyOneItem: false,
              isSortList: false,
              copyOnDrop: false,
              connectedTo: ['target'],
              value: [
                { alias: 'X', text: 'First object' },
                { alias: 'Y', text: 'Second object' },
              ],
            },
            {
              type: 'drop-list',
              id: 'target',
              alias: 'A',
              onlyOneItem: true,
              isSortList: false,
              copyOnDrop: false,
              connectedTo: ['pool'],
              value: [],
            },
          ],
        },
      ],
    });
    const { fixture, component, message } = await playerFixture(definition, scheme);
    const send = vi.spyOn(component as any, 'sendToPlayer');
    await message({ type: 'vopReadyNotification' });
    const ownParts = {
      elementCodes: JSON.stringify([
        { id: 'POOL', value: ['X'], status: 'VALUE_CHANGED' },
        { id: 'A', value: ['Y'], status: 'VALUE_CHANGED' },
      ]),
    };
    await message({
      type: 'vopStateChangedNotification',
      sessionId: component.playerSessionId,
      timeStamp: Date.now(),
      unitState: { dataParts: ownParts },
    });
    const ready = async () => {
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
      });
      const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
      await message({ type: 'vopReadyNotification' }, frame.contentWindow!);
    };
    component.toggleSolution();
    await ready();
    const solutionStart = send.mock.calls.at(-1)![0];
    expect(JSON.parse(solutionStart.unitState.dataParts.elementCodes)).toEqual([
      { id: 'POOL', value: ['Y'], status: 'VALUE_CHANGED' },
      { id: 'A', value: ['X'], status: 'VALUE_CHANGED' },
    ]);
    component.toggleSolution();
    await ready();
    expect(send.mock.calls.at(-1)![0].unitState.dataParts).toEqual(ownParts);
  });

  it('restores personal data parts and the page after hiding the solution, ignoring stale and synthetic states', async () => {
    const definition = JSON.stringify({
      pages: [{}, { elements: [{ id: 'input', alias: 'ANSWER', type: 'text-field' }] }],
    });
    const { fixture, component, message, frame } = await playerFixture(definition, solutionScheme);
    const send = vi.spyOn(component as any, 'sendToPlayer');
    await message({ type: 'vopReadyNotification' });
    const ownSession = component.playerSessionId;
    const ownSource = frame.contentWindow!;
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
    fixture.detectChanges();
    // ASPECT emits its final answer state on unload, after the frame has been removed.
    const finalAnswers = JSON.stringify([{ id: 'ANSWER', value: 'Bonn', status: 'VALUE_CHANGED' }]);
    await message(
      {
        type: 'vopStateChangedNotification',
        sessionId: ownSession,
        timeStamp: '2026-10-23T10:00:03Z',
        unitState: { dataParts: { elementCodes: finalAnswers } },
      },
      ownSource,
    );
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
      elementCodes: finalAnswers,
      other: 'retain me',
    });
    expect(restoredStart.playerConfig.startPage).toBe('1');
    expect(component.solutionVisible).toBe(false);

    // Print modes ignore response values in ASPECT. They must neither claim an active
    // solution nor replace the buffered personal answers with empty print responses.
    component.toggleSolution();
    await ready();
    component.pagingMode = 'view-all';
    component.onPagingModeChange();
    const printFrame = await ready();
    const printSource = printFrame.contentWindow!;
    const printSession = component.playerSessionId;
    expect(component.solutionVisible).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: printFrame.contentWindow,
        data: {
          type: 'vopStateChangedNotification',
          sessionId: component.playerSessionId,
          unitState: { dataParts: { elementCodes: '[]' } },
        },
      }),
    );
    component.pagingMode = 'buttons';
    component.onPagingModeChange();
    fixture.detectChanges();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: printSource,
        data: {
          type: 'vopStateChangedNotification',
          sessionId: printSession,
          unitState: { dataParts: { elementCodes: '[]' } },
        },
      }),
    );
    await ready();
    expect(send.mock.calls.at(-1)![0].unitState.dataParts.elementCodes).toBe(finalAnswers);

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
    expect(component.reviewCodingVisible).toBe(true);
    expect(component.activeTab).toBe('comments');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.solution-info').textContent).toContain(
      'Keine eindeutige Musterlösung',
    );
  });

  it('waits for a fresh state after an Aspect drag without relying on unload reports', async () => {
    const { component, frame, message } = await playerFixture(
      JSON.stringify({ pages: [{ elements: [{ alias: 'ANSWER', type: 'text-field' }] }] }),
      solutionScheme,
    );
    await message({ type: 'vopReadyNotification' });
    const doc = frame.contentDocument!;
    const object = doc.createElement('div');
    object.setAttribute('data-aspect-draggable', 'true');
    doc.body.append(object);
    object.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
    );
    doc.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }));
    component.toggleSolution();
    expect(component.solutionRequestPending).toBe(true);
    expect(component.solutionVisible).toBe(false);
    await message({
      type: 'vopStateChangedNotification',
      sessionId: component.playerSessionId,
      timeStamp: Date.now() + 1,
      unitState: { dataParts: { elementCodes: '[]' } },
    });
    expect(component.solutionRequestPending).toBe(false);
    expect(component.solutionVisible).toBe(true);
  });

  it.each(['click', 'cancel'])(
    'does not wait for an answer report after a drag object %s without a drop',
    async (mode) => {
      const { component, frame, message } = await playerFixture(
        JSON.stringify({ pages: [{ elements: [{ alias: 'ANSWER', type: 'text-field' }] }] }),
        solutionScheme,
      );
      await message({ type: 'vopReadyNotification' });
      const doc = frame.contentDocument!;
      const object = doc.createElement('div');
      object.setAttribute('data-aspect-draggable', 'true');
      doc.body.append(object);
      object.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      if (mode === 'cancel') doc.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
      doc.dispatchEvent(
        new MouseEvent('pointerup', {
          bubbles: true,
          clientX: mode === 'cancel' ? 100 : 10,
          clientY: 10,
        }),
      );
      component.toggleSolution();
      expect(component.solutionRequestPending).toBe(false);
      expect(component.solutionVisible).toBe(true);
    },
  );

  it.each(['iso', 'milliseconds'])(
    'waits for a fresh player response with %s timestamps after an input before showing the solution',
    async (format) => {
      const { component, frame, message } = await playerFixture(
        JSON.stringify({
          pages: [{ elements: [{ id: 'input', alias: 'ANSWER', type: 'text-field' }] }],
        }),
        solutionScheme,
      );
      await message({ type: 'vopReadyNotification' });
      const sessionId = component.playerSessionId;
      frame.contentDocument!.dispatchEvent(new Event('input', { bubbles: true }));
      component.toggleSolution();
      expect(component.solutionRequestPending).toBe(true);
      expect(component.solutionVisible).toBe(false);
      expect(component.playerSessionId).toBe(sessionId);
      await message({
        type: 'vopStateChangedNotification',
        sessionId,
        timeStamp: format === 'iso' ? new Date(Date.now() - 1000).toISOString() : Date.now() - 1000,
        unitState: { dataParts: { elementCodes: '[]' } },
      });
      expect(component.solutionRequestPending).toBe(true);
      await message({
        type: 'vopStateChangedNotification',
        sessionId,
        timeStamp: format === 'iso' ? new Date(Date.now() + 1).toISOString() : Date.now() + 1,
        unitState: {
          dataParts: {
            elementCodes: JSON.stringify([
              { id: 'ANSWER', status: 'VALUE_CHANGED', value: 'Meine letzte Eingabe' },
            ]),
          },
        },
      });
      expect(component.solutionRequestPending).toBe(false);
      expect(component.solutionVisible).toBe(true);
    },
  );

  it('keeps the personal player when a fresh response does not arrive', async () => {
    const { component, frame, message } = await playerFixture(
      JSON.stringify({
        pages: [{ elements: [{ id: 'input', alias: 'ANSWER', type: 'text-field' }] }],
      }),
      solutionScheme,
    );
    await message({ type: 'vopReadyNotification' });
    const sessionId = component.playerSessionId;
    vi.useFakeTimers();
    try {
      frame.contentDocument!.dispatchEvent(new Event('input', { bubbles: true }));
      component.toggleSolution();
      await vi.advanceTimersByTimeAsync(2500);
      expect(component.solutionRequestPending).toBe(false);
      expect(component.solutionVisible).toBe(false);
      expect(component.playerSessionId).toBe(sessionId);
      expect(component.solutionRequestError).toContain('noch nicht vom Player gemeldet');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { role: 'option', type: 'click', key: '' },
    { role: 'radio', type: 'click', key: '' },
    { role: 'radio', type: 'keydown', key: 'ArrowRight' },
  ])('waits for custom $role controls changed via $type', async ({ role, type, key }) => {
    const { component, frame, message } = await playerFixture(
      JSON.stringify({
        pages: [{ elements: [{ id: 'input', alias: 'ANSWER', type: 'text-field' }] }],
      }),
      solutionScheme,
    );
    await message({ type: 'vopReadyNotification' });
    const doc = frame.contentDocument!;
    const control = doc.createElement('button');
    control.setAttribute('role', role);
    doc.body.append(control);
    control.dispatchEvent(
      type === 'keydown'
        ? new KeyboardEvent(type, { key, bubbles: true })
        : new Event(type, { bubbles: true }),
    );
    component.toggleSolution();
    expect(component.solutionRequestPending).toBe(true);
    expect(component.solutionVisible).toBe(false);
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

  it.each([
    { reviewMode: true, showMetadata: true, hideReviewMetadata: true, visible: false },
    { reviewMode: true, showMetadata: false, hideReviewMetadata: true, visible: false },
    { reviewMode: true, showMetadata: false, hideReviewMetadata: false, visible: true },
    { reviewMode: true, showMetadata: false, hideReviewMetadata: undefined, visible: true },
    { reviewMode: false, showMetadata: true, hideReviewMetadata: true, visible: true },
    { reviewMode: false, showMetadata: false, hideReviewMetadata: false, visible: false },
  ])(
    'applies metadata visibility independently in review and ordinary views: %j',
    async ({ reviewMode, showMetadata, hideReviewMetadata, visible }) => {
      const { fixture, component } = await playerFixture();
      fixture.componentRef.setInput('reviewMode', reviewMode);
      fixture.componentRef.setInput('featureConfigOverride', {
        showMetadata,
        hideReviewMetadata,
        showCodingScheme: true,
      } satisfies FeatureConfig);
      fixture.detectChanges();
      component.panelVisible = true;
      component.reviewPanelCollapsed = false;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      const tabs = Array.from(
        fixture.nativeElement.querySelectorAll('.panel-tabs button'),
      ) as HTMLElement[];
      expect(tabs.some((tab) => tab.textContent?.trim() === 'Metadaten')).toBe(visible);
    },
  );

  it('removes an open metadata panel when hidden and keeps it hidden after unit changes', async () => {
    const { fixture, component } = await playerFixture();
    component.reviewPanelCollapsed = false;
    component.activeTab = 'metadata';
    component.unitMetadata = [{ id: 'subject', label: 'Fach', value: 'Deutsch' }];
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.meta-dl').textContent).toContain('Deutsch');
    fixture.componentRef.setInput('featureConfigOverride', { hideReviewMetadata: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.meta-dl')).toBeNull();
    expect(component.activeTab).toBe('comments');
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.showMetadata).toBe(false);
    fixture.componentRef.setInput('featureConfigOverride', { hideReviewMetadata: false });
    fixture.detectChanges();
    expect(component.showMetadata).toBe(true);
  });

  const transcriptMetadata = [
    { id: 'iqb_transcript', label: 'Hörsequenz Transkript', value: 'Erste Zeile\nZweite Zeile' },
    { id: 'iqb_final_transcript', label: 'Transkript zur Aufgabe', value: 'Bearbeiteter Hörtext' },
    {
      id: 'iqb_copyright_original',
      label: 'Transkript Original / Text Original',
      value: 'Originaler Hörtext',
    },
    { id: 'k6', label: 'Transkript zur Aufgabe', value: 'Hörtext aus älterem Profil' },
  ];
  const otherMetadata = [
    { id: 'iqb_author', label: 'Entwickler:in', value: 'EM' },
    { id: 'subject', label: 'Fach', value: 'Deutsch' },
    { id: 'k6', label: 'Nebengeräusche', value: 'Vogelstimmen' },
    { id: 'note', label: 'Hinweise zum Transkript', value: 'Interner Hinweis' },
    { id: 'iqb_copyright', label: 'Quellenangaben', value: 'Quellenvermerk' },
  ];

  it.each([true, false])(
    'shows only transcript fields in their own review tab (hideReviewMetadata: %s)',
    async (hideReviewMetadata) => {
      const { fixture, component } = await playerFixture(undefined, undefined, {
        u1: [...otherMetadata, ...transcriptMetadata],
      });
      fixture.componentRef.setInput('featureConfigOverride', {
        hideReviewMetadata,
        hideReviewDeveloperNames: true,
      });
      fixture.detectChanges();
      const tabs = Array.from(
        fixture.nativeElement.querySelectorAll('.panel-tabs button'),
      ) as HTMLButtonElement[];
      tabs.find((tab) => tab.textContent?.trim() === 'Hörtranskripte')!.click();
      fixture.detectChanges();
      const transcripts = fixture.nativeElement.querySelector('.transcript-dl') as HTMLElement;
      expect(transcripts.querySelectorAll('dd')).toHaveLength(4);
      expect(transcripts.querySelector('dd')?.textContent).toBe('Erste Zeile\nZweite Zeile');
      for (const entry of transcriptMetadata)
        expect(transcripts.textContent).toContain(entry.value);
      for (const entry of otherMetadata) expect(transcripts.textContent).not.toContain(entry.value);
      expect(component.showMetadata).toBe(!hideReviewMetadata);
      if (!hideReviewMetadata) {
        tabs.find((tab) => tab.textContent?.trim() === 'Metadaten')!.click();
        fixture.detectChanges();
        const metadata = fixture.nativeElement.querySelector('.meta-dl').textContent;
        expect(metadata).toContain('Deutsch');
        expect(metadata).toContain('Vogelstimmen');
        expect(metadata).not.toContain('EM');
        for (const entry of transcriptMetadata) expect(metadata).not.toContain(entry.value);
      }
    },
  );

  it('keeps transcripts accessible when toggling metadata and clears them across unit changes', async () => {
    const { fixture, component } = await playerFixture(undefined, undefined, {
      u1: [...transcriptMetadata, ...otherMetadata],
      u2: [{ id: 'iqb_transcript', label: 'Transkript', value: 'Zweiter Hörtext' }],
      u3: otherMetadata,
    });
    const openTranscripts = () => {
      const tabs = Array.from(
        fixture.nativeElement.querySelectorAll('.panel-tabs button'),
      ) as HTMLButtonElement[];
      tabs.find((tab) => tab.textContent?.trim() === 'Hörtranskripte')!.click();
      fixture.detectChanges();
    };
    for (const hideReviewMetadata of [true, false, true]) {
      fixture.componentRef.setInput('featureConfigOverride', { hideReviewMetadata });
      fixture.detectChanges();
      openTranscripts();
      expect(fixture.nativeElement.querySelector('.transcript-dl').textContent).toContain(
        'Bearbeiteter Hörtext',
      );
    }
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    await fixture.whenStable();
    openTranscripts();
    const transcripts = fixture.nativeElement.querySelector('.transcript-dl').textContent;
    expect(transcripts).toContain('Zweiter Hörtext');
    expect(transcripts).not.toContain('Bearbeiteter Hörtext');
    fixture.componentRef.setInput('unitId', 'u3');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.activeTab).toBe('comments');
    expect(fixture.nativeElement.querySelector('.transcript-dl')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Hörtranskripte');
    expect(fixture.nativeElement.textContent).not.toContain('Zweiter Hörtext');
  });

  it('does not show an empty transcript tab', async () => {
    const { fixture } = await playerFixture(undefined, undefined, {
      u1: [{ id: 'iqb_transcript', label: 'Transkript', value: '  \n ' }, ...otherMetadata],
    });
    expect(fixture.nativeElement.textContent).not.toContain('Hörtranskripte');
  });

  it.each([true, false])(
    'keeps the ordinary metadata setting for transcript fields (showMetadata: %s)',
    async (showMetadata) => {
      const { fixture, component } = await playerFixture(undefined, undefined, {
        u1: [...transcriptMetadata, ...otherMetadata],
      });
      fixture.componentRef.setInput('reviewMode', false);
      fixture.componentRef.setInput('featureConfigOverride', {
        showMetadata,
        showCodingScheme: true,
      });
      fixture.detectChanges();
      component.panelVisible = true;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Hörtranskripte');
      const metadata = fixture.nativeElement.querySelector('.meta-dl') as HTMLElement | null;
      if (showMetadata) {
        expect(metadata?.textContent).toContain('Originaler Hörtext');
        expect(metadata?.textContent).toContain('Deutsch');
      } else expect(metadata).toBeNull();
    },
  );

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
      getApStartPage: vi.fn().mockReturnValue(of({ featureConfig: {} })),
      getViewUnit: vi.fn((_apId: string, unitId: string) => unitResponses[unitId]),
      getReviewTranscripts: vi.fn().mockReturnValue(of([])),
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
    fixture.componentRef.setInput('apId', 'ap-1');
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
    expect(api.getApStartPage).not.toHaveBeenCalled();
    expect(api.getViewUnit).toHaveBeenCalledWith('ap-1', 'u1');
    expect(fixture.nativeElement.querySelector('app-breadcrumb')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Aufgabe 1');
    expect(component.showMetadata).toBe(true);
    expect(component.showCodingScheme).toBe(true);
    expect(component.showCommentBtn).toBe(true);
    expect(component.showBookletCommentBtn).toBe(true);
    expect(api.getFilePreview).toHaveBeenCalledWith('ap-1', 'metadata-u1');
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
    expect(tabs).toEqual(['Kommentare', 'Metadaten']);
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
    (
      fixture.nativeElement.querySelector('.review-coding-panel button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.coding-variable h4') as NodeListOf<HTMLElement>,
      ).map((heading) => heading.textContent?.trim().replace(/\s+/g, ' ')),
    ).toEqual(['Variable 1', 'Variable 2']);
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
    codingFilter.value = 'Variable 1';
    codingFilter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.coding-variable h4') as NodeListOf<HTMLElement>,
      ).map((heading) => heading.textContent?.trim().replace(/\s+/g, ' ')),
    ).toEqual(['Variable 1']);
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
    const widthBeforeKeyboardResize = component.reviewPanelWidth;
    resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(component.reviewPanelWidth).toBe(widthBeforeKeyboardResize + 24);
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
    expect(api.getViewUnit).toHaveBeenLastCalledWith('ap-1', 'u2');
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Aufgabe 2');
    (fixture.nativeElement.querySelectorAll('.panel-tabs .tab')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.comment-thread-stub') as HTMLElement).dataset[
        'unitId'
      ],
    ).toBe('u2');

    // Returning to ordinary booklet navigation must restore the AP's hidden
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
    const initialWidth = view.reviewPanelWidth;
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
      expect(view.reviewPanelWidth).toBe(initialWidth + 50);
      pointer(window, 'pointerup', { pointerId: 2 });
      pointer(window, 'pointermove', { clientX: 730 });
      expect(view.reviewPanelWidth).toBe(initialWidth + 70);
      if (ending === 'blur') window.dispatchEvent(new Event('blur'));
      else if (ending === 'released-button')
        pointer(window, 'pointermove', { buttons: 0, clientX: 600 });
      else if (ending === 'collapse') view.toggleReviewPanel();
      else if (ending === 'destroy') view.ngOnDestroy();
      else pointer(ending === 'lostpointercapture' ? handle : window, ending, { buttons: 0 });
      pointer(window, 'pointermove', { clientX: 600 });
      expect(view.reviewPanelWidth).toBe(initialWidth + 70);
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
