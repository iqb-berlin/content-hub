import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { ApApplicationTokensComponent } from './application-tokens.component';
import { ApplicationToken } from '../../core/models/api.models';

function createToken(overrides: Partial<ApplicationToken> = {}): ApplicationToken {
  return {
    id: 'token-1',
    name: 'Studio AP',
    tokenPrefix: 'ch_abc...',
    scopes: ['ap.read'],
    allowedApIds: ['ap-1'],
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
          get: vi.fn().mockReturnValue('ap-1'),
        },
      },
    },
  };
}

describe('ApApplicationTokensComponent', () => {
  let api: {
    getApApplicationTokens: ReturnType<typeof vi.fn>;
    createApApplicationToken: ReturnType<typeof vi.fn>;
    revokeApApplicationToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getApApplicationTokens: vi.fn().mockReturnValue(
        of({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        }),
      ),
      createApApplicationToken: vi.fn(),
      revokeApApplicationToken: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads AP-limited application tokens on init', () => {
    api.getApApplicationTokens.mockReturnValue(
      of({
        items: [createToken()],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    );

    const component = new ApApplicationTokensComponent(api as any, createRoute() as any);
    component.ngOnInit();

    expect(component.apId).toBe('ap-1');
    expect(api.getApApplicationTokens).toHaveBeenCalledWith('ap-1', {
      limit: 50,
      offset: 0,
    });
    expect(component.tokens).toHaveLength(1);
    expect(component.total).toBe(1);
  });

  it('creates an AP-scoped token and stores the one-time secret', () => {
    const component = new ApApplicationTokensComponent(api as any, createRoute() as any);
    component.apId = 'ap-1';
    component.newToken = {
      name: ' Studio ',
      expiresAtLocal: '',
      scopes: ['ap.read', 'files.read'],
    };
    api.createApApplicationToken.mockReturnValue(
      of({
        ...createToken({ name: 'Studio', scopes: ['ap.read', 'files.read'] }),
        token: 'ch_secret',
      }),
    );

    component.createToken();

    expect(api.createApApplicationToken).toHaveBeenCalledWith('ap-1', {
      name: 'Studio',
      scopes: ['ap.read', 'files.read'],
      expiresAt: null,
    });
    expect(component.createdToken?.token).toBe('ch_secret');
    expect(component.showCreate).toBe(false);
  });

  it('revokes the selected AP-scoped token', () => {
    const component = new ApApplicationTokensComponent(api as any, createRoute() as any);
    component.apId = 'ap-1';
    api.revokeApApplicationToken.mockReturnValue(
      of(createToken({ active: false, revokedAt: '2026-01-01' })),
    );

    component.openRevokeDialog(createToken());
    component.confirmRevoke();

    expect(api.revokeApApplicationToken).toHaveBeenCalledWith('ap-1', 'token-1');
    expect(component.revokeDialogOpen).toBe(false);
    expect(component.message).toContain('widerrufen');
  });

  it('keeps revoke dialog open when revoking fails', () => {
    const component = new ApApplicationTokensComponent(api as any, createRoute() as any);
    component.apId = 'ap-1';
    api.revokeApApplicationToken.mockReturnValue(
      throwError(() => ({ error: { message: 'kaputt' } })),
    );

    component.openRevokeDialog(createToken());
    component.confirmRevoke();

    expect(component.revokeDialogOpen).toBe(true);
    expect(component.revokeDialogError).toBe('kaputt');
  });

  it('does not offer revoke for multi-AP tokens', () => {
    const component = new ApApplicationTokensComponent(api as any, createRoute() as any);
    component.apId = 'ap-1';
    const multiApToken = createToken({ allowedApIds: ['ap-1', 'ap-2'] });

    component.openRevokeDialog(multiApToken);

    expect(component.canRevoke(multiApToken)).toBe(false);
    expect(component.revokeDialogOpen).toBe(false);
  });
});
