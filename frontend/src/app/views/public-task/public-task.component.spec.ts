import { DestroyRef } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PublicTaskComponent } from './public-task.component';
import { PublicTaskSnapshot, PublicTasksService } from './public-tasks.service';

describe('PublicTaskComponent', () => {
  function setup() {
    const paramMap = new BehaviorSubject(convertToParamMap({ publicationId: 'first' }));
    const api = { get: vi.fn() };
    const component = new PublicTaskComponent(
      { paramMap } as unknown as ActivatedRoute,
      api as unknown as PublicTasksService,
      { onDestroy: () => () => undefined } as unknown as DestroyRef,
    );
    return { component, paramMap, api };
  }

  it('can open another public link after a withdrawn or unknown publication', () => {
    const { component, paramMap, api } = setup();
    const snapshot = { title: 'Second task' } as PublicTaskSnapshot;
    api.get
      .mockReturnValueOnce(throwError(() => ({ status: 404 })))
      .mockReturnValueOnce(of({ snapshot }));
    component.ngOnInit();
    expect(component.error).toContain('zurückgezogen');
    expect(component.loading).toBe(false);
    paramMap.next(convertToParamMap({ publicationId: 'second' }));
    expect(component.snapshot).toEqual(snapshot);
    expect(component.error).toBe('');
  });

  it('clears the old snapshot on navigation and ignores an outdated response', () => {
    const { component, paramMap, api } = setup();
    const first = new Subject();
    const second = new Subject();
    api.get.mockReturnValueOnce(first).mockReturnValueOnce(second);
    component.ngOnInit();
    paramMap.next(convertToParamMap({ publicationId: 'second' }));
    first.next({ snapshot: { title: 'Stale task' } });
    expect(component.snapshot).toBeNull();
    second.next({ snapshot: { title: 'Current task' } });
    expect(component.snapshot?.title).toBe('Current task');
  });
});
