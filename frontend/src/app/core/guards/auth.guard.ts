import { inject } from '@angular/core';
import { CanActivateFn, UrlTree } from '@angular/router';
import { catchError, filter, map, Observable, of, take, timeout } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { AccessService } from '../services/access.service';

const ADMIN_PROFILE_WAIT_MS = 5000;

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const accessService = inject(AccessService);

  if (authService.isLoggedIn) return true;
  return accessService.createAccessUrlTree('login_required', {
    nextUrl: state.url,
  });
};

export const adminGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const accessService = inject(AccessService);

  if (!authService.isLoggedIn) {
    return createAdminLoginUrlTree(accessService, state.url);
  }

  if (authService.currentUser) {
    return authService.currentUser.isAppAdmin
      ? true
      : createAdminAccessUrlTree(accessService, state.url);
  }

  authService.loadProfile();
  return waitForAdminProfile(authService, accessService, state.url);
};

function waitForAdminProfile(
  authService: AuthService,
  accessService: AccessService,
  nextUrl: string,
): Observable<boolean | UrlTree> {
  return authService.currentUser$.pipe(
    filter((user) => !!user || !authService.isLoggedIn),
    take(1),
    timeout({ first: ADMIN_PROFILE_WAIT_MS }),
    map((user) => {
      if (!user) {
        return createAdminLoginUrlTree(accessService, nextUrl);
      }
      return user.isAppAdmin ? true : createAdminAccessUrlTree(accessService, nextUrl);
    }),
    catchError(() =>
      of(
        authService.isLoggedIn
          ? createAdminAccessUrlTree(accessService, nextUrl)
          : createAdminLoginUrlTree(accessService, nextUrl),
      ),
    ),
  );
}

function createAdminLoginUrlTree(accessService: AccessService, nextUrl: string): UrlTree {
  return accessService.createAccessUrlTree('login_required', {
    context: 'admin',
    nextUrl,
  });
}

function createAdminAccessUrlTree(accessService: AccessService, nextUrl: string): UrlTree {
  return accessService.createAccessUrlTree('insufficient_rights', {
    context: 'admin',
    nextUrl,
  });
}

export const apManagerGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const apiService = inject(ApiService);
  const accessService = inject(AccessService);
  const apId = route.paramMap.get('apId') || '';

  if (!authService.isLoggedIn) {
    return accessService.createAccessUrlTree('login_required', {
      context: 'manage',
      apId: apId || undefined,
      nextUrl: state.url,
    });
  }

  if (authService.isAdmin) return true;

  if (!apId) {
    return accessService.createAccessUrlTree('insufficient_rights', {
      context: 'manage',
      nextUrl: state.url,
    });
  }

  return apiService.getAp(apId).pipe(
    map(() => true),
    catchError((err) => {
      if (err?.status === 401) {
        return of(
          accessService.createAccessUrlTree('login_required', {
            context: 'manage',
            apId,
            nextUrl: state.url,
          }),
        );
      }

      return of(
        accessService.createAccessUrlTree('insufficient_rights', {
          context: 'manage',
          apId,
          nextUrl: state.url,
        }),
      );
    }),
  );
};
