import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { AcpManagerContextComponent } from './acp-manager-context.component';

function createRoute(path: string) {
  return {
    parent: {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('acp-1'),
        },
      },
    },
    snapshot: {
      paramMap: {
        get: vi.fn().mockReturnValue('acp-1'),
      },
      routeConfig: {
        path,
      },
    },
  };
}

function createApiStub() {
  return {
    getAcp: vi.fn().mockReturnValue(of({ id: 'acp-1', name: 'ACP 1', packageId: 'pkg-1' })),
    getAcpRoles: vi.fn().mockReturnValue(of([])),
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

function createComponent(path: string): AcpManagerContextComponent {
  return new AcpManagerContextComponent(
    createRoute(path) as any,
    createApiStub() as any,
    createAuthStub() as any,
    createDestroyRefStub() as any,
  );
}

describe('AcpManagerContextComponent', () => {
  it('uses ACP list back link on dashboard route', () => {
    const component = createComponent('');

    component.ngOnInit();

    expect(component.backLink).toEqual(['/acps']);
    expect(component.backLabel).toBe('← Zur AP-Liste');
  });

  it('uses dashboard back link on nested manager routes', () => {
    const component = createComponent('files');

    component.ngOnInit();

    expect(component.backLink).toEqual(['/manage', 'acp-1']);
    expect(component.backLabel).toBe('← Zur AP-Übersicht');
  });
});
