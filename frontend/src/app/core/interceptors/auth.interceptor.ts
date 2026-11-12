import { HttpErrorResponse, HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { AccessService } from '../services/access.service';
import { AuthService } from '../services/auth.service';
import { BYPASS_APP_AUTH, OIDC_REFRESH_RETRY_ATTEMPTED } from './auth-context.tokens';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const access = inject(AccessService);

  const request = req.url.startsWith('/api/')
    ? req.clone({ setHeaders: { 'X-Content-Hub-Terminology': 'ap' } })
    : req;
  return forwardRequest(request, next, auth, access);
};

function isInlineAuthError(url: string): boolean {
  return url.startsWith('/api/auth/credential-login') || url.startsWith('/api/auth/oidc-callback');
}

function forwardRequest(
  req: Parameters<HttpInterceptorFn>[0],
  next: Parameters<HttpInterceptorFn>[1],
  auth: AuthService,
  access: AccessService,
): Observable<HttpEvent<unknown>> {
  const skipAppAuth = req.context.get(BYPASS_APP_AUTH);
  const token = skipAppAuth ? null : auth.getToken();
  const request = token
    ? req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      })
    : req;

  return next(request).pipe(
    catchError((error: unknown) => handleAuthError(error, request, next, auth, access)),
  );
}

function handleAuthError(
  error: unknown,
  req: Parameters<HttpInterceptorFn>[0],
  next: Parameters<HttpInterceptorFn>[1],
  auth: AuthService,
  access: AccessService,
): Observable<HttpEvent<unknown>> {
  if (!(error instanceof HttpErrorResponse)) {
    return throwError(() => error);
  }

  if (req.context.get(BYPASS_APP_AUTH)) {
    return throwError(() => error);
  }

  const status = error.status;
  const nextUrl = `${window.location.pathname}${window.location.search}`;

  if (status === 401 && !isInlineAuthError(req.url)) {
    const requestToken = getBearerToken(req.headers.get('Authorization'));
    const currentToken = auth.getToken();

    // A request started before login, or with a session that has since been
    // replaced, must not clear the newer session when its late 401 arrives.
    if (currentToken && requestToken !== currentToken) {
      return throwError(() => error);
    }

    const hadToken = !!requestToken;
    const canRetryOidcRequest =
      hadToken && auth.isOidcUser && !req.context.get(OIDC_REFRESH_RETRY_ATTEMPTED);

    if (canRetryOidcRequest) {
      return from(auth.refreshOidcSession()).pipe(
        switchMap((refreshed) => {
          const refreshedToken = auth.getToken();
          if (refreshed && refreshedToken) {
            return forwardRequest(
              req.clone({
                context: req.context.set(OIDC_REFRESH_RETRY_ATTEMPTED, true),
              }),
              next,
              auth,
              access,
            );
          }

          return handleUnauthorized(auth, access, nextUrl, hadToken, error);
        }),
        catchError(() => handleUnauthorized(auth, access, nextUrl, hadToken, error)),
      );
    }

    return handleUnauthorized(auth, access, nextUrl, hadToken, error);
  }

  if (status === 403 && !req.url.startsWith('/api/auth/') && !!auth.getToken()) {
    const message = String(error.error?.message || '').toLowerCase();
    const reason = message.includes('not enabled') ? 'feature_disabled' : 'insufficient_rights';

    void access.redirectToAccess(reason, {
      nextUrl,
      replaceUrl: true,
    });
  }

  return throwError(() => error);
}

function getBearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length);
}

function handleUnauthorized(
  auth: AuthService,
  access: AccessService,
  nextUrl: string,
  hadToken: boolean,
  error: HttpErrorResponse,
): Observable<never> {
  if (hadToken) auth.clearSession();
  // Public publications remain readable when optional profile restoration fails.
  if (nextUrl.startsWith('/public/task/')) return throwError(() => error);

  if (hadToken) {
    void access.redirectToAccess('session_expired', {
      nextUrl,
      replaceUrl: true,
    });
  } else {
    void access.redirectToAccess('login_required', {
      nextUrl,
      replaceUrl: true,
    });
  }

  return throwError(() => error);
}
