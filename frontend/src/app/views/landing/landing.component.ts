import { Component, OnInit } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin, map } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { PublicAp, Ap } from '../../core/models/api.models';
import { renderMarkdownContent } from '../../core/utils/markdown.util';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="landing">
      <!-- Hero -->
      <section class="hero">
        <h1>Content Hub</h1>
        <p class="hero-sub">Assessment Packages für Lernstandserhebungen</p>
      </section>

      <!-- Custom landing page content from admin settings -->
      @if (landingHtml) {
        <section class="custom-content card rich-text-content" [innerHTML]="landingHtml"></section>
      }

      <!-- AP grid -->
      <section class="ap-section">
        <h2>Verfügbare Pakete</h2>
        <div class="ap-grid">
          @for (ap of aps; track ap.id) {
            <div class="card ap-card">
              <div class="ap-card-header">
                <span
                  class="badge"
                  [class.badge-success]="
                    ap.accessModel === 'PUBLIC' || ap.accessModel === 'CREDENTIALS_LIST'
                  "
                  [class.badge-info]="
                    ap.accessModel !== 'PUBLIC' &&
                    ap.accessModel !== 'CREDENTIALS_LIST' &&
                    ap.accessModel !== 'ADMIN'
                  "
                  [class.badge-warning]="ap.accessModel === 'ADMIN'"
                >
                  @if (ap.accessModel === 'PUBLIC') {
                    Öffentlich
                  } @else if (ap.accessModel === 'CREDENTIALS_LIST') {
                    Zugangsdaten erforderlich
                  } @else if (ap.accessModel === 'REGISTERED') {
                    Registriert
                  } @else if (ap.accessModel === 'ADMIN') {
                    Admin
                  } @else {
                    Privat
                  }
                </span>
              </div>
              <h3>{{ ap.name }}</h3>
              <p class="desc">{{ ap.description || 'Keine Beschreibung verfügbar.' }}</p>
              <div class="card-footer">
                @if (ap.accessModel === 'CREDENTIALS_LIST' && !isLoggedIn) {
                  @if (loginApId === ap.id) {
                    <!-- Inline login form -->
                    <div class="inline-login-form">
                      @if (loginError) {
                        <div class="login-error">{{ loginError }}</div>
                      }
                      <form (ngSubmit)="onLoginSubmit(ap.id)">
                        <div class="login-fields">
                          <input
                            type="text"
                            [(ngModel)]="loginUsername"
                            name="username"
                            placeholder="Benutzername"
                            class="login-input"
                            [disabled]="loginLoading"
                            required
                          />
                          <input
                            type="password"
                            [(ngModel)]="loginPassword"
                            name="password"
                            placeholder="Kennwort"
                            class="login-input"
                            [disabled]="loginLoading"
                            required
                          />
                        </div>
                        <div class="login-actions">
                          <button
                            type="submit"
                            class="btn btn-primary btn-sm"
                            [disabled]="loginLoading || !loginUsername || !loginPassword"
                          >
                            @if (loginLoading) {
                              <span class="spinner-inline"></span> Anmelden...
                            } @else {
                              Zugang öffnen
                            }
                          </button>
                          <button
                            type="button"
                            class="btn btn-outline btn-sm"
                            [disabled]="loginLoading"
                            (click)="cancelLogin()"
                          >
                            Abbrechen
                          </button>
                        </div>
                      </form>
                    </div>
                  } @else {
                    <!-- Show login button -->
                    <button class="btn btn-primary" (click)="showLoginForm(ap.id)">
                      <span class="btn-icon">🔑</span> Anmelden
                    </button>
                  }
                } @else if (ap.requiresLogin && !isLoggedIn) {
                  <a [routerLink]="['/credential-login', ap.id]" class="btn btn-primary">
                    <span class="btn-icon">🔑</span> Anmelden
                  </a>
                } @else {
                  @if (isManagerForAp(ap.id)) {
                    <a [routerLink]="['/manage', ap.id]" class="btn btn-primary">
                      <span class="btn-icon">🛠</span> Verwalten
                    </a>
                  } @else {
                    <a [routerLink]="['/view', ap.id]" class="btn btn-primary">
                      <span class="btn-icon">📦</span> Öffnen
                    </a>
                  }
                }
              </div>
            </div>
          }
        </div>
        @if (!aps.length) {
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <h3>Keine öffentlichen Pakete verfügbar</h3>
            <p>Es wurden noch keine Assessment Packages veröffentlicht.</p>
          </div>
        }
      </section>

      <!-- Footer -->
      <footer class="landing-footer">
        <div class="footer-links">
          @if (imprintHtml) {
            <button class="footer-link" (click)="showLegalDialog('imprint')">Impressum</button>
          }
          @if (privacyHtml) {
            <button class="footer-link" (click)="showLegalDialog('privacy')">Datenschutz</button>
          }
          @if (accessibilityHtml) {
            <button class="footer-link" (click)="showLegalDialog('accessibility')">
              Barrierefreiheit
            </button>
          }
        </div>
        <p class="footer-credit">IQB · Humboldt-Universität zu Berlin</p>
      </footer>

      <!-- Legal dialog overlay -->
      @if (activeLegalDialog) {
        <div class="dialog-overlay" (click)="closeLegalDialog()">
          <div class="dialog-content card" (click)="$event.stopPropagation()">
            <div class="dialog-header">
              <h2>{{ activeLegalTitle }}</h2>
              <button class="btn btn-outline btn-sm" (click)="closeLegalDialog()">✕</button>
            </div>
            <div class="dialog-body rich-text-content" [innerHTML]="activeLegalContent"></div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .landing {
        display: flex;
        flex-direction: column;
        min-height: calc(100vh - 56px - 48px);
      }

      /* Hero */
      .hero {
        text-align: center;
        padding: 56px 24px 40px;
        background: linear-gradient(
          135deg,
          rgba(26, 82, 118, 0.06) 0%,
          rgba(41, 128, 185, 0.08) 100%
        );
        border-radius: var(--radius);
        margin-bottom: 32px;
      }
      .hero h1 {
        font-size: 2.5rem;
        font-weight: 700;
        background: linear-gradient(
          135deg,
          var(--color-primary) 0%,
          var(--color-primary-light) 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 8px;
      }
      .hero-sub {
        color: var(--color-text-secondary);
        font-size: 1.15rem;
        font-weight: 300;
      }

      /* Custom content */
      .custom-content {
        margin-bottom: 32px;
        line-height: 1.7;
      }

      /* AP Section */
      .ap-section {
        flex: 1;
      }
      .ap-section h2 {
        font-size: 1.4rem;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ap-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
      }

      /* AP Card */
      .ap-card {
        display: flex;
        flex-direction: column;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
        border: 1px solid var(--color-border);
      }
      .ap-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
      }
      .ap-card-header {
        margin-bottom: 12px;
      }
      .ap-card h3 {
        font-size: 1.15rem;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .desc {
        color: var(--color-text-secondary);
        font-size: 0.9rem;
        line-height: 1.5;
        flex: 1;
      }
      .card-footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }
      .btn-icon {
        margin-right: 4px;
      }

      /* Empty state */
      .empty-state {
        text-align: center;
        padding: 64px 24px;
        color: var(--color-text-secondary);
      }
      .empty-icon {
        font-size: 3rem;
        margin-bottom: 16px;
      }
      .empty-state h3 {
        color: var(--color-text);
        margin-bottom: 8px;
      }
      .empty-state p {
        font-size: 0.95rem;
      }

      /* Footer */
      .landing-footer {
        margin-top: 48px;
        padding: 24px 0;
        border-top: 1px solid var(--color-border);
        text-align: center;
      }
      .footer-links {
        display: flex;
        justify-content: center;
        gap: 24px;
        margin-bottom: 12px;
      }
      .footer-link {
        background: none;
        border: none;
        color: var(--color-primary-light);
        cursor: pointer;
        font-size: 0.85rem;
        font-family: inherit;
        padding: 0;
      }
      .footer-link:hover {
        text-decoration: underline;
      }
      .footer-credit {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }

      /* Legal dialog */
      .dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 24px;
      }
      .dialog-content {
        max-width: 680px;
        width: 100%;
        max-height: 80vh;
        overflow-y: auto;
      }
      .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .dialog-header h2 {
        margin-bottom: 0;
      }
      .dialog-body {
        line-height: 1.7;
        font-size: 0.95rem;
      }

      /* Inline login form styles */
      .inline-login-form {
        width: 100%;
      }
      .login-error {
        color: #e74c3c;
        font-size: 0.85rem;
        margin-bottom: 8px;
        padding: 4px 8px;
        background: rgba(231, 76, 60, 0.08);
        border-radius: 4px;
      }
      .login-fields {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }
      .login-input {
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-size: 0.9rem;
        font-family: inherit;
      }
      .login-input:focus {
        outline: none;
        border-color: var(--color-primary-light);
        box-shadow: 0 0 0 2px rgba(41, 128, 185, 0.15);
      }
      .login-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .spinner-inline {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class LandingComponent implements OnInit {
  aps: PublicAp[] = [];
  landingHtml: string | null = null;
  imprintHtml: string | null = null;
  privacyHtml: string | null = null;
  accessibilityHtml: string | null = null;

  activeLegalDialog: boolean = false;
  activeLegalTitle: string = '';
  activeLegalContent: string | null = null;

  // Inline login form state
  loginApId: string | null = null;
  loginUsername = '';
  loginPassword = '';
  loginLoading = false;
  loginError = '';

  constructor(
    private api: ApiService,
    private authService: AuthService,
    private router: Router,
  ) {}

  get isLoggedIn(): boolean {
    return this.authService.isLoggedIn;
  }

  ngOnInit() {
    const apsRequest = this.authService.isAdmin
      ? forkJoin({ public: this.api.getPublicAps(), all: this.api.getAps() }).pipe(
          map(({ public: publicAps, all: allAps }: { public: PublicAp[]; all: Ap[] }) =>
            this.mergeForAdmin(publicAps, allAps),
          ),
        )
      : this.authService.isLoggedIn
        ? forkJoin({ public: this.api.getPublicAps(), all: this.api.getAps() }).pipe(
            map(({ public: publicAps, all: allAps }: { public: PublicAp[]; all: Ap[] }) =>
              this.mergeForLoggedUsers(publicAps, allAps),
            ),
          )
        : this.api.getPublicAps();

    forkJoin({
      settings: this.api.getPublicSettings(),
      aps: apsRequest,
    }).subscribe(({ settings, aps }) => {
      this.aps = aps as PublicAp[];
      this.landingHtml = renderMarkdownContent(settings.landingPageHtml);
      this.imprintHtml = renderMarkdownContent(settings.imprintHtml);
      this.privacyHtml = renderMarkdownContent(settings.privacyHtml);
      this.accessibilityHtml = renderMarkdownContent(settings.accessibilityHtml);
    });
  }

  showLegalDialog(type: 'imprint' | 'privacy' | 'accessibility') {
    const titles = {
      imprint: 'Impressum',
      privacy: 'Datenschutz',
      accessibility: 'Barrierefreiheit',
    };
    const contents = {
      imprint: this.imprintHtml,
      privacy: this.privacyHtml,
      accessibility: this.accessibilityHtml,
    };
    this.activeLegalTitle = titles[type];
    this.activeLegalContent = contents[type];
    this.activeLegalDialog = true;
  }

  closeLegalDialog() {
    this.activeLegalDialog = false;
  }

  // Inline login form handlers
  showLoginForm(apId: string) {
    this.loginApId = apId;
    this.loginUsername = '';
    this.loginPassword = '';
    this.loginError = '';
    this.loginLoading = false;
  }

  cancelLogin() {
    this.loginApId = null;
    this.loginUsername = '';
    this.loginPassword = '';
    this.loginError = '';
    this.loginLoading = false;
  }

  onLoginSubmit(apId: string) {
    if (!this.loginUsername || !this.loginPassword || this.loginLoading) return;

    this.loginLoading = true;
    this.loginError = '';

    this.authService.credentialLogin(apId, this.loginUsername, this.loginPassword).subscribe({
      next: () => {
        this.loginLoading = false;
        this.router.navigate([this.isManagerForAp(apId) ? '/manage' : '/view', apId]);
      },
      error: (err) => {
        this.loginError = err.error?.message || 'Anmeldung fehlgeschlagen';
        this.loginLoading = false;
      },
    });
  }

  isManagerForAp(apId: string): boolean {
    return this.authService.hasApRole(apId, 'AP_MANAGER');
  }

  private mergeForAdmin(publicAps: PublicAp[], allAps: Ap[]): PublicAp[] {
    const merged = [...publicAps];
    const byId = new Map(merged.map((ap) => [ap.id, ap]));

    for (const ap of allAps) {
      const existing = byId.get(ap.id);
      if (existing) {
        // Admins can always access configured credential APs directly.
        existing.requiresLogin = false;
        continue;
      }

      const mapped: PublicAp = {
        id: ap.id,
        name: ap.name,
        description: ap.description ?? undefined,
        accessModel: 'ADMIN',
        requiresLogin: false,
      };
      merged.push(mapped);
      byId.set(mapped.id, mapped);
    }

    return merged;
  }

  private mergeForLoggedUsers(publicAps: PublicAp[], allAps: Ap[]): PublicAp[] {
    const merged = [...publicAps];
    const byId = new Map(merged.map((ap) => [ap.id, ap]));

    for (const ap of allAps) {
      const existing = byId.get(ap.id);
      if (existing) {
        // Logged-in users with explicit AP roles should not be forced into credential re-login.
        existing.requiresLogin = false;
        if (existing.accessModel === 'CREDENTIALS_LIST') {
          existing.accessModel = 'REGISTERED';
        }
        continue;
      }

      const mapped: PublicAp = {
        id: ap.id,
        name: ap.name,
        description: ap.description ?? undefined,
        accessModel: 'REGISTERED',
        requiresLogin: false,
      };
      merged.push(mapped);
      byId.set(mapped.id, mapped);
    }

    return merged;
  }
}
