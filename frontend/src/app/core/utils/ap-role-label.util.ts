export type ApManagerRole = 'AP_MANAGER' | 'READ_ONLY' | null | undefined;

export function getApRoleLabel(role: ApManagerRole, isAppAdmin = false): string {
  if (role === 'AP_MANAGER') return 'Manager';
  if (role === 'READ_ONLY') return 'Gast';
  if (isAppAdmin) return 'App-Admin';
  return 'Zugriff gewährt';
}
