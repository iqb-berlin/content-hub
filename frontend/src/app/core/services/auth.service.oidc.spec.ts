import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { LoginResponse, OidcConfig, UserProfile } from '../models/api.models';
import { AuthService } from './auth.service';
import { BYPASS_APP_AUTH } from '../interceptors/auth-context.tokens';
import { PendingPersonalSessionStorageService } from './pending-personal-session-storage.service';

describe('AuthService OIDC and Crypto Paths', () => {
  let service: AuthService;
  let httpClientMock: {
    post: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  const profile: UserProfile = {
    id: 'u-1',
    username: 'julian',
    displayName: 'Julian',
    isAppAdmin: false,
    acpRoles: [],
  };

  const oidcConfig: OidcConfig = {
    enabled: true,
    issuerUrl: 'https://id.example.com',
    clientId: 'client-web',
    redirectUri: 'http://localhost:4200/auth/callback',
    scope: 'openid profile email',
  };

  const createJwt = (expiresInSeconds: number) => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const payload = btoa(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    return `${header}.${payload}.sig`;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();

    class BroadcastChannelMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = vi.fn();
    }

    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);
    vi.stubGlobal('btoa', (input: string) => Buffer.from(input, 'binary').toString('base64'));
    vi.stubGlobal('TextEncoder', TextEncoder);

    const subtleDigest = vi.fn().mockImplementation(async (_algo: string, data: ArrayBuffer) => {
      const bytes = new Uint8Array(data);
      const out = new Uint8Array(32);
      for (let i = 0; i < out.length; i++) {
        out[i] = bytes[i % Math.max(bytes.length, 1)] ^ 0xaa;
      }
      return out.buffer;
    });

    vi.stubGlobal('crypto', {
      subtle: {
        digest: subtleDigest,
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 17 + 13) % 256;
        return arr;
      },
    });

    httpClientMock = {
      get: vi.fn().mockReturnValue(of(oidcConfig)),
      post: vi.fn().mockImplementation((url: string) => {
        if (url === '/api/auth/oidc-callback') {
          return of({
            accessToken: 'app-jwt',
            user: profile,
          } as LoginResponse);
        }
        if (url === '/api/auth/sync-oidc-roles') {
          return of({
            accessToken: 'refreshed-jwt',
            user: profile,
          } as LoginResponse);
        }
        return of({});
      }),
    };

    service = new AuthService(httpClientMock as any, new PendingPersonalSessionStorageService());
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('loads the OIDC configuration endpoint', () => {
    service.getOidcConfig().subscribe();

    expect(httpClientMock.get).toHaveBeenCalledWith('/api/auth/oidc-config');
  });

  it('marks OIDC users from auth type flag', () => {
    expect(service.isOidcUser).toBe(false);
    localStorage.setItem('ch_auth_type', 'oidc');
    expect(service.isOidcUser).toBe(true);
  });

  it('stores redirect target and rejects when Keycloak is disabled', async () => {
    httpClientMock.get.mockReturnValueOnce(of({ ...oidcConfig, enabled: false }));

    await expect(service.initiateOidcLogin('/admin')).rejects.toThrow(
      'Die Keycloak-Anmeldung ist nicht konfiguriert.',
    );

    expect(sessionStorage.getItem('oidc_redirect_url')).toBe('/admin');
  });

  it('clears a stale redirect target when a new login has no target', async () => {
    sessionStorage.setItem('oidc_redirect_url', '/stale');
    httpClientMock.get.mockReturnValueOnce(of({ ...oidcConfig, enabled: false }));

    await expect(service.initiateOidcLogin()).rejects.toThrow();

    expect(sessionStorage.getItem('oidc_redirect_url')).toBeNull();
  });

  it('reports a user-facing error when the OIDC configuration cannot be loaded', async () => {
    httpClientMock.get.mockReturnValueOnce(throwError(() => new Error('network details')));

    await expect(service.initiateOidcLogin()).rejects.toThrow(
      'Die Keycloak-Konfiguration konnte nicht geladen werden.',
    );
  });

  it('rejects authorization code flow for invalid state', async () => {
    await expect(
      firstValueFrom(service.handleOidcAuthorizationCode('code-1', null)),
    ).rejects.toThrow('Ungültiger OIDC-State');
  });

  it('rejects authorization code flow when verifier is missing', async () => {
    sessionStorage.setItem('oidc_state', 'state-1');

    await expect(
      firstValueFrom(service.handleOidcAuthorizationCode('code-1', 'state-1')),
    ).rejects.toThrow('PKCE-Verifier fehlt');
  });

  it('rejects authorization code flow when OIDC config is incomplete', async () => {
    sessionStorage.setItem('oidc_state', 'state-1');
    sessionStorage.setItem('oidc_code_verifier', 'verifier-1');
    httpClientMock.get.mockReturnValueOnce(of({ ...oidcConfig, enabled: false }));

    await expect(
      firstValueFrom(service.handleOidcAuthorizationCode('code-1', 'state-1')),
    ).rejects.toThrow('OIDC ist nicht konfiguriert');
  });

  it('rejects authorization code flow when token response has no usable token', async () => {
    sessionStorage.setItem('oidc_state', 'state-1');
    sessionStorage.setItem('oidc_code_verifier', 'verifier-1');
    httpClientMock.get.mockReturnValueOnce(of(oidcConfig));
    httpClientMock.post.mockImplementation((url: string) => {
      if (url.includes('/protocol/openid-connect/token')) {
        return of({} as any);
      }
      return of({ accessToken: 'ignored', user: profile } as LoginResponse);
    });

    await expect(
      firstValueFrom(service.handleOidcAuthorizationCode('code-1', 'state-1')),
    ).rejects.toThrow('Kein Token aus OIDC-Antwort erhalten');
  });

  it('completes authorization code flow and stores app + OIDC tokens', async () => {
    sessionStorage.setItem('oidc_state', 'state-1');
    sessionStorage.setItem('oidc_code_verifier', 'verifier-1');
    httpClientMock.get.mockReturnValueOnce(of(oidcConfig));
    httpClientMock.post.mockImplementation((url: string) => {
      if (url.includes('/protocol/openid-connect/token')) {
        return of({
          access_token: 'oidc-access',
          id_token: 'oidc-id',
          refresh_token: 'oidc-refresh',
        });
      }
      if (url === '/api/auth/oidc-callback') {
        return of({
          accessToken: 'app-jwt',
          user: profile,
        } as LoginResponse);
      }
      return of({});
    });

    const result = await firstValueFrom(service.handleOidcAuthorizationCode('code-1', 'state-1'));

    expect(result).toEqual({ accessToken: 'app-jwt', user: profile });
    expect(localStorage.getItem('ch_token')).toBe('app-jwt');
    expect(localStorage.getItem('ch_oidc_access_token')).toBe('oidc-access');
    expect(localStorage.getItem('ch_oidc_id_token')).toBe('oidc-id');
    expect(localStorage.getItem('ch_oidc_refresh_token')).toBe('oidc-refresh');
    expect(localStorage.getItem('ch_auth_type')).toBe('oidc');
    expect(sessionStorage.getItem('oidc_state')).toBeNull();
    expect(sessionStorage.getItem('oidc_code_verifier')).toBeNull();
    expect(service.currentUser).toEqual(profile);
    const tokenRequest = httpClientMock.post.mock.calls.find(([url]) =>
      String(url).includes('/protocol/openid-connect/token'),
    );
    expect(tokenRequest?.[2]?.context.get(BYPASS_APP_AUTH)).toBe(true);
  });

  it('supports direct oidc callback and id-token fallback persistence', async () => {
    const result = await firstValueFrom(service.handleOidcCallback('id-token-only'));

    expect(result).toEqual({ accessToken: 'app-jwt', user: profile });
    expect(localStorage.getItem('ch_oidc_id_token')).toBe('id-token-only');
    expect(localStorage.getItem('ch_auth_type')).toBe('oidc');
    expect(service.currentUser).toEqual(profile);
  });

  it('does not trigger password flow for non-oidc users', () => {
    const getOidcSpy = vi.spyOn(service, 'getOidcConfig');
    localStorage.removeItem('ch_auth_type');

    service.changePassword();

    expect(getOidcSpy).not.toHaveBeenCalled();
  });

  it('prepares password-change flow for oidc users', () => {
    localStorage.setItem('ch_auth_type', 'oidc');
    sessionStorage.removeItem('oidc_redirect_url');
    httpClientMock.get.mockReturnValue(of(oidcConfig));

    service.changePassword();

    expect(sessionStorage.getItem('oidc_redirect_url')).toBe(
      window.location.pathname + window.location.search,
    );
  });

  it('loads profile using OIDC sync path', () => {
    localStorage.setItem('ch_auth_type', 'oidc');
    localStorage.setItem('ch_oidc_id_token', 'id-token');
    const syncSpy = vi.spyOn(service, 'syncOidcRoles').mockReturnValue(of(profile));

    service.loadProfile();

    expect(syncSpy).toHaveBeenCalledWith('id-token');
    expect(service.currentUser).toEqual(profile);
  });

  it('logs out on OIDC sync failure during profile load', () => {
    localStorage.setItem('ch_auth_type', 'oidc');
    localStorage.setItem('ch_oidc_id_token', 'id-token');
    vi.spyOn(service, 'syncOidcRoles').mockReturnValue(throwError(() => new Error('sync failed')));
    const logoutSpy = vi.spyOn(service, 'logout').mockImplementation(() => undefined);

    service.loadProfile();

    expect(logoutSpy).toHaveBeenCalled();
  });

  it('syncOidcRoles refreshes app token and normalizes missing acpRoles', async () => {
    httpClientMock.post.mockReturnValueOnce(
      of({
        accessToken: 'new-jwt',
        user: {
          ...profile,
          acpRoles: undefined,
        },
      } as LoginResponse),
    );

    const result = await firstValueFrom(service.syncOidcRoles('id-token'));

    expect(localStorage.getItem('ch_token')).toBe('new-jwt');
    expect(result.acpRoles).toEqual([]);
  });

  it('handles OIDC logout branch and clears local/session state without broadcast', () => {
    localStorage.setItem('ch_token', 'jwt');
    localStorage.setItem('ch_auth_type', 'oidc');
    localStorage.setItem('ch_oidc_id_token', 'id-token');
    localStorage.setItem('ch_oidc_access_token', 'access-token');
    localStorage.setItem('ch_oidc_refresh_token', 'refresh-token');
    sessionStorage.setItem('oidc_redirect_url', '/admin');
    sessionStorage.setItem('oidc_state', 'state-x');
    sessionStorage.setItem('oidc_code_verifier', 'verifier-x');
    const redirectSpy = vi
      .spyOn(service as any, 'redirectToKeycloakLogout')
      .mockImplementation(() => undefined);

    service.logout(false);

    expect(httpClientMock.post).toHaveBeenCalledWith('/api/auth/logout', {});
    expect(redirectSpy).toHaveBeenCalledWith('id-token');
    expect(localStorage.getItem('ch_token')).toBeNull();
    expect(localStorage.getItem('ch_oidc_id_token')).toBeNull();
    expect(localStorage.getItem('ch_oidc_access_token')).toBeNull();
    expect(localStorage.getItem('ch_oidc_refresh_token')).toBeNull();
    expect(localStorage.getItem('ch_auth_type')).toBeNull();
    expect(sessionStorage.getItem('oidc_redirect_url')).toBeNull();
    expect(sessionStorage.getItem('oidc_state')).toBeNull();
    expect(sessionStorage.getItem('oidc_code_verifier')).toBeNull();
  });

  it('uses the installer-approved login URL for the Keycloak logout redirect', () => {
    const navigateSpy = vi
      .spyOn(service as any, 'navigateBrowserTo')
      .mockImplementation(() => undefined);

    (service as any).redirectToKeycloakLogout('id-token');

    const logoutUrl = new URL(navigateSpy.mock.calls[0][0]);
    expect(logoutUrl.pathname).toBe('/protocol/openid-connect/logout');
    expect(logoutUrl.searchParams.get('post_logout_redirect_uri')).toBe(
      `${window.location.origin}/login`,
    );
    expect(logoutUrl.searchParams.get('client_id')).toBe(oidcConfig.clientId);
    expect(logoutUrl.searchParams.get('id_token_hint')).toBe('id-token');
  });

  it('falls back to the public start page when the logout configuration cannot be loaded', () => {
    httpClientMock.get.mockReturnValueOnce(throwError(() => new Error('network failure')));
    const navigateSpy = vi
      .spyOn(service as any, 'navigateBrowserTo')
      .mockImplementation(() => undefined);

    (service as any).redirectToKeycloakLogout('id-token');

    expect(navigateSpy).toHaveBeenCalledWith(`${window.location.origin}/`);
  });

  it('falls back to the public start page when Keycloak logout is not configured', () => {
    httpClientMock.get.mockReturnValueOnce(of({ ...oidcConfig, enabled: false }));
    const navigateSpy = vi
      .spyOn(service as any, 'navigateBrowserTo')
      .mockImplementation(() => undefined);

    (service as any).redirectToKeycloakLogout('id-token');

    expect(navigateSpy).toHaveBeenCalledWith(`${window.location.origin}/`);
  });

  it('restores an OIDC session by refreshing tokens when the app token is missing', async () => {
    localStorage.setItem('ch_auth_type', 'oidc');
    localStorage.setItem('ch_oidc_access_token', createJwt(600));
    localStorage.setItem('ch_oidc_id_token', createJwt(600));
    localStorage.setItem('ch_oidc_refresh_token', 'refresh-1');

    httpClientMock.post.mockImplementation((url: string) => {
      if (url.includes('/protocol/openid-connect/token')) {
        return of({
          access_token: 'new-oidc-access',
          id_token: 'new-oidc-id',
          refresh_token: 'refresh-2',
        });
      }
      if (url === '/api/auth/oidc-callback') {
        return of({
          accessToken: 'app-jwt',
          user: profile,
        } as LoginResponse);
      }
      return of({});
    });

    service.initFromStorage();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(localStorage.getItem('ch_token')).toBe('app-jwt');
    expect(localStorage.getItem('ch_oidc_access_token')).toBe('new-oidc-access');
    expect(localStorage.getItem('ch_oidc_id_token')).toBe('new-oidc-id');
    expect(localStorage.getItem('ch_oidc_refresh_token')).toBe('refresh-2');
    expect(service.currentUser).toEqual(profile);
  });

  it('refreshes OIDC tokens automatically before expiry', async () => {
    localStorage.setItem('ch_auth_type', 'oidc');
    localStorage.setItem('ch_oidc_access_token', createJwt(30));
    localStorage.setItem('ch_oidc_id_token', createJwt(30));
    localStorage.setItem('ch_oidc_refresh_token', 'refresh-1');

    httpClientMock.post.mockImplementation((url: string) => {
      if (url.includes('/protocol/openid-connect/token')) {
        return of({
          access_token: 'rotated-access',
          id_token: 'rotated-id',
          refresh_token: 'refresh-2',
        });
      }
      if (url === '/api/auth/oidc-callback') {
        return of({
          accessToken: 'rotated-app-jwt',
          user: profile,
        } as LoginResponse);
      }
      return of({});
    });

    await firstValueFrom(
      service.handleOidcCallback(createJwt(30), createJwt(30), createJwt(30), 'refresh-1'),
    );

    await vi.advanceTimersByTimeAsync(1);

    expect(localStorage.getItem('ch_token')).toBe('rotated-app-jwt');
    expect(localStorage.getItem('ch_oidc_access_token')).toBe('rotated-access');
    expect(localStorage.getItem('ch_oidc_id_token')).toBe('rotated-id');
    expect(localStorage.getItem('ch_oidc_refresh_token')).toBe('refresh-2');
  });

  it('retries token refresh with the latest refresh token after a parallel rotation', async () => {
    localStorage.setItem('ch_auth_type', 'oidc');
    localStorage.setItem('ch_oidc_access_token', createJwt(30));
    localStorage.setItem('ch_oidc_id_token', createJwt(30));
    localStorage.setItem('ch_oidc_refresh_token', 'refresh-1');

    let refreshAttempts = 0;
    httpClientMock.post.mockImplementation((url: string, body?: string, options?: any) => {
      if (url.includes('/protocol/openid-connect/token')) {
        refreshAttempts += 1;
        expect(options?.context.get(BYPASS_APP_AUTH)).toBe(true);

        if (refreshAttempts === 1) {
          expect(body).toContain('refresh_token=refresh-1');
          localStorage.setItem('ch_oidc_refresh_token', 'refresh-2');
          return throwError(() => new Error('stale refresh token'));
        }

        expect(body).toContain('refresh_token=refresh-2');
        return of({
          access_token: 'rotated-access-2',
          id_token: 'rotated-id-2',
          refresh_token: 'refresh-3',
        });
      }
      if (url === '/api/auth/oidc-callback') {
        return of({
          accessToken: 'rotated-app-jwt-2',
          user: profile,
        } as LoginResponse);
      }
      return of({});
    });

    const refreshed = await service.refreshOidcSession();

    expect(refreshed).toBe(true);
    expect(refreshAttempts).toBe(2);
    expect(localStorage.getItem('ch_token')).toBe('rotated-app-jwt-2');
    expect(localStorage.getItem('ch_oidc_access_token')).toBe('rotated-access-2');
    expect(localStorage.getItem('ch_oidc_id_token')).toBe('rotated-id-2');
    expect(localStorage.getItem('ch_oidc_refresh_token')).toBe('refresh-3');
  });

  it('exercises base64url, sha256 and challenge generation (subtle + fallback)', async () => {
    const base64 = (service as any).base64UrlEncode(new Uint8Array([251, 255, 254]));
    expect(base64).toBe('-__-');

    const hash = (service as any).sha256(new TextEncoder().encode('abc'));
    const hashHex = Array.from(hash)
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hashHex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    const challengeWithSubtle = await (service as any).generateCodeChallenge('verifier-subtle');
    expect(challengeWithSubtle).toMatch(/^[A-Za-z0-9_-]+$/);

    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => arr.fill(1),
    });
    const challengeFallback = await (service as any).generateCodeChallenge('verifier-fallback');
    expect(challengeFallback).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates random values via crypto.getRandomValues', () => {
    const value = (service as any).generateRandomValue(16);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
