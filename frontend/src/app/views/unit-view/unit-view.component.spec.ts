import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import {
  FeatureConfig,
  FilePreviewVomdData,
  UnitCommentAvailability,
  UnitViewData,
} from '../../core/models/api.models';
import { UnitViewComponent } from './unit-view.component';

vi.mock('../comment-thread/item-comment-thread.component', async () => {
  const { Component } = await import('@angular/core');
  class ItemCommentThreadStub {
    apId = '';
    targetType = '';
    unitId = '';
    itemId = '';
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
      '@if (itemId || targetType === "UNIT" || targetType === "BOOKLET") { <div class="comment-thread-stub" [attr.data-target-type]="targetType" [attr.data-unit-id]="unitId" [attr.data-item-id]="itemId" [attr.data-booklet-id]="bookletId"></div> }',
    inputs: [
      'apId',
      'targetType',
      'unitId',
      'itemId',
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
    items: UnitViewData['items'] = [],
    codingFile?: Promise<unknown>,
    navigationItemsByUnit?: Record<string, UnitViewData['navigationItems']>,
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
          items,
          navigationItems: navigationItemsByUnit?.[unitId],
          codingScheme,
          dependencies: [
            { type: 'PLAYER', downloadUrl: '/player' },
            { type: 'UNIT_DEFINITION', downloadUrl: '/definition' },
            ...(codingFile ? [{ type: 'CODING_SCHEME', downloadUrl: '/coding' }] : []),
            ...(metadataByUnit ? [{ type: 'METADATA', fileId: unitId }] : []),
          ],
        }),
      getFilePreview: (_apId: string, fileId: string) =>
        of({ structuredData: { type: 'vomd', unitProfiles: metadataByUnit?.[fileId] || [] } }),
      getItemCommentCounts: vi.fn(),
      getUnitCommentAvailability: (): Observable<UnitCommentAvailability> =>
        of({ codingCommentsAvailable: true }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          url === '/definition'
            ? definition
            : url === '/coding'
              ? JSON.stringify(await codingFile)
              : '<p>Player</p>',
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
    return { fixture, component: fixture.componentInstance, frame, postMessage, message, api };
  }

  async function enableComments(result: Awaited<ReturnType<typeof playerFixture>>) {
    result.fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['ITEM', 'CODING'],
    });
    result.fixture.detectChanges();
    await result.message({ type: 'vopReadyNotification' });
  }

  const twoPages = JSON.stringify({
    pages: [
      { elements: [{ id: 'input-1', alias: 'FIRST', type: 'text-field' }] },
      { elements: [{ id: 'input-2', alias: 'SECOND', type: 'text-field' }] },
    ],
  });
  const fullCode = [{ id: 1, type: 'FULL_CREDIT', score: 1 }];

  it.each([undefined, 'FIRST'])(
    'limits items to their explicitly referenced subtotal pages within a shared aggregate (legacy reference: %s)',
    async (legacyReference) => {
      const result = await playerFixture(
        JSON.stringify({
          pages: ['FIRST', 'SECOND', 'THIRD'].map((alias) => ({ elements: [{ alias }] })),
        }),
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: [] },
            { id: 'SECOND', sourceType: 'BASE', codes: [] },
            { id: 'THIRD', sourceType: 'BASE', codes: [] },
            { id: 'subtotal-1', sourceType: 'SUM_SCORE', deriveSources: ['FIRST', 'SECOND'] },
            { id: 'subtotal-2', sourceType: 'SUM_SCORE', deriveSources: ['THIRD'] },
            {
              id: 'total',
              sourceType: 'SUM_SCORE',
              deriveSources: ['subtotal-1', 'subtotal-2'],
              codes: fullCode,
            },
          ],
        },
        undefined,
        [
          { id: 'I1', variableReadOnlyId: 'total', sourceVariable: 'subtotal-1' },
          {
            id: 'I2',
            variableReadOnlyId: 'total',
            sourceVariable: 'subtotal-2',
            variableId: legacyReference,
          },
        ],
      );
      await enableComments(result);
      expect(result.component.selectedCommentItemId).toBe('I1');
      for (const [page, itemId] of [
        [2, 'I1'],
        [3, 'I2'],
        [1, 'I1'],
      ] as const) {
        result.component.navigateToPage(page);
        expect(result.component.selectedCommentItemId).toBe(itemId);
        expect(result.component.activeReviewCodingId).toBe('total');
      }
    },
  );

  it.each([false, true])(
    'keeps distinct VOMD items when a generated ID collides with an exact ID (comments: %s)',
    async (comments) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'SECOND', sourceType: 'BASE', codes: [] },
            {
              id: 'result-second',
              sourceType: 'COPY_VALUE',
              deriveSources: ['SECOND'],
              codes: fullCode,
            },
          ],
        },
        undefined,
        [{ id: 'u1_I', variableReadOnlyId: 'result-second' }],
        undefined,
        {
          u1: [
            { id: 'u1_I', variableReadOnlyId: 'result-second' },
            { id: 'I', variableId: 'FIRST' },
          ],
        },
      );
      if (comments) await enableComments(result);
      else await result.message({ type: 'vopReadyNotification' });

      expect(result.component.activeReviewCodingId).toBe('FIRST');
      expect(result.component.selectedCommentItemId).toBe(comments ? 'I' : '');
      result.component.navigateToPage(2);
      expect(result.component.activeReviewCodingId).toBe('result-second');
      expect(result.component.selectedCommentItemId).toBe(comments ? 'u1_I' : '');
    },
  );

  it.each([false, true])(
    'falls back to a permanently visible item when the scroll page has no item (comments: %s)',
    async (comments) => {
      const result = await playerFixture(
        JSON.stringify({
          pages: [
            { alwaysVisible: true, elements: [{ alias: 'FIRST' }] },
            { elements: [] },
            { elements: [{ alias: 'SECOND' }] },
          ],
        }),
        {
          variableCodings: ['FIRST', 'SECOND'].map((id) => ({
            id,
            sourceType: 'BASE',
            codes: fullCode,
          })),
        },
        undefined,
        [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', variableId: 'SECOND' },
        ],
      );
      if (comments) await enableComments(result);
      else await result.message({ type: 'vopReadyNotification' });

      expect(result.component.activeReviewCodingId).toBe('FIRST');
      expect(result.component.selectedCommentItemId).toBe(comments ? 'I1' : '');
      result.component.navigateToPage(2);
      expect(result.component.activeReviewCodingId).toBe('SECOND');
      expect(result.component.selectedCommentItemId).toBe(comments ? 'I2' : '');
      result.component.navigateToPage(1);
      expect(result.component.activeReviewCodingId).toBe('FIRST');
      expect(result.component.selectedCommentItemId).toBe(comments ? 'I1' : '');
    },
  );

  it('keeps the permanent input as the comment target when its coding derives from a scroll page', async () => {
    const result = await playerFixture(
      JSON.stringify({
        pages: [
          { alwaysVisible: true, elements: [{ alias: 'PERMANENT' }] },
          { elements: [{ alias: 'FIRST' }] },
          { elements: [] },
        ],
      }),
      {
        variableCodings: [
          { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
          { id: 'result', sourceType: 'COPY_VALUE', deriveSources: ['FIRST'], codes: fullCode },
        ],
      },
      undefined,
      [
        { id: 'I1', variableId: 'FIRST' },
        { id: 'I2', sourceVariable: 'PERMANENT', variableReadOnlyId: 'result' },
      ],
    );
    await enableComments(result);
    expect(result.component.selectedCommentItemId).toBe('I1');
    result.component.navigateToPage(2);
    expect(result.component.selectedCommentItemId).toBe('I2');
    expect(result.component.activeReviewCodingId).toBe('result');
    result.component.navigateToPage(1);
    expect(result.component.selectedCommentItemId).toBe('I1');
    expect(result.component.activeReviewCodingId).toBe('FIRST');
  });

  it.each([
    { reference: 'sourceVariable', sourceId: 'output' },
    { reference: 'variableId', sourceId: 'output' },
    { reference: 'sourceVariable', sourceId: 'FIRST' },
    { reference: 'variableId', sourceId: 'FIRST' },
  ])(
    'uses explicit player reference $reference when the pinned coding derives from $sourceId',
    async ({ reference, sourceId }) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'output', sourceType: 'BASE', codes: [] },
            { id: 'result', sourceType: 'COPY_VALUE', deriveSources: [sourceId], codes: fullCode },
          ],
        },
        undefined,
        [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', [reference]: 'SECOND', variableReadOnlyId: 'result' },
        ],
      );
      await enableComments(result);
      expect(result.component.selectedCommentItemId).toBe('I1');
      result.component.reviewCodingVisible = true;
      result.component.navigateToPage(2);
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      const panel = result.fixture.nativeElement;
      expect(panel.querySelector('.comment-thread-stub').dataset.itemId).toBe('I2');
      expect(panel.querySelector('.current-coding')?.dataset.codingId).toBe('result');
    },
  );

  it.each([false, true])(
    'follows the MDB007 aggregate and inherits only missing source instructions and codes (own codes: %s)',
    async (ownCodes) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            {
              id: '01',
              alias: 'SECOND',
              sourceType: 'BASE',
              codes: fullCode,
              manualInstruction: 'Nur Segment Bilderbücher markieren.',
            },
            {
              id: '01_1',
              alias: '01',
              sourceType: 'SUM_SCORE',
              deriveSources: ['01', 'FIRST'],
              codes: ownCodes ? [{ ...fullCode[0], id: 2 }] : [],
            },
          ],
        },
        undefined,
        [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', variableId: '01', variableReadOnlyId: '01_1' },
        ],
      );
      await enableComments(result);
      result.component.reviewCodingVisible = true;
      result.component.navigateToPage(2);
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      const panel = result.fixture.nativeElement;
      expect(panel.querySelector('.comment-thread-stub').dataset.itemId).toBe('I2');
      const active = panel.querySelector('.current-coding');
      expect(active?.dataset.codingId).toBe('01');
      expect(active.textContent).toContain('Nur Segment Bilderbücher markieren.');
      expect(active.querySelector('.coding-code strong').textContent.trim()).toBe(
        ownCodes ? 'Code 2' : 'Code 1',
      );
      result.component.navigateToPage(1);
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(panel.querySelector('.comment-thread-stub').dataset.itemId).toBe('I1');
      expect(panel.querySelector('.current-coding')?.dataset.codingId).toBe('FIRST');
    },
  );

  it('selects the canonical item and inherits its leaf instructions through a shared subtotal', async () => {
    const result = await playerFixture(
      twoPages,
      {
        variableCodings: [
          { id: 'a', alias: 'FIRST', manualInstruction: 'Erste Anweisung', codes: fullCode },
          { id: 'b', alias: 'SECOND', manualInstruction: 'Zweite Anweisung', codes: fullCode },
          { id: 'subtotal', sourceType: 'SUM_SCORE', deriveSources: ['a', 'b'], codes: [] },
          { id: 'total', sourceType: 'SUM_SCORE', deriveSources: ['subtotal'], codes: [] },
        ],
      },
      undefined,
      [
        { id: 'I1', variableReadOnlyId: 'total', sourceVariable: 'FIRST' },
        { id: 'I2', variableReadOnlyId: 'total', sourceVariable: 'SECOND' },
      ],
    );
    await enableComments(result);
    result.component.toggleReviewCoding();
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    const panel = result.fixture.nativeElement;
    expect(panel.querySelector('.comment-thread-stub').dataset.itemId).toBe('I2');
    expect(panel.querySelector('.current-coding').dataset.codingId).toBe('total');
    expect(panel.querySelector('.current-coding').textContent).toContain('Zweite Anweisung');
    await result.message({
      type: 'vopStateChangedNotification',
      playerState: { currentPage: '0' },
    });
    expect(panel.querySelector('.comment-thread-stub').dataset.itemId).toBe('I1');
    expect(panel.querySelector('.current-coding').textContent).toContain('Erste Anweisung');
  });

  it('keeps aggregate coding on an extra source page without selecting another page’s item', async () => {
    const result = await playerFixture(
      JSON.stringify({
        pages: ['FIRST', 'SECOND', 'HELPER'].map((alias) => ({
          elements: [{ alias, type: 'text-field' }],
        })),
      }),
      {
        variableCodings: [
          { id: 'FIRST', sourceType: 'BASE', codes: [] },
          { id: 'SECOND', sourceType: 'BASE', codes: [], manualInstruction: 'Zweite Anweisung' },
          { id: 'HELPER', sourceType: 'BASE', codes: [] },
          {
            id: 'total',
            sourceType: 'SUM_SCORE',
            deriveSources: ['FIRST', 'SECOND', 'HELPER'],
            codes: fullCode,
          },
        ],
      },
      undefined,
      [
        { id: 'I1', variableReadOnlyId: 'total', sourceVariable: 'FIRST' },
        { id: 'I2', variableReadOnlyId: 'total', sourceVariable: 'SECOND' },
      ],
    );
    await enableComments(result);
    result.component.toggleReviewCoding();
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    const panel = result.fixture.nativeElement;
    expect(panel.querySelector('.comment-thread-stub').dataset.itemId).toBe('I2');
    expect(panel.querySelector('.current-coding').textContent).toContain('Zweite Anweisung');

    await result.message({
      type: 'vopStateChangedNotification',
      sessionId: result.component.playerSessionId,
      playerState: { currentPage: '2' },
    });
    expect(panel.querySelector('.comment-thread-stub')).toBeNull();
    expect(panel.querySelector('.current-coding').dataset.codingId).toBe('total');
    expect(panel.querySelector('.current-coding').textContent).not.toContain('Zweite Anweisung');
  });

  it('follows each item’s explicit source of a shared aggregate without item comments', async () => {
    const result = await playerFixture(
      twoPages,
      {
        variableCodings: [
          {
            id: 'FIRST',
            manualInstruction: 'Erste Anweisung',
            sourceType: 'BASE',
            codes: fullCode,
          },
          {
            id: 'SECOND',
            manualInstruction: 'Zweite Anweisung',
            sourceType: 'BASE',
            codes: fullCode,
          },
          { id: 'total', sourceType: 'SUM_SCORE', deriveSources: ['FIRST', 'SECOND'], codes: [] },
        ],
      },
      undefined,
      [
        { id: 'I2', variableReadOnlyId: 'total', sourceVariable: 'SECOND' },
        { id: 'I1', variableReadOnlyId: 'total', sourceVariable: 'FIRST' },
      ],
    );
    result.component.reviewCodingVisible = true;
    await result.message({ type: 'vopReadyNotification' });
    const active = () => result.fixture.nativeElement.querySelector('.current-coding');
    expect(active()?.textContent).toContain('Erste Anweisung');
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(active()?.textContent).toContain('Zweite Anweisung');
  });

  it.each([
    { enableCommenting: false, commentTargets: ['ITEM', 'CODING'] },
    { enableCommenting: true, commentTargets: ['UNIT', 'BOOKLET'] },
  ] satisfies FeatureConfig[])(
    'review: follows file-only aggregate references beyond the metadata preview without item comments for %j',
    async (featureConfig) => {
      const aliases = Array.from({ length: 25 }, (_, index) => `FIELD_${index + 1}`);
      const result = await playerFixture(
        JSON.stringify({
          pages: aliases.map((alias) => ({ elements: [{ alias, type: 'text-field' }] })),
        }),
        {
          variableCodings: [
            ...aliases.map((alias, index) => ({
              id: `base-${index}`,
              alias,
              sourceType: 'BASE',
              codes: fullCode,
            })),
            ...aliases.map((_, index) => ({
              id: `result-${index}`,
              sourceType: 'SUM_SCORE',
              deriveSources: [`base-${index}`],
              codes: fullCode,
            })),
          ],
        },
        undefined,
        [],
        undefined,
        {
          u1: aliases.map((_, index) => ({
            id: `I${index + 1}`,
            variableReadOnlyId: `result-${index}`,
          })),
        },
      );
      const availability = vi.spyOn(result.api, 'getUnitCommentAvailability');
      result.fixture.componentRef.setInput('featureConfigOverride', featureConfig);
      result.component.reviewCodingVisible = true;
      await result.message({ type: 'vopReadyNotification' });
      expect(result.component.activeReviewCodingId).toBe('result-0');
      result.component.navigateToPage(25);
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(result.component.activeReviewCodingId).toBe('result-24');
      expect(
        result.fixture.nativeElement.querySelector('.current-coding h4').textContent,
      ).toContain('result-24');
      expect(result.component.commentItems).toEqual([]);
      expect(result.component.selectedCommentItemId).toBe('');
      expect(availability).not.toHaveBeenCalled();
      result.fixture.componentRef.setInput('unitId', 'u2');
      result.fixture.detectChanges();
      await vi.waitFor(() => expect(result.component.definitionContent).not.toBeNull());
      await result.fixture.whenStable();
      expect(result.component.activeReviewCodingId).toBe('FIELD_1');
    },
  );

  it.each(['variableId', 'sourceVariable'] as const)(
    'review: keeps legacy %s targets separate when another variable has a colliding alias',
    async (reference) => {
      const result = await playerFixture(
        JSON.stringify({
          pages: [
            { elements: [{ alias: 'FIRST', type: 'text-field' }] },
            { elements: [{ alias: 'A', type: 'text-field' }] },
          ],
        }),
        {
          variableCodings: [
            { id: 'A', alias: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'B', alias: 'A', sourceType: 'BASE', codes: fullCode },
          ],
        },
        undefined,
        [
          { id: 'I1', [reference]: 'A' },
          { id: 'I2', [reference]: 'B' },
        ],
      );
      await enableComments(result);
      result.component.navigateToPage(2);
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(result.component.selectedCommentItemId).toBe('I2');
      expect(result.component.activeReviewCodingId).toBe('A');
      await result.message({
        type: 'vopStateChangedNotification',
        playerState: { currentPage: '0' },
      });
      expect(result.component.selectedCommentItemId).toBe('I1');
      expect(result.component.activeReviewCodingId).toBe('FIRST');
    },
  );

  it.each(['host', 'player', 'manual'] as const)(
    'review: clears the active coding for an uncoded item selected through %s navigation',
    async (navigation) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'internal-first', alias: 'FIRST', sourceType: 'BASE', codes: fullCode },
          ],
        },
        undefined,
        [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', variableId: 'SECOND' },
        ],
      );
      await enableComments(result);
      result.component.reviewCodingVisible = true;
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(
        result.fixture.nativeElement.querySelector('.current-coding h4').textContent,
      ).toContain('FIRST');
      if (navigation === 'host') result.component.navigateToPage(2);
      else if (navigation === 'player')
        await result.message({
          type: 'vopStateChangedNotification',
          playerState: { currentPage: '1' },
        });
      else {
        const select = result.fixture.nativeElement.querySelector(
          '.comment-item-select select',
        ) as HTMLSelectElement;
        select.value = 'I2';
        select.dispatchEvent(new Event('change'));
        // A repeated report for the displayed coded page must preserve this explicit choice.
        await result.message({
          type: 'vopStateChangedNotification',
          playerState: { currentPage: '0' },
        });
      }
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(result.component.selectedCommentItemId).toBe('I2');
      expect(result.component.activeReviewCodingId).toBe('');
      expect(result.fixture.nativeElement.querySelector('.current-coding')).toBeNull();
      result.component.selectedCommentItemId = 'I1';
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(
        result.fixture.nativeElement.querySelector('.current-coding h4').textContent,
      ).toContain('FIRST');
    },
  );

  it.each(
    (['host', 'player'] as const).flatMap((navigation) =>
      [false, true].map((emptyVariable) => ({ navigation, emptyVariable })),
    ),
  )(
    'review: requests a choice on shared pages after $navigation navigation (empty variable: $emptyVariable)',
    async ({ navigation, emptyVariable }) => {
      const result = await playerFixture(
        JSON.stringify({
          pages: [
            { elements: [{ alias: 'FIRST', type: 'text-field' }] },
            {
              elements: [
                { alias: 'UNCODED', type: 'text-field' },
                { alias: 'SECOND', type: 'text-field' },
              ],
            },
          ],
        }),
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            ...(emptyVariable ? [{ id: 'UNCODED', sourceType: 'BASE', codes: [] }] : []),
            { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
          ],
        },
        undefined,
        [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', variableId: 'UNCODED' },
          { id: 'I3', variableId: 'SECOND' },
        ],
      );
      await enableComments(result);
      result.component.reviewCodingVisible = true;
      const navigate = async (page: number) => {
        if (navigation === 'host') result.component.navigateToPage(page);
        else
          await result.message({
            type: 'vopStateChangedNotification',
            playerState: { currentPage: String(page - 1) },
          });
        result.fixture.changeDetectorRef.markForCheck();
        await result.fixture.whenStable();
      };
      await navigate(2);
      expect(result.component.selectedCommentItemId).toBe('');
      expect(result.component.activeReviewCodingId).toBe('');
      expect(result.fixture.nativeElement.querySelector('.current-coding')).toBeNull();

      const select = result.fixture.nativeElement.querySelector(
        'select[aria-label="Item auf dieser Seite"]',
      ) as HTMLSelectElement;
      expect(Array.from(select.options, (option) => option.value)).toEqual(['', 'I2', 'I3']);
      select.value = 'I3';
      select.dispatchEvent(new Event('change'));
      await result.message({
        type: 'vopStateChangedNotification',
        playerState: { currentPage: '1' },
      });
      expect(result.component.selectedCommentItemId).toBe('I3');
      expect(result.component.activeReviewCodingId).toBe('SECOND');
      result.component.selectedCommentItemId = 'I2';
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(result.fixture.nativeElement.querySelector('.current-coding')).toBeNull();
      await navigate(1);
      expect(result.component.selectedCommentItemId).toBe('I1');
      expect(result.component.activeReviewCodingId).toBe('FIRST');
      await navigate(2);
      expect(result.component.selectedCommentItemId).toBe('');
      expect(result.component.activeReviewCodingId).toBe('');
    },
  );

  it.each([false, true])(
    'keeps the coding empty for the only uncoded item on its page (comments: %s)',
    async (comments) => {
      const result = await playerFixture(
        JSON.stringify({
          pages: [
            { elements: [{ alias: 'FIRST' }] },
            { elements: [{ alias: 'UNCODED' }, { alias: 'HELPER' }] },
            { elements: [{ alias: 'THIRD' }] },
          ],
        }),
        {
          variableCodings: ['FIRST', 'HELPER', 'THIRD'].map((id) => ({
            id,
            sourceType: 'BASE',
            codes: fullCode,
          })),
        },
        undefined,
        [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', variableId: 'UNCODED' },
        ],
      );
      if (comments) await enableComments(result);
      else await result.message({ type: 'vopReadyNotification' });
      result.component.navigateToPage(2);
      expect(result.component.selectedReviewItemId).toBe('I2');
      expect(result.component.activeReviewCodingId).toBe('');

      result.component.navigateToPage(3);
      expect(result.component.selectedReviewItemId).toBe('');
      expect(result.component.activeReviewCodingId).toBe('THIRD');
    },
  );

  it('offers item selection without comments and preserves an explicit item across its source pages', async () => {
    const result = await playerFixture(
      JSON.stringify({
        pages: [
          { elements: [{ alias: 'FIRST' }, { alias: 'EXTRA' }] },
          { elements: [{ alias: 'SECOND' }, { alias: 'OTHER' }] },
          { elements: [{ alias: 'THIRD' }] },
        ],
      }),
      {
        variableCodings: [
          ...['FIRST', 'EXTRA', 'SECOND', 'OTHER', 'THIRD'].map((id) => ({
            id,
            sourceType: 'BASE',
            codes: fullCode,
          })),
          {
            id: 'TOTAL',
            sourceType: 'SUM_SCORE',
            deriveSources: ['FIRST', 'SECOND'],
            codes: fullCode,
          },
        ],
      },
      undefined,
      [
        { id: 'I1', variableReadOnlyId: 'TOTAL' },
        { id: 'I2', variableId: 'EXTRA' },
        { id: 'I3', variableId: 'OTHER' },
        { id: 'I4', variableId: 'THIRD' },
      ],
    );
    await result.message({ type: 'vopReadyNotification' });
    expect(result.component.selectedReviewItemId).toBe('');
    expect(result.component.activeReviewCodingId).toBe('');
    const select = result.fixture.nativeElement.querySelector(
      'select[aria-label="Item auf dieser Seite"]',
    ) as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.value)).toEqual(['', 'I1', 'I2']);
    select.value = 'I1';
    select.dispatchEvent(new Event('change'));
    await result.fixture.whenStable();

    result.component.navigateToPage(2);
    expect(result.component.selectedReviewItemId).toBe('I1');
    expect(result.component.activeReviewCodingId).toBe('TOTAL');

    result.component.navigateToPage(3);
    expect(result.component.selectedReviewItemId).toBe('I4');
    result.component.navigateToPage(2);
    expect(result.component.selectedReviewItemId).toBe('');
    expect(result.component.activeReviewCodingId).toBe('');
  });

  it('review: follows public item references without a coding scheme despite internal IDs', async () => {
    const result = await playerFixture(twoPages, undefined, undefined, [
      { id: 'I1', variableId: 'FIRST', variableReadOnlyId: 'internal-first' },
      { id: 'I2', sourceVariable: 'SECOND', variableReadOnlyId: 'internal-second' },
    ]);
    await enableComments(result);
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I2');
    expect(result.component.activeReviewCodingId).toBe('');
    await result.message({
      type: 'vopStateChangedNotification',
      sessionId: result.component.playerSessionId,
      playerState: { currentPage: '0' },
    });
    expect(result.component.selectedCommentItemId).toBe('I1');
  });

  it('review: retains the item when the delayed coding scheme makes its fallback ambiguous', async () => {
    let resolveCoding!: (scheme: unknown) => void;
    const codingFile = new Promise<unknown>((resolve) => {
      resolveCoding = resolve;
    });
    const result = await playerFixture(
      twoPages,
      undefined,
      undefined,
      [
        { id: 'I1', sourceVariable: 'FIRST', variableReadOnlyId: 'stale-id' },
        { id: 'I2', variableReadOnlyId: 'FIRST' },
      ],
      codingFile,
    );
    await enableComments(result);
    expect(result.component.selectedCommentItemId).toBe('I1');
    resolveCoding({
      variableCodings: [
        { id: 'FIRST', alias: 'SECOND', sourceType: 'BASE', codes: fullCode },
        { id: 'internal-first', alias: 'FIRST', sourceType: 'BASE', codes: fullCode },
      ],
    });
    await vi.waitFor(() => expect(result.component.codingSchemeLoading).toBe(false));
    await result.fixture.whenStable();
    expect(result.fixture.nativeElement.querySelector('.comment-thread-stub')?.dataset.itemId).toBe(
      'I1',
    );
    expect(result.component.activeReviewCodingId).toBe('');
    result.component.navigateToPage(2);
    expect(result.component.selectedCommentItemId).toBe('I2');
    expect(result.component.activeReviewCodingId).toBe('SECOND');
  });

  it('review: follows pages before strict coding identities load and preserves a manual choice when they arrive', async () => {
    let resolveCoding!: (scheme: unknown) => void;
    const codingFile = new Promise<unknown>((resolve) => {
      resolveCoding = resolve;
    });
    const result = await playerFixture(
      twoPages,
      undefined,
      undefined,
      [
        { id: 'I1', variableId: 'FIRST', variableReadOnlyId: 'internal-first' },
        { id: 'I2', variableId: 'SECOND', variableReadOnlyId: 'internal-second' },
      ],
      codingFile,
    );
    await enableComments(result);
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I2');

    result.component.selectedCommentItemId = 'I1';
    resolveCoding({
      variableCodings: [
        { id: 'internal-first', alias: 'FIRST', sourceType: 'BASE', codes: fullCode },
        { id: 'internal-second', alias: 'SECOND', sourceType: 'BASE', codes: fullCode },
      ],
    });
    await vi.waitFor(() => expect(result.component.codingSchemeLoading).toBe(false));
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I1');
    expect(result.component.activeReviewCodingId).toBe('FIRST');
    await result.message({
      type: 'vopStateChangedNotification',
      sessionId: result.component.playerSessionId,
      playerState: { currentPage: '0' },
    });
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I2');
    expect(result.component.activeReviewCodingId).toBe('SECOND');
  });

  it.each([
    { enableCommenting: false, commentTargets: ['ITEM', 'CODING'] },
    { enableCommenting: true, commentTargets: ['UNIT', 'BOOKLET'] },
  ] satisfies FeatureConfig[])(
    'review: retains item aggregate codings without item commenting for %j',
    async (featureConfig) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
            { id: 'RESULT_1', sourceType: 'SUM_SCORE', deriveSources: ['FIRST'], codes: fullCode },
            { id: 'RESULT_2', sourceType: 'SUM_SCORE', deriveSources: ['SECOND'], codes: fullCode },
          ],
        },
        undefined,
        [
          { id: 'I1', variableId: 'RESULT_1' },
          { id: 'I2', variableId: 'RESULT_2' },
        ],
      );
      const availability = vi.spyOn(result.api, 'getUnitCommentAvailability');
      result.fixture.componentRef.setInput('featureConfigOverride', featureConfig);
      result.component.reviewCodingVisible = true;
      await result.message({ type: 'vopReadyNotification' });
      expect(result.component.activeReviewCodingId).toBe('RESULT_1');
      result.component.navigateToPage(2);
      result.fixture.changeDetectorRef.markForCheck();
      await result.fixture.whenStable();
      expect(result.component.activeReviewCodingId).toBe('RESULT_2');
      expect(
        result.fixture.nativeElement.querySelector('.current-coding h4').textContent,
      ).toContain('RESULT_2');
      await result.message({
        type: 'vopStateChangedNotification',
        sessionId: result.component.playerSessionId,
        playerState: { currentPage: '0' },
      });
      expect(result.component.activeReviewCodingId).toBe('RESULT_1');
      expect(result.component.selectedCommentItemId).toBe('');
      expect(result.component.commentItems).toEqual([]);
      expect(availability).not.toHaveBeenCalled();
    },
  );

  it('review: uses the canonical list and asks only for unit comment availability', async () => {
    const result = await playerFixture(
      twoPages,
      undefined,
      undefined,
      [{ id: 'index-only', variableId: 'SECOND' }],
      undefined,
      { u1: [{ id: 'canonical', variableId: 'FIRST' }] },
    );
    const availability = vi.spyOn(result.api, 'getUnitCommentAvailability');
    await enableComments(result);
    expect(availability).toHaveBeenCalledWith('ap', 'u1');
    expect(result.api.getItemCommentCounts).not.toHaveBeenCalled();
    expect(result.component.selectedCommentItemId).toBe('canonical');
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('');
    expect(result.fixture.nativeElement.querySelector('.comment-thread-stub')).toBeNull();
    const select = result.fixture.nativeElement.querySelector(
      '.comment-item-select select',
    ) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(Array.from(select.options, (option) => option.value)).toEqual(['', 'canonical']);
  });

  it.each([false, true])(
    'review: uses the current VOMD mapping for a prefixed index alias with item comments %s',
    async (enableItemComments) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
            {
              id: 'old-result',
              sourceType: 'COPY_VALUE',
              deriveSources: ['FIRST'],
              codes: fullCode,
            },
            {
              id: 'new-result',
              sourceType: 'COPY_VALUE',
              deriveSources: ['SECOND'],
              codes: fullCode,
            },
          ],
        },
        undefined,
        [{ id: 'I1', variableReadOnlyId: 'old-result' }],
        undefined,
        { u1: [{ id: 'I1', fallbackIds: ['u1_I1'], variableReadOnlyId: 'new-result' }] },
      );
      if (enableItemComments) await enableComments(result);
      else await result.message({ type: 'vopReadyNotification' });
      expect(result.component.activeReviewCodingId).toBe('FIRST');
      expect(result.component.selectedCommentItemId).toBe('');

      result.component.navigateToPage(2);
      expect(result.component.activeReviewCodingId).toBe('new-result');
      expect(result.component.selectedCommentItemId).toBe(enableItemComments ? 'I1' : '');
    },
  );

  it('review: follows items bound to derived variables to their base player pages', async () => {
    const result = await playerFixture(
      twoPages,
      {
        variableCodings: [
          { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
          { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
          { id: 'RESULT_1', sourceType: 'SUM_SCORE', deriveSources: ['FIRST'], codes: fullCode },
          { id: 'RESULT_2', sourceType: 'SUM_SCORE', deriveSources: ['SECOND'], codes: fullCode },
        ],
      },
      undefined,
      [
        { id: 'I1', variableId: 'RESULT_1' },
        { id: 'I2', variableId: 'RESULT_2' },
      ],
    );
    await enableComments(result);
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I2');
    expect(result.component.activeReviewCodingId).toBe('RESULT_2');
  });

  it('uses current canonical references where the index has stale internal IDs', async () => {
    const result = await playerFixture(
      twoPages,
      {
        variableCodings: ['FIRST', 'SECOND'].map((id) => ({
          id,
          sourceType: 'BASE',
          codes: fullCode,
        })),
      },
      undefined,
      [
        { id: 'I1', variableReadOnlyId: 'FIRST' },
        { id: 'I2', variableReadOnlyId: 'SECOND' },
      ],
      undefined,
      {
        u1: [
          { id: 'I1', variableId: 'SECOND' },
          { id: 'I2', variableId: 'FIRST' },
        ],
      },
    );
    await enableComments(result);
    expect(result.component.selectedCommentItemId).toBe('I2');
    expect(result.component.activeReviewCodingId).toBe('FIRST');
    result.component.navigateToPage(2);
    expect(result.component.selectedCommentItemId).toBe('I1');
    expect(result.component.activeReviewCodingId).toBe('SECOND');
  });

  it.each([
    {
      scope: 'item',
      type: 'ITEM',
      activeCoding: true,
      expectedOptions: ['I1', 'I2', 'I3', 'ARCHIVE'],
    },
    { scope: 'coding', type: 'CODING', activeCoding: false, expectedOptions: ['', 'ARCHIVE'] },
  ] as const)(
    'opens an existing $scope thread outside the player navigation',
    async ({ scope, type, activeCoding, expectedOptions }) => {
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
          ],
        },
        undefined,
        [],
        undefined,
        {
          u1: [
            { id: 'I1', variableId: 'FIRST' },
            { id: 'I2', variableId: 'FIRST' },
            { id: 'I3', variableId: 'SECOND' },
          ],
        },
      );
      vi.spyOn(result.api, 'getUnitCommentAvailability').mockReturnValue(
        of({
          codingCommentsAvailable: activeCoding,
          additionalItems: [{ id: 'ARCHIVE', label: 'Historisches Item', targetTypes: [type] }],
        }),
      );
      await enableComments(result);
      const { fixture, component } = result;
      component.activeTab = 'comments';
      component.commentScope = scope;
      component.selectedReviewItemId = 'I1';
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();

      const pagePicker = fixture.nativeElement.querySelector(
        'select[aria-label="Item auf dieser Seite"]',
      ) as HTMLSelectElement;
      const picker = fixture.nativeElement.querySelector(
        'select[aria-label="Item"]',
      ) as HTMLSelectElement;
      expect(Array.from(pagePicker.options).map(({ value }) => value)).toEqual(['I1', 'I2']);
      expect(Array.from(picker.options).map(({ value }) => value)).toEqual(expectedOptions);
      picker.value = 'ARCHIVE';
      picker.dispatchEvent(new Event('change'));
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      const thread = fixture.nativeElement.querySelector('.comment-thread-stub') as HTMLElement;
      expect(thread.dataset['targetType']).toBe(type);
      expect(thread.dataset['itemId']).toBe('ARCHIVE');
      expect(component.selectedReviewItemId).toBe('I1');
      expect(component.activeReviewCodingId).toBe('FIRST');

      component.navigateToPage(2);
      expect(component.selectedReviewItemId).toBe('I3');
      expect(component.selectedCommentItemId).toBe(activeCoding ? 'I3' : '');
    },
  );

  it('review: follows canonical items supplied by the file-backed catalog', async () => {
    const result = await playerFixture(
      twoPages,
      {
        variableCodings: [
          { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
          { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
        ],
      },
      undefined,
      [],
      undefined,
      {
        u1: [
          { id: 'I1', variableId: 'FIRST' },
          { id: 'I2', variableReadOnlyId: 'SECOND' },
        ],
      },
    );
    await enableComments(result);
    expect(result.component.commentItems).toHaveLength(2);
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I2');
  });

  it('review: respects a strict internal variable reference when another alias shadows it', async () => {
    const definition = JSON.stringify({
      pages: [
        { elements: [{ id: 'input-a', alias: 'FIRST', type: 'text-field' }] },
        { elements: [{ id: 'input-b', alias: 'A', type: 'text-field' }] },
      ],
    });
    const result = await playerFixture(
      definition,
      {
        variableCodings: [
          { id: 'A', alias: 'FIRST', sourceType: 'BASE', codes: fullCode },
          { id: 'B', alias: 'A', sourceType: 'BASE', codes: fullCode },
        ],
      },
      undefined,
      [
        { id: 'I1', variableReadOnlyId: 'A' },
        { id: 'I2', variableReadOnlyId: 'B' },
      ],
    );
    await enableComments(result);
    result.component.navigateToPage(2);
    result.fixture.changeDetectorRef.markForCheck();
    await result.fixture.whenStable();
    expect(result.component.selectedCommentItemId).toBe('I2');
  });

  it.each([false, true])(
    'prioritizes both canonical IDs over colliding raw VOMD IDs (reversed: %s)',
    async (reversed) => {
      const navigationItems = [
        { id: 'u1_I1', fallbackIds: ['I1'], variableId: 'FIRST' },
        { id: 'u1_u1_I1', variableId: 'SECOND' },
      ];
      const result = await playerFixture(
        twoPages,
        {
          variableCodings: [
            { id: 'FIRST', sourceType: 'BASE', codes: fullCode },
            { id: 'SECOND', sourceType: 'BASE', codes: fullCode },
          ],
        },
        undefined,
        [],
        undefined,
        { u1: reversed ? [...navigationItems].reverse() : navigationItems },
      );
      await enableComments(result);

      for (const [page, itemId, codingId] of [
        [1, 'u1_I1', 'FIRST'],
        [2, 'u1_u1_I1', 'SECOND'],
        [1, 'u1_I1', 'FIRST'],
      ] as const) {
        result.component.navigateToPage(page);
        result.fixture.changeDetectorRef.markForCheck();
        await result.fixture.whenStable();
        expect(result.component.selectedCommentItemId).toBe(itemId);
        expect(result.component.activeReviewCodingId).toBe(codingId);
        expect(
          result.fixture.nativeElement.querySelector('.comment-thread-stub').dataset.itemId,
        ).toBe(itemId);
      }
    },
  );

  it('follows the internal player ID when another page uses it as a public alias', async () => {
    const result = await playerFixture(
      JSON.stringify({
        pages: [
          { elements: [{ id: 'input-a', alias: 'FIRST', type: 'text-field' }] },
          { elements: [{ id: 'input-b', alias: 'input-a', type: 'text-field' }] },
        ],
      }),
      { variableCodings: [{ id: 'input-a', sourceType: 'BASE', codes: fullCode }] },
      undefined,
      [{ id: 'item-a', variableReadOnlyId: 'input-a', sourceVariable: 'FIRST' }],
    );
    await enableComments(result);

    expect(result.component.selectedCommentItemId).toBe('item-a');
    expect(result.component.activeReviewCodingId).toBe('input-a');
    result.component.navigateToPage(2);
    expect(result.component.selectedCommentItemId).toBe('');
    expect(result.component.activeReviewCodingId).toBe('');
  });

  it.each([1, 2])(
    'selects the sole unmapped index item only when the definition has one scroll page (%i pages)',
    async (pages) => {
      const result = await playerFixture(
        pages === 2
          ? twoPages
          : JSON.stringify({
              pages: [{ elements: [{ alias: 'FIRST', type: 'text-field' }] }],
            }),
        { variableCodings: [{ id: 'FIRST', sourceType: 'BASE', codes: fullCode }] },
        undefined,
        [{ id: 'legacy-item' }],
      );
      await enableComments(result);

      expect(result.component.selectedCommentItemId).toBe(pages === 1 ? 'legacy-item' : '');
      expect(result.component.activeReviewCodingId).toBe(pages === 1 ? '' : 'FIRST');
    },
  );

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

  async function reviewNavigationFixture(withSolution = false, codingFile?: Promise<unknown>) {
    const aliases = ['FIRST', 'SECOND', 'THIRD'];
    const result = await playerFixture(
      JSON.stringify({
        pages: [
          { alwaysVisible: true, elements: [{ id: 'stimulus', type: 'text' }] },
          ...aliases.map((alias) => ({
            elements: [{ id: `input-${alias}`, alias, type: 'text-field' }],
          })),
        ],
      }),
      codingFile
        ? undefined
        : {
            variableCodings: aliases.map((alias, index) => ({
              id: `internal-${index}`,
              alias,
              sourceType: 'BASE',
              codes: [
                {
                  id: 1,
                  type: 'FULL_CREDIT',
                  score: 1,
                  ...(withSolution
                    ? { ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Berlin'] }] }] }
                    : {}),
                },
              ],
            })),
          },
      undefined,
      aliases.map((variableId, index) => ({ id: `I${index + 1}`, variableId })),
      codingFile,
    );
    result.fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['ITEM', 'CODING'],
    });
    result.fixture.detectChanges();
    await result.message({ type: 'vopReadyNotification' });
    return result;
  }

  it.each([
    { format: 'Verona 6', validPages: [{ id: '0' }, { id: '2' }] },
    { format: 'legacy', validPages: { '0': 'First', '2': 'Third' } },
  ])(
    'matches the actual page ID for sparse $format pages in both navigation directions',
    async ({ validPages }) => {
      const { fixture, component, message, postMessage } = await reviewNavigationFixture();
      await message({
        type: 'vopStateChangedNotification',
        sessionId: component.playerSessionId,
        playerState: { validPages, currentPage: '2' },
      });
      expect(component.currentPage).toBe(2);
      expect(component.selectedCommentItemId).toBe('I3');
      expect(component.activeReviewCodingId).toBe('THIRD');
      component.navigateToPage(1);
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(component.selectedCommentItemId).toBe('I1');
      expect(component.activeReviewCodingId).toBe('FIRST');
      component.navigateToPage(2);
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(component.selectedCommentItemId).toBe('I3');
      expect(component.activeReviewCodingId).toBe('THIRD');
      expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ target: '2' });
    },
  );

  it.each([undefined, { currentPage: '0' }])(
    'preserves an explicit comment target on response updates with playerState %j',
    async (playerState) => {
      const { fixture, component, message } = await reviewNavigationFixture();
      const select = fixture.nativeElement.querySelector(
        '.comment-item-select select',
      ) as HTMLSelectElement;
      select.value = 'I2';
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      await message({
        type: 'vopStateChangedNotification',
        sessionId: component.playerSessionId,
        unitState: { dataParts: { elementCodes: '[]' } },
        playerState,
      });
      expect(component.currentPage).toBe(1);
      expect(component.selectedCommentItemId).toBe('I2');
      expect(component.activeReviewCodingId).toBe('SECOND');
      await message({
        type: 'vopStateChangedNotification',
        sessionId: component.playerSessionId,
        playerState: { currentPage: '2' },
      });
      expect(component.selectedCommentItemId).toBe('I3');
      expect(component.activeReviewCodingId).toBe('THIRD');
    },
  );

  it.each([
    {
      change: 'reordered',
      validPages: [{ id: '2' }, { id: '0' }],
      pageId: '2',
      item: 'I2',
      coding: 'SECOND',
    },
    { change: 'removed', validPages: [{ id: '0' }], pageId: '0', item: 'I1', coding: 'FIRST' },
  ])(
    'keeps page, comment and coding in sync across restart when the current page is $change',
    async ({ validPages, pageId, item, coding }) => {
      const { fixture, component, message } = await reviewNavigationFixture();
      await message({
        type: 'vopStateChangedNotification',
        sessionId: component.playerSessionId,
        playerState: { validPages: [{ id: '0' }, { id: '2' }], currentPage: '2' },
      });
      const select = fixture.nativeElement.querySelector(
        '.comment-item-select select',
      ) as HTMLSelectElement;
      select.value = 'I2';
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      await message({
        type: 'vopStateChangedNotification',
        sessionId: component.playerSessionId,
        playerState: { validPages },
      });
      expect(component.currentPage).toBe(1);
      expect(component.selectedCommentItemId).toBe(item);
      expect(component.activeReviewCodingId).toBe(coding);
      component.pagingMode = 'concat-scroll';
      component.onPagingModeChange();
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
      });
      const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
      const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
      await message({ type: 'vopReadyNotification' }, frame.contentWindow!);
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        type: 'vopStartCommand',
        playerConfig: { startPage: pageId },
      });
      await message(
        {
          type: 'vopStateChangedNotification',
          sessionId: component.playerSessionId,
          playerState: { validPages, currentPage: pageId },
        },
        frame.contentWindow!,
      );
      expect(component.selectedCommentItemId).toBe(item);
      expect(component.activeReviewCodingId).toBe(coding);
    },
  );

  it('preserves a manual target when its coding file arrives after the selection', async () => {
    let resolveCoding!: (scheme: unknown) => void;
    const codingFile = new Promise<unknown>((resolve) => {
      resolveCoding = resolve;
    });
    const { fixture, component, message } = await reviewNavigationFixture(false, codingFile);
    const select = fixture.nativeElement.querySelector(
      '.comment-item-select select',
    ) as HTMLSelectElement;
    select.value = 'I2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    resolveCoding({
      variableCodings: ['FIRST', 'SECOND', 'THIRD'].map((alias) => ({
        id: alias,
        sourceType: 'BASE',
        codes: [{ id: 1, type: 'FULL_CREDIT', score: 1 }],
      })),
    });
    await vi.waitFor(() => expect(component.codingSchemeLoading).toBe(false));
    await fixture.whenStable();
    expect(component.selectedCommentItemId).toBe('I2');
    expect(component.activeReviewCodingId).toBe('SECOND');
    await message({
      type: 'vopStateChangedNotification',
      sessionId: component.playerSessionId,
      playerState: { currentPage: '2' },
    });
    expect(component.selectedCommentItemId).toBe('I3');
  });

  it.each([false, true])(
    'reveals the current coding when opening through the solution button (prefill: %s)',
    async (withSolution) => {
      const { fixture, component, message } = await reviewNavigationFixture(withSolution);
      await message({
        type: 'vopStateChangedNotification',
        sessionId: component.playerSessionId,
        playerState: { currentPage: '1' },
      });
      expect(component.activeReviewCodingId).toBe('SECOND');
      expect(component.reviewCodingVisible).toBe(false);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return { top: this.dataset['codingId'] === 'SECOND' ? 400 : 100 } as DOMRect;
      });
      const button = Array.from(
        fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
      ).find((button) => button.textContent?.trim() === 'Musterlösung anzeigen')!;
      button.click();
      await fixture.whenStable();
      expect(component.reviewCodingVisible).toBe(true);
      const pane = fixture.nativeElement.querySelector('.review-coding-body') as HTMLElement;
      expect(pane.scrollTop).toBe(300);
      expect(component.selectedCommentItemId).toBe('I2');
    },
  );

  it('follows host and player page changes with the item comment and aliased coding', async () => {
    const scheme = {
      variableCodings: ['FIRST', 'SECOND'].map((alias, index) => ({
        id: `internal-${index}`,
        alias,
        sourceType: 'BASE',
        codes: [{ id: 1, type: 'FULL_CREDIT', score: 1 }],
      })),
    };
    const { fixture, component, message } = await playerFixture(
      JSON.stringify({
        pages: [
          { alwaysVisible: true, elements: [{ id: 'text', type: 'text' }] },
          { elements: [{ id: 'input-1', alias: 'FIRST', type: 'text-field' }] },
          { elements: [{ id: 'input-2', alias: 'SECOND', type: 'text-field' }] },
        ],
      }),
      scheme,
      undefined,
      [
        { id: 'I1', variableId: 'FIRST' },
        { id: 'I2', variableId: 'SECOND' },
      ],
    );
    fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['ITEM', 'CODING'],
    });
    component.reviewCodingVisible = true;
    fixture.detectChanges();
    await message({ type: 'vopReadyNotification' });
    expect(component.selectedCommentItemId).toBe('I1');

    component.navigateToPage(2);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(component.selectedCommentItemId).toBe('I2');
    expect(
      fixture.nativeElement.querySelector('.coding-variable.current-coding h4').textContent,
    ).toContain('SECOND');

    await message({
      type: 'vopStateChangedNotification',
      sessionId: component.playerSessionId,
      playerState: { currentPage: '0', validPages: [{ id: '0' }, { id: '1' }] },
    });
    expect(component.selectedCommentItemId).toBe('I1');
    expect(
      fixture.nativeElement.querySelector('.coding-variable.current-coding h4').textContent,
    ).toContain('FIRST');
  });

  it('reveals the selected coding inside its pane and retains a manual choice on the same page', async () => {
    const { fixture, component, message } = await playerFixture(
      JSON.stringify({
        pages: [
          {
            elements: [
              { id: 'one', alias: 'I1', type: 'text-field' },
              { id: 'two', alias: 'I2', type: 'text-field' },
            ],
          },
        ],
      }),
      {
        variableCodings: ['I1', 'I2'].map((id) => ({
          id,
          sourceType: 'BASE',
          codes: [{ id: 1, type: 'FULL_CREDIT', score: 1 }],
        })),
      },
      undefined,
      [{ id: 'I1' }, { id: 'I2' }],
    );
    fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['ITEM'],
    });
    component.toggleReviewCoding();
    fixture.detectChanges();
    await fixture.whenStable();
    const content = fixture.nativeElement.querySelector('.review-coding-body') as HTMLElement;
    const coding = content.querySelector('[data-coding-id="I2"]') as HTMLElement;
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(coding, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
    content.scrollTop = 20;
    const select = fixture.nativeElement.querySelector(
      '.comment-item-select select',
    ) as HTMLSelectElement;
    select.value = 'I2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(component.activeReviewCodingId).toBe('I2');
    expect(content.scrollTop).toBe(320);
    await message({ type: 'vopStateChangedNotification', playerState: { currentPage: '0' } });
    expect(component.selectedCommentItemId).toBe('I2');
    expect(component.activeReviewCodingId).toBe('I2');
    expect(content.scrollTop).toBe(320);
  });

  it('uses the unit item list before comment availability arrives and ignores stale player messages', async () => {
    const { fixture, component, message, api } = await playerFixture(
      JSON.stringify({
        pages: [
          { elements: [{ alias: 'I1', type: 'text-field' }] },
          { elements: [{ alias: 'I2', type: 'text-field' }] },
        ],
      }),
      undefined,
      undefined,
      [{ id: 'I1' }, { id: 'I2' }],
    );
    const availability = new Subject<{ codingCommentsAvailable: boolean }>();
    vi.spyOn(api, 'getUnitCommentAvailability').mockReturnValue(availability);
    fixture.componentRef.setInput('featureConfigOverride', {
      enableCommenting: true,
      commentTargets: ['ITEM'],
    });
    fixture.detectChanges();
    await message({ type: 'vopReadyNotification' });
    component.navigateToPage(2);
    availability.next({ codingCommentsAvailable: false });
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(component.selectedCommentItemId).toBe('I2');
    await message({
      type: 'vopStateChangedNotification',
      sessionId: 'stale',
      playerState: { currentPage: '0' },
    });
    expect(component.selectedCommentItemId).toBe('I2');
    component.navigateToPage(1);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(component.selectedCommentItemId).toBe('I1');
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

  it('derives drop-list responses when the current frame identifies a legacy ASPECT player', async () => {
    const { component, fixture, message } = await playerFixture(
      JSON.stringify({
        version: '4.0.0',
        pages: [
          {
            elements: [
              {
                id: 'pool',
                type: 'drop-list',
                value: [{ id: 'object' }],
                connectedTo: ['answer'],
                onlyOneItem: false,
                copyOnDrop: false,
              },
              {
                id: 'answer',
                type: 'drop-list',
                value: [],
                connectedTo: [],
                onlyOneItem: true,
                copyOnDrop: false,
              },
            ],
          },
        ],
      }),
      {
        variableCodings: [
          {
            id: 'answer',
            sourceType: 'BASE',
            codes: [
              {
                id: 1,
                type: 'FULL_CREDIT',
                score: 1,
                ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['object'] }] }],
              },
            ],
          },
        ],
      },
    );
    const notification = {
      type: 'vopReadyNotification',
      metadata: { id: 'iqb-player-aspect', version: '2.0.3' },
    };
    await message(notification, window);
    expect(component.reviewSolution.prefill.status).toBe('unavailable');
    await message(notification);
    expect(component.reviewSolution.prefill).toMatchObject({
      status: 'available',
      responses: [{ id: 'answer', value: ['object'] }],
    });
    fixture.componentRef.setInput('unitId', 'u2');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.reviewSolution.prefill.status).toBe('unavailable');
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
