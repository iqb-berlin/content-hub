import { CapabilitiesComponent } from '../../shared/capabilities/capabilities.component';
import { sequenceLabel } from '../../shared/sequence-label';
import { Component, ElementRef, ViewChild, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import {
  Acp,
  AcpRoleAssignment,
  AcpRoleName,
  AssignableAcpUser,
} from '../../core/models/api.models';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { BookletSelectionComponent } from '../../shared/components/booklet-selection.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CapabilitiesComponent,
    FormsModule,
    RouterLink,
    JsonPipe,
    AcpManagerContextComponent,
    ConfirmDialogComponent,
    BookletSelectionComponent,
  ],
  template: `
    @if (acp) {
      <app-acp-manager-context />

      <div class="page-header">
        <div class="header-main">
          @if (editingName) {
            <input
              [(ngModel)]="editName"
              (keyup.enter)="saveName()"
              (keyup.escape)="cancelEditName()"
              class="input-lg"
            />
            <button class="btn btn-primary btn-sm" (click)="saveName()">Speichern</button>
            <button class="btn btn-outline btn-sm" (click)="cancelEditName()">Abbrechen</button>
          } @else {
            <h1>{{ acp.name }}</h1>
            @if (canEditName) {
              <button class="btn btn-sm btn-link" (click)="startEditName()" title="Umbenennen">
                ✏️
              </button>
            }
          }
        </div>
      </div>

      @if (error) {
        <div class="alert alert-error">{{ error }}</div>
      }
      @if (indexSuccessMessage) {
        <div class="alert alert-success">{{ indexSuccessMessage }}</div>
      }

      <section class="card overview-section" aria-labelledby="content-heading">
        <h2 id="content-heading">Inhalte</h2>
        @if (contentData) {
          <div class="grid content-grid">
            @if (
              contentData.capabilities?.includes('item-explorer:view') ||
              contentData.capabilities?.includes('item-explorer:edit')
            ) {
              <a
                [routerLink]="['/view', acp.id, 'item-explorer']"
                class="card link-card primary-content"
              >
                <span class="tile-icon" aria-hidden="true">🔭</span>
                <div>
                  <h3>Item-Explorer</h3>
                  <p>Items prüfen, kommentieren und bearbeiten</p>
                </div>
                <span class="tile-arrow" aria-hidden="true">›</span>
              </a>
            }
            @if (
              contentData.units?.length &&
              contentData.featureConfig?.enableUnitListNavigation !== false
            ) {
              <a [routerLink]="['/view', acp.id, 'units']" class="card link-card">
                <span class="tile-icon" aria-hidden="true">📝</span>
                <div>
                  <h3>Aufgaben ansehen</h3>
                  <p>
                    Vollständige Aufgaben öffnen · {{ contentData.units.length }}
                    {{ contentData.units.length === 1 ? 'Aufgabe' : 'Aufgaben' }}
                  </p>
                </div>
                <span class="tile-arrow" aria-hidden="true">›</span>
              </a>
            }
            @if (
              contentData.sequences?.length &&
              contentData.featureConfig?.enableSequenceNavigation !== false
            ) {
              @for (sequence of nonBookletSequences; track sequence.kind + ':' + sequence.id) {
                <a [routerLink]="['/view', acp.id, 'sequence', sequence.id]" class="card link-card">
                  <span class="tile-icon" aria-hidden="true">📋</span>
                  <div>
                    <h3>Aufgabenfolge</h3>
                    <p>{{ sequenceLabel(sequence) }}</p>
                  </div>
                  <span class="tile-arrow" aria-hidden="true">›</span>
                </a>
              }
            }
          </div>
          @if (
            bookletSequences.length && contentData.featureConfig?.enableSequenceNavigation !== false
          ) {
            <app-booklet-selection
              [acpId]="acp.id"
              [booklets]="bookletSequences"
              actionLabel="Öffnen"
            />
          }
        } @else {
          <p>{{ contentError || 'Inhalte werden geladen …' }}</p>
        }
      </section>

      <section class="card overview-section" aria-labelledby="management-heading">
        <h2 id="management-heading">Verwaltung</h2>
        <div class="grid management-grid">
          <a [routerLink]="['/manage', acp.id, 'files']" class="card link-card">
            <span class="tile-icon" aria-hidden="true">📁</span>
            <div>
              <h3>Dateien verwalten</h3>
              <p>Dateien hochladen, prüfen und herunterladen</p>
            </div>
          </a>
          <a [routerLink]="['/manage', acp.id, 'snapshots']" class="card link-card">
            <span class="tile-icon" aria-hidden="true">📸</span>
            <div>
              <h3>Sicherungsstände</h3>
              <p>Paketstand sichern und wiederherstellen</p>
            </div>
          </a>
          <a [routerLink]="['/manage', acp.id, 'access']" class="card link-card">
            <span class="tile-icon" aria-hidden="true">🔐</span>
            <div>
              <h3>Zugriff &amp; Funktionen</h3>
              <p>Zugang und Funktionen festlegen</p>
            </div>
          </a>
          @if (contentData?.capabilities?.includes('review:manage')) {
            <a
              [routerLink]="['/view', acp.id, 'review', 'manage']"
              class="card link-card review-card"
            >
              <span class="tile-icon" aria-hidden="true">💬</span>
              <div>
                <h3>Review</h3>
                <p>
                  <span
                    class="badge"
                    [class.badge-success]="contentData?.featureConfig?.enableReview"
                    [class.badge-warning]="!contentData?.featureConfig?.enableReview"
                  >
                    {{ contentData?.featureConfig?.enableReview ? 'Aktiv' : 'Nicht aktiviert' }}
                  </span>
                  · Bereitschaft, Freigabe und Kommentare verwalten
                </p>
              </div>
            </a>
          }
          <a [routerLink]="['/manage', acp.id, 'application-tokens']" class="card link-card">
            <span class="tile-icon" aria-hidden="true">🔑</span>
            <div>
              <h3>API-Zugänge</h3>
              <p>Zugriff für externe Anwendungen verwalten</p>
            </div>
          </a>
        </div>
      </section>

      <details class="card index-section">
        <summary>Paketstruktur (ACP-Index)</summary>
        <div class="toolbar index-actions">
          <a [routerLink]="['/view', acp.id, 'index']" class="btn btn-outline">Struktur ansehen</a>
          <button #indexTrigger class="btn btn-outline" (click)="openIndexDialog()">
            JSON anzeigen
          </button>
          <a [href]="api.getIndexExportUrl(acp.id)" class="btn btn-outline">Exportieren</a>
          <label class="btn btn-accent"
            >Importieren
            <input type="file" accept=".json" (change)="importIndex($event)" hidden />
          </label>
          <button class="btn btn-outline danger-action" (click)="openDeleteIndexDialog()">
            Index zurücksetzen
          </button>
        </div>
      </details>

      <dialog
        #indexDialog
        class="index-dialog"
        aria-labelledby="index-dialog-title"
        (close)="restoreIndexFocus()"
      >
        <div class="index-dialog-header">
          <h2 id="index-dialog-title">ACP-Index als JSON</h2>
          <button class="btn btn-outline btn-sm" (click)="closeIndexDialog()" autofocus>
            Schließen
          </button>
        </div>
        <pre class="json-view" tabindex="0" aria-label="ACP-Index JSON">{{
          acp.acpIndex | json
        }}</pre>
      </dialog>

      <section class="card roles-card" aria-labelledby="roles-heading">
        <h2 id="roles-heading">Personen &amp; Rollen</h2>
        <p class="roles-help">
          ACP-Manager verwalten das Paket. „Nur lesend“ erlaubt keine Paketverwaltung. Rechte für
          Review und Item Explorer gelten zusätzlich und unabhängig von der Paketrolle. Änderungen
          pro Person speichern.
        </p>
        @if (roleError) {
          <p class="alert alert-error" role="alert">{{ roleError }}</p>
        }
        @if (roleStatus) {
          <p class="role-status" role="status">{{ roleStatus }}</p>
        }
        <div class="roles-table-scroll">
          <table class="roles-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Paketrolle</th>
                <th scope="col">Review</th>
                <th scope="col">Item Explorer</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              @for (role of roles; track role.id) {
                <tr [class.assignment-changed]="hasAssignmentChanges(role)">
                  <th scope="row" class="person-name">
                    {{ role.user?.displayName || role.user?.username || role.userId }}
                  </th>
                  <td data-label="Paketrolle">
                    <select
                      class="form-select"
                      [ngModel]="roleEdits[role.userId] ?? role.role"
                      (ngModelChange)="roleEdits[role.userId] = $event"
                      [attr.aria-label]="
                        'Rolle für ' +
                        (role.user?.displayName || role.user?.username || role.userId)
                      "
                      [disabled]="roleBusy"
                    >
                      <option value="ACP_MANAGER" [disabled]="!canAssignManager">
                        ACP-Manager
                      </option>
                      <option value="READ_ONLY">Nur lesend</option>
                    </select>
                  </td>
                  <td data-label="Review">
                    <app-capabilities
                      class="role-capabilities"
                      group="review"
                      [value]="capabilityEdits[role.userId] ?? role.capabilities ?? []"
                      [disabled]="roleBusy"
                      [compact]="true"
                      [showHint]="false"
                      (valueChange)="capabilityEdits[role.userId] = $event"
                    />
                  </td>
                  <td data-label="Item Explorer">
                    <app-capabilities
                      class="role-capabilities"
                      group="item-explorer"
                      [value]="capabilityEdits[role.userId] ?? role.capabilities ?? []"
                      [disabled]="roleBusy"
                      [compact]="true"
                      [showHint]="false"
                      (valueChange)="capabilityEdits[role.userId] = $event"
                    />
                  </td>
                  <td>
                    <div class="role-actions">
                      <button
                        class="btn btn-primary btn-sm"
                        (click)="saveAssignment(role)"
                        [disabled]="roleBusy || !hasAssignmentChanges(role)"
                      >
                        Änderungen speichern
                      </button>
                      <button
                        class="btn btn-link btn-sm"
                        (click)="removeRole(role.userId)"
                        [disabled]="roleBusy || (role.role === 'ACP_MANAGER' && !canAssignManager)"
                      >
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5">Noch keine Personen zugewiesen.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <details class="add-person">
          <summary>Person hinzufügen</summary>
          @if (availableUsers.length) {
            <div class="add-person-layout">
              <div class="add-person-fields">
                <div class="add-person-field">
                  <label for="new-role-person">Person</label>
                  <select
                    id="new-role-person"
                    [(ngModel)]="selectedUserId"
                    class="form-select"
                    [disabled]="roleBusy"
                  >
                    <option value="">Person auswählen …</option>
                    @for (u of availableUsers; track u.id) {
                      <option [value]="u.id">{{ u.displayName || u.username }}</option>
                    }
                  </select>
                </div>
                <div class="add-person-field">
                  <label for="new-role-value">Paketrolle</label>
                  <select
                    id="new-role-value"
                    [(ngModel)]="selectedRole"
                    class="form-select"
                    [disabled]="roleBusy"
                  >
                    <option value="ACP_MANAGER" [disabled]="!canAssignManager">ACP-Manager</option>
                    <option value="READ_ONLY">Nur lesend</option>
                  </select>
                </div>
              </div>
              <app-capabilities
                class="new-person-capabilities"
                [(value)]="newCapabilities"
                [disabled]="roleBusy"
                [compact]="true"
                [showHint]="false"
              />
              <button
                class="btn btn-primary btn-sm add-person-button"
                (click)="assignRole()"
                [disabled]="roleBusy || !selectedUserId"
              >
                Person hinzufügen
              </button>
            </div>
          } @else {
            <p>Alle verfügbaren Personen sind bereits zugewiesen.</p>
          }
        </details>
      </section>

      <app-confirm-dialog
        [open]="showDeleteIndexDialog"
        title="ACP-Index zurücksetzen"
        message="Der aktuelle ACP-Index wird auf den Standardzustand zurückgesetzt."
        [details]="[
          'Diese Aktion betrifft den gesamten Index (inkl. Struktur und Metadaten).',
          'Dateien bleiben erhalten, können aber im Index fehlen, bis erneut synchronisiert/importiert wird.',
        ]"
        [error]="deleteIndexError"
        [busy]="deletingIndex"
        busyLabel="Index wird zurückgesetzt..."
        confirmLabel="Zurücksetzen"
        confirmVariant="danger"
        (confirmed)="confirmDeleteIndex()"
        (cancelled)="closeDeleteIndexDialog()"
      />
    }
  `,
  styles: [
    `
      .overview-section {
        margin-bottom: 16px;
      }
      .overview-section h2,
      .roles-card h2 {
        font-size: 1.05rem;
        margin-bottom: 16px;
      }
      .grid.content-grid {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
      }
      .grid.management-grid {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
      }
      .grid .link-card {
        display: flex;
        align-items: center;
        gap: 16px;
        margin: 0;
        padding: 20px;
      }
      .grid .link-card h3 {
        font-size: 1rem;
      }
      .tile-icon {
        font-size: 1.8rem;
        flex-shrink: 0;
      }
      .tile-arrow {
        margin-left: auto;
        font-size: 1.8rem;
      }
      .primary-content {
        background: #f0f7fc;
        border-color: #aacfe8;
      }
      .index-section {
        margin-bottom: 16px;
      }
      .index-section summary {
        cursor: pointer;
        font-weight: 600;
      }
      .index-actions {
        margin-top: 16px;
        flex-wrap: wrap;
      }
      .danger-action {
        color: var(--color-danger-text);
      }
      .index-dialog {
        width: min(900px, calc(100vw - 32px));
        max-height: 80dvh;
        padding: 24px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: var(--color-surface);
        color: var(--color-text);
        margin: auto;
      }
      .index-dialog::backdrop {
        background: rgba(0, 0, 0, 0.4);
      }
      .index-dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
      }
      .index-dialog-header h2 {
        font-size: 1.15rem;
      }
      .roles-card button:disabled {
        opacity: 0.5;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 16px;
        margin-bottom: 0;
      }
      .header-main {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .link-card {
        text-decoration: none;
        color: inherit;
        transition:
          transform 0.15s,
          box-shadow 0.15s;
        cursor: pointer;
      }
      .link-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        text-decoration: none;
      }
      .link-card p {
        color: var(--color-text-secondary);
        font-size: 0.85rem;
        margin-top: 4px;
      }
      .json-view {
        background: var(--color-bg);
        padding: 16px;
        border-radius: var(--radius);
        overflow-x: auto;
        font-size: 0.8rem;
        max-height: 55dvh;
        margin-top: 12px;
      }
      .roles-table-scroll {
        overflow-x: auto;
      }
      .roles-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
        min-width: 800px;
      }
      .roles-table th,
      .roles-table td {
        padding: 12px 8px;
        border-bottom: 1px solid var(--color-border);
        text-align: left;
      }
      .roles-table thead th {
        color: var(--color-text-secondary);
        font-size: 0.85rem;
        font-weight: 600;
      }
      .roles-table th:nth-child(1) {
        width: 24%;
      }
      .roles-table th:nth-child(2) {
        width: 190px;
      }
      .roles-table th:nth-child(3) {
        width: 150px;
      }
      .roles-table th:nth-child(4) {
        width: 150px;
      }
      .roles-table th:nth-child(5) {
        width: 170px;
      }
      .assignment-changed {
        background: var(--color-bg);
      }
      .person-name {
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      .role-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .roles-help {
        color: var(--color-text-secondary);
        font-size: 0.88rem;
        margin: -6px 0 14px;
      }
      .roles-table select {
        width: 100%;
      }
      .add-person {
        margin-top: 20px;
        padding: 16px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        background: var(--color-bg);
      }
      .add-person summary {
        cursor: pointer;
        font-weight: 600;
      }
      .add-person[open] summary {
        margin-bottom: 16px;
      }
      .add-person-fields {
        display: flex;
        align-items: end;
        gap: 12px;
        flex-wrap: wrap;
      }
      .add-person-layout {
        display: grid;
        grid-template-columns: minmax(250px, 1fr) minmax(330px, 1.2fr) auto;
        align-items: end;
        gap: 16px;
      }
      .add-person-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.85rem;
        flex: 1 1 170px;
      }
      .add-person-button {
        white-space: nowrap;
      }
      .role-status {
        color: var(--color-text-secondary);
        margin: 12px 0;
      }
      @media (min-width: 901px) {
        .roles-table td[data-label='Paketrolle'] {
          padding-right: 32px;
        }
      }
      @media (max-width: 1000px) {
        .add-person-layout {
          grid-template-columns: 1fr;
          align-items: stretch;
        }
        .add-person-button {
          justify-self: start;
        }
      }
      @media (max-width: 900px) {
        .roles-table {
          min-width: 0;
        }
        .roles-table thead {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
        }
        .roles-table tbody {
          display: grid;
          gap: 12px;
        }
        .roles-table tr {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          padding: 12px;
          gap: 12px;
        }
        .roles-table th,
        .roles-table td {
          border: 0;
          padding: 0;
          width: auto;
          min-width: 0;
        }
        .roles-table th:nth-child(1) {
          width: auto;
        }
        .roles-table .person-name,
        .roles-table td[data-label='Paketrolle'],
        .roles-table td:last-child {
          grid-column: 1 / -1;
        }
        .roles-table td[data-label]::before {
          content: attr(data-label);
          display: block;
          font-size: 0.8rem;
          color: var(--color-text-secondary);
          font-weight: 600;
          margin-bottom: 8px;
        }
        .role-actions {
          padding-top: 8px;
          border-top: 1px solid var(--color-border);
        }
      }
      @media (max-width: 650px) {
        .add-person-field {
          width: 100%;
        }
      }
      .form-select {
        padding: 6px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-size: 0.85rem;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  sequenceLabel = sequenceLabel;
  acp: Acp | null = null;
  roles: AcpRoleAssignment[] = [];
  allUsers: AssignableAcpUser[] = [];
  contentData: any = null;
  contentError = '';
  @ViewChild('indexDialog') indexDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('indexTrigger') indexTrigger?: ElementRef<HTMLButtonElement>;

  openIndexDialog() {
    this.indexDialog?.nativeElement.showModal();
  }
  closeIndexDialog() {
    this.indexDialog?.nativeElement.close();
  }
  restoreIndexFocus() {
    this.indexTrigger?.nativeElement.focus();
  }
  selectedUserId = '';
  selectedRole: AcpRoleName = 'READ_ONLY';
  roleEdits: Record<string, AcpRoleName | undefined> = {};
  capabilityEdits: Record<string, string[] | undefined> = {};
  roleBusy = false;
  roleError = '';
  roleStatus = '';

  get canAssignManager(): boolean {
    return this.auth.isAdmin;
  }

  get availableUsers(): AssignableAcpUser[] {
    return this.allUsers.filter((user) => !this.roles.some((role) => role.userId === user.id));
  }

  get bookletSequences(): any[] {
    return (this.contentData?.sequences || []).filter(
      (sequence: any) => sequence.kind === 'booklet',
    );
  }

  get nonBookletSequences(): any[] {
    return (this.contentData?.sequences || []).filter(
      (sequence: any) => sequence.kind !== 'booklet',
    );
  }

  myRole: string | null = null;
  editingName = false;
  editName = '';
  error = '';
  indexSuccessMessage = '';
  showDeleteIndexDialog = false;
  deletingIndex = false;
  deleteIndexError = '';

  get canEditName(): boolean {
    return this.auth.isAdmin || this.myRole === 'ACP_MANAGER';
  }

  constructor(
    private route: ActivatedRoute,
    public api: ApiService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('acpId')!;
    this.api.getAcp(id).subscribe((acp) => (this.acp = acp));
    this.api.getAcpStartPage(id).subscribe({
      next: (data) => (this.contentData = data),
      error: () => (this.contentError = 'Inhalte konnten nicht geladen werden.'),
    });
    this.api.getAcpRoles(id).subscribe((roles) => {
      this.roles = roles;
      const myId = this.auth.currentUser?.id;
      const myAssignment = roles.find((r) => r.userId === myId);
      this.myRole = myAssignment ? myAssignment.role : null;
    });
    this.api.getAssignableUsers(id).subscribe((users) => {
      this.allUsers = users;
    });
  }

  private reloadContent() {
    if (!this.acp) return;
    this.api.getAcpStartPage(this.acp.id).subscribe({
      next: (data) => {
        this.contentData = data;
        this.contentError = '';
      },
      error: () => {
        this.contentData = null;
        this.contentError = 'Inhalte konnten nicht geladen werden.';
      },
    });
  }

  importIndex(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.acp) return;
    this.indexSuccessMessage = '';
    this.error = '';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        this.api.importAcpIndex(this.acp!.id, data).subscribe({
          next: (idx) => {
            this.acp!.acpIndex = idx;
            this.error = '';
            this.indexSuccessMessage = 'ACP-Index wurde importiert.';
            this.reloadContent();
          },
          error: () => (this.error = 'ACP-Index konnte nicht importiert werden.'),
        });
      } catch {
        this.error = 'Ungültige JSON-Datei';
      }
    };
    reader.readAsText(file);
  }

  openDeleteIndexDialog() {
    this.showDeleteIndexDialog = true;
    this.deleteIndexError = '';
  }

  closeDeleteIndexDialog() {
    if (this.deletingIndex) return;
    this.showDeleteIndexDialog = false;
    this.deleteIndexError = '';
  }

  confirmDeleteIndex() {
    if (!this.acp || this.deletingIndex) return;
    this.deletingIndex = true;
    this.deleteIndexError = '';
    this.indexSuccessMessage = '';

    this.api.deleteAcpIndex(this.acp.id).subscribe({
      next: (idx) => {
        this.acp!.acpIndex = idx;
        this.indexSuccessMessage = 'ACP-Index wurde auf den Standardzustand zurückgesetzt.';
        this.deletingIndex = false;
        this.showDeleteIndexDialog = false;
        this.reloadContent();
      },
      error: (err) => {
        this.deletingIndex = false;
        this.deleteIndexError = err?.error?.message || 'Fehler beim Zurücksetzen des ACP-Index.';
      },
    });
  }

  assignRole() {
    if (
      !this.selectedUserId ||
      !this.availableUsers.some((user) => user.id === this.selectedUserId)
    )
      return;
    this.persistRole(this.selectedUserId, this.selectedRole, this.newCapabilities);
  }

  newCapabilities: string[] = [];
  hasAssignmentChanges(role: AcpRoleAssignment): boolean {
    const nextRole = this.roleEdits[role.userId] ?? role.role;
    const nextCapabilities = this.capabilityEdits[role.userId] ?? role.capabilities ?? [];
    return (
      nextRole !== role.role || !this.sameCapabilities(nextCapabilities, role.capabilities || [])
    );
  }

  saveAssignment(assignment: AcpRoleAssignment) {
    if (!this.hasAssignmentChanges(assignment)) return;
    this.persistRole(
      assignment.userId,
      this.roleEdits[assignment.userId] ?? assignment.role,
      this.capabilityEdits[assignment.userId] ?? assignment.capabilities ?? [],
    );
  }

  private persistRole(userId: string, role: AcpRoleName, capabilities: string[]) {
    if (!this.acp || this.roleBusy) return;
    this.roleBusy = true;
    this.roleError = '';
    this.roleStatus = '';
    const assignment = this.roles.find((entry) => entry.userId === userId);
    const save =
      assignment?.role === role
        ? this.api.updateRoleCapabilities(this.acp.id, userId, capabilities)
        : this.api.assignAcpRole(this.acp.id, { userId, role, capabilities });
    save.subscribe({
      next: (saved) => {
        const existing = this.roles.find((entry) => entry.userId === userId);
        const updated = {
          ...existing,
          ...saved,
          userId,
          role: saved.role ?? role,
          user: existing?.user || this.allUsers.find((user) => user.id === userId),
        };
        this.roles = existing
          ? this.roles.map((entry) => (entry.userId === userId ? updated : entry))
          : [...this.roles, updated];
        delete this.roleEdits[userId];
        delete this.capabilityEdits[userId];
        if (this.selectedUserId === userId) {
          this.selectedUserId = '';
          this.newCapabilities = [];
        }
        if (this.auth.currentUser?.id === userId) this.myRole = updated.role;
        this.roleBusy = false;
        this.roleStatus = existing ? 'Zuordnung gespeichert.' : 'Person hinzugefügt.';
      },
      error: (err) => {
        this.roleBusy = false;
        this.roleError = this.mapRoleError(err, 'Die Rolle konnte nicht gespeichert werden.');
      },
    });
  }

  removeRole(userId: string) {
    if (!this.acp || this.roleBusy) return;
    this.roleBusy = true;
    this.roleError = '';
    this.roleStatus = '';
    this.api.removeAcpRole(this.acp.id, userId).subscribe({
      next: () => {
        this.roles = this.roles.filter((role) => role.userId !== userId);
        delete this.roleEdits[userId];
        delete this.capabilityEdits[userId];
        if (this.auth.currentUser?.id === userId) this.myRole = null;
        this.roleBusy = false;
        this.roleStatus = 'Rollenzuweisung entfernt.';
      },
      error: (err) => {
        this.roleBusy = false;
        this.roleError = this.mapRoleError(err, 'Die Rolle konnte nicht entfernt werden.');
      },
    });
  }

  private sameCapabilities(left: string[], right: string[]): boolean {
    const normalizedLeft = [...new Set(left)].sort();
    const normalizedRight = [...new Set(right)].sort();
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((capability, index) => capability === normalizedRight[index])
    );
  }

  startEditName() {
    if (!this.acp) return;
    this.editName = this.acp.name;
    this.editingName = true;
  }

  cancelEditName() {
    this.editingName = false;
    this.editName = '';
  }

  saveName() {
    if (!this.acp || !this.editName.trim()) return;
    this.api.updateAcp(this.acp.id, { name: this.editName.trim() }).subscribe({
      next: (acp) => {
        this.acp = acp;
        this.editingName = false;
      },
      error: (err) => (this.error = err.error?.message || 'Fehler beim Speichern'),
    });
  }

  private mapRoleError(err: any, fallback: string): string {
    const message = err?.error?.message || '';

    if (
      typeof message === 'string' &&
      message.includes('At least one ACP_MANAGER must remain assigned')
    ) {
      return 'Mindestens ein ACP-Manager muss zugewiesen bleiben. Bitte zuerst einer anderen Person die Manager-Rolle geben.';
    }

    if (
      typeof message === 'string' &&
      message.includes('Only Application Admins can remove ACP_MANAGER role')
    ) {
      return 'Nur App-Admins dürfen ACP-Manager-Rollen entfernen.';
    }

    if (
      typeof message === 'string' &&
      message.includes('Only Application Admins can assign ACP_MANAGER role')
    ) {
      return 'Nur App-Admins dürfen ACP-Manager-Rollen zuweisen.';
    }

    return message || fallback;
  }
}
