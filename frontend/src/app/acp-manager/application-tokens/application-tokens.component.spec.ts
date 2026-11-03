import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { AcpApplicationTokensComponent } from './application-tokens.component';
import { ApplicationToken } from '../../core/models/api.models';

function createToken(overrides: Partial<ApplicationToken> = {}): ApplicationToken {
  return {
    id: 'token-1',
    name: 'Studio ACP',
    tokenPrefix: 'ch_abc...',
    scopes: ['acp.read'],
    allowedAcpIds: ['acp-1'],
    active: true,
    expiresAt: null,
    lastUsedAt: null,
    createdByUserId: 'manager-1',
    revokedByUserId: null,
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createRoute() {
  return {
    parent: {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('acp-1'),
        },
      },
    },
  };
}

describe('AcpApplicationTokensComponent', () => {
  let api: {
    getAcpApplicationTokens: ReturnType<typeof vi.fn>;
    createAcpApplicationToken: ReturnType<typeof vi.fn>;
    revokeAcpApplicationToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getAcpApplicationTokens: vi.fn().mockReturnValue(
        of({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        }),
      ),
      createAcpApplicationToken: vi.fn(),
      revokeAcpApplicationToken: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads ACP-limited application tokens on init', () => {
    api.getAcpApplicationTokens.mockReturnValue(
      of({
        items: [createToken()],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    );

    const component = new AcpApplicationTokensComponent(api as any, createRoute() as any);
    component.ngOnInit();

    expect(component.acpId).toBe('acp-1');
    expect(api.getAcpApplicationTokens).toHaveBeenCalledWith('acp-1', {
      limit: 50,
      offset: 0,
    });
    expect(component.tokens).toHaveLength(1);
    expect(component.total).toBe(1);
  });

  it('creates an ACP-scoped token and stores the one-time secret', () => {
    const component = new AcpApplicationTokensComponent(api as any, createRoute() as any);
    component.acpId = 'acp-1';
    component.newToken = {
      name: ' Studio ',
      expiresAtLocal: '',
      scopes: ['acp.read', 'files.read'],
    };
    api.createAcpApplicationToken.mockReturnValue(
      of({
        ...createToken({ name: 'Studio', scopes: ['acp.read', 'files.read'] }),
        token: 'ch_secret',
      }),
    );

    component.createToken();

    expect(api.createAcpApplicationToken).toHaveBeenCalledWith('acp-1', {
      name: 'Studio',
      scopes: ['acp.read', 'files.read'],
      expiresAt: null,
    });
    expect(component.createdToken?.token).toBe('ch_secret');
    expect(component.showCreate).toBe(false);
  });

  it('revokes the selected ACP-scoped token', () => {
    const component = new AcpApplicationTokensComponent(api as any, createRoute() as any);
    component.acpId = 'acp-1';
    api.revokeAcpApplicationToken.mockReturnValue(
      of(createToken({ active: false, revokedAt: '2026-01-01' })),
    );

    component.openRevokeDialog(createToken());
    component.confirmRevoke();

    expect(api.revokeAcpApplicationToken).toHaveBeenCalledWith('acp-1', 'token-1');
    expect(component.revokeDialogOpen).toBe(false);
    expect(component.message).toContain('widerrufen');
  });

  it('keeps revoke dialog open when revoking fails', () => {
    const component = new AcpApplicationTokensComponent(api as any, createRoute() as any);
    component.acpId = 'acp-1';
    api.revokeAcpApplicationToken.mockReturnValue(
      throwError(() => ({ error: { message: 'kaputt' } })),
    );

    component.openRevokeDialog(createToken());
    component.confirmRevoke();

    expect(component.revokeDialogOpen).toBe(true);
    expect(component.revokeDialogError).toBe('kaputt');
  });

  it('does not offer revoke for multi-ACP tokens', () => {
    const component = new AcpApplicationTokensComponent(api as any, createRoute() as any);
    component.acpId = 'acp-1';
    const multiAcpToken = createToken({ allowedAcpIds: ['acp-1', 'acp-2'] });

    component.openRevokeDialog(multiAcpToken);

    expect(component.canRevoke(multiAcpToken)).toBe(false);
    expect(component.revokeDialogOpen).toBe(false);
  });
});
