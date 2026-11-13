import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiService } from '../services/api.service';

export const explorerCapabilityGuard = ((route) => {
  const api = inject(ApiService);
  const router = inject(Router);
  const id = route.paramMap.get('apId') || route.parent?.paramMap.get('apId') || '';
  return api.getCapabilities(id).pipe(
    map((access) => (access.canViewExplorer ? true : router.createUrlTree(['/view', id]))),
    catchError(() => of(router.createUrlTree(['/view', id]))),
  );
}) satisfies CanActivateFn;

export const reviewManageGuard = ((route) => {
  const api = inject(ApiService);
  const router = inject(Router);
  const id = route.paramMap.get('apId') || route.parent?.paramMap.get('apId') || '';
  return api.getCapabilities(id).pipe(
    map((access) => (access.canManageReview ? true : router.createUrlTree(['/view', id]))),
    catchError(() => of(router.createUrlTree(['/view', id]))),
  );
}) satisfies CanActivateFn;
