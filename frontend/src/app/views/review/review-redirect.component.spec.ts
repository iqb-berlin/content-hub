import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ReviewRedirectComponent } from './review-redirect.component';

function setup(capabilities$: ReturnType<typeof of> | ReturnType<typeof throwError>) {
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  const api = { getCapabilities: vi.fn().mockReturnValue(capabilities$) };
  const route = {
    snapshot: { paramMap: { get: () => null } },
    parent: { snapshot: { paramMap: { get: () => 'ap-1' } } },
  };
  return {
    component: new ReviewRedirectComponent(route as any, router as any, api as any),
    router,
    api,
  };
}

describe('ReviewRedirectComponent', () => {
  it('keeps capability-only Review managers in the view route tree', () => {
    const { component, router, api } = setup(of({ canManageReview: true, canReview: true }));

    component.ngOnInit();

    expect(api.getCapabilities).toHaveBeenCalledWith('ap-1');
    expect(router.navigate).toHaveBeenCalledWith(['/view', 'ap-1', 'review', 'manage'], {
      replaceUrl: true,
    });
  });

  it('returns participants and failed permission checks to the AP start page', () => {
    const participant = setup(of({ canManageReview: false, canReview: true }));
    participant.component.ngOnInit();
    expect(participant.router.navigate).toHaveBeenCalledWith(['/view', 'ap-1'], {
      replaceUrl: true,
    });

    const failed = setup(throwError(() => new Error('offline')));
    failed.component.ngOnInit();
    expect(failed.router.navigate).toHaveBeenCalledWith(['/view', 'ap-1'], {
      replaceUrl: true,
    });
  });
});
