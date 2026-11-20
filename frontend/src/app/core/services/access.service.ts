import { Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

export type AccessReason =
  | 'login_required'
  | 'insufficient_rights'
  | 'feature_disabled'
  | 'session_expired';

export interface AccessNavigationOptions {
  nextUrl?: string;
  apId?: string;
  context?: 'admin' | 'ap' | 'view' | 'manage';
  replaceUrl?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AccessService {
  private lastRedirectUrl = '';
  private lastRedirectAt = 0;

  constructor(private readonly router: Router) {}

  createAccessUrlTree(
    reason: AccessReason,
    options: Omit<AccessNavigationOptions, 'replaceUrl'> = {},
  ): UrlTree {
    const queryParams: Record<string, string> = { reason };

    if (options.nextUrl) queryParams['next'] = options.nextUrl;
    if (options.apId) queryParams['apId'] = options.apId;
    if (options.context) queryParams['context'] = options.context;

    return this.router.createUrlTree(['/access'], { queryParams });
  }

  redirectToAccess(reason: AccessReason, options: AccessNavigationOptions = {}): Promise<boolean> {
    const tree = this.createAccessUrlTree(reason, options);
    const targetUrl = this.router.serializeUrl(tree);
    const now = Date.now();

    if (targetUrl === this.router.url) {
      return Promise.resolve(false);
    }

    if (this.lastRedirectUrl === targetUrl && now - this.lastRedirectAt < 300) {
      return Promise.resolve(false);
    }

    this.lastRedirectUrl = targetUrl;
    this.lastRedirectAt = now;

    return this.router.navigateByUrl(tree, {
      replaceUrl: options.replaceUrl ?? false,
    });
  }
}
