import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { ApiService } from './core/services/api.service';
import { applyLanguage, applyTheme } from './core/utils/app-settings.util';
import { forkJoin } from 'rxjs';
import { BuildVersion } from './core/models/api.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="app-header">
      <a routerLink="/" class="header-left logo" aria-label="Content Hub – Startseite">
        <img
          src="branding/content-hub-v1/logo.svg"
          alt=""
          class="app-logo"
          width="40"
          height="40"
        />
        <span>Content Hub</span>
      </a>
      <nav>
        @if (auth.isLoggedIn && auth.isAdmin) {
          <a routerLink="/admin/users">Nutzer</a>
        }
        @if (auth.isLoggedIn && auth.isAdmin) {
          <a routerLink="/admin/application-tokens">Token</a>
        }
        @if (auth.isLoggedIn && auth.hasManagedAcps) {
          <a routerLink="/acps">ACPs</a>
        }
        @if (auth.isLoggedIn && auth.isAdmin) {
          <a routerLink="/admin/settings">Einstellungen</a>
        }
        @if (auth.isLoggedIn) {
          <span class="user-info">{{
            auth.currentUser?.displayName || auth.currentUser?.username
          }}</span>
          @if (auth.isOidcUser) {
            <button class="btn-change-password" (click)="changePassword()" title="Passwort ändern">
              🔒
            </button>
          }
          <button class="btn-logout" (click)="logout()">Abmelden</button>
        } @else {
          <a routerLink="/login">Anmelden</a>
        }
      </nav>
    </header>
    <main class="app-main">
      <router-outlet />
    </main>
    <footer class="app-footer">
      @if (buildVersion) {
        <span [class.version-mismatch]="versionMismatch" [title]="versionTitle"
          >v{{ buildVersion.version }}</span
        >
      }
    </footer>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      .app-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 24px;
        height: 64px;
        background: var(--color-primary);
        color: var(--color-on-primary);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .app-logo {
        height: 40px;
        width: 40px;
        flex-shrink: 0;
        object-fit: contain;
      }
      .logo {
        color: var(--color-on-primary);
        text-decoration: none;
        font-size: 1.25rem;
        font-weight: 600;
      }
      nav {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      nav a {
        color: var(--color-on-primary);
        text-decoration: none;
        font-size: 0.9rem;
      }
      nav a:hover {
        color: var(--color-on-primary);
      }
      .user-info {
        font-size: 0.85rem;
        color: var(--color-on-primary);
      }
      .btn-logout {
        background: transparent;
        border: 1px solid currentColor;
        color: var(--color-on-primary);
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .btn-logout:hover {
        background: color-mix(in srgb, var(--color-on-primary) 14%, transparent);
      }
      .btn-change-password {
        background: transparent;
        border: none;
        color: var(--color-on-primary);
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
        opacity: 0.85;
      }
      .btn-change-password:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.15);
      }
      .app-main {
        flex: 1;
        padding: 24px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
      }
      .app-footer {
        min-height: 32px;
        padding: 6px 24px;
        color: var(--color-text-secondary);
        font-size: 0.75rem;
        text-align: right;
      }
      .version-mismatch {
        color: var(--color-danger-text);
        font-weight: 600;
      }
      @media (max-width: 700px) {
        .app-header {
          height: auto;
          min-height: 64px;
          padding: 10px 16px;
          align-items: stretch;
          flex-direction: column;
          gap: 8px;
        }
        .header-left {
          min-width: 0;
          gap: 10px;
        }
        .app-logo {
          height: 32px;
          width: 32px;
        }
        .logo {
          font-size: 1rem;
          overflow-wrap: anywhere;
        }
        nav {
          width: 100%;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-start;
        }
        .user-info {
          max-width: 100%;
          overflow-wrap: anywhere;
        }
        .app-main {
          padding: 16px;
        }
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  buildVersion: BuildVersion | null = null;
  versionMismatch = false;
  versionTitle = '';
  private readonly settingsUpdatedListener = (event: Event) => {
    const customEvent = event as CustomEvent<{
      theme?: Record<string, unknown>;
      language?: string;
    }>;
    const detail = customEvent.detail;
    if (!detail) {
      return;
    }

    applyTheme(detail.theme);
    applyLanguage(detail.language);
  };
  private readonly appResumeListener = () => {
    void this.auth.restoreOidcSessionOnResume();
  };
  private readonly visibilityChangeListener = () => {
    if (document.visibilityState === 'visible') {
      void this.auth.restoreOidcSessionOnResume();
    }
  };

  constructor(
    public auth: AuthService,
    private router: Router,
    private api: ApiService,
  ) {}

  ngOnInit() {
    window.addEventListener('cp-settings-updated', this.settingsUpdatedListener as EventListener);
    window.addEventListener('focus', this.appResumeListener);
    document.addEventListener('visibilitychange', this.visibilityChangeListener);
    this.auth.initFromStorage();

    this.api.getPublicSettings().subscribe((settings) => {
      applyTheme(settings.theme);
      applyLanguage(settings.language);
    });

    forkJoin({
      backend: this.api.getBackendVersion(),
      frontend: this.api.getFrontendVersion(),
    }).subscribe({
      next: ({ backend, frontend }) => {
        this.buildVersion = frontend;
        this.versionMismatch =
          backend.version !== frontend.version ||
          backend.commit !== frontend.commit ||
          backend.builtAt !== frontend.builtAt;
        this.versionTitle = this.versionMismatch
          ? `Versionskonflikt: Frontend ${frontend.version} (${frontend.commit}, ${frontend.builtAt}), Backend ${backend.version} (${backend.commit}, ${backend.builtAt})`
          : `Release ${frontend.version}, Commit ${frontend.commit}, gebaut ${frontend.builtAt}`;
      },
      error: () => {
        this.buildVersion = null;
      },
    });
  }

  ngOnDestroy() {
    window.removeEventListener(
      'cp-settings-updated',
      this.settingsUpdatedListener as EventListener,
    );
    window.removeEventListener('focus', this.appResumeListener);
    document.removeEventListener('visibilitychange', this.visibilityChangeListener);
  }

  async logout() {
    const wasOidc = this.auth.isOidcUser;
    this.auth.logout();
    if (!wasOidc) {
      await this.router.navigate(['/']);
    }
  }

  changePassword() {
    this.auth.changePassword();
  }
}
