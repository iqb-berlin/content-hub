import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import type { CredentialLoginResponse, UserProfile } from '../models/api.models';
import { PendingPersonalSessionStorageService } from './pending-personal-session-storage.service';

function createJwt(sub: string, type = 'user', acpId = ''): string {
  const payload = btoa(
    JSON.stringify({
      sub,
      type,
      acpId,
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
    acpRoles: [],
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
      const credentialToken = createJwt('credential-1', 'credential', 'acp1');
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

  describe('hasManagedAcps', () => {
    it('should return false when no user loaded', () => {
      expect(service.hasManagedAcps).toBe(false);
    });

    it('should return true for app admin', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({ ...mockUserProfile, isAppAdmin: true, acpRoles: [] }),
      );
      service.loadProfile();

      expect(service.hasManagedAcps).toBe(true);
    });

    it('should return true when user manages at least one ACP', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({
          ...mockUserProfile,
          isAppAdmin: false,
          acpRoles: [{ acpId: 'acp1', role: 'ACP_MANAGER' as const }],
        }),
      );
      service.loadProfile();

      expect(service.hasManagedAcps).toBe(true);
    });

    it('should safely return false when acpRoles are missing', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({
          ...mockUserProfile,
          isAppAdmin: false,
          acpRoles: undefined,
        }),
      );
      service.loadProfile();

      expect(service.hasManagedAcps).toBe(false);
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
        acpId: 'acp1',
        username: 'user',
      };
      httpClientMock.post.mockReturnValue(of(response));

      service.credentialLogin('acp1', 'user', 'pass').subscribe((res) => {
        expect(res).toEqual(response);
        expect(localStorage.getItem('ch_token')).toBe('cred-token');
        expect(localStorage.getItem('ch_auth_type')).toBe('credential');
      });

      expect(httpClientMock.post).toHaveBeenCalledWith('/api/auth/credential-login', {
        acpId: 'acp1',
        username: 'user',
        password: 'pass',
      });
    });

    it('should replace a previous OIDC session on credential login', () => {
      const credentialToken = createJwt('credential-1', 'credential', 'acp1');
      localStorage.setItem('ch_auth_type', 'oidc');
      localStorage.setItem('ch_oidc_id_token', 'id-token');
      localStorage.setItem('ch_oidc_access_token', 'access-token');
      localStorage.setItem('ch_oidc_refresh_token', 'refresh-token');
      httpClientMock.post.mockReturnValue(
        of({
          accessToken: credentialToken,
          acpId: 'acp1',
          username: 'reader',
        } satisfies CredentialLoginResponse),
      );

      service.credentialLogin('acp1', 'reader', 'pass').subscribe();

      expect(localStorage.getItem('ch_auth_type')).toBe('credential');
      expect(localStorage.getItem('ch_oidc_id_token')).toBeNull();
      expect(localStorage.getItem('ch_oidc_access_token')).toBeNull();
      expect(localStorage.getItem('ch_oidc_refresh_token')).toBeNull();
    });

    it('discards snapshots owned by another identity without an active explorer', () => {
      const userAToken = createJwt('user-a');
      const credentialBToken = createJwt('credential-b', 'credential', 'acp2');
      const userAIdentity = pendingPersonalSessionStorage.resolveIdentityFromToken(userAToken);
      pendingPersonalSessionStorage.set(
        'ch_item_explorer_pending_personal:acp1',
        JSON.stringify({ identity: userAIdentity, updates: [] }),
      );
      httpClientMock.post.mockReturnValue(
        of({
          accessToken: credentialBToken,
          acpId: 'acp2',
          username: 'reader-b',
        } satisfies CredentialLoginResponse),
      );

      service.credentialLogin('acp2', 'reader-b', 'pass').subscribe();

      expect(
        pendingPersonalSessionStorage.get('ch_item_explorer_pending_personal:acp1'),
      ).toBeNull();
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

  describe('hasAcpRole', () => {
    it('should return false when not logged in', () => {
      expect(service.hasAcpRole('acp1', 'admin')).toBe(false);
    });

    it('should return true for app admin', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({ ...mockUserProfile, isAppAdmin: true, acpRoles: [] }),
      );
      service.loadProfile();

      expect(service.hasAcpRole('acp1', 'any-role')).toBe(true);
    });

    it('should check specific ACP role', () => {
      localStorage.setItem('ch_token', 'test-token');
      httpClientMock.get.mockReturnValue(
        of({
          ...mockUserProfile,
          isAppAdmin: false,
          acpRoles: [{ acpId: 'acp1', role: 'ACP_MANAGER' as const }],
        }),
      );
      service.loadProfile();

      expect(service.hasAcpRole('acp1', 'ACP_MANAGER')).toBe(true);
      expect(service.hasAcpRole('acp1', 'READ_ONLY')).toBe(false);
      expect(service.hasAcpRole('acp2', 'ACP_MANAGER')).toBe(false);
    });
  });
});
