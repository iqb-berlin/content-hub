import { describe, expect, it } from 'vitest';
import { getApRoleLabel } from './ap-role-label.util';

describe('getApRoleLabel', () => {
  it('returns manager label for AP_MANAGER role', () => {
    expect(getApRoleLabel('AP_MANAGER', false)).toBe('Manager');
  });

  it('returns guest label for READ_ONLY role', () => {
    expect(getApRoleLabel('READ_ONLY', false)).toBe('Gast');
  });

  it('returns app-admin label for users without explicit AP role', () => {
    expect(getApRoleLabel(null, true)).toBe('App-Admin');
  });

  it('returns fallback label when no role is assigned', () => {
    expect(getApRoleLabel(undefined, false)).toBe('Zugriff gewährt');
  });
});
