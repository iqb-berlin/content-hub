import { Component, Inject, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ReviewReadiness } from '../../core/models/api.models';
import { BookletSelectionComponent } from '../../shared/components/booklet-selection.component';

interface ReviewMember {
  kind: 'user' | 'credential';
  id: string;
  label?: string;
}
interface ReviewGroup {
  id?: string;
  name: string;
  archived: boolean;
  members: ReviewMember[];
}
interface ReviewConfig {
  enableReview: boolean;
  visibilityMode: 'PRIVATE' | 'SHARED' | 'GROUP';
  configVersion: number;
  groups: ReviewGroup[];
}

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, BookletSelectionComponent],
  selector: 'app-review',
  styles: [
    `
      :host {
        display: block;
      }
      fieldset {
        min-width: 0;
        margin: 1.25rem 0;
        padding: 1rem;
        border: 1px solid #d6dfe5;
        border-radius: 0.5rem;
      }
      fieldset fieldset {
        background: #fff;
      }
      legend {
        padding: 0 0.4rem;
        font-weight: 600;
      }
      label {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.3rem 0.75rem 0.3rem 0;
      }
      input:not([type='checkbox']),
      select {
        max-width: 100%;
        padding: 0.5rem 0.65rem;
        border: 1px solid #b9c6d0;
        border-radius: 0.3rem;
        font: inherit;
        background: #fff;
        color: #243b4d;
      }
      input[type='checkbox'] {
        width: 1rem;
        height: 1rem;
      }
      .btn {
        margin: 0.25rem 0.35rem 0.25rem 0;
      }
      .review-status,
      .analysis-toolbar,
      .configuration-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px 24px;
      }
      .review-status {
        margin: 16px 0;
      }
      .review-navigation {
        display: flex;
        gap: 8px;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--color-border);
        padding-bottom: 12px;
      }
      .review-group {
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 16px;
        margin: 12px 0;
        background: var(--color-bg);
      }
      summary {
        cursor: pointer;
        font-weight: 600;
      }
      .review-group[open] summary {
        margin-bottom: 12px;
      }
      .analysis-card {
        margin-top: 16px;
      }
      .comment-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
        margin: 16px 0;
      }
      .comment-filters label {
        display: flex;
        flex-direction: column;
        align-items: start;
        margin: 0;
      }
      .analysis-toolbar {
        margin-top: 16px;
        align-items: end;
      }
      .analysis-toolbar label,
      .analysis-toolbar .btn {
        margin: 0;
      }
      .activation-card {
        margin: 16px 0 24px;
        border-left: 4px solid var(--color-primary);
      }
      .activation-control {
        font-weight: 600;
      }
      .archive-help {
        margin: 8px 0 16px;
        color: var(--color-text-secondary);
        font-size: 0.88rem;
      }
      .member-name {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .member-kind {
        font-size: 0.75rem;
        color: var(--color-text-secondary);
      }

      .analysis-toolbar label {
        display: flex;
        flex-direction: column;
        align-items: start;
      }
      .analysis-toolbar select {
        width: 100%;
      }
      .configuration-actions {
        margin-top: 12px;
      }
      .delete-group-dialog {
        width: min(520px, calc(100vw - 32px));
        max-height: calc(100dvh - 48px);
        overflow-y: auto;
        margin: auto;
        padding: 28px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        color: var(--color-text);
        background: var(--color-surface, #fff);
        box-shadow: var(--shadow);
      }
      .delete-group-dialog::backdrop {
        background: rgba(15, 23, 42, 0.5);
      }
      .delete-group-name {
        padding: 12px 16px;
        background: var(--color-bg);
        border-radius: var(--radius);
        overflow-wrap: anywhere;
        font-weight: 600;
      }
      .delete-group-dialog ul {
        padding-left: 20px;
        color: var(--color-text-secondary);
        line-height: 1.6;
      }
      .delete-group-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }
      .delete-group-actions .btn {
        margin: 0;
      }
      .member-list {
        max-height: 14rem;
        overflow-y: auto;
        margin-top: 0.5rem;
      }
      .member-list label {
        display: grid;
        grid-template-columns: 16px minmax(0, 1fr) auto;
        gap: 10px;
        margin: 0;
        padding: 8px 0;
        border-bottom: 1px solid var(--color-border);
      }
      .comment-overview {
        max-height: 60vh;
        overflow-y: auto;
      }
      .page-header {
        display: block;
        margin-bottom: 1rem;
      }
      .page-header h1 {
        margin-bottom: 0.35rem;
      }
      .readiness-card {
        margin: 1rem 0;
        padding: 1rem;
        border-left: 4px solid var(--color-border);
      }
      .readiness-card.ready {
        border-left-color: var(--color-success);
      }
      .readiness-card.warning {
        border-left-color: var(--color-warning);
      }
      .readiness-card.blocked {
        border-left-color: var(--color-danger);
      }
      .readiness-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .readiness-summary {
        color: var(--color-text-secondary);
      }
      p {
        margin: 0.65rem 0;
      }
      @media (max-width: 600px) {
        fieldset {
          padding: 0.7rem;
        }
      }
    `,
  ],
  template: `<a class="btn btn-outline btn-sm" [routerLink]="['/view', acpId]"
      >← Zur ACP-Übersicht</a
    >
    <div class="page-header">
      <h1>Review</h1>
      <p>Review vorbereiten und Rückmeldungen auswerten.</p>
    </div>
    @if (error) {
      <p class="alert alert-error" role="alert">{{ error }}</p>
    }
    <div class="card review-status" aria-label="Review-Status">
      <span
        ><strong>Review:</strong>
        {{
          config
            ? savedEnabled
              ? 'Aktiv'
              : 'Inaktiv'
            : access?.canReview
              ? 'Zugänglich'
              : 'Nicht zugänglich'
        }}</span
      >
      @if (access?.canManageReview) {
        <span><strong>Bereitschaft:</strong> {{ readinessLabel }}</span>
      }
    </div>
    <nav class="review-navigation" aria-label="Review-Bereiche">
      <button
        class="btn"
        [class.btn-primary]="activeSection === 'preparation'"
        [attr.aria-pressed]="activeSection === 'preparation'"
        (click)="activeSection = 'preparation'"
      >
        Vorbereitung
      </button>
      @if (access?.canReview) {
        <button
          class="btn"
          [class.btn-primary]="activeSection === 'analysis'"
          [attr.aria-pressed]="activeSection === 'analysis'"
          (click)="activeSection = 'analysis'"
        >
          Auswertung ({{ comments.length }})
        </button>
      }
    </nav>
    @if (activeSection === 'preparation') {
      @if (access?.canManageReview && config) {
        <section class="card activation-card" aria-labelledby="activation-heading">
          <div class="readiness-header">
            <div>
              <h2 id="activation-heading">Review freigeben</h2>
              <label class="activation-control"
                ><input
                  type="checkbox"
                  [(ngModel)]="config.enableReview"
                  [disabled]="busy || readinessBusy"
                />Review für Teilnehmende aktivieren</label
              >
            </div>
            <button
              class="btn btn-primary"
              (click)="configure()"
              [disabled]="busy || readinessBusy"
            >
              Einstellungen speichern
            </button>
          </div>
          <p>
            Die Freigabe gilt nach dem Speichern und bleibt aktiv, bis sie wieder deaktiviert wird.
            Review-Verantwortliche behalten auch bei inaktivem Review Zugriff.
          </p>
          @if (config.enableReview !== savedEnabled) {
            <p role="status">Änderung der Freigabe noch nicht gespeichert.</p>
          }
          <small
            >Speichert auch Änderungen an Kommentarsicht und Gruppen. Beim Aktivieren wird die
            Bereitschaft geprüft.</small
          >
        </section>
      }

      @if (access?.canManageReview) {
        <section
          class="card readiness-card"
          [class.ready]="!readiness?.stale && readiness?.status === 'READY'"
          [class.warning]="readiness?.stale || readiness?.status === 'WARNING'"
          [class.blocked]="readiness?.status === 'BLOCKED'"
        >
          <div class="readiness-header">
            <div>
              <h2>1. Bereitschaft prüfen</h2>
              @if (!readiness) {
                <p>Noch nicht geprüft.</p>
              } @else {
                <p>
                  <strong>{{ readinessLabel }}</strong>
                  · {{ readiness.summary.bookletCount }} Testhefte ·
                  {{ readiness.summary.unitCount }} referenzierte Aufgaben ·
                  {{ readiness.summary.validFiles }}/{{ readiness.summary.totalFiles }} Dateien ohne
                  Fehler
                </p>
                @if (readiness.stale) {
                  <p>Paket oder Prüfregeln seit der Prüfung geändert. Bitte erneut prüfen.</p>
                }
                <small>Letzte Prüfung: {{ readiness.checkedAt | date: 'medium' }}</small>
              }
            </div>
            <button class="btn btn-outline" (click)="checkReadiness()" [disabled]="readinessBusy">
              {{ readinessBusy ? 'Wird geprüft …' : 'Bereitschaft prüfen' }}
            </button>
          </div>
          @if (readinessError) {
            <p role="status">{{ readinessError }}</p>
          }
          @if (readiness?.blockers?.length) {
            <div>
              <strong>Probleme vor der Aktivierung beheben</strong>
              <ul>
                @for (blocker of readiness!.blockers; track blocker) {
                  <li>{{ blocker }}</li>
                }
              </ul>
            </div>
          }
          @if (readiness?.warnings?.length) {
            <div>
              <strong>Hinweise</strong>
              <ul>
                @for (warning of readiness!.warnings; track warning) {
                  <li>{{ warning }}</li>
                }
              </ul>
            </div>
          }
        </section>
      }
      @if (manifest) {
        <h2>2. Prüfansicht testen</h2>
        <p>Testheft auswählen und die Ansicht für das Review prüfen.</p>
        @if (manifest.booklets?.length) {
          <app-booklet-selection [acpId]="acpId" [booklets]="manifest.booklets" />
        } @else {
          <p>Dieser ACP enthält noch keine Testhefte.</p>
        }
      }
      @if (access?.canManageReview && config) {
        <fieldset [disabled]="busy">
          <legend>3. Kommentarsicht und Gruppen</legend>
          <p>
            <label
              >Kommentarsicht
              <select [(ngModel)]="config.visibilityMode">
                <option value="PRIVATE">Privat – nur eigene Kommentare</option>
                <option value="SHARED">Geteilt – alle Review-Teilnehmenden</option>
                <option value="GROUP">Innerhalb von Review-Gruppen teilen</option>
              </select>
            </label>
          </p>
          <p>Review-Verantwortliche sehen alle Kommentare. Gruppen vergeben keine Zugangsrechte.</p>
          <p>Bewertungen sind nur im geteilten Modus verfügbar.</p>
          @for (group of config.groups; track $index) {
            <details class="review-group" [open]="!group.id">
              <summary>
                {{ group.name || 'Neue Review-Gruppe' }} · {{ group.members.length }} Mitglieder{{
                  group.archived ? ' · Archiviert' : ''
                }}
              </summary>
              <label>Name <input [(ngModel)]="group.name" maxlength="120" /></label>
              <label
                ><input type="checkbox" [(ngModel)]="group.archived" /> Gruppe archivieren</label
              >
              <details class="archive-help">
                <summary
                  title="Archivierte Gruppen bleiben mit ihren Kommentaren erhalten und können wieder aktiviert werden."
                >
                  Was bedeutet Archivieren?
                </summary>
                <p>
                  In archivierten Gruppen können keine neuen Kommentare angelegt werden. Die aktive
                  Gruppenzuordnung entfällt; vorhandene Kommentare bleiben erhalten. Verantwortliche
                  können sie weiterhin auswerten. Die Sichtbarkeit eigener oder allgemein geteilter
                  Kommentare bleibt bestehen. Durch Entfernen des Hakens lässt sich die Gruppe
                  wieder aktivieren.
                </p>
              </details>
              @if (!group.id) {
                <button class="btn btn-outline btn-sm" (click)="removeDraftGroup(group)">
                  Neue Gruppe verwerfen
                </button>
              }
              @if (group.id) {
                <button class="btn btn-outline btn-sm" (click)="deleteGroup(group)">
                  Gruppe löschen
                </button>
              }
              <div class="member-list">
                @for (member of members; track member.kind + member.id) {
                  <label
                    ><input
                      type="checkbox"
                      [checked]="hasMember(group, member)"
                      (change)="toggleMember(group, member)"
                    />
                    <span class="member-name">{{ member.label }}</span>
                    @if (member.kind === 'credential') {
                      <small class="member-kind">ACP-Zugang</small>
                    }
                  </label>
                }
              </div>
            </details>
          }
          @if (deletedGroupIds.length) {
            <p role="status">
              {{ deletedGroupIds.length }} Gruppe(n) zum Löschen vorgemerkt. Bitte Einstellungen
              speichern.
            </p>
          }
          <button #addGroupButton class="btn btn-outline" (click)="addGroup()">
            Review-Gruppe hinzufügen
          </button>
          <p>
            Beim Gruppenwechsel bleiben vorhandene Kommentare in ihrer bisherigen Gruppe. Gruppen
            ohne Kommentare können gelöscht werden. Gruppen mit Kommentaren werden archiviert, damit
            ihr Verlauf erhalten bleibt.
          </p>
          <div class="configuration-actions">
            <button class="btn btn-primary" (click)="configure()" [disabled]="readinessBusy">
              Review-Konfiguration speichern
            </button>
            @if (configConflict) {
              <button class="btn btn-outline" (click)="loadConfig()">
                Aktuellen Stand laden und eigene Änderungen verwerfen
              </button>
            }
          </div>
          @if (saved) {
            <span role="status">Gespeichert</span>
          }
        </fieldset>
      }
    }
    @if (activeSection === 'analysis') {
      @if (access?.canReview) {
        <section class="card analysis-card">
          <div class="readiness-header">
            <h2>Kommentare ({{ filteredComments.length }})</h2>
            <small class="readiness-summary">Kommentare werden automatisch aktualisiert.</small>
          </div>
          <div class="comment-filters" aria-label="Kommentare filtern">
            <label
              >Kommentar durchsuchen<input
                type="search"
                [(ngModel)]="textFilter"
                placeholder="Suchtext …"
            /></label>
            <label
              >Autor/in<select [(ngModel)]="authorFilter">
                <option value="">Alle</option>
                @for (author of authors; track author) {
                  <option [value]="author">{{ author }}</option>
                }
              </select></label
            >
            <label
              >Bezug<select [(ngModel)]="targetFilter">
                <option value="">Alle</option>
                <option value="BOOKLET">Testheft</option>
                <option value="UNIT">Aufgabe</option>
                <option value="ITEM">Item</option>
                <option value="CODING">Kodierung</option>
                <option value="TASK_SEQUENCE">Aufgabenfolge</option>
              </select></label
            >
            @if (access?.canManageReview && config) {
              <label
                >Gruppe filtern
                <select [(ngModel)]="groupFilter">
                  <option value="">Alle Gruppen</option>
                  <option value="ungrouped">Ohne Gruppe</option>
                  @for (group of config.groups; track group.id) {
                    <option [value]="group.id">{{ group.name }}</option>
                  }
                </select>
              </label>
            }
            <button class="btn btn-outline btn-sm" (click)="resetFilters()">
              Filter zurücksetzen
            </button>
          </div>
          <div class="analysis-toolbar">
            <label
              >Exportumfang
              <select [(ngModel)]="exportScope" (ngModelChange)="exportFormat = 'xlsx'">
                <option value="visible">
                  {{
                    access?.canManageReview
                      ? 'Kommentare aller Personen'
                      : 'Alle sichtbaren Kommentare'
                  }}
                </option>
                <option value="personal">Eigene Kommentare</option>
              </select>
            </label>
            <label
              >Format
              <select
                aria-label="Format"
                [(ngModel)]="exportFormat"
                [disabled]="exportScope === 'visible'"
              >
                <option value="xlsx">Excel (XLSX)</option>
                @if (exportScope === 'personal') {
                  <option value="csv">CSV</option>
                }
              </select>
            </label>
            <button
              class="btn btn-primary"
              (click)="exportComments(exportScope === 'personal' ? exportFormat : undefined)"
            >
              Exportieren
            </button>
          </div>
          <label
            ><input type="checkbox" [(ngModel)]="exportAll" />Anzeigefilter beim Export
            ignorieren</label
          >
          <p class="readiness-summary">
            {{
              exportAll
                ? 'Exportiert den gesamten gewählten Umfang.'
                : 'Der Export verwendet die aktuellen Anzeigefilter.'
            }}
          </p>
          @if (commentsError) {
            <p role="alert">{{ commentsError }}</p>
          }
          <div
            class="comment-overview"
            role="region"
            aria-label="Sichtbare Kommentare"
            tabindex="0"
          >
            @for (comment of filteredComments; track comment.id) {
              <article class="card">
                <strong>{{ targetLabel(comment.targetType) }} · {{ comment.targetId }}</strong>
                <span> · {{ comment.groupName || 'Ohne Gruppe' }} · {{ comment.authorLabel }}</span>
                <p style="white-space: pre-wrap">{{ comment.commentText }}</p>
              </article>
            } @empty {
              <p>Keine Kommentare vorhanden.</p>
            }
          </div>
        </section>
      }
    }
    <dialog
      #deleteGroupDialog
      class="delete-group-dialog"
      aria-labelledby="delete-group-heading"
      aria-describedby="delete-group-description"
      (cancel)="cancelGroupDeletion()"
      (close)="restoreGroupFocus()"
    >
      <h2 id="delete-group-heading">Review-Gruppe löschen?</h2>
      <p class="delete-group-name">{{ groupToDelete?.name }}</p>
      <div id="delete-group-description">
        <p>
          Die Gruppe wird zum Löschen vorgemerkt. Wirksam wird die Löschung erst mit „Einstellungen
          speichern“.
        </p>
        <ul>
          <li>Die Mitgliedszuordnung dieser Gruppe wird entfernt.</li>
          <li>
            Gruppen mit Kommentaren können nicht gelöscht werden. Du kannst sie stattdessen
            archivieren.
          </li>
        </ul>
      </div>
      <div class="delete-group-actions">
        <button class="btn btn-outline" autofocus (click)="cancelGroupDeletion()">Abbrechen</button>
        <button class="btn btn-danger" (click)="confirmGroupDeletion()">Löschung vormerken</button>
      </div>
    </dialog>`,
})
export class ReviewComponent implements OnInit, OnDestroy {
  activeSection: 'preparation' | 'analysis' = 'preparation';
  exportScope: 'visible' | 'personal' = 'visible';
  exportFormat: 'csv' | 'xlsx' = 'xlsx';
  targetLabel(type: string): string {
    return (
      (
        { BOOKLET: 'Testheft', UNIT: 'Aufgabe', ITEM: 'Item', CODING: 'Kodierung' } as Record<
          string,
          string
        >
      )[type] || type
    );
  }
  acpId = '';
  access: any;
  manifest: any;
  error = '';
  busy = false;
  saved = false;
  configConflict = false;
  @ViewChild('deleteGroupDialog') private deleteGroupDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('addGroupButton') private addGroupButton?: ElementRef<HTMLButtonElement>;
  groupToDelete: ReviewGroup | null = null;
  private groupDeleteTrigger: HTMLElement | null = null;
  deletedGroupIds: string[] = [];
  private removedGroups: ReviewGroup[] = [];
  config: ReviewConfig | null = null;
  private savedMode = 'PRIVATE';
  savedEnabled = false;
  readiness: ReviewReadiness | null = null;
  readinessBusy = false;
  members: ReviewMember[] = [];
  comments: any[] = [];
  commentsError = '';
  groupFilter = '';
  textFilter = '';
  authorFilter = '';
  targetFilter = '';
  exportAll = false;
  readinessError = '';
  private readinessGeneration = 0;
  private readinessPoll?: ReturnType<typeof setInterval>;
  private requests = new Subscription();
  private commentsRequest: Subscription | null = null;
  private poll?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ApiService) private api: ApiService,
  ) {}
  ngOnInit() {
    this.acpId =
      this.route.snapshot.paramMap.get('acpId') ||
      this.route.parent?.snapshot.paramMap.get('acpId') ||
      '';
    this.load();
    this.readinessPoll = setInterval(() => {
      if (this.access?.canManageReview && !this.readinessBusy) this.loadReadiness();
    }, 30000);
    this.poll = setInterval(() => {
      if (this.access?.canReview) this.loadComments();
    }, 8000);
  }
  ngOnDestroy() {
    clearInterval(this.poll);
    clearInterval(this.readinessPoll);
    this.requests.unsubscribe();
    this.commentsRequest?.unsubscribe();
  }
  load(reloadConfig = true) {
    this.requests.add(
      this.api.getCapabilities(this.acpId).subscribe({
        next: (access) => {
          this.access = access;
          if (!access.canManageReview && access.canReview) this.activeSection = 'analysis';
          if (access.canManageReview && reloadConfig) {
            this.loadConfig();
            this.loadReadiness();
          }
          if (access.canReview) {
            this.requests.add(
              this.api.getReview(this.acpId).subscribe({
                next: (data) => (this.manifest = data),
                error: () => (this.error = 'Review konnte nicht geladen werden.'),
              }),
            );
            this.loadComments();
          } else {
            this.error = 'Review ist deaktiviert oder nicht zugänglich.';
            this.comments = [];
          }
        },
        error: () => (this.error = 'Kein Zugriff auf diesen ACP.'),
      }),
    );
  }
  loadConfig() {
    this.requests.add(
      this.api.getReviewConfig(this.acpId).subscribe({
        next: (config) => {
          this.removedGroups = [];
          this.deletedGroupIds = [];
          this.configConflict = false;
          this.config = config;
          this.savedMode = config.visibilityMode;
          this.savedEnabled = config.enableReview;
        },
        error: () => (this.error = 'Konfiguration konnte nicht geladen werden.'),
      }),
    );
    this.requests.add(
      this.api.getReviewMembers(this.acpId).subscribe({
        next: (members) => (this.members = members),
        error: () => (this.error = 'Gruppenmitglieder konnten nicht geladen werden.'),
      }),
    );
  }
  get authors(): string[] {
    return [...new Set(this.comments.map((comment) => comment.authorLabel || ''))]
      .filter(Boolean)
      .sort();
  }
  get displayFilters(): Record<string, string> {
    return Object.fromEntries(
      Object.entries({
        q: this.textFilter.trim(),
        author: this.authorFilter,
        groupId: this.groupFilter,
        targetType: this.targetFilter,
      }).filter(([, value]) => value),
    );
  }
  resetFilters() {
    this.textFilter = '';
    this.authorFilter = '';
    this.groupFilter = '';
    this.targetFilter = '';
  }
  loadReadiness() {
    const generation = this.readinessGeneration;
    this.requests.add(
      this.api.getReviewReadiness(this.acpId).subscribe({
        next: (result) => {
          if (!this.readinessBusy && generation === this.readinessGeneration) {
            this.readiness = result;
            this.readinessError = '';
          }
        },
        error: () => {
          if (!this.readinessBusy && generation === this.readinessGeneration) {
            this.readinessError = 'Aktualität der letzten Prüfung konnte nicht ermittelt werden.';
          }
        },
      }),
    );
  }
  deleteGroup(group: ReviewGroup) {
    if (!group.id || !this.config || this.busy) return;
    this.groupToDelete = group;
    this.groupDeleteTrigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.deleteGroupDialog?.nativeElement.showModal();
  }
  cancelGroupDeletion() {
    this.groupToDelete = null;
    this.deleteGroupDialog?.nativeElement.close();
  }
  confirmGroupDeletion() {
    const group = this.groupToDelete;
    if (!group?.id || !this.config || this.busy) return;
    this.removedGroups.push(group);
    this.deletedGroupIds.push(group.id);
    this.config.groups = this.config.groups.filter((entry) => entry !== group);
    this.groupToDelete = null;
    this.groupDeleteTrigger = null;
    this.deleteGroupDialog?.nativeElement.close();
  }
  restoreGroupFocus() {
    const target = this.groupDeleteTrigger?.isConnected
      ? this.groupDeleteTrigger
      : this.addGroupButton?.nativeElement;
    target?.focus();
    this.groupDeleteTrigger = null;
  }
  get filteredComments() {
    return this.comments.filter(
      (comment) =>
        (!this.textFilter.trim() ||
          comment.commentText.toLowerCase().includes(this.textFilter.trim().toLowerCase())) &&
        (!this.authorFilter || comment.authorLabel === this.authorFilter) &&
        (!this.targetFilter || comment.targetType === this.targetFilter) &&
        (!this.groupFilter ||
          (this.groupFilter === 'ungrouped'
            ? !comment.groupId
            : comment.groupId === this.groupFilter)),
    );
  }
  hasMember(group: ReviewGroup, member: ReviewMember) {
    return group.members.some((entry) => entry.id === member.id && entry.kind === member.kind);
  }
  toggleMember(group: ReviewGroup, member: ReviewMember) {
    if (this.hasMember(group, member))
      group.members = group.members.filter(
        (entry) => entry.id !== member.id || entry.kind !== member.kind,
      );
    else group.members.push({ kind: member.kind, id: member.id });
  }
  removeDraftGroup(group: ReviewGroup) {
    if (!group.id && this.config)
      this.config.groups = this.config.groups.filter((entry) => entry !== group);
  }
  addGroup() {
    this.config?.groups.push({ name: '', archived: false, members: [] });
  }
  get readinessLabel(): string {
    if (this.readinessError) return 'Aktualität unbekannt';
    if (this.readiness?.stale) return 'Erneute Prüfung erforderlich';
    if (this.readiness?.status === 'READY') return 'Prüfbereit';
    if (this.readiness?.status === 'WARNING') return 'Mit Hinweisen prüfbar';
    if (this.readiness?.status === 'BLOCKED') return 'Blockiert';
    return 'Noch nicht geprüft';
  }
  checkReadiness() {
    if (this.readinessBusy) return;
    this.readinessGeneration++;
    this.readinessError = '';
    this.readinessBusy = true;
    this.error = '';
    this.requests.add(
      this.api.checkReviewReadiness(this.acpId).subscribe({
        next: (readiness) => {
          this.readiness = readiness;
          this.readinessBusy = false;
        },
        error: (error) => {
          this.readinessBusy = false;
          this.error = error?.error?.message || 'Review-Bereitschaft konnte nicht geprüft werden.';
        },
      }),
    );
  }
  loadComments() {
    if (this.commentsRequest && !this.commentsRequest.closed) return;
    this.commentsRequest = this.api.getVisibleReviewComments(this.acpId).subscribe({
      next: (comments) => {
        this.comments = comments;
        this.commentsError = '';
      },
      error: () => {
        this.comments = [];
        this.commentsError = 'Kommentare konnten nicht geladen werden.';
      },
    });
  }
  configure() {
    if (!this.config || this.busy) return;
    const sharing = this.config.visibilityMode === 'SHARED' && this.savedMode !== 'SHARED';
    if (
      sharing &&
      !window.confirm(
        'Alle bereits vorhandenen Kommentare, auch aus Review-Gruppen, werden für sämtliche berechtigten Review-Teilnehmenden sichtbar. Wirklich freigeben?',
      )
    )
      return;
    const activating = this.config.enableReview && !this.savedEnabled;
    if (activating) {
      this.readinessGeneration++;
      this.readinessBusy = true;
      this.error = '';
      this.requests.add(
        this.api.checkReviewReadiness(this.acpId).subscribe({
          next: (readiness) => {
            this.readiness = readiness;
            this.readinessBusy = false;
            if (readiness.stale || readiness.status === 'BLOCKED') {
              this.error = readiness.stale
                ? 'Das Paket wurde während der Prüfung geändert. Bitte erneut prüfen.'
                : 'Der Review kann wegen technischer Blocker nicht aktiviert werden.';
              return;
            }
            const confirmWarnings =
              readiness.status !== 'WARNING' ||
              window.confirm(
                'Die Bereitschaftsprüfung enthält Hinweise. Review trotzdem aktivieren?',
              );
            if (!confirmWarnings) return;
            this.saveConfig(sharing, readiness.status === 'WARNING');
          },
          error: (error) => {
            this.readinessBusy = false;
            this.error =
              error?.error?.message || 'Review-Bereitschaft konnte nicht geprüft werden.';
          },
        }),
      );
      return;
    }
    this.saveConfig(sharing);
  }
  private saveConfig(sharing: boolean, confirmReadinessWarnings = false) {
    if (!this.config) return;
    this.busy = true;
    this.saved = false;
    this.error = '';
    this.requests.add(
      this.api
        .configureReview(this.acpId, {
          ...this.config,
          deletedGroupIds: this.deletedGroupIds,
          confirmExistingComments: sharing,
          confirmReadinessWarnings,
        })
        .subscribe({
          next: (config) => {
            this.removedGroups = [];
            this.deletedGroupIds = [];
            this.configConflict = false;
            this.config = config;
            this.savedMode = config.visibilityMode;
            this.savedEnabled = config.enableReview;
            this.busy = false;
            this.saved = true;
            this.load(false);
          },
          error: (error) => {
            this.busy = false;
            if (this.config && this.removedGroups.length) {
              this.config.groups.push(...this.removedGroups);
              this.removedGroups = [];
              this.deletedGroupIds = [];
            }
            this.configConflict = error?.status === 409;
            if (error?.error?.readiness) this.readiness = error.error.readiness;
            this.error = error?.error?.message || 'Konfiguration konnte nicht gespeichert werden.';
          },
        }),
    );
  }
  exportComments(format?: 'csv' | 'xlsx') {
    this.commentsError = '';
    const personal = format !== undefined;
    const filters = this.exportAll ? {} : this.displayFilters;
    const download =
      format === 'csv'
        ? this.api.exportMyReviewCommentsCsv(this.acpId, filters)
        : format === 'xlsx'
          ? this.api.exportMyReviewCommentsXlsx(this.acpId, filters)
          : this.api.exportVisibleReviewComments(this.acpId, filters);
    this.requests.add(
      download.subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `review-${this.acpId}${personal ? '-mine' : ''}.${format || 'xlsx'}`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => (this.commentsError = 'Export konnte nicht erstellt werden.'),
      }),
    );
  }
}
