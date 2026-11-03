import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateContentPoolStorage } from './legacy-storage.util';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Content Hub storage transition', () => {
  it('preserves sessions and unsaved personal work without replacing newer values', () => {
    localStorage.setItem('cp_token', 'previous-token');
    localStorage.setItem('ch_token', 'newer-token');
    localStorage.setItem('cp_oidc_refresh_token', 'refresh-token');
    sessionStorage.setItem('cp_item_explorer_pending_personal:acp-1', 'unsaved-work');
    sessionStorage.setItem('oidc_redirect_url', '/view/acp-1');

    migrateContentPoolStorage();
    migrateContentPoolStorage();

    expect(localStorage.getItem('ch_token')).toBe('newer-token');
    expect(localStorage.getItem('ch_oidc_refresh_token')).toBe('refresh-token');
    expect(localStorage.getItem('cp_oidc_refresh_token')).toBeNull();
    expect(sessionStorage.getItem('ch_item_explorer_pending_personal:acp-1')).toBe('unsaved-work');
    expect(sessionStorage.getItem('oidc_redirect_url')).toBe('/view/acp-1');
  });

  it('retains original data when writing a new key fails', () => {
    localStorage.setItem('cp_token', 'previous-token');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => migrateContentPoolStorage()).not.toThrow();
    expect(localStorage.getItem('cp_token')).toBe('previous-token');
  });
});
