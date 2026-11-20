import { Injector, runInInjectionContext } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { apViewGuard } from './ap-view.guard';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { AccessService } from '../services/access.service';

describe('apViewGuard', () => {
  let authMock: { isLoggedIn: boolean };
  let apiMock: { getApStartPage: ReturnType<typeof vi.fn> };
  let accessMock: { createAccessUrlTree: ReturnType<typeof vi.fn> };
  let injector: Injector;

  beforeEach(() => {
    authMock = { isLoggedIn: false };
    apiMock = { getApStartPage: vi.fn().mockReturnValue(of({ id: 'ap-1' })) };
    accessMock = {
      createAccessUrlTree: vi.fn((reason: string, options: any) => ({ reason, options })),
    };

    injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: ApiService, useValue: apiMock },
        { provide: AccessService, useValue: accessMock },
      ],
    });
  });

  it('allows logged-in users immediately', async () => {
    authMock.isLoggedIn = true;

    const result = await firstValueFrom(
      runInInjectionContext(
        injector,
        () =>
          apViewGuard(
            { paramMap: { get: () => 'ap-1' } } as any,
            { url: '/view/ap-1' } as any,
          ) as any,
      ),
    );

    expect(result).toBe(true);
    expect(apiMock.getApStartPage).not.toHaveBeenCalled();
  });

  it('checks AP visibility for anonymous users', async () => {
    const result = await firstValueFrom(
      runInInjectionContext(
        injector,
        () =>
          apViewGuard(
            { paramMap: { get: () => 'ap-1' } } as any,
            { url: '/view/ap-1' } as any,
          ) as any,
      ),
    );

    expect(apiMock.getApStartPage).toHaveBeenCalledWith('ap-1');
    expect(result).toBe(true);
  });

  it('redirects unauthorized anonymous users to login-required access page', async () => {
    apiMock.getApStartPage.mockReturnValue(throwError(() => ({ status: 403 })));

    const result = await firstValueFrom(
      runInInjectionContext(
        injector,
        () =>
          apViewGuard(
            { paramMap: { get: () => 'ap-2' } } as any,
            { url: '/view/ap-2/units' } as any,
          ) as any,
      ),
    );

    expect(accessMock.createAccessUrlTree).toHaveBeenCalledWith('login_required', {
      context: 'view',
      apId: 'ap-2',
      nextUrl: '/view/ap-2/units',
    });
    expect(result).toEqual({
      reason: 'login_required',
      options: { context: 'view', apId: 'ap-2', nextUrl: '/view/ap-2/units' },
    });
  });
});
