import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { AccessReason } from '../core/services/access.service';

import { ApiService } from '../core/services/api.service';
import { Subject, catchError, map, of, switchMap, takeUntil } from 'rxjs';

type AccessContext = 'admin' | 'ap' | 'view' | 'manage' | null;

@Component({
  selector: 'app-access',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="access-wrapper">
      <div class="card access-card">
        <h1>{{ title }}</h1>
        <p class="subtitle">{{ subtitle }}</p>

        @if (detail) {
          <div class="alert alert-warning">{{ detail }}</div>
        }

        <div class="actions">
          @if (showLoginButton) {
            <button class="btn btn-primary" (click)="goToLogin()">Zur Anmeldung</button>
          }

          @if (showCredentialButton) {
            <a [routerLink]="['/credential-login', apId]" class="btn btn-outline">
              Mit AP-Zugang anmelden
            </a>
          }

          @if (showRetryButton) {
            <button class="btn btn-outline" (click)="goToNextUrl()">Erneut versuchen</button>
          }

          <a routerLink="/" class="btn btn-outline">Zur Startseite</a>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .access-wrapper {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: calc(100vh - 200px);
        padding: 16px;
      }

      .access-card {
        width: 100%;
        max-width: 560px;
        text-align: left;
        border-left: 4px solid #f39c12;
      }

      .access-card h1 {
        margin-bottom: 8px;
      }

      .subtitle {
        color: var(--color-text-secondary);
        margin-bottom: 16px;
        line-height: 1.5;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }
    `,
  ],
})
export class AccessComponent implements OnInit, OnDestroy {
  reason: AccessReason = 'insufficient_rights';
  context: AccessContext = null;
  nextUrl = '';
  apId = '';
  apName = '';
  private readonly destroyed$ = new Subject<void>();

  title = 'Kein Zugriff';
  subtitle = 'Sie haben aktuell keine Berechtigung für diese Seite.';
  detail = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly api: ApiService,
  ) {}

  get showLoginButton(): boolean {
    return this.reason === 'login_required' || this.reason === 'session_expired';
  }

  get showCredentialButton(): boolean {
    return this.reason === 'login_required' && !!this.apId;
  }

  get showRetryButton(): boolean {
    return !!this.nextUrl && this.auth.isLoggedIn && this.reason !== 'session_expired';
  }

  ngOnInit() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          const reason = params.get('reason');
          const context = params.get('context');
          const next = params.get('next');
          const apId = params.get('apId') ?? params.get('acpId');

          this.reason = this.parseReason(reason);
          this.context = this.parseContext(context);
          this.nextUrl = this.normalizeNextUrl(next);
          this.apId = apId?.trim() || '';

          this.apName = '';
          this.applyTexts();
          return this.reason === 'login_required' && this.apId
            ? this.api.getPublicAps().pipe(
                map((aps) => aps.find((ap) => ap.id === this.apId)?.name?.trim() || ''),
                catchError(() => of('')),
              )
            : of('');
        }),
        takeUntil(this.destroyed$),
      )
      .subscribe((name) => {
        this.apName = name;
        this.applyTexts();
      });
  }

  ngOnDestroy() {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  goToLogin() {
    const queryParams: Record<string, string> = {};

    if (this.nextUrl) {
      queryParams['next'] = this.nextUrl;
    }

    this.router.navigate(['/login'], { queryParams });
  }

  goToNextUrl() {
    if (!this.nextUrl) return;
    this.router.navigateByUrl(this.nextUrl);
  }

  private applyTexts() {
    switch (this.reason) {
      case 'login_required':
        this.title = 'Anmeldung erforderlich';
        this.subtitle = 'Bitte melden Sie sich an, um auf diese Seite zuzugreifen.';
        this.detail = this.apId
          ? `Für ${this.apName ? `das Paket "${this.apName}"` : 'dieses Paket'} kann je nach Konfiguration ein separater AP-Zugang erforderlich sein.`
          : '';
        break;
      case 'session_expired':
        this.title = 'Sitzung abgelaufen';
        this.subtitle = 'Ihre Sitzung ist nicht mehr gültig. Bitte melden Sie sich erneut an.';
        this.detail = '';
        break;
      case 'feature_disabled':
        this.title = 'Funktion nicht verfügbar';
        this.subtitle = 'Diese Funktion ist für dieses AP derzeit nicht freigeschaltet.';
        this.detail = 'Bitte wenden Sie sich an die zuständige AP-Administration.';
        break;
      case 'insufficient_rights':
      default:
        this.title = 'Kein Zugriff';
        this.subtitle = 'Sie haben aktuell keine ausreichenden Rechte für diese Seite.';
        this.detail =
          'Bitte melden Sie sich mit einem berechtigten Konto an oder kontaktieren Sie die Administration.';
        break;
    }
  }

  private parseReason(value: string | null): AccessReason {
    if (
      value === 'login_required' ||
      value === 'insufficient_rights' ||
      value === 'feature_disabled' ||
      value === 'session_expired'
    ) {
      return value;
    }
    return 'insufficient_rights';
  }

  private parseContext(value: string | null): AccessContext {
    if (value === 'acp') return 'ap';
    if (value === 'admin' || value === 'ap' || value === 'view' || value === 'manage') {
      return value;
    }
    return null;
  }

  private normalizeNextUrl(value: string | null): string {
    const trimmed = value?.trim() || '';
    if (!trimmed.startsWith('/')) {
      return '';
    }
    if (trimmed.startsWith('//')) {
      return '';
    }
    return trimmed;
  }
}
