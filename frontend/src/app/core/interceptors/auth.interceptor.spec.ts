import { Injector, runInInjectionContext } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpContext, HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { AccessService } from '../services/access.service';
import { BYPASS_APP_AUTH } from './auth-context.tokens';

describe('authInterceptor', () => {
  let token: string | null;
  let authMock: {
    getToken: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    refreshOidcSession: ReturnType<typeof vi.fn>;
    isOidcUser: boolean;
  };
  let accessMock: {
    redirectToAccess: ReturnType<typeof vi.fn>;
  };
  let injector: Injector;

  beforeEach(() => {
    token = 'token-1';
    authMock = {
      getToken: vi.fn(() => token),
      clearSession: vi.fn(() => {
        token = null;
      }),
      refreshOidcSession: vi.fn().mockResolvedValue(false),
      isOidcUser: false,
    };
    accessMock = {
      redirectToAccess: vi.fn().mockResolvedValue(true),
    };

    injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: AccessService, useValue: accessMock },
      ],
    });
  });

  it('adds bearer token header when token exists', async () => {
    const req = new HttpRequest('GET', '/api/view/ap/ap-1');
    const next = vi.fn((forwardedReq: HttpRequest<unknown>) => {
      expect(forwardedReq.headers.get('Authorization')).toBe('Bearer token-1');
      expect(forwardedReq.headers.get('X-Content-Hub-Terminology')).toBe('ap');
      return of(new HttpResponse({ status: 200, body: {} }));
    });

    await firstValueFrom(runInInjectionContext(injector, () => authInterceptor(req, next as any)));

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not add the terminology header to external identity-provider requests', async () => {
    const req = new HttpRequest('GET', 'https://identity.example/realms/test');
    const next = vi.fn((forwarded: HttpRequest<unknown>) => {
      expect(forwarded.headers.has('X-Content-Hub-Terminology')).toBe(false);
      return of(new HttpResponse({ status: 200 }));
    });
    await firstValueFrom(runInInjectionContext(injector, () => authInterceptor(req, next as any)));
  });

  it('redirects to session_expired on 401 for protected requests', async () => {
    const req = new HttpRequest('GET', '/api/view/ap/ap-1');
    const next = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 401 })));

    await expect(
      firstValueFrom(runInInjectionContext(injector, () => authInterceptor(req, next as any))),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(authMock.clearSession).toHaveBeenCalledTimes(1);
    expect(accessMock.redirectToAccess).toHaveBeenCalledWith(
      'session_expired',
      expect.objectContaining({
        replaceUrl: true,
      }),
    );
  });

  it('refreshes OIDC sessions and retries a protected request once after 401', async () => {
    authMock.isOidcUser = true;
    authMock.refreshOidcSession.mockImplementation(async () => {
      token = 'token-2';
      return true;
    });

    const req = new HttpRequest('GET', '/api/view/ap/ap-1');
    const next = vi
      .fn()
      .mockImplementationOnce(() => throwError(() => new HttpErrorResponse({ status: 401 })))
      .mockImplementationOnce((forwardedReq: HttpRequest<unknown>) => {
        expect(forwardedReq.headers.get('Authorization')).toBe('Bearer token-2');
        return of(new HttpResponse({ status: 200, body: { ok: true } }));
      });

    const response = await firstValueFrom(
      runInInjectionContext(injector, () => authInterceptor(req, next as any)),
    );

    expect(response).toBeInstanceOf(HttpResponse);
    expect(authMock.refreshOidcSession).toHaveBeenCalledTimes(1);
    expect(authMock.clearSession).not.toHaveBeenCalled();
    expect(accessMock.redirectToAccess).not.toHaveBeenCalled();
  });

  it('does not redirect for inline AP credential errors', async () => {
    const req = new HttpRequest('POST', '/api/auth/credential-login');
    const next = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 401 })));

    await expect(
      firstValueFrom(runInInjectionContext(injector, () => authInterceptor(req, next as any))),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(authMock.clearSession).not.toHaveBeenCalled();
    expect(accessMock.redirectToAccess).not.toHaveBeenCalled();
  });

  it('does not clear a new login session when an older anonymous request returns 401', async () => {
    token = null;
    const response$ = new Subject<HttpResponse<unknown>>();
    const req = new HttpRequest('GET', '/api/auth/oidc-config');
    const next = vi.fn(() => response$);
    const result = firstValueFrom(
      runInInjectionContext(injector, () => authInterceptor(req, next as any)),
    );

    token = 'new-login-token';
    response$.error(new HttpErrorResponse({ status: 401 }));

    await expect(result).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(authMock.clearSession).not.toHaveBeenCalled();
    expect(accessMock.redirectToAccess).not.toHaveBeenCalled();
    expect(token).toBe('new-login-token');
  });

  it('does not attach the app bearer token to bypassed requests', async () => {
    const req = new HttpRequest('POST', 'https://id.example.com/token', null, {
      context: new HttpContext().set(BYPASS_APP_AUTH, true),
    });
    const next = vi.fn((forwardedReq: HttpRequest<unknown>) => {
      expect(forwardedReq.headers.has('Authorization')).toBe(false);
      return of(new HttpResponse({ status: 200, body: {} }));
    });

    await firstValueFrom(runInInjectionContext(injector, () => authInterceptor(req, next as any)));

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('maps feature-disabled 403 errors to feature_disabled access reason', async () => {
    const req = new HttpRequest('GET', '/api/view/ap/ap-1/units/u1');
    const next = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { message: 'Unit view is not enabled for this AP' },
          }),
      ),
    );

    await expect(
      firstValueFrom(runInInjectionContext(injector, () => authInterceptor(req, next as any))),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(accessMock.redirectToAccess).toHaveBeenCalledWith(
      'feature_disabled',
      expect.objectContaining({
        replaceUrl: true,
      }),
    );
  });
});
