import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { TaskSequenceComponent } from './task-sequence.component';

vi.mock('../comment-thread/item-comment-thread.component', async () => {
  const { Component } = await import('@angular/core');
  class ItemCommentThreadStub {}
  Component({
    selector: 'app-item-comment-thread',
    standalone: true,
    template: '',
    inputs: ['acpId', 'targetType', 'bookletId', 'enabled'],
  })(ItemCommentThreadStub);
  return { ItemCommentThreadComponent: ItemCommentThreadStub };
});

vi.mock('../unit-view/unit-view.component', async () => {
  const { Component } = await import('@angular/core');
  class UnitViewStub {
    acpId = '';
    unitId = '';
    bookletId = '';
    embedded = false;
    reviewMode = false;
    featureConfigOverride: unknown = null;
  }
  Component({
    selector: 'app-unit-view',
    standalone: true,
    template:
      '<div class="unit-review-stub" [attr.data-unit-id]="unitId" [attr.data-booklet-id]="bookletId" [attr.data-review-mode]="reviewMode">{{ unitId }}</div>',
    inputs: [
      'acpId',
      'unitId',
      'bookletId',
      'bookletName',
      'embedded',
      'reviewMode',
      'featureConfigOverride',
    ],
  })(UnitViewStub);
  return { UnitViewComponent: UnitViewStub };
});

describe('Booklet navigation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each([true, false, 'unavailable'] as const)(
    'keeps booklet navigation with review permission %s',
    async (canReview) => {
      const routeParamMap = new BehaviorSubject(
        convertToParamMap({ acpId: 'acp-1', sequenceId: 'booklet-1' }),
      );
      const routeQueryParamMap = new BehaviorSubject(convertToParamMap({ kind: 'booklet' }));
      const sequences = {
        'booklet-1': {
          id: 'booklet-1',
          name: 'Review-Booklet',
          units: [
            {
              id: 'u1',
              name: 'Aufgabe 1',
              occurrenceId: 'first',
              alias: 'A',
              blockPath: ['Mathematik'],
            },
            {
              id: 'u1',
              name: 'Aufgabe 1 erneut',
              occurrenceId: 'second',
              alias: 'B',
              blockPath: ['Mathematik', 'Geometrie'],
            },
            {
              id: 'u2',
              name: 'Aufgabe 2',
              occurrenceId: 'third',
              blockPath: ['Mathematik', 'Zahlen'],
            },
          ],
        },
        'booklet-2': {
          id: 'booklet-2',
          name: 'Zweites Testheft',
          units: [{ id: 'u3', name: 'Andere Aufgabe', occurrenceId: 'only' }],
        },
      };
      await TestBed.configureTestingModule({
        imports: [TaskSequenceComponent],
        schemas: [NO_ERRORS_SCHEMA],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          {
            provide: AuthService,
            useValue: {
              isLoggedIn: false,
              isAdmin: false,
              currentUser$: of(null),
              hasAcpRole: vi.fn().mockReturnValue(false),
            },
          },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                paramMap: { get: (key: string) => (key === 'acpId' ? 'acp-1' : 'booklet-1') },
                queryParamMap: { get: () => 'booklet' },
              },
              paramMap: routeParamMap,
              queryParamMap: routeQueryParamMap,
            },
          },
          {
            provide: ApiService,
            useValue: {
              appendAuthToken: vi.fn((url: string) => url),
              getCapabilities: vi
                .fn()
                .mockReturnValue(
                  canReview === 'unavailable'
                    ? throwError(() => new Error('offline'))
                    : of({ canReview }),
                ),
              getAcpStartPage: vi.fn().mockReturnValue(
                of({
                  featureConfig: {
                    enableSequenceNavigation: false,
                    enableCommenting: true,
                    commentTargets: ['BOOKLET', 'UNIT'],
                  },
                  sequences: [
                    { id: 'booklet-1', name: 'Review-Booklet', kind: 'booklet' },
                    { id: 'booklet-2', name: 'Zweites Testheft', kind: 'booklet' },
                    { id: 'sequence-1', name: 'Aufgabenfolge', kind: 'sequence' },
                  ],
                }),
              ),
              getViewSequence: vi
                .fn()
                .mockImplementation((_acpId: string, sequenceId: keyof typeof sequences) =>
                  of(sequences[sequenceId]),
                ),
            },
          },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(TaskSequenceComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      await vi.waitFor(() => expect(component.hasUnits).toBe(true));
      fixture.detectChanges();
      expect(TestBed.inject(ApiService).getViewSequence).toHaveBeenCalledWith(
        'acp-1',
        'booklet-1',
        'booklet',
      );
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      component.downloadSequence();
      expect(open).toHaveBeenCalledWith(
        '/api/acp/acp-1/files?sequenceId=booklet-1&format=zip&kind=booklet',
        '_blank',
      );
      open.mockRestore();
      component.toggleUnitList();
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      const buttons = fixture.nativeElement.querySelectorAll(
        '.unit-list-item',
      ) as NodeListOf<HTMLButtonElement>;
      expect(buttons.length).toBe(3);
      expect(buttons[1].textContent).toContain('Mathematik / Geometrie');
      expect(buttons[1].textContent).toContain('Alias: B');
      buttons[1].click();
      fixture.detectChanges();
      expect(component.currentUnit?.occurrenceId).toBe('second');
      expect(component.currentUnit?.id).toBe('u1');
      expect(fixture.nativeElement.querySelector('.nav-info').textContent).toContain(
        'Mathematik / Geometrie',
      );
      expect(component.canGoNext).toBe(true);
      const embeddedUnit = fixture.nativeElement.querySelector('.unit-review-stub') as HTMLElement;
      expect(embeddedUnit.dataset['unitId']).toBe('u1');
      expect(embeddedUnit.dataset['bookletId']).toBe('booklet-1');
      expect(embeddedUnit.dataset['reviewMode']).toBe(String(canReview === true));
      expect(component.showUnitListBtn).toBe(true);
      expect(fixture.nativeElement.querySelector('.nav-info strong').textContent).toBe(
        'Aufgabe 1 erneut (u1)',
      );
      expect(component.breadcrumbs.at(-1)?.label).toBe('Review-Booklet');
      expect(fixture.nativeElement.querySelector('.seq-header')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Vollansicht');
      expect(fixture.nativeElement.textContent).toContain('Vollbild');

      const workspace = fixture.nativeElement.querySelector('.review-workspace') as HTMLElement;
      const requestFullscreen = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(workspace, 'requestFullscreen', { value: requestFullscreen });
      await component.toggleFullscreen();
      expect(requestFullscreen).toHaveBeenCalledOnce();
      requestFullscreen.mockRejectedValueOnce(new Error('fullscreen blocked'));
      await component.toggleFullscreen();
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(component.isFallbackFullscreen).toBe(true);
      expect(component.isFullscreen).toBe(true);
      expect(workspace.classList.contains('fullscreen-fallback')).toBe(true);
      await component.toggleFullscreen();
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(component.isFullscreen).toBe(false);

      component.next();
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(component.currentUnit?.id).toBe('u2');
      expect(component.canGoNext).toBe(false);
      expect(
        (
          fixture.nativeElement.querySelector(
            '.sequence-navigation button:last-child',
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        (fixture.nativeElement.querySelector('.unit-review-stub') as HTMLElement).dataset['unitId'],
      ).toBe('u2');

      component.prev();
      expect(component.currentUnit?.occurrenceId).toBe('second');
      component.prev();
      expect(component.currentUnit?.occurrenceId).toBe('first');
    },
  );

  it('filters and switches between test booklets in the same review', async () => {
    const routeParamMap = new BehaviorSubject(
      convertToParamMap({ acpId: 'acp-1', sequenceId: 'booklet-1' }),
    );
    const routeQueryParamMap = new BehaviorSubject(convertToParamMap({ kind: 'booklet' }));
    const sequences = {
      'booklet-1': {
        id: 'booklet-1',
        name: 'Erstes Testheft',
        units: [
          { id: 'u1', name: 'Aufgabe 1' },
          { id: 'u2', name: 'Aufgabe 2' },
        ],
      },
      'booklet-2': {
        id: 'booklet-2',
        name: 'Zweites Testheft',
        units: [{ id: 'u3', name: 'Andere Aufgabe' }],
      },
    };
    const api = {
      appendAuthToken: vi.fn((url: string) => url),
      getCapabilities: vi.fn().mockReturnValue(of({ canReview: true })),
      getAcpStartPage: vi.fn().mockReturnValue(
        of({
          featureConfig: {},
          sequences: [
            { id: 'booklet-1', name: 'Erstes Testheft', kind: 'booklet' },
            { id: 'booklet-2', name: 'Zweites Testheft', kind: 'booklet' },
          ],
        }),
      ),
      getViewSequence: vi
        .fn()
        .mockImplementation((_acpId: string, sequenceId: keyof typeof sequences) =>
          of(sequences[sequenceId]),
        ),
    };

    await TestBed.configureTestingModule({
      imports: [TaskSequenceComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            isLoggedIn: false,
            isAdmin: false,
            currentUser$: of(null),
            hasAcpRole: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: (key: string) => (key === 'acpId' ? 'acp-1' : 'booklet-1') },
              queryParamMap: { get: () => 'booklet' },
            },
            paramMap: routeParamMap,
            queryParamMap: routeQueryParamMap,
          },
        },
        { provide: ApiService, useValue: api },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TaskSequenceComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.currentUnit?.id).toBe('u1');
    component.next();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(component.currentIndex).toBe(1);

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const bookletButton = fixture.nativeElement.querySelector(
      'button[aria-controls="review-booklet-list"]',
    ) as HTMLButtonElement;
    expect(bookletButton.textContent).toContain('Erstes Testheft');
    expect(bookletButton.textContent).toContain('1/2');
    expect(bookletButton.getAttribute('aria-label')).toContain(
      'Testheft wechseln, aktuell Erstes Testheft',
    );
    bookletButton.click();
    fixture.detectChanges();

    const currentBooklet = fixture.nativeElement.querySelector(
      '.booklet-list-item.active',
    ) as HTMLButtonElement;
    expect(currentBooklet.getAttribute('aria-current')).toBe('page');
    expect(currentBooklet.querySelector('.booklet-id')?.textContent).toContain('booklet-1');
    expect(currentBooklet.textContent).toContain('Aktuell geöffnet');
    expect(currentBooklet.textContent?.indexOf('booklet-1')).toBeLessThan(
      currentBooklet.textContent?.indexOf('Erstes Testheft') ?? -1,
    );

    const bookletSearch = fixture.nativeElement.querySelector(
      '.booklet-search input',
    ) as HTMLInputElement;
    bookletSearch.value = 'zweites';
    bookletSearch.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const bookletChoices = fixture.nativeElement.querySelectorAll(
      '.booklet-list-item',
    ) as NodeListOf<HTMLButtonElement>;
    expect(bookletChoices.length).toBe(1);
    expect(bookletChoices[0].textContent).toContain('Zweites Testheft');
    expect(bookletChoices[0].textContent).toContain('booklet-2');
    expect(bookletChoices[0].textContent?.indexOf('booklet-2')).toBeLessThan(
      bookletChoices[0].textContent?.indexOf('Zweites Testheft') ?? -1,
    );
    bookletChoices[0].click();
    expect(navigate).toHaveBeenCalledWith(['/view', 'acp-1', 'sequence', 'booklet-2'], {
      queryParams: { kind: 'booklet' },
    });

    routeParamMap.next(convertToParamMap({ acpId: 'acp-1', sequenceId: 'booklet-2' }));
    fixture.detectChanges();
    expect(api.getViewSequence).toHaveBeenLastCalledWith('acp-1', 'booklet-2', 'booklet');
    expect(component.sequenceId).toBe('booklet-2');
    expect(component.currentIndex).toBe(0);
    expect(component.currentUnit?.id).toBe('u3');
    expect(component.currentBookletPosition).toBe(2);
    expect(component.breadcrumbs.at(-1)?.label).toBe('Zweites Testheft');
  });
});
