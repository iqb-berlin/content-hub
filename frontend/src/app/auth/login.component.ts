import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <div class="login-wrapper">
      <div class="card login-card">
        <h1>Anmelden</h1>
        <p class="subtitle">Content Hub</p>

        @if (error) {
          <div class="alert alert-error">{{ error }}</div>
          <button type="button" class="btn btn-primary" (click)="startLogin()">
            Erneut versuchen
          </button>
        } @else {
          <div class="loading" aria-live="polite">Weiterleitung zu Keycloak...</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .login-wrapper {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 60vh;
      }
      .login-card {
        width: 100%;
        max-width: 400px;
      }
      .subtitle {
        color: var(--color-text-secondary);
        margin-bottom: 24px;
      }
      .loading {
        text-align: center;
        padding: 20px;
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class LoginComponent implements OnInit {
  error = '';
  nextUrl = '';

  constructor(
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.nextUrl = this.normalizeNextUrl(params.get('next'));
      const callbackError = params.get('error')?.trim() || '';

      if (callbackError) {
        if (!this.nextUrl) {
          this.nextUrl = this.normalizeNextUrl(sessionStorage.getItem('oidc_redirect_url'));
        }
        this.error = callbackError;
        return;
      }

      void this.startLogin();
    });
  }

  async startLogin(): Promise<void> {
    this.error = '';
    try {
      await this.auth.initiateOidcLogin(this.nextUrl || undefined);
    } catch (error) {
      this.error =
        error instanceof Error && error.message
          ? error.message
          : 'Die Keycloak-Anmeldung konnte nicht gestartet werden.';
    }
  }

  private normalizeNextUrl(value: string | null): string {
    const trimmed = value?.trim() || '';
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '';
    return trimmed;
  }
}
