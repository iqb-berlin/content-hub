import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { DashboardComponent } from './dashboard.component';

function setup() {
  const assignment = {
    id: 'assignment',
    userId: 'manager',
    role: 'AP_MANAGER',
    capabilities: ['review:participate'],
    user: { displayName: 'Manager' },
  };
  const api = {
    updateRoleCapabilities: vi
      .fn()
      .mockImplementation((_ap, _user, capabilities) => of({ ...assignment, capabilities })),
    assignApRole: vi.fn().mockImplementation((_ap, data) => of({ id: 'saved', ...data })),
  };
  const component = new DashboardComponent(
    {} as any,
    api as any,
    { isAdmin: false, currentUser: { id: 'manager' } } as any,
  );
  component.ap = { id: 'ap' } as any;
  component.roles = [assignment];
  return { component, api, assignment };
}

describe('Dashboard assignment persistence', () => {
  it('saves manager capabilities without requesting a manager role assignment', () => {
    const { component, api, assignment } = setup();
    component.capabilityEdits.manager = ['review:participate', 'review:manage'];
    component.saveAssignment(assignment);
    expect(api.updateRoleCapabilities).toHaveBeenCalledWith('ap', 'manager', [
      'review:participate',
      'review:manage',
    ]);
    expect(api.assignApRole).not.toHaveBeenCalled();
    expect(component.roles[0].role).toBe('AP_MANAGER');
    expect(component.hasAssignmentChanges(component.roles[0])).toBe(false);
    expect(component.roleBusy).toBe(false);
  });

  it('uses the current server role when it changed since the page was loaded', () => {
    const { component, api, assignment } = setup();
    component.myRole = 'AP_MANAGER';
    component.capabilityEdits.manager = ['review:manage'];
    api.updateRoleCapabilities.mockReturnValue(
      of({
        ...assignment,
        role: 'READ_ONLY',
        capabilities: ['review:manage'],
      }),
    );
    component.saveAssignment(assignment);
    expect(component.roles[0].role).toBe('READ_ONLY');
    expect(component.myRole).toBe('READ_ONLY');
    expect(component.canEditName).toBe(false);
    expect(component.hasAssignmentChanges(component.roles[0])).toBe(false);
    expect(api.assignApRole).not.toHaveBeenCalled();
  });

  it('retains the requested role if a response does not include it', () => {
    const { component, api, assignment } = setup();
    component.capabilityEdits.manager = ['review:manage'];
    api.updateRoleCapabilities.mockReturnValue(of({ capabilities: ['review:manage'] }));
    component.saveAssignment(assignment);
    expect(component.roles[0].role).toBe('AP_MANAGER');
    expect(component.myRole).toBe('AP_MANAGER');
  });

  it('retains role assignment authorization for actual role changes', () => {
    const { component, api, assignment } = setup();
    component.roleEdits.manager = 'READ_ONLY';
    component.saveAssignment(assignment);
    expect(api.assignApRole).toHaveBeenCalledWith('ap', {
      userId: 'manager',
      role: 'READ_ONLY',
      capabilities: ['review:participate'],
    });
    expect(api.updateRoleCapabilities).not.toHaveBeenCalled();
  });

  it('keeps new assignments on the assignment endpoint', () => {
    const { component, api } = setup();
    component.allUsers = [{ id: 'new' }];
    component.selectedUserId = 'new';
    component.assignRole();
    expect(api.assignApRole).toHaveBeenCalledWith('ap', {
      userId: 'new',
      role: 'READ_ONLY',
      capabilities: [],
    });
    expect(api.updateRoleCapabilities).not.toHaveBeenCalled();
  });

  it('keeps capability edits available after a save failure', () => {
    const { component, api, assignment } = setup();
    api.updateRoleCapabilities.mockReturnValue(
      throwError(() => ({ error: { message: 'Speichern fehlgeschlagen' } })),
    );
    component.capabilityEdits.manager = ['review:manage'];
    component.saveAssignment(assignment);
    expect(component.capabilityEdits.manager).toEqual(['review:manage']);
    expect(component.roles[0]).toEqual(assignment);
    expect(component.roleError).toBe('Speichern fehlgeschlagen');
    expect(component.roleBusy).toBe(false);
  });
});

describe('Dashboard sequence presentation', () => {
  it('separates booklets from generic task sequences without relying on package-specific IDs', () => {
    const { component } = setup();
    component.contentData = {
      sequences: [
        { id: 'instrument-a', name: 'Teil 1', kind: 'booklet' },
        { id: 'instrument-b', name: 'Teil 1', kind: 'booklet' },
        { id: 'legacy-sequence', name: 'Aufgabenfolge', kind: 'module' },
      ],
    };

    expect(component.bookletSequences.map((sequence) => sequence.id)).toEqual([
      'instrument-a',
      'instrument-b',
    ]);
    expect(component.nonBookletSequences.map((sequence) => sequence.id)).toEqual([
      'legacy-sequence',
    ]);
  });
});
