import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ApManagerContextComponent } from './ap-manager-context.component';

function createRoute(path: string) {
  return {
    parent: {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('ap-1'),
        },
      },
    },
    snapshot: {
      paramMap: {
        get: vi.fn().mockReturnValue('ap-1'),
      },
      routeConfig: {
        path,
      },
    },
  };
}

function createApiStub() {
  return {
    getAp: vi.fn().mockReturnValue(of({ id: 'ap-1', name: 'AP 1', packageId: 'pkg-1' })),
    getApRoles: vi.fn().mockReturnValue(of([])),
  };
}

function createAuthStub() {
  return {
    currentUser: null,
    currentUser$: of(null),
  };
}

function createDestroyRefStub() {
  return {
    onDestroy: vi.fn(),
  };
}

function createComponent(path: string): ApManagerContextComponent {
  return new ApManagerContextComponent(
    createRoute(path) as any,
    createApiStub() as any,
    createAuthStub() as any,
    createDestroyRefStub() as any,
  );
}

describe('ApManagerContextComponent', () => {
  it('uses AP list back link on dashboard route', () => {
    const component = createComponent('');

    component.ngOnInit();

    expect(component.backLink).toEqual(['/aps']);
    expect(component.backLabel).toBe('← Zur AP-Liste');
  });

  it('uses dashboard back link on nested manager routes', () => {
    const component = createComponent('files');

    component.ngOnInit();

    expect(component.backLink).toEqual(['/manage', 'ap-1']);
    expect(component.backLabel).toBe('← Zur AP-Übersicht');
  });
});
