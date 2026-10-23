import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('PendingPersonalSessionStorageService', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses its in-memory copy when session storage is unavailable', () => {
    sessionStorage.setItem('pending', '{"value":"old"}');
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    const service = new PendingPersonalSessionStorageService();

    expect(service.get('unread')).toBeNull();
    expect(sessionStorage.getItem).toHaveBeenCalledWith('unread');
    service.set('pending', '{"value":1}');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('pending', '{"value":1}');

    expect(service.get('pending')).toBe('{"value":1}');
    service.remove('pending');
    expect(service.get('pending')).toBeNull();
  });

  it('removes snapshots owned by another activated identity', () => {
    const service = new PendingPersonalSessionStorageService();
    const userAIdentity = service.resolveIdentityFromToken(createJwt('user-a'));
    const userBToken = createJwt('user-b');
    const userBIdentity = service.resolveIdentityFromToken(userBToken);
    const userAKey = 'cp_item_explorer_pending_personal:acp-a';
    const userBKey = 'cp_item_explorer_pending_personal:acp-b';
    service.set(userAKey, JSON.stringify({ identity: userAIdentity, updates: [] }));
    service.set(userBKey, JSON.stringify({ identity: userBIdentity, updates: [] }));

    service.activateIdentityFromToken(userBToken);

    expect(service.get(userAKey)).toBeNull();
    expect(service.get(userBKey)).not.toBeNull();
  });

  it('keeps a local-user snapshot when the same user activates an OIDC session', () => {
    const service = new PendingPersonalSessionStorageService();
    const localUserToken = createJwt('user-a', 'user');
    const oidcUserToken = createJwt('user-a', 'oidc');
    const snapshotKey = 'cp_item_explorer_pending_personal:acp-a';
    service.set(
      snapshotKey,
      JSON.stringify({
        identity: service.resolveIdentityFromToken(localUserToken),
        updates: [],
      }),
    );

    service.activateIdentityFromToken(oidcUserToken);

    expect(service.get(snapshotKey)).not.toBeNull();
    expect(service.resolveIdentityFromToken(localUserToken)).toBe(
      service.resolveIdentityFromToken(oidcUserToken),
    );
  });

  it('removes a local-user snapshot when a different OIDC user activates', () => {
    const service = new PendingPersonalSessionStorageService();
    const localUserToken = createJwt('user-a', 'user');
    const oidcUserToken = createJwt('user-b', 'oidc');
    const snapshotKey = 'cp_item_explorer_pending_personal:acp-a';
    service.set(
      snapshotKey,
      JSON.stringify({
        identity: service.resolveIdentityFromToken(localUserToken),
        updates: [],
      }),
    );

    service.activateIdentityFromToken(oidcUserToken);

    expect(service.get(snapshotKey)).toBeNull();
  });

  it('keeps credential identities separated by ACP', () => {
    const service = new PendingPersonalSessionStorageService();

    expect(
      service.resolveIdentityFromToken(createJwt('credential-1', 'credential', 'acp-a')),
    ).not.toBe(service.resolveIdentityFromToken(createJwt('credential-1', 'credential', 'acp-b')));
  });
  it('does not resurrect a removed snapshot when browser deletion fails', () => {
    sessionStorage.setItem('pending', 'stale');
    const service = new PendingPersonalSessionStorageService();
    const remove = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    service.remove('pending');
    expect(remove).toHaveBeenCalledWith('pending');
    expect(sessionStorage.getItem('pending')).toBe('stale');
    expect(service.get('pending')).toBeNull();
    remove.mockRestore();
    service.set('pending', 'new');
    expect(service.get('pending')).toBe('new');
  });

  it('removes another identity from memory even when browser enumeration fails', () => {
    const service = new PendingPersonalSessionStorageService();
    const key = 'cp_item_explorer_pending_personal:acp-a';
    service.set(
      key,
      JSON.stringify({ identity: service.resolveIdentityFromToken(createJwt('a')) }),
    );
    const enumerate = vi.spyOn(sessionStorage, 'key').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    service.activateIdentityFromToken(createJwt('b'));
    expect(enumerate).toHaveBeenCalled();
    expect(service.get(key)).toBeNull();
  });

  it.each(['{broken', '{}', '{"identity":42}', ''])('removes corrupt snapshots: %s', (raw) => {
    const key = 'cp_item_explorer_pending_personal:acp-a';
    sessionStorage.setItem(key, raw);
    const service = new PendingPersonalSessionStorageService();
    service.activateIdentityFromToken(createJwt('user-a'));
    expect(service.get(key)).toBeNull();
  });

  it.each([null, '', 'invalid', 'header.%%%.signature', createJwt('  ')])(
    'ignores invalid identity tokens without deleting recoverable changes: %s',
    (token) => {
      const service = new PendingPersonalSessionStorageService();
      const key = 'cp_item_explorer_pending_personal:acp-a';
      service.set(key, 'recoverable');
      expect(service.resolveIdentityFromToken(token)).toBeNull();
      service.activateIdentityFromToken(token);
      expect(service.get(key)).toBe('recoverable');
    },
  );

  it('does not activate an expired identity', () => {
    const service = new PendingPersonalSessionStorageService();
    const token = `header.${btoa(JSON.stringify({ sub: 'a', exp: 1 }))}.signature`;
    expect(service.resolveIdentityFromToken(token)).toBeNull();
  });
});
