import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { ApplicationTokensComponent } from './application-tokens.component';
import { ApplicationToken } from '../../core/models/api.models';

function createToken(overrides: Partial<ApplicationToken> = {}): ApplicationToken {
  return {
    id: 'token-1',
    name: 'Studio',
    tokenPrefix: 'ch_abc...',
    scopes: ['acp.read'],
    allowedAcpIds: null,
    active: true,
    expiresAt: null,
    lastUsedAt: null,
    createdByUserId: 'admin-1',
    revokedByUserId: null,
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ApplicationTokensComponent', () => {
  let api: {
    getApplicationTokens: ReturnType<typeof vi.fn>;
    createApplicationToken: ReturnType<typeof vi.fn>;
    revokeApplicationToken: ReturnType<typeof vi.fn>;
    getAcps: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getApplicationTokens: vi.fn().mockReturnValue(
        of({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        }),
      ),
      createApplicationToken: vi.fn(),
      revokeApplicationToken: vi.fn(),
      getAcps: vi.fn().mockReturnValue(of([])),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads application tokens on init', () => {
    api.getApplicationTokens.mockReturnValue(
      of({
        items: [createToken()],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    );

    const component = new ApplicationTokensComponent(api as any);
    component.ngOnInit();

    expect(api.getApplicationTokens).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(api.getAcps).toHaveBeenCalled();
    expect(component.tokens).toHaveLength(1);
    expect(component.total).toBe(1);
  });

  it('creates a token and stores the one-time secret', () => {
    const component = new ApplicationTokensComponent(api as any);
    component.newToken = {
      name: ' Studio ',
      expiresAtLocal: '',
      scopes: ['acp.read', 'files.read'],
      allowedAcpIds: [],
    };
    api.createApplicationToken.mockReturnValue(
      of({
        ...createToken({ name: 'Studio', scopes: ['acp.read', 'files.read'] }),
        token: 'ch_secret',
      }),
    );

    component.createToken();

    expect(api.createApplicationToken).toHaveBeenCalledWith({
      name: 'Studio',
      scopes: ['acp.read', 'files.read'],
      expiresAt: null,
      allowedAcpIds: null,
    });
    expect(component.createdToken?.token).toBe('ch_secret');
    expect(component.showCreate).toBe(false);
  });

  it('rejects create when name or scopes are missing', () => {
    const component = new ApplicationTokensComponent(api as any);
    component.newToken = { name: ' ', expiresAtLocal: '', scopes: ['acp.read'], allowedAcpIds: [] };

    component.createToken();

    expect(api.createApplicationToken).not.toHaveBeenCalled();
    expect(component.error).toContain('Name');

    component.error = '';
    component.newToken = { name: 'Studio', expiresAtLocal: '', scopes: [], allowedAcpIds: [] };
    component.createToken();

    expect(api.createApplicationToken).not.toHaveBeenCalled();
    expect(component.error).toContain('Berechtigung');
  });

  it('revokes the selected token', () => {
    const token = createToken();
    const component = new ApplicationTokensComponent(api as any);
    api.revokeApplicationToken.mockReturnValue(
      of(createToken({ active: false, revokedAt: '2026-01-01' })),
    );

    component.openRevokeDialog(token);
    component.confirmRevoke();

    expect(api.revokeApplicationToken).toHaveBeenCalledWith('token-1');
    expect(component.revokeDialogOpen).toBe(false);
    expect(component.message).toContain('widerrufen');
  });

  it('keeps revoke dialog open when revoke fails', () => {
    const component = new ApplicationTokensComponent(api as any);
    api.revokeApplicationToken.mockReturnValue(
      throwError(() => ({ error: { message: 'kaputt' } })),
    );

    component.openRevokeDialog(createToken());
    component.confirmRevoke();

    expect(component.revokeDialogOpen).toBe(true);
    expect(component.revokeDialogError).toBe('kaputt');
  });

  it('does not offer revoke for already revoked tokens', () => {
    const component = new ApplicationTokensComponent(api as any);
    const revoked = createToken({ active: false, revokedAt: '2026-01-01' });

    component.openRevokeDialog(revoked);

    expect(component.canRevoke(revoked)).toBe(false);
    expect(component.revokeDialogOpen).toBe(false);
  });

  it('maps status labels', () => {
    const component = new ApplicationTokensComponent(api as any);

    expect(component.statusLabel(createToken())).toBe('Aktiv');
    expect(component.statusLabel(createToken({ active: false }))).toBe('Widerrufen');
    expect(component.statusLabel(createToken({ expiresAt: '2000-01-01T00:00:00.000Z' }))).toBe(
      'Abgelaufen',
    );
  });
});
