import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskSequence } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { TaskSequenceComponent } from './task-sequence.component';

vi.mock('../comment-thread/item-comment-thread.component', async () => {
  const { Component } = await import('@angular/core');
  class Stub {}
  Component({
    selector: 'app-item-comment-thread',
    standalone: true,
    template: '',
    inputs: ['acpId', 'targetType', 'bookletId', 'enabled'],
  })(Stub);
  return { ItemCommentThreadComponent: Stub };
});
vi.mock('../unit-view/unit-view.component', async () => {
  const { Component } = await import('@angular/core');
  class Stub {}
  Component({
    selector: 'app-unit-view',
    standalone: true,
    template: '',
    inputs: [
      'acpId',
      'unitId',
      'bookletId',
      'bookletName',
      'embedded',
      'reviewMode',
      'featureConfigOverride',
    ],
  })(Stub);
  return { UnitViewComponent: Stub };
});

const sequence: TaskSequence = {
  id: 'booklet-1',
  name: 'Testheft',
  units: [
    {
      id: 'u1',
      name: 'Aufgabe 1',
      occurrenceId: 'booklet-1::0/0',
      linkId: 'Y5gRx3-5hT2cV0WQ',
      alias: 'A',
    },
    {
      id: 'u1',
      name: 'Aufgabe 1',
      occurrenceId: 'booklet-1::1/0 & B',
      linkId: 'qN2y7_rP0G1x8A6B',
      alias: 'B',
    },
    { id: 'u2', name: 'Aufgabe 2' },
  ],
};
const baseUrl = '/view/acp-1/sequence/booklet-1';

async function setup(url: string, pending?: Subject<TaskSequence>) {
  const api = {
    getCapabilities: vi.fn().mockReturnValue(of({ canReview: true })),
    getAcpStartPage: vi.fn().mockReturnValue(of({ featureConfig: {} })),
    getViewSequence: vi.fn().mockReturnValue(pending || of(sequence)),
  };
  await TestBed.configureTestingModule({
    imports: [TaskSequenceComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([
        { path: 'view/:acpId/sequence/:sequenceId', component: TaskSequenceComponent },
      ]),
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: { isLoggedIn: false, isAdmin: false, currentUser$: of(null) },
      },
    ],
  }).compileComponents();
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl(url, TaskSequenceComponent);
  const router = TestBed.inject(Router);
  return { component, harness, router, api };
}

describe('Booklet task links', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens the exact occurrence of a repeated unit, including escaped characters', async () => {
    const occurrence = sequence.units[1].occurrenceId!;
    const { component, router, api } = await setup(
      `${baseUrl}?kind=booklet&occurrence=${encodeURIComponent(occurrence)}`,
    );
    expect(component.currentIndex).toBe(1);
    expect(component.currentUnit?.alias).toBe('B');
    expect(component.invalidUnitLink).toBe(false);
    expect(router.parseUrl(router.url).queryParams['occurrence']).toBe(occurrence);
    expect(api.getViewSequence).toHaveBeenCalledOnce();
  });

  it('opens the short link for a repeated occurrence and generates only short links', async () => {
    const occurrence = sequence.units[1].linkId!;
    const { component, harness, router } = await setup(
      `${baseUrl}?kind=booklet&occurrence=${occurrence}`,
    );
    expect(component.currentIndex).toBe(1);
    expect(component.currentUnit?.alias).toBe('B');
    expect(component.invalidUnitLink).toBe(false);
    expect(router.url).toBe(`${baseUrl}?kind=booklet&occurrence=${occurrence}`);
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.workspace-actions a')?.getAttribute('href')).toBe(router.url);
    root
      .querySelector<HTMLButtonElement>('button[aria-controls="task-sequence-unit-list"]')!
      .click();
    harness.detectChanges();
    expect(
      Array.from(root.querySelectorAll('.unit-direct-link'), (link) => link.getAttribute('href')),
    ).toEqual([
      `${baseUrl}?kind=booklet&occurrence=${sequence.units[0].linkId}`,
      `${baseUrl}?kind=booklet&occurrence=${sequence.units[1].linkId}`,
      `${baseUrl}?kind=booklet&position=3`,
    ]);
  });

  it('reports an old short link as stale instead of selecting the new unit at that path', async () => {
    const pending = new Subject<TaskSequence>();
    const { component, harness, router } = await setup(
      `${baseUrl}?kind=booklet&occurrence=${sequence.units[1].linkId}`,
      pending,
    );
    pending.next({
      ...sequence,
      units: sequence.units.map((unit, index) => ({
        ...unit,
        id: `replacement-${index}`,
        linkId: `changed-version-${index}`,
      })),
    });
    harness.detectChanges();
    expect(component.currentIndex).toBe(0);
    expect(component.invalidUnitLink).toBe(true);
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent,
    ).toContain('ungültig oder veraltet');
    component.next();
    await harness.fixture.whenStable();
    expect(component.invalidUnitLink).toBe(false);
    expect(component.currentIndex).toBe(1);
    expect(router.parseUrl(router.url).queryParams['occurrence']).toBe('changed-version-1');
  });

  it('rejects ambiguous short link IDs', async () => {
    const pending = new Subject<TaskSequence>();
    const { component, harness } = await setup(
      `${baseUrl}?kind=booklet&occurrence=duplicate`,
      pending,
    );
    pending.next({
      ...sequence,
      units: sequence.units.map((unit) => ({ ...unit, linkId: 'duplicate' })),
    });
    harness.detectChanges();
    expect(component.currentIndex).toBe(0);
    expect(component.invalidUnitLink).toBe(true);
  });

  it('still generates long links for older API responses without short IDs', async () => {
    const pending = new Subject<TaskSequence>();
    const { component, harness } = await setup(`${baseUrl}?kind=booklet`, pending);
    pending.next({
      ...sequence,
      units: sequence.units.map((unit) => ({ ...unit, linkId: undefined })),
    });
    harness.detectChanges();
    expect(component.unitLinkParams(1).occurrence).toBe(sequence.units[1].occurrenceId);
  });

  it('keeps URL and selection synchronized without fetching the booklet again', async () => {
    const { component, router, harness, api } = await setup(`${baseUrl}?kind=booklet&keep=yes`);
    component.next();
    await harness.fixture.whenStable();
    expect(component.currentIndex).toBe(1);
    expect(router.parseUrl(router.url).queryParams).toEqual({
      kind: 'booklet',
      keep: 'yes',
      occurrence: sequence.units[1].linkId,
    });
    component.next();
    await harness.fixture.whenStable();
    expect(component.currentIndex).toBe(2);
    expect(router.parseUrl(router.url).queryParams).toEqual({
      kind: 'booklet',
      keep: 'yes',
      position: '3',
    });
    component.prev();
    await harness.fixture.whenStable();
    expect(component.currentIndex).toBe(1);
    expect(router.parseUrl(router.url).queryParams['position']).toBeUndefined();
    component.jumpTo(0);
    await harness.fixture.whenStable();
    expect(component.currentIndex).toBe(0);
    expect(router.parseUrl(router.url).queryParams['occurrence']).toBe(sequence.units[0].linkId);
    expect(api.getViewSequence).toHaveBeenCalledOnce();
    await harness.navigateByUrl(`${baseUrl}?kind=booklet&position=3`, TaskSequenceComponent);
    expect(component.currentIndex).toBe(2);
    await harness.navigateByUrl(`${baseUrl}?kind=booklet`, TaskSequenceComponent);
    expect(component.currentIndex).toBe(0);
    expect(api.getViewSequence).toHaveBeenCalledOnce();
  });

  it('waits for the manifest and uses the latest link selection while it loads', async () => {
    const pending = new Subject<TaskSequence>();
    const { component, harness } = await setup(`${baseUrl}?kind=booklet&position=1`, pending);
    expect(component.sequence).toBeNull();
    await harness.navigateByUrl(`${baseUrl}?kind=booklet&position=3`, TaskSequenceComponent);
    pending.next(sequence);
    harness.detectChanges();
    expect(component.currentIndex).toBe(2);
    expect(component.currentUnit?.id).toBe('u2');
  });

  it.each([
    'occurrence=missing',
    'occurrence=',
    'position=0',
    'position=-1',
    'position=4',
    'position=1.5',
    'position=abc',
    'position=01',
    'position=9007199254740993',
    'position=2&position=3',
    'occurrence=first&occurrence=second',
    'occurrence=first&position=2',
  ])('reports an invalid target and safely displays the first unit: %s', async (query) => {
    const { component } = await setup(`${baseUrl}?kind=booklet&${query}`);
    expect(component.currentIndex).toBe(0);
    expect(component.invalidUnitLink).toBe(true);
  });

  it('ignores task link parameters on legacy module sequences', async () => {
    const { component, router } = await setup(`${baseUrl}?position=3`);
    expect(component.currentIndex).toBe(0);
    component.next();
    expect(component.currentIndex).toBe(1);
    expect(router.url).toBe(`${baseUrl}?position=3`);
  });

  it('resets a stale selection when switching booklet', async () => {
    const { component, router, harness, api } = await setup(`${baseUrl}?kind=booklet&position=3`);
    component.reviewBooklets = [{ id: 'booklet-1' }, { id: 'booklet-2' }];
    api.getViewSequence.mockReturnValue(of({ id: 'booklet-2', units: [{ id: 'other' }] }));
    component.switchBooklet('booklet-2');
    await harness.fixture.whenStable();
    expect(router.url).toBe('/view/acp-1/sequence/booklet-2?kind=booklet');
    expect(component.currentIndex).toBe(0);
    expect(component.currentUnit?.id).toBe('other');
    expect(component.invalidUnitLink).toBe(false);
  });

  it('blocks stale task navigation until the selected booklet finishes loading', async () => {
    const { component, router, harness, api } = await setup(`${baseUrl}?kind=booklet&position=2`);
    const pending = new Subject<TaskSequence>();
    const root = harness.fixture.nativeElement as HTMLElement;
    const embeddedUnit = root.querySelector('app-unit-view');
    const taskListButton = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Aufgabenliste'),
    )!;
    component.reviewBooklets = [{ id: 'booklet-1' }, { id: 'booklet-2' }];
    api.getViewSequence.mockImplementation((_acpId: string, id: string) =>
      id === 'booklet-2' ? pending : of(sequence),
    );
    taskListButton.click();
    harness.detectChanges();
    expect(root.querySelectorAll('.unit-direct-link')).toHaveLength(3);

    component.switchBooklet('booklet-2');
    await harness.fixture.whenStable();
    harness.detectChanges();
    const switchedUrl = '/view/acp-1/sequence/booklet-2?kind=booklet';
    expect(router.url).toBe(switchedUrl);
    expect(component.canGoPrev).toBe(false);
    expect(component.canGoNext).toBe(false);
    for (const button of root.querySelectorAll<HTMLButtonElement>('.sequence-navigation button')) {
      expect(button.disabled).toBe(true);
    }
    expect(taskListButton.disabled).toBe(true);
    expect(root.querySelector('.workspace-actions a')).toBeNull();
    expect(root.querySelector('.unit-direct-link')).toBeNull();
    expect(root.querySelector('app-unit-view')).toBe(embeddedUnit);

    component.next();
    component.prev();
    component.jumpTo(1);
    component.toggleUnitList();
    await harness.fixture.whenStable();
    expect(router.url).toBe(switchedUrl);
    expect(component.unitListOpen).toBe(false);
    expect(api.getViewSequence).toHaveBeenCalledTimes(2);

    pending.next({ id: 'booklet-2', units: [{ id: 'other-1' }, { id: 'other-2' }] });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.currentUnit?.id).toBe('other-1');
    expect(component.canGoNext).toBe(true);
    expect(taskListButton.disabled).toBe(false);
    expect(root.querySelector('app-unit-view')).toBe(embeddedUnit);
    expect(root.querySelector('.workspace-actions a')?.getAttribute('href')).toBe(
      `${switchedUrl}&position=1`,
    );

    component.next();
    await harness.fixture.whenStable();
    expect(router.url).toBe(`${switchedUrl}&position=2`);
    expect(component.currentUnit?.id).toBe('other-2');
    expect(api.getViewSequence).toHaveBeenCalledTimes(2);
  });
});
