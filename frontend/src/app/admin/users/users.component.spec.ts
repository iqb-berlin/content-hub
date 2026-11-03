import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { UsersComponent } from './users.component';

describe('UsersComponent', () => {
  let api: {
    getUsers: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
    setAppAdmin: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getUsers: vi.fn().mockReturnValue(of([])),
      createUser: vi.fn().mockReturnValue(of({})),
      setAppAdmin: vi.fn().mockReturnValue(of({})),
      deleteUser: vi.fn().mockReturnValue(of(undefined)),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads users on init', () => {
    api.getUsers.mockReturnValue(of([{ id: 'u1', username: 'alice', isAppAdmin: false }]));

    const component = new UsersComponent(api as any);
    component.ngOnInit();

    expect(api.getUsers).toHaveBeenCalledTimes(1);
    expect(component.users).toHaveLength(1);
  });

  it('creates user and resets form state', () => {
    const component = new UsersComponent(api as any);
    component.showCreate = true;
    const payload = { username: 'new-user', displayName: 'Neue Person' };
    component.newUser = { ...payload };

    component.createUser();

    expect(api.createUser).toHaveBeenCalledWith(payload);
    expect(component.showCreate).toBe(false);
    expect(component.newUser).toEqual({ username: '', displayName: '' });
  });

  it('blocks create when required fields are missing', () => {
    const component = new UsersComponent(api as any);
    component.newUser = { username: ' ', displayName: '' };

    component.createUser();

    expect(api.createUser).not.toHaveBeenCalled();
    expect(component.error).toContain('erforderlich');
  });

  it('opens delete dialog with selected user', () => {
    const component = new UsersComponent(api as any);
    component.openDeleteUserDialog({ id: 'u1', username: 'alice', isAppAdmin: false });

    expect(component.deleteDialogOpen).toBe(true);
    expect(component.deleteDialogUser?.id).toBe('u1');
  });

  it('deletes user after dialog confirmation', () => {
    const component = new UsersComponent(api as any);
    component.openDeleteUserDialog({ id: 'u1', username: 'alice', isAppAdmin: false });
    component.confirmDeleteUser();

    expect(api.deleteUser).toHaveBeenCalledWith('u1');
    expect(component.deleteDialogOpen).toBe(false);
  });

  it('does not close delete dialog while busy', () => {
    const component = new UsersComponent(api as any);
    component.openDeleteUserDialog({ id: 'u1', username: 'alice', isAppAdmin: false });
    component.deleteDialogBusy = true;

    component.closeDeleteUserDialog();

    expect(component.deleteDialogOpen).toBe(true);
    expect(component.deleteDialogUser?.id).toBe('u1');
  });

  it('closes delete dialog and clears state when not busy', () => {
    const component = new UsersComponent(api as any);
    component.openDeleteUserDialog({ id: 'u1', username: 'alice', isAppAdmin: false });
    component.deleteDialogError = 'Fehler';

    component.closeDeleteUserDialog();

    expect(component.deleteDialogOpen).toBe(false);
    expect(component.deleteDialogUser).toBeNull();
    expect(component.deleteDialogError).toBe('');
  });

  it('maps manager-protection error when deleting user fails', () => {
    api.deleteUser.mockReturnValue(
      throwError(() => ({ error: { message: 'would have no ACP_MANAGER' } })),
    );
    const component = new UsersComponent(api as any);
    component.openDeleteUserDialog({ id: 'u1', username: 'alice', isAppAdmin: false });

    component.confirmDeleteUser();

    expect(component.deleteDialogBusy).toBe(false);
    expect(component.deleteDialogError).toContain('letzte AP-Manager');
    expect(component.deleteDialogOpen).toBe(true);
  });

  it('surfaces load error', () => {
    api.getUsers.mockReturnValue(throwError(() => ({ error: { message: 'Fehler' } })));

    const component = new UsersComponent(api as any);
    component.load();

    expect(component.error).toBe('Fehler');
  });
});
