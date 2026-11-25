import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from './auth.service';
import type { CredentialLoginResponse, UserProfile } from '../models/api.models';
import { PendingPersonalSessionStorageService } from './pending-personal-session-storage.service';

function createJwt(sub: string, type = 'user', apId = ''): string {
  const payload = btoa(
    JSON.stringify({
      sub,
      type,
      apId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('AuthService', () => {
  let service: AuthService;
  let httpClientMock: {
    post: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let broadcastChannelMock: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
  };
  let pendingPersonalSessionStorage: PendingPersonalSessionStorageService;

  const mockUserProfile: UserProfile = {
    id: '1',
    username: 'testuser',
    displayName: 'Test User',
    isAppAdmin: true,
    apRoles: [],
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();

    broadcastChannelMock = {
      postMessage: vi.fn(),
      onmessage: null,
    };

    class BroadcastChannelMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = broadcastChannelMock.postMessage;
      constructor() {
        setTimeout(() => {
          broadcastChannelMock = this as any;
        }, 0);
      }
    }

    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);

    httpClientMock = {
      post: vi.fn().mockReturnValue(of({})),
      get: vi.fn().mockReturnValue(of(mockUserProfile)),
    };
    pendingPersonalSessionStorage = new PendingPersonalSessionStorageService();
    service = new AuthService(httpClientMock as any, pendingPersonalSessionStorage);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initFromStorage', () => {
    it('should not load profile during construction, even when token exists', () => {
      localStorage.setItem('ch_token', 'persisted-token');
      const localHttpMock = {
        post: vi.fn().mockReturnValue(of({})),
        get: vi.fn().mockReturnValue(of(mockUserProfile)),
      };

      const constructedService = new AuthService(
        localHttpMock as any,
        pendingPersonalSessionStorage,
      );

      expect(localHttpMock.get).not.toHaveBeenCalled();
      expect(constructedService.currentUser).toBeNull();
    });

    it('should load profile when token exists in storage', () => {
      localStorage.setItem('ch_token', 'persisted-token');
      httpClientMock.get.mockReturnValue(of(mockUserProfile));

      service.initFromStorage();

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/auth/profile');
      expect(service.currentUser).toEqual(mockUserProfile);
    });

    it('should restore credential tokens without loading a user profile', () => {
      const credentialToken = createJwt('credential-1', 'credential', 'ap1');
      localStorage.setItem('ch_token', credentialToken);
      localStorage.setItem('ch_auth_type', 'oidc');
      localStorage.setItem('ch_oidc_id_token', 'stale-id-token');
      localStorage.setItem('ch_oidc_access_token', 'stale-access-token');
      localStorage.setItem('ch_oidc_refresh_token', 'stale-refresh-token');

      service.initFromStorage();

      expect(httpClientMock.get).not.toHaveBeenCalled();
      expect(localStorage.getItem('ch_token')).toBe(credentialToken);
      expect(localStorage.getItem('ch_auth_type')).toBe('credential');
      expect(localStorage.getItem('ch_oidc_id_token')).toBeNull();
      expect(localStorage.getItem('ch_oidc_access_token')).toBeNull();
      expect(localStorage.getItem('ch_oidc_refresh_token')).toBeNull();
      expect(service.isLoggedIn).toBe(true);
      expect(service.currentUser).toBeNull();
    });

    it('should skip profile load when no token exists in storage', () => {
      localStorage.removeItem('ch_token');

      service.initFromStorage();

      expect(httpClientMock.get).not.toHaveBeenCalled();
    });

    it('clears legacy local sessions immediately', () => {
      localStorage.setItem('ch_token', 'legacy-token');
      localStorage.setItem('ch_auth_type', 'local');

      service.initFromStorage();

      expect(localStorage.getItem('ch_token')).toBeNull();
      expect(localStorage.getItem('ch_auth_type')).toBeNull();
      expect(httpClientMock.get).not.toHaveBeenCalled();
    });
  });

  describe('getToken', () => {
    it('should return null when no token in localStorage', () => {
      expect(service.getToken()).toBeNull();
    });

    it('should return token from localStorage', () => {
      localStorage.setItem('ch_token', 'test-token');
      expect(service.getToken()).toBe('test-token');
    });
  });

  describe('isLoggedIn', () => {
    it('should return false when no token', () => {
      expect(service.isLoggedIn).toBe(false);
    });

    it('should return true when token exists', () => {
      localStorage.setItem('ch_token', 'test-token');
      expect(service.isLoggedIn).toBe(true);
    });
  });

  describe('isAdmin', () => {
    it('should return false when no user loaded', () => {
      expect(service.isAdmin).toBe(false);
    });
  });

  describe('hasManagedAps', () => {
    it('should return false when no user loaded', () => {
      expect(service.hasManagedAps).toBe(false);
    });

    it('should return true for app admin', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(of({ ...mockUserProfile, isAppAdmin: true, apRoles: [] }));
      service.loadProfile();

      expect(service.hasManagedAps).toBe(true);
    });

    it('should return true when user manages at least one AP', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({
          ...mockUserProfile,
          isAppAdmin: false,
          apRoles: [{ apId: 'ap1', role: 'AP_MANAGER' as const }],
        }),
      );
      service.loadProfile();

      expect(service.hasManagedAps).toBe(true);
    });

    it('should safely return false when apRoles are missing', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({
          ...mockUserProfile,
          isAppAdmin: false,
          apRoles: undefined,
        }),
      );
      service.loadProfile();

      expect(service.hasManagedAps).toBe(false);
    });
  });

  describe('currentUser', () => {
    it('should return null when no user loaded', () => {
      expect(service.currentUser).toBeNull();
    });
  });

  describe('credentialLogin', () => {
    it('should store token on successful credential login', () => {
      const response: CredentialLoginResponse = {
        accessToken: 'cred-token',
        apId: 'ap1',
        username: 'user',
      };
      httpClientMock.post.mockReturnValue(of(response));

      service.credentialLogin('ap1', 'user', 'pass').subscribe((res) => {
        expect(res).toEqual(response);
        expect(localStorage.getItem('ch_token')).toBe('cred-token');
        expect(localStorage.getItem('ch_auth_type')).toBe('credential');
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/auth/credential-login', {
        apId: 'ap1',
        username: 'user',
        password: 'pass',
      });
    });

    it('should replace a previous OIDC session on credential login', () => {
      const credentialToken = createJwt('credential-1', 'credential', 'ap1');
      localStorage.setItem('ch_auth_type', 'oidc');
      localStorage.setItem('ch_oidc_id_token', 'id-token');
      localStorage.setItem('ch_oidc_access_token', 'access-token');
      localStorage.setItem('ch_oidc_refresh_token', 'refresh-token');
      httpClientMock.post.mockReturnValue(
        of({
          accessToken: credentialToken,
          apId: 'ap1',
          username: 'reader',
        } satisfies CredentialLoginResponse),
      );

      service.credentialLogin('ap1', 'reader', 'pass').subscribe();

      expect(localStorage.getItem('ch_auth_type')).toBe('credential');
      expect(localStorage.getItem('ch_oidc_id_token')).toBeNull();
      expect(localStorage.getItem('ch_oidc_access_token')).toBeNull();
      expect(localStorage.getItem('ch_oidc_refresh_token')).toBeNull();
    });

    it('discards snapshots owned by another identity without an active explorer', () => {
      const userAToken = createJwt('user-a');
      const credentialBToken = createJwt('credential-b', 'credential', 'ap2');
      const userAIdentity = pendingPersonalSessionStorage.resolveIdentityFromToken(userAToken);
      pendingPersonalSessionStorage.set(
        'ch_item_explorer_pending_personal:ap1',
        JSON.stringify({ identity: userAIdentity, updates: [] }),
      );
      httpClientMock.post.mockReturnValue(
        of({
          accessToken: credentialBToken,
          apId: 'ap2',
          username: 'reader-b',
        } satisfies CredentialLoginResponse),
      );

      service.credentialLogin('ap2', 'reader-b', 'pass').subscribe();

      expect(pendingPersonalSessionStorage.get('ch_item_explorer_pending_personal:ap1')).toBeNull();
    });
  });

  describe('logout', () => {
    it('should remove token and clear user', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.post.mockReturnValue(of({}));

      service.logout();

      expect(localStorage.getItem('ch_token')).toBeNull();
    });

    it('should call backend logout endpoint', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.post.mockReturnValue(of({}));

      service.logout();

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/auth/logout', {});
    });

    it('should clear OIDC redirect URL from sessionStorage', () => {
      localStorage.setItem('ch_token', 'test-token');
      sessionStorage.setItem('oidc_redirect_url', '/some-path');
      httpClientMock.post.mockReturnValue(of({}));

      service.logout();

      expect(sessionStorage.getItem('oidc_redirect_url')).toBeNull();
    });

    it('should broadcast logout to other tabs', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.post.mockReturnValue(of({}));

      service.logout();

      expect(broadcastChannelMock.postMessage).toHaveBeenCalledWith({ type: 'logout' });
    });
  });

  describe('loadProfile', () => {
    it.each([
      { status: 0, oidc: false },
      { status: 500, oidc: false },
      { status: 503, oidc: true },
      { status: 0, oidc: true },
      { status: 401, oidc: false },
      { status: 403, oidc: true },
    ])(
      'keeps a public task open when optional profile restoration fails: %j',
      ({ status, oidc }) => {
        const originalUrl = `${window.location.pathname}${window.location.search}`;
        window.history.replaceState(null, '', '/public/task/publication-id');
        try {
          localStorage.setItem('ch_token', 'test-token');
          localStorage.setItem('ch_auth_type', 'oidc');
          if (oidc) localStorage.setItem('ch_oidc_id_token', 'id-token');
          const failure = throwError(() => new HttpErrorResponse({ status }));
          httpClientMock.get.mockReturnValue(failure);
          httpClientMock.post.mockReturnValue(failure);
          const logout = vi.spyOn(service, 'logout');
          service.loadProfile();
          expect(logout).not.toHaveBeenCalled();
          expect(window.location.pathname).toBe('/public/task/publication-id');
          expect(localStorage.getItem('ch_token')).toBe(
            [401, 403].includes(status) ? null : 'test-token',
          );
          expect(httpClientMock.post).not.toHaveBeenCalledWith('/api/auth/logout', {});
        } finally {
          window.history.replaceState(null, '', originalUrl);
        }
      },
    );

    it('should load and set user profile', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(of(mockUserProfile));

      service.loadProfile();

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/auth/profile');
      expect(service.currentUser).toEqual(mockUserProfile);
      expect(service.isAdmin).toBe(true);
    });

    it('should logout on profile load error', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(throwError(() => new Error('Network error')));

      service.loadProfile();

      expect(httpClientMock.get).toHaveBeenCalledWith('/api/auth/profile');
      expect(localStorage.getItem('ch_token')).toBeNull();
    });
  });

  describe('hasApRole', () => {
    it('should return false when not logged in', () => {
      expect(service.hasApRole('ap1', 'admin')).toBe(false);
    });

    it('should return true for app admin', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(of({ ...mockUserProfile, isAppAdmin: true, apRoles: [] }));
      service.loadProfile();

      expect(service.hasApRole('ap1', 'any-role')).toBe(true);
    });

    it('should check specific AP role', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({
          ...mockUserProfile,
          isAppAdmin: false,
          apRoles: [{ apId: 'ap1', role: 'AP_MANAGER' as const }],
        }),
      );
      service.loadProfile();

      expect(service.hasApRole('ap1', 'AP_MANAGER')).toBe(true);
      expect(service.hasApRole('ap1', 'READ_ONLY')).toBe(false);
      expect(service.hasApRole('ap2', 'AP_MANAGER')).toBe(false);
    });
  });
});
