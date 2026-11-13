import { inject } from '@angular/core';
import { CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { AccessService } from '../services/access.service';
import { catchError, map, of } from 'rxjs';

/**
 * Guard that checks if a user has access to a specific AP view.
 * Public access and credential-based access (via token) are handled by the backend.
 * Registered users are also checked against their roles for the AP.
 */
export const apViewGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const auth = inject(AuthService);
  const api = inject(ApiService);
  const access = inject(AccessService);
  const apId = route.paramMap.get('apId');

  if (!apId) {
    return of(
      access.createAccessUrlTree('insufficient_rights', {
        context: 'view',
        nextUrl: state.url,
      }),
    );
  }

  // If already logged in (JWT or Credential Token), we let the request through
  // and let the backend handle the fine-grained access.
  if (auth.isLoggedIn) return of(true);

  // For unauthenticated users, we check if the AP is PUBLIC.
  // getApStartPage will return 200 for PUBLIC aps and for those the user has access to.
  // It will return 401/403 for restricted ones.
  return api.getApStartPage(apId).pipe(
    map(() => true),
    catchError((err) => {
      if (err.status === 401 || err.status === 403) {
        return of(
          access.createAccessUrlTree('login_required', {
            context: 'view',
            apId,
            nextUrl: state.url,
          }),
        );
      }

      return of(
        access.createAccessUrlTree('insufficient_rights', {
          context: 'view',
          apId,
          nextUrl: state.url,
        }),
      );
    }),
  );
};
