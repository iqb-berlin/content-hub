import { DestroyRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PublicTasksService } from '../../views/public-task/public-tasks.service';
import { PublicationsComponent } from './publications.component';

describe('PublicationsComponent', () => {
  function setup() {
    const api = { preview: vi.fn(), create: vi.fn(), setPublished: vi.fn() };
    const component = new PublicationsComponent(
      {} as ActivatedRoute,
      api as unknown as PublicTasksService,
      { onDestroy: () => () => undefined } as unknown as DestroyRef,
    );
    component.apId = 'ap';
    component.input = { unitId: 'u1', copyrightNotice: '© Stimulus', publicComments: '' };
    return { component, api };
  }

  it('requires a checked preview and prevents duplicate publication while the request is pending', () => {
    const { component, api } = setup();
    component.publish();
    expect(api.create).not.toHaveBeenCalled();
    api.preview.mockReturnValue(of({ sourceRevision: 'revision', snapshot: {} }));
    component.preview();
    const pending = new Subject();
    api.create.mockReturnValue(pending);
    component.publish();
    component.publish();
    expect(api.create).toHaveBeenCalledTimes(1);
    pending.next({ id: 'p1', path: '/public/task/p1' });
    expect(component.publications).toHaveLength(1);
    expect(component.draft).toBeNull();
  });

  it('invalidates the preview when inputs change or the source revision is stale', () => {
    const { component, api } = setup();
    api.preview.mockReturnValue(of({ sourceRevision: 'revision', snapshot: {} }));
    component.preview();
    component.clearPreview();
    component.publish();
    expect(api.create).not.toHaveBeenCalled();
    component.preview();
    api.create.mockReturnValue(
      throwError(() => ({ status: 409, error: { message: 'Vorschau erneut prüfen' } })),
    );
    component.publish();
    expect(component.draft).toBeNull();
    expect(component.error).toBe('Vorschau erneut prüfen');
    expect(component.busy).toBe(false);
  });
});
