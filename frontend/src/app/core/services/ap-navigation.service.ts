import { inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';

/** Resolves the AP entry point after the user profile becomes available. */
@Injectable({ providedIn: 'root' })
export class ApNavigationService {
  private readonly user = toSignal(inject(AuthService).currentUser$);

  overviewRoute(apId: string): string[] {
    const user = this.user();
    const canManage =
      user?.isAppAdmin ||
      user?.apRoles?.some((role) => role.apId === apId && role.role === 'AP_MANAGER');
    return [canManage ? '/manage' : '/view', apId];
  }
}
