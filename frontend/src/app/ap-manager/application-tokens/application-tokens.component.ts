import { DatePipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  ApplicationToken,
  CreatedApplicationToken,
  ServerApiScope,
} from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { ApManagerContextComponent } from '../shared/ap-manager-context.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';

type ScopeOption = {
  value: ServerApiScope;
  label: string;
};

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: 'ap.read', label: 'AP lesen' },
  { value: 'transfer.read', label: 'Transfer lesen' },
  { value: 'transfer.write', label: 'Transfer schreiben' },
  { value: 'index.read', label: 'Index lesen' },
  { value: 'index.write', label: 'Index schreiben' },
  { value: 'files.read', label: 'Dateien lesen' },
  { value: 'files.write', label: 'Dateien schreiben' },
  { value: 'audit.read', label: 'Audit lesen' },
];

@Component({
  selector: 'app-ap-application-tokens',
  standalone: true,
  imports: [DatePipe, FormsModule, ApManagerContextComponent, ConfirmDialogComponent],
  template: `
    <app-ap-manager-context />

    <div class="page-header">
      <h1>API-Zugänge</h1>
      <div class="header-actions">
        <button class="btn btn-outline" (click)="load()" [disabled]="loading">Aktualisieren</button>
        <button class="btn btn-primary" (click)="openCreateForm()">+ Token anlegen</button>
      </div>
    </div>

    @if (error) {
      <div class="alert alert-error">{{ error }}</div>
    }

    @if (message) {
      <div class="alert alert-success">{{ message }}</div>
    }

    @if (createdToken) {
      <div class="card token-secret-card">
        <div class="secret-header">
          <div>
            <h3>Token wurde angelegt</h3>
            <p>Der Klartext-Token wird nur jetzt angezeigt.</p>
          </div>
          <button class="btn btn-outline btn-sm" (click)="dismissCreatedToken()">Schließen</button>
        </div>
        <div class="secret-row">
          <input
            [value]="createdToken.token"
            readonly
            aria-label="Neu erzeugter Applikationstoken"
          />
          <button class="btn btn-outline" (click)="copyCreatedToken()">Kopieren</button>
        </div>
      </div>
    }

    @if (showCreate) {
      <div class="card">
        <h3>Neues Token für dieses AP</h3>
        <form (ngSubmit)="createToken()">
          <div class="form-grid">
            <div class="form-group">
              <label>Name</label>
              <input
                [(ngModel)]="newToken.name"
                name="name"
                required
                maxlength="160"
                autocomplete="off"
              />
            </div>
            <div class="form-group">
              <label>Ablaufdatum</label>
              <input
                [(ngModel)]="newToken.expiresAtLocal"
                name="expiresAtLocal"
                type="datetime-local"
              />
            </div>
          </div>

          <div class="form-group">
            <label>Berechtigungen</label>
            <div class="scope-grid">
              @for (scope of scopeOptions; track scope.value) {
                <label class="scope-option">
                  <input
                    type="checkbox"
                    [checked]="isScopeSelected(scope.value)"
                    (change)="toggleScope(scope.value, $any($event.target).checked)"
                  />
                  <span>{{ scope.label }}</span>
                  <code>{{ scope.value }}</code>
                </label>
              }
            </div>
          </div>

          <div class="toolbar">
            <button type="submit" class="btn btn-primary" [disabled]="creating">
              {{ creating ? 'Lege an...' : 'Token anlegen' }}
            </button>
            <button
              type="button"
              class="btn btn-outline"
              [disabled]="creating"
              (click)="closeCreateForm()"
            >
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    }

    <div class="card">
      <div class="table-header">
        <div>
          <h3>Ausgestellte AP-Tokens</h3>
          <span class="table-meta">{{ total }} insgesamt</span>
        </div>
        <div class="pager">
          <button
            class="btn btn-outline btn-sm"
            [disabled]="offset === 0 || loading"
            (click)="previousPage()"
          >
            Zurück
          </button>
          <span>{{ currentPageLabel }}</span>
          <button
            class="btn btn-outline btn-sm"
            [disabled]="!hasNextPage || loading"
            (click)="nextPage()"
          >
            Weiter
          </button>
        </div>
      </div>

      @if (loading) {
        <div class="empty-state"><h3>Lade Token...</h3></div>
      } @else if (!tokens.length) {
        <div class="empty-state"><h3>Keine Applikationstoken für dieses AP vorhanden</h3></div>
      } @else {
        <div class="table-scroll">
          <table class="table token-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Berechtigungen</th>
                <th>Status</th>
                <th>Ablauf</th>
                <th>Letzte Nutzung</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              @for (token of tokens; track token.id) {
                <tr>
                  <td>
                    <strong>{{ token.name }}</strong>
                    <div class="subtle">{{ token.createdAt | date: 'dd.MM.yyyy HH:mm' }}</div>
                  </td>
                  <td>
                    <code>{{ token.tokenPrefix }}</code>
                  </td>
                  <td>
                    <div class="scope-tags">
                      @for (scope of token.scopes; track scope) {
                        <span class="badge badge-info">{{ scope }}</span>
                      }
                    </div>
                  </td>
                  <td>
                    <span
                      class="badge"
                      [class.badge-success]="token.active && !token.revokedAt"
                      [class.badge-danger]="!token.active || token.revokedAt"
                      [class.badge-warning]="isExpired(token)"
                    >
                      {{ statusLabel(token) }}
                    </span>
                  </td>
                  <td>
                    {{ token.expiresAt ? (token.expiresAt | date: 'dd.MM.yyyy HH:mm') : 'Nie' }}
                  </td>
                  <td>
                    {{
                      token.lastUsedAt ? (token.lastUsedAt | date: 'dd.MM.yyyy HH:mm') : 'Noch nie'
                    }}
                  </td>
                  <td>
                    @if (canRevoke(token)) {
                      <button class="btn btn-sm btn-danger" (click)="openRevokeDialog(token)">
                        Widerrufen
                      </button>
                    } @else {
                      <span class="subtle">Keine Aktion</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <app-confirm-dialog
      [open]="revokeDialogOpen"
      [title]="revokeDialogTitle"
      [message]="revokeDialogMessage"
      [details]="revokeDialogDetails"
      [error]="revokeDialogError"
      [busy]="revokeDialogBusy"
      busyLabel="Widerrufe Token..."
      confirmLabel="Token widerrufen"
      confirmVariant="danger"
      (confirmed)="confirmRevoke()"
      (cancelled)="closeRevokeDialog()"
    />
  `,
  styles: [
    `
      .header-actions,
      .secret-header,
      .table-header,
      .pager {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .header-actions,
      .pager {
        flex-wrap: wrap;
      }

      .secret-header,
      .table-header {
        justify-content: space-between;
        margin-bottom: 14px;
      }

      .secret-header p,
      .table-meta,
      .subtle {
        color: var(--color-text-secondary);
        font-size: 0.82rem;
      }

      .token-secret-card {
        border: 1px solid rgba(39, 174, 96, 0.25);
      }

      .secret-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
      }

      .secret-row input {
        width: 100%;
        min-width: 0;
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.86rem;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
      }

      .scope-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: 8px;
      }

      .scope-option {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 6px 8px;
        align-items: center;
        padding: 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        cursor: pointer;
      }

      .scope-option input {
        width: auto;
      }

      .scope-option code {
        grid-column: 2;
        color: var(--color-text-secondary);
        font-size: 0.76rem;
      }

      .table-scroll {
        overflow-x: auto;
      }

      .token-table td {
        vertical-align: top;
      }

      .scope-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      @media (max-width: 720px) {
        .page-header,
        .secret-header,
        .table-header {
          align-items: flex-start;
          flex-direction: column;
        }

        .secret-row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ApApplicationTokensComponent implements OnInit {
  apId = '';
  tokens: ApplicationToken[] = [];
  total = 0;
  limit = 50;
  offset = 0;
  loading = false;
  creating = false;
  error = '';
  message = '';
  showCreate = false;
  createdToken: CreatedApplicationToken | null = null;
  readonly scopeOptions = SCOPE_OPTIONS;
  newToken: {
    name: string;
    expiresAtLocal: string;
    scopes: ServerApiScope[];
  } = {
    name: '',
    expiresAtLocal: '',
    scopes: ['ap.read'],
  };

  revokeDialogOpen = false;
  revokeDialogBusy = false;
  revokeDialogError = '';
  revokeDialogToken: ApplicationToken | null = null;

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.apId = this.route.parent?.snapshot.paramMap.get('apId') || '';
    this.load();
  }

  get hasNextPage(): boolean {
    return this.offset + this.limit < this.total;
  }

  get currentPageLabel(): string {
    if (!this.total) {
      return '0 von 0';
    }
    const from = this.offset + 1;
    const to = Math.min(this.offset + this.limit, this.total);
    return `${from}-${to} von ${this.total}`;
  }

  get revokeDialogTitle(): string {
    if (!this.revokeDialogToken) return 'Token widerrufen';
    return `Token "${this.revokeDialogToken.name}" widerrufen`;
  }

  get revokeDialogMessage(): string {
    return 'Dieser Token wird sofort für externe Anwendungen ungültig.';
  }

  get revokeDialogDetails(): string[] {
    const prefix = this.revokeDialogToken?.tokenPrefix;
    return prefix ? [`Prefix: ${prefix}`, 'Die Aktion kann nicht rückgängig gemacht werden.'] : [];
  }

  load() {
    if (!this.apId) return;
    this.loading = true;
    this.error = '';

    this.api
      .getApApplicationTokens(this.apId, { limit: this.limit, offset: this.offset })
      .subscribe({
        next: (result) => {
          this.tokens = result.items;
          this.total = result.total;
          this.limit = result.limit;
          this.offset = result.offset;
          this.loading = false;
        },
        error: (err) => {
          this.error = err.error?.message || 'Fehler beim Laden der Applikationstoken';
          this.loading = false;
        },
      });
  }

  openCreateForm() {
    this.error = '';
    this.message = '';
    this.showCreate = true;
  }

  closeCreateForm() {
    if (this.creating) return;
    this.showCreate = false;
    this.resetCreateForm();
  }

  isScopeSelected(scope: ServerApiScope): boolean {
    return this.newToken.scopes.includes(scope);
  }

  toggleScope(scope: ServerApiScope, checked: boolean) {
    if (checked && !this.newToken.scopes.includes(scope)) {
      this.newToken.scopes = [...this.newToken.scopes, scope];
      return;
    }
    if (!checked) {
      this.newToken.scopes = this.newToken.scopes.filter((selected) => selected !== scope);
    }
  }

  createToken() {
    const name = this.newToken.name.trim();
    if (!name) {
      this.error = 'Name ist erforderlich.';
      return;
    }
    if (!this.newToken.scopes.length) {
      this.error = 'Mindestens eine Berechtigung ist erforderlich.';
      return;
    }

    const expiresAt = this.parseExpiresAt();
    if (expiresAt === false) {
      return;
    }

    this.error = '';
    this.message = '';
    this.creating = true;

    this.api
      .createApApplicationToken(this.apId, {
        name,
        scopes: this.newToken.scopes,
        expiresAt,
      })
      .subscribe({
        next: (created) => {
          this.createdToken = created;
          this.creating = false;
          this.showCreate = false;
          this.resetCreateForm();
          this.load();
        },
        error: (err) => {
          this.error = err.error?.message || 'Fehler beim Anlegen des Applikationstokens';
          this.creating = false;
        },
      });
  }

  dismissCreatedToken() {
    this.createdToken = null;
  }

  async copyCreatedToken() {
    if (!this.createdToken?.token) return;
    try {
      await navigator.clipboard.writeText(this.createdToken.token);
      this.message = 'Token kopiert.';
    } catch {
      this.error = 'Token konnte nicht kopiert werden.';
    }
  }

  previousPage() {
    if (this.offset === 0 || this.loading) return;
    this.offset = Math.max(0, this.offset - this.limit);
    this.load();
  }

  nextPage() {
    if (!this.hasNextPage || this.loading) return;
    this.offset += this.limit;
    this.load();
  }

  openRevokeDialog(token: ApplicationToken) {
    if (!this.canRevoke(token)) return;
    this.revokeDialogToken = token;
    this.revokeDialogError = '';
    this.revokeDialogBusy = false;
    this.revokeDialogOpen = true;
  }

  closeRevokeDialog() {
    if (this.revokeDialogBusy) return;
    this.revokeDialogOpen = false;
    this.revokeDialogError = '';
    this.revokeDialogToken = null;
  }

  confirmRevoke() {
    if (!this.revokeDialogToken || this.revokeDialogBusy) return;
    this.revokeDialogBusy = true;
    this.revokeDialogError = '';
    const tokenId = this.revokeDialogToken.id;

    this.api.revokeApApplicationToken(this.apId, tokenId).subscribe({
      next: () => {
        this.revokeDialogBusy = false;
        this.revokeDialogOpen = false;
        this.revokeDialogToken = null;
        this.message = 'Token widerrufen.';
        this.load();
      },
      error: (err) => {
        this.revokeDialogBusy = false;
        this.revokeDialogError = err.error?.message || 'Fehler beim Widerrufen des Tokens';
      },
    });
  }

  statusLabel(token: ApplicationToken): string {
    if (token.revokedAt || !token.active) {
      return 'Widerrufen';
    }
    if (this.isExpired(token)) {
      return 'Abgelaufen';
    }
    return 'Aktiv';
  }

  isExpired(token: ApplicationToken): boolean {
    return Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
  }

  canRevoke(token: ApplicationToken): boolean {
    return (
      token.active &&
      !token.revokedAt &&
      token.allowedApIds?.length === 1 &&
      token.allowedApIds[0] === this.apId
    );
  }

  private parseExpiresAt(): string | null | false {
    const raw = this.newToken.expiresAtLocal.trim();
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.error = 'Ablaufdatum ist ungültig.';
      return false;
    }
    if (parsed <= new Date()) {
      this.error = 'Ablaufdatum muss in der Zukunft liegen.';
      return false;
    }
    return parsed.toISOString();
  }

  private resetCreateForm() {
    this.newToken = {
      name: '',
      expiresAtLocal: '',
      scopes: ['ap.read'],
    };
  }
}
