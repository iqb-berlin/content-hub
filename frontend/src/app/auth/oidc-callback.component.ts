import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, OidcLoginStateError } from '../core/services/auth.service';

@Component({
  selector: 'app-oidc-callback',
  standalone: true,
  template: `<div class="callback-container">
    <p>Verarbeitung der Anmeldung...</p>
  </div>`,
  styles: [
    `
      .callback-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 60vh;
      }
    `,
  ],
})
export class OidcCallbackComponent implements OnInit {
  constructor(
    private auth: AuthService,
    private router: Router,
  ) {}

  async ngOnInit() {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      if (error) {
        this.router.navigate(['/login'], {
          queryParams: { error: `OIDC Fehler: ${errorDescription || error}` },
        });
        return;
      }

      const code = searchParams.get('code');
      const state = searchParams.get('state');

      if (code) {
        await firstValueFrom(this.auth.handleOidcAuthorizationCode(code, state));
        this.navigateToTarget();
        return;
      }

      // Backward compatibility for legacy implicit flow callbacks.
      const hash = window.location.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const idToken = hashParams.get('id_token');
        const accessToken = hashParams.get('access_token');
        const tokenForBackend = idToken || accessToken;

        if (tokenForBackend) {
          await firstValueFrom(
            this.auth.handleOidcCallback(
              tokenForBackend,
              accessToken || undefined,
              idToken || undefined,
            ),
          );
          this.navigateToTarget();
          return;
        }
      }

      this.router.navigate(['/login'], {
        queryParams: { error: 'OIDC Authentifizierung fehlgeschlagen: Kein Token erhalten' },
      });
    } catch (error) {
      if (error instanceof OidcLoginStateError) {
        // Start a fresh authorization flow; never exchange an unverified code.
        const next = this.normalizeRedirectUrl(sessionStorage.getItem('oidc_redirect_url') || '/');
        this.router.navigate(['/login'], { queryParams: { next }, replaceUrl: true });
        return;
      }
      this.router.navigate(['/login'], {
        queryParams: { error: 'OIDC Authentifizierung fehlgeschlagen' },
      });
    }
  }

  private navigateToTarget(): void {
    const redirectUrl = sessionStorage.getItem('oidc_redirect_url') || '/';
    sessionStorage.removeItem('oidc_redirect_url');
    const normalized = this.normalizeRedirectUrl(redirectUrl);
    this.router.navigateByUrl(normalized);
  }

  private normalizeRedirectUrl(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed.startsWith('/')) return '/';
    if (trimmed.startsWith('//')) return '/';
    return trimmed;
  }
}
