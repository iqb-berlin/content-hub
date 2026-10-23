import { convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../core/services/auth.service';
import { PendingPersonalSessionStorageService } from '../core/services/pending-personal-session-storage.service';
import { LoginComponent } from './login.component';
import { OidcCallbackComponent } from './oidc-callback.component';

describe('OidcCallbackComponent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal('BroadcastChannel', undefined);
    window.history.replaceState({}, '', '/auth/callback?code=original-code&state=original-state');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup() {
    const http = {
      get: vi.fn().mockReturnValue(
        of({
          enabled: true,
          issuerUrl: 'https://id.example.com',
          clientId: 'web',
          redirectUri: `${window.location.origin}/auth/callback`,
          scope: 'openid profile email',
        }),
      ),
      post: vi
        .fn()
        .mockImplementation((url: string) =>
          of(
            url.endsWith('/token')
              ? { access_token: 'access', id_token: 'id' }
              : { accessToken: 'app-token', user: { id: 'user', acpRoles: [] } },
          ),
        ),
    };
    const auth = new AuthService(http as any, new PendingPersonalSessionStorageService());
    vi.spyOn(auth as any, 'scheduleOidcTokenRefresh').mockImplementation(() => undefined);
    const browser = vi.spyOn(auth as any, 'navigateBrowserTo').mockImplementation(() => undefined);
    const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
    return {
      auth,
      http,
      browser,
      router,
      component: new OidcCallbackComponent(auth, router as any),
    };
  }

  it.each([
    ['fresh tab', null, null, 'original-state'],
    ['missing state parameter', 'original-state', 'old-verifier', null],
    ['mismatched state', 'different-state', 'old-verifier', 'original-state'],
    ['missing verifier', 'original-state', null, 'original-state'],
  ])(
    'restarts safely for %s and completes a fresh login',
    async (_label, savedState, verifier, state) => {
      const { auth, http, browser, router, component } = setup();
      if (savedState) sessionStorage.setItem('oidc_state', savedState);
      if (verifier) sessionStorage.setItem('oidc_code_verifier', verifier);
      sessionStorage.setItem('oidc_redirect_url', '/admin/users');
      window.history.replaceState(
        {},
        '',
        `/auth/callback?code=original-code${state ? `&state=${state}` : ''}`,
      );
      await component.ngOnInit();
      expect(http.post).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { next: '/admin/users' },
        replaceUrl: true,
      });
      const login = new LoginComponent(auth, {
        queryParamMap: of(convertToParamMap(router.navigate.mock.calls[0][1].queryParams)),
      } as any);
      login.ngOnInit();
      await vi.waitFor(() => expect(browser).toHaveBeenCalledTimes(1));
      const url = new URL(browser.mock.calls[0][0]);
      const freshState = sessionStorage.getItem('oidc_state');
      const freshVerifier = sessionStorage.getItem('oidc_code_verifier');
      expect(freshState).toBeTruthy();
      expect(freshState).not.toBe(savedState);
      expect(freshState).not.toBe(state);
      expect(freshVerifier).toBeTruthy();
      expect(freshVerifier).not.toBe(verifier);
      expect(url.searchParams.get('state')).toBe(freshState);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.has('code')).toBe(false);
      expect(http.post).not.toHaveBeenCalled();
      window.history.replaceState({}, '', `/auth/callback?code=fresh-code&state=${freshState}`);
      await component.ngOnInit();
      expect(new URLSearchParams(http.post.mock.calls[0][1]).get('code')).toBe('fresh-code');
      expect(new URLSearchParams(http.post.mock.calls[0][1]).get('code_verifier')).toBe(
        freshVerifier,
      );
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users');
      expect(sessionStorage.getItem('oidc_state')).toBeNull();
      expect(sessionStorage.getItem('oidc_code_verifier')).toBeNull();
    },
  );

  it('completes the original callback in the same tab', async () => {
    const { component, http, router } = setup();
    sessionStorage.setItem('oidc_state', 'original-state');
    sessionStorage.setItem('oidc_code_verifier', 'original-verifier');
    await component.ngOnInit();
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not automatically restart after token exchange errors', async () => {
    const { component, http, router } = setup();
    sessionStorage.setItem('oidc_state', 'original-state');
    sessionStorage.setItem('oidc_code_verifier', 'original-verifier');
    http.post.mockReturnValue(throwError(() => new Error('token exchange failed')));
    await component.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { error: 'OIDC Authentifizierung fehlgeschlagen' },
    });
  });

  it('drops external recovery targets', async () => {
    const { component, router } = setup();
    sessionStorage.setItem('oidc_redirect_url', '//external.example');
    await component.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { next: '/' },
      replaceUrl: true,
    });
  });
});
