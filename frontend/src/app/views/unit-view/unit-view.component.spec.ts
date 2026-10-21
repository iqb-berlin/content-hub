import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { UnitViewData } from '../../core/models/api.models';
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
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

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
      ).map((heading) => heading.textContent?.trim()),
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
    codingFilter.value = 'VAR_1';
    codingFilter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.coding-variable h4') as NodeListOf<HTMLElement>,
      ).map((heading) => heading.textContent?.trim()),
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
