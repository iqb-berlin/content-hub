import { convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AccessComponent } from './access.component';

function createComponent(query: Record<string, string | undefined>) {
  const api = {
    getPublicAps: vi.fn().mockReturnValue(of([{ id: 'package-1', name: 'Bestehendes Paket' }])),
  };
  const component = new AccessComponent(
    { queryParamMap: of(convertToParamMap(query)) } as any,
    {} as any,
    { isLoggedIn: false } as any,
    api as any,
  );
  return { component, api };
}

describe('AccessComponent package link compatibility', () => {
  it.each([
    { name: 'legacy ACP', query: { acpId: 'package-1', context: 'acp' } },
    { name: 'current AP', query: { apId: 'package-1', context: 'ap' } },
  ])('preserves package sign-in and the return target for $name links', ({ query }) => {
    const { component, api } = createComponent({
      ...query,
      reason: 'login_required',
      next: '/view/package-1/item-explorer',
    });

    component.ngOnInit();

    expect(component.showCredentialButton).toBe(true);
    expect(component.apId).toBe('package-1');
    expect(component.apName).toBe('Bestehendes Paket');
    expect(component.detail).toContain('Bestehendes Paket');
    expect(component.context).toBe('ap');
    expect(component.nextUrl).toBe('/view/package-1/item-explorer');
    expect(api.getPublicAps).toHaveBeenCalledOnce();
    component.ngOnDestroy();
  });

  it('keeps the current package ID when both query parameter names are present', () => {
    const { component } = createComponent({
      reason: 'login_required',
      apId: 'package-1',
      acpId: 'another-package',
    });

    component.ngOnInit();

    expect(component.apId).toBe('package-1');
    expect(component.apName).toBe('Bestehendes Paket');
    expect(component.showCredentialButton).toBe(true);
    component.ngOnDestroy();
  });
});
