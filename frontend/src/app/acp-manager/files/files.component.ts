import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import {
  AcpFile,
  FileProcessingJob,
  FilePreviewResponse,
  FileUploadResponse,
  UploadValidationSummary,
  UnitFileValidationResult,
} from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { FilePreviewPanelComponent } from './file-preview-panel.component';

type UploadConflictDecision = 'replace' | 'skip';

interface UploadConflictEntry {
  selectedIndex: number;
  incoming: File;
  existing: AcpFile;
  decision?: UploadConflictDecision;
}

type FileValidationState = 'ok' | 'error' | 'unchecked';
type FileValidationFilter = 'all' | FileValidationState;
type DeleteDialogMode = 'single' | 'selected' | 'all';

@Component({
  selector: 'app-files',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    AcpManagerContextComponent,
    ConfirmDialogComponent,
    FilePreviewPanelComponent,
  ],
  template: `
    <app-acp-manager-context />

    <div class="page-header">
      <h1>Dateien</h1>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" (click)="validateFiles()" [disabled]="validating || isBusy">
          {{ validating ? '⏳ Wird geprüft...' : '🔍 Dateien prüfen' }}
        </button>
        @if (files.length) {
          <button class="btn btn-outline" (click)="downloadAllFiles()" [disabled]="isBusy">
            {{ downloadAllButtonLabel }}
          </button>
        }
        <input #uploadInput type="file" multiple (change)="upload($event)" hidden />
        <button
          class="btn btn-primary"
          type="button"
          (click)="uploadInput.click()"
          [disabled]="isBusy"
        >
          📤 Dateien oder ZIP hochladen
        </button>
        @if (files.length) {
          <button class="btn btn-danger" (click)="openDeleteAllFilesDialog()" [disabled]="isBusy">
            🗑 Alle löschen
          </button>
        }
      </div>
    </div>

    @if (uploading) {
      <div class="alert alert-success">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
          <strong>Dateien werden hochgeladen</strong>
          <span>{{ uploadPercent }}%</span>
        </div>
        <div
          style="margin-top:10px;height:10px;background:#d9efe2;border-radius:999px;overflow:hidden"
        >
          <div
            style="height:100%;background:#2e8b57;transition:width 180ms ease"
            [style.width.%]="uploadPercent"
          ></div>
        </div>
        <div style="margin-top:8px">{{ uploadProgress }}</div>
      </div>
    }

    @if (processing && processingJob) {
      <div class="alert alert-info">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
          <strong>{{ processingJob.phaseLabel }}</strong>
          @if (processingPercent !== null) {
            <span>{{ processingPercent }}%</span>
          }
        </div>
        @if (processingPercent !== null) {
          <div
            style="margin-top:10px;height:10px;background:#d7e7f7;border-radius:999px;overflow:hidden"
          >
            <div
              style="height:100%;background:#2563eb;transition:width 180ms ease"
              [style.width.%]="processingPercent"
            ></div>
          </div>
        }
        <div style="margin-top:8px">{{ processingProgress }}</div>
        @if (processingJob.message) {
          <div style="margin-top:4px;color:var(--color-text-secondary)">
            {{ processingJob.message }}
          </div>
        }
      </div>
    }

    @if (downloading && (downloadJob || downloadTransferActive)) {
      <div class="alert alert-info">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
          <strong>{{ downloadStatusLabel }}</strong>
          @if (downloadPercent !== null) {
            <span>{{ downloadPercent }}%</span>
          }
        </div>
        @if (downloadPercent !== null) {
          <div
            style="margin-top:10px;height:10px;background:#d7e7f7;border-radius:999px;overflow:hidden"
          >
            <div
              style="height:100%;background:#2563eb;transition:width 180ms ease"
              [style.width.%]="downloadPercent"
            ></div>
          </div>
        }
        <div style="margin-top:8px">{{ downloadProgress }}</div>
        @if (downloadMessage) {
          <div style="margin-top:4px;color:var(--color-text-secondary)">{{ downloadMessage }}</div>
        }
      </div>
    }

    @if (uploadError) {
      <div class="alert alert-danger">
        {{ uploadError }}
      </div>
    }

    @if (downloadError) {
      <div class="alert alert-danger">
        {{ downloadError }}
      </div>
    }

    @if (lastConflictSummary) {
      <div class="alert alert-info">
        Konfliktprüfung: {{ lastConflictSummary.conflicts }} doppelte Datei(en) erkannt,
        {{ lastConflictSummary.replaced }} ersetzt, {{ lastConflictSummary.skipped }} übersprungen.
      </div>
    }

    @if (lastSyncReport) {
      <div class="alert alert-info">
        @if (lastSyncReport.requiresConfirmation) {
          Der ACP-Index wurde nicht verändert. Prüfen und übernehmen Sie die Generatorvorschau im
          <a [routerLink]="['/manage', acpId, 'index']">ACP-Index-Editor</a>.
        } @else {
          Index-Sync: {{ lastSyncReport.unitsAdded }} Aufgaben hinzugefügt,
          {{ lastSyncReport.unitsUpdated }} Aufgaben aktualisiert,
          {{ lastSyncReport.itemsAdded }} Items hinzugefügt, {{ lastSyncReport.itemsUpdated }} Items
          aktualisiert.
        }
        @if (lastSyncReport.warnings?.length) {
          <div style="margin-top:6px">
            Warnungen:
            @for (warning of lastSyncReport.warnings; track warning) {
              <div>- {{ warning }}</div>
            }
          </div>
        }
      </div>
    }

    @if (lastValidationSummary) {
      <div
        class="alert"
        [class.alert-success]="lastValidationSummary.invalidFiles === 0"
        [class.alert-warning]="lastValidationSummary.invalidFiles > 0"
      >
        Auto-Validierung: {{ lastValidationSummary.validFiles }} von
        {{ lastValidationSummary.totalFiles }} Datei(en) ohne Fehler.
        @if (lastValidationSummary.invalidFiles > 0) {
          <span> {{ lastValidationSummary.invalidFiles }} Datei(en) enthalten Fehler.</span>
        }
        <div style="margin-top:6px">
          ACP-Semantik:
          {{ lastValidationSummary.semanticValid ? 'OK' : 'Fehler/Warnungen vorhanden' }} ({{
            lastValidationSummary.semanticIssueCount
          }}
          Issue(s))
        </div>
      </div>
    }

    <!-- Validation Results -->
    @if (validationResults.length) {
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-bottom:12px">Aufgabendateien prüfen</h3>
        @for (result of validationResults; track result.unitId) {
          <div class="validation-unit" [class.valid]="result.valid" [class.invalid]="!result.valid">
            <div class="validation-header">
              <span
                class="badge"
                [class.badge-success]="result.valid"
                [class.badge-danger]="!result.valid"
              >
                {{ result.valid ? '✓' : '✗' }}
              </span>
              <strong>{{ result.unitLabel }}</strong>
              <code>({{ result.unitId }})</code>
            </div>
            @if (!result.valid) {
              <div class="validation-details">
                @if (!result.files.definition.found) {
                  <span class="badge badge-danger"
                    >Fehlend: {{ result.files.definition.expected }}</span
                  >
                }
                @if (!result.files.codingScheme.found) {
                  <span class="badge badge-warning"
                    >Fehlend: {{ result.files.codingScheme.expected }}</span
                  >
                }
                @if (!result.files.metadata.found) {
                  <span class="badge badge-warning"
                    >Fehlend: {{ result.files.metadata.expected }}</span
                  >
                }
                @if (!result.files.player.found) {
                  <span class="badge badge-danger"
                    >Fehlend: Player ({{ result.files.player.expected }})</span
                  >
                }
              </div>
            }
          </div>
        }
      </div>
    }

    <div class="card filter-card">
      <div class="filter-toolbar">
        <input
          class="filter-input"
          [(ngModel)]="searchQuery"
          (input)="applyFilters()"
          placeholder="🔎 Nach Dateiname suchen..."
        />
        <select class="filter-select" [(ngModel)]="selectedFileType" (change)="applyFilters()">
          <option [value]="FILE_TYPE_FILTER_ALL">Alle Typen</option>
          @for (fileType of availableFileTypes; track fileType) {
            <option [value]="fileType">{{ fileType }}</option>
          }
          @if (hasFilesWithoutType) {
            <option [value]="FILE_TYPE_FILTER_NONE">Ohne Typ</option>
          }
        </select>
        <select
          class="filter-select"
          [(ngModel)]="selectedValidationFilter"
          (change)="applyFilters()"
        >
          <option value="all">Alle Prüfzustände</option>
          <option value="ok">OK</option>
          <option value="error">Fehler</option>
          <option value="unchecked">Nicht geprüft</option>
        </select>
        <button
          class="btn btn-outline btn-sm"
          (click)="resetFilters()"
          [disabled]="!hasActiveFilters()"
        >
          Filter zurücksetzen
        </button>
      </div>
      @if (files.length) {
        <div class="selection-toolbar">
          <span class="selection-summary">
            {{
              selectedFilesCount ? selectedFilesCount + ' Datei(en) ausgewählt' : 'Keine Auswahl'
            }}
          </span>
          <button
            class="btn btn-outline btn-sm"
            (click)="selectVisibleFiles()"
            [disabled]="!filteredFiles.length || allVisibleFilesSelected"
          >
            Sichtbare Treffer auswählen
          </button>
          <button
            class="btn btn-outline btn-sm"
            (click)="clearSelection()"
            [disabled]="selectedFilesCount === 0"
          >
            Auswahl leeren
          </button>
          <button
            class="btn btn-outline btn-sm"
            (click)="downloadSelectedFiles()"
            [disabled]="selectedFilesCount === 0 || isBusy"
          >
            {{ downloadSelectedButtonLabel }}
          </button>
          <button
            class="btn btn-danger btn-sm"
            (click)="openDeleteSelectedFilesDialog()"
            [disabled]="selectedFilesCount === 0 || isBusy"
          >
            Auswahl löschen
          </button>
        </div>
      }
      <div class="filter-summary">{{ filteredFiles.length }} von {{ files.length }} Dateien</div>
    </div>

    <div class="files-layout">
      <div class="card table-card">
        <table class="table">
          <thead>
            <tr>
              <th class="selection-col">
                <input
                  type="checkbox"
                  aria-label="Alle sichtbaren Dateien auswählen"
                  [checked]="allVisibleFilesSelected"
                  [indeterminate]="someVisibleFilesSelected"
                  (change)="toggleVisibleFileSelection($any($event.target).checked)"
                />
              </th>
              <th>Dateiname</th>
              <th>Typ</th>
              <th>Größe</th>
              <th>Validierung</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            @for (file of filteredFiles; track file.id) {
              <tr
                [class.is-selected]="selectedPreviewFile?.id === file.id"
                [class.is-marked]="isFileSelected(file.id)"
              >
                <td class="selection-col">
                  <input
                    type="checkbox"
                    [checked]="isFileSelected(file.id)"
                    [attr.aria-label]="'Datei auswählen: ' + file.originalName"
                    (change)="toggleFileSelection(file.id, $any($event.target).checked)"
                  />
                </td>
                <td>{{ file.originalName }}</td>
                <td>{{ file.fileType || '–' }}</td>
                <td>{{ formatSize(file.fileSize) }}</td>
                <td>
                  @if (file.validationResult) {
                    <span
                      class="badge"
                      [class.badge-success]="file.validationResult.valid"
                      [class.badge-danger]="!file.validationResult.valid"
                    >
                      {{ file.validationResult.valid ? 'OK' : 'Fehler' }}
                    </span>

                    @if (file.validationResult.issues.length) {
                      <div class="file-validation-issues">
                        @for (
                          issue of file.validationResult.issues;
                          track issueTrack(issue, $index)
                        ) {
                          <div
                            class="file-validation-issue"
                            [class.issue-error]="issue.severity === 'error'"
                            [class.issue-warning]="issue.severity === 'warning'"
                            [class.issue-info]="issue.severity === 'info'"
                          >
                            <span class="issue-tag">{{ issue.severity.toUpperCase() }}</span>
                            <span>{{ issue.message }}</span>
                          </div>
                        }
                      </div>
                    }
                  } @else {
                    <span class="badge badge-warning">Nicht geprüft</span>
                  }
                </td>
                <td>
                  <div class="action-row">
                    <button
                      class="btn btn-sm btn-outline btn-state"
                      [attr.aria-expanded]="selectedPreviewFile?.id === file.id"
                      aria-controls="file-preview-panel"
                      (click)="openPreview(file)"
                    >
                      {{ selectedPreviewFile?.id === file.id ? 'Schließen' : 'Ansehen' }}
                    </button>
                    <a [href]="getDownloadUrl(file)" class="btn btn-sm btn-outline" target="_blank"
                      >⬇ Download</a
                    >
                    <button class="btn btn-sm btn-danger" (click)="openDeleteFileDialog(file)">
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!files.length) {
          <div class="empty-state"><h3>Keine Dateien vorhanden</h3></div>
        } @else if (!filteredFiles.length) {
          <div class="empty-state"><h3>Keine Treffer für die aktuellen Filter</h3></div>
        }
      </div>

      <app-file-preview-panel
        id="file-preview-panel"
        [file]="selectedPreviewFile"
        [preview]="selectedPreview"
        [inlineUrl]="selectedPreviewInlineUrl"
        [downloadUrl]="selectedPreviewDownloadUrl"
        [loading]="previewLoading"
        [error]="previewError"
      />
    </div>

    <app-confirm-dialog
      [open]="deleteDialogOpen"
      [title]="deleteDialogTitle"
      [message]="deleteDialogMessage"
      [details]="deleteDialogDetails"
      [error]="deleteDialogError"
      [busy]="deleteDialogBusy"
      busyLabel="Lösche..."
      [confirmLabel]="deleteDialogConfirmLabel"
      confirmVariant="danger"
      (confirmed)="confirmDeleteDialog()"
      (cancelled)="closeDeleteDialog()"
    />

    @if (conflictDialogOpen) {
      <div class="overlay-backdrop" (click)="cancelConflictDialog()">
        <div class="overlay-dialog card" (click)="$event.stopPropagation()">
          <h3 style="margin-top: 0">Dateikonflikte beim Upload</h3>
          <p>
            Für bereits vorhandene Dateinamen bitte pro Datei entscheiden, ob die vorhandene Datei
            ersetzt oder der Upload übersprungen wird.
          </p>

          <div class="conflict-toolbar">
            <button class="btn btn-outline btn-sm" (click)="applyDecisionToAll('replace')">
              Alle ersetzen
            </button>
            <button class="btn btn-outline btn-sm" (click)="applyDecisionToAll('skip')">
              Alle überspringen
            </button>
          </div>

          <div class="conflict-list">
            @for (entry of conflictEntries; track conflictTrack(entry, $index); let i = $index) {
              <div class="conflict-row">
                <div class="conflict-name">
                  <strong>{{ entry.incoming.name }}</strong>
                </div>
                <div class="conflict-meta">
                  Neu: {{ formatSize(entry.incoming.size) }} | Vorhanden:
                  {{ formatSize(entry.existing.fileSize) }}
                </div>
                <div
                  class="conflict-actions"
                  role="group"
                  [attr.aria-label]="'Konfliktentscheidung für ' + entry.incoming.name"
                >
                  <button
                    class="btn btn-sm btn-outline btn-state"
                    [attr.aria-pressed]="entry.decision === 'replace'"
                    (click)="setConflictDecision(i, 'replace')"
                  >
                    Ersetzen
                  </button>
                  <button
                    class="btn btn-sm btn-outline btn-state"
                    [attr.aria-pressed]="entry.decision === 'skip'"
                    (click)="setConflictDecision(i, 'skip')"
                  >
                    Überspringen
                  </button>
                </div>
              </div>
            }
          </div>

          <div class="dialog-actions">
            <button class="btn btn-outline" (click)="cancelConflictDialog()">Abbrechen</button>
            <button
              class="btn btn-primary"
              [disabled]="!canConfirmConflictDialog()"
              (click)="confirmConflictDialog()"
            >
              Upload starten
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .validation-unit {
        padding: 8px 12px;
        margin-bottom: 6px;
        border-radius: var(--radius);
        border-left: 3px solid transparent;
      }
      .validation-unit.valid {
        border-left-color: var(--color-success);
        background: rgba(39, 174, 96, 0.05);
      }
      .validation-unit.invalid {
        border-left-color: var(--color-danger);
        background: rgba(231, 76, 60, 0.05);
      }
      .validation-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.9rem;
      }
      .validation-details {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding-left: 32px;
      }
      .file-validation-issues {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 320px;
      }
      .file-validation-issue {
        display: flex;
        gap: 6px;
        align-items: flex-start;
        font-size: 0.75rem;
        color: var(--color-text-secondary);
      }
      .file-validation-issue .issue-tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 56px;
        padding: 1px 6px;
        border-radius: 4px;
        font-weight: 700;
        background: var(--color-bg);
        color: var(--color-text-secondary);
      }
      .file-validation-issue.issue-error .issue-tag {
        background: rgba(231, 76, 60, 0.15);
        color: #a93226;
      }
      .file-validation-issue.issue-warning .issue-tag {
        background: rgba(243, 156, 18, 0.18);
        color: #9c640c;
      }
      .file-validation-issue.issue-info .issue-tag {
        background: rgba(52, 152, 219, 0.16);
        color: #1f618d;
      }
      .filter-card {
        margin-bottom: 16px;
      }
      .filter-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .filter-input {
        flex: 1 1 280px;
        min-width: 220px;
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-family: inherit;
        font-size: 0.9rem;
      }
      .filter-select {
        min-width: 180px;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-family: inherit;
        font-size: 0.85rem;
        background: #fff;
      }
      .filter-summary {
        margin-top: 8px;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
      }
      .selection-toolbar {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .selection-summary {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        margin-right: auto;
      }
      .files-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.9fr);
        gap: 16px;
        align-items: start;
      }
      .selection-col {
        width: 44px;
        text-align: center;
      }
      .table-card {
        overflow: hidden;
      }
      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .table tbody tr.is-selected {
        background: rgba(41, 128, 185, 0.08);
      }
      .table tbody tr.is-marked:not(.is-selected) {
        background: rgba(39, 174, 96, 0.08);
      }

      .overlay-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        padding: 16px;
      }

      .overlay-dialog {
        width: min(780px, 100%);
        max-height: 85vh;
        overflow: auto;
      }

      .conflict-toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }

      .conflict-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 12px;
      }

      .conflict-row {
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 10px;
        background: var(--color-bg-soft, #f8f9fb);
      }

      .conflict-name {
        margin-bottom: 4px;
      }

      .conflict-meta {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        margin-bottom: 8px;
      }

      .conflict-actions {
        display: flex;
        gap: 8px;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      @media (max-width: 1180px) {
        .files-layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class FilesComponent implements OnInit {
  readonly FILE_TYPE_FILTER_ALL = 'all';
  readonly FILE_TYPE_FILTER_NONE = '__no_type__';

  acpId = '';
  files: AcpFile[] = [];
  filteredFiles: AcpFile[] = [];
  searchQuery = '';
  selectedFileType = this.FILE_TYPE_FILTER_ALL;
  selectedValidationFilter: FileValidationFilter = 'all';
  uploading = false;
  processing = false;
  processingJob: FileProcessingJob | null = null;
  uploadPercent = 0;
  uploadProgress = '';
  uploadError: string | null = null;
  downloading = false;
  downloadJob: FileProcessingJob | null = null;
  downloadTransferActive = false;
  downloadTransferStartedAt: number | null = null;
  downloadTransferredBytes = 0;
  downloadTransferTotalBytes: number | null = null;
  downloadError: string | null = null;
  validating = false;
  validationResults: UnitFileValidationResult[] = [];
  lastSyncReport: any = null;
  lastValidationSummary: UploadValidationSummary | null = null;
  lastConflictSummary: { conflicts: number; replaced: number; skipped: number } | null = null;
  selectedPreviewFile: AcpFile | null = null;
  selectedPreview: FilePreviewResponse | null = null;
  previewLoading = false;
  previewError = '';
  selectedFileIds = new Set<string>();

  conflictDialogOpen = false;
  conflictEntries: UploadConflictEntry[] = [];
  private conflictDialogResolver: ((value: UploadConflictEntry[] | null) => void) | null = null;
  deleteDialogOpen = false;
  deleteDialogMode: DeleteDialogMode = 'single';
  deleteDialogTarget: AcpFile | null = null;
  deleteDialogSelectedFileIds: string[] = [];
  deleteDialogBusy = false;
  deleteDialogError = '';

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  get isBusy(): boolean {
    return this.uploading || this.processing || this.downloading;
  }

  get downloadAllButtonLabel(): string {
    if (this.downloadTransferActive) {
      return '⏳ ZIP wird geladen...';
    }
    if (this.downloading) {
      return '⏳ ZIP wird erstellt...';
    }
    return '⬇ Alle herunterladen';
  }

  get downloadSelectedButtonLabel(): string {
    return this.downloading ? '⏳ Download läuft...' : 'Auswahl herunterladen';
  }

  get processingPercent(): number | null {
    if (!this.processingJob) {
      return null;
    }
    if (this.processingJob.status === 'completed') {
      return 100;
    }
    if (this.processingJob.phaseTotal <= 0) {
      return null;
    }
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((this.processingJob.phaseCurrent / this.processingJob.phaseTotal) * 100),
      ),
    );
  }

  get processingProgress(): string {
    if (!this.processingJob) {
      return '';
    }
    if (this.processingJob.phaseTotal > 0) {
      return `${this.processingJob.phaseCurrent} von ${this.processingJob.phaseTotal}`;
    }
    return 'Verarbeitung wird vorbereitet...';
  }

  get downloadStatusLabel(): string {
    if (this.downloadTransferActive) {
      return 'ZIP wird heruntergeladen';
    }
    return this.downloadJob?.phaseLabel || 'ZIP wird erstellt';
  }

  get downloadPercent(): number | null {
    if (this.downloadTransferActive) {
      if (!this.downloadTransferTotalBytes || this.downloadTransferTotalBytes <= 0) {
        return null;
      }
      return Math.max(
        0,
        Math.min(
          100,
          Math.round((this.downloadTransferredBytes / this.downloadTransferTotalBytes) * 100),
        ),
      );
    }
    if (!this.downloadJob) {
      return null;
    }
    if (this.downloadJob.status === 'completed') {
      return 100;
    }
    if (this.downloadJob.phaseTotal <= 0) {
      return null;
    }
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((this.downloadJob.phaseCurrent / this.downloadJob.phaseTotal) * 100),
      ),
    );
  }

  get downloadProgress(): string {
    if (this.downloadTransferActive) {
      if (this.downloadTransferTotalBytes && this.downloadTransferTotalBytes > 0) {
        return `${this.formatSize(this.downloadTransferredBytes)} von ${this.formatSize(this.downloadTransferTotalBytes)}`;
      }
      if (this.downloadTransferredBytes > 0) {
        return `${this.formatSize(this.downloadTransferredBytes)} heruntergeladen`;
      }
      return 'Download wird gestartet...';
    }
    if (!this.downloadJob) {
      return '';
    }
    if (this.isByteBasedDownloadJob(this.downloadJob)) {
      return (
        `${this.formatSize(this.downloadJob.phaseCurrent)} von ` +
        `${this.formatSize(this.downloadJob.phaseTotal)} verarbeitet`
      );
    }
    if (this.downloadJob.phaseTotal > 0) {
      return `${this.downloadJob.phaseCurrent} von ${this.downloadJob.phaseTotal}`;
    }
    if (this.downloadJob.status === 'completed') {
      return 'Archiv ist bereit.';
    }
    return 'ZIP-Erstellung wird vorbereitet...';
  }

  get downloadMessage(): string | null {
    if (this.downloadTransferActive) {
      const transferDetails = [
        this.getDownloadTransferRateLabel(),
        this.getDownloadTransferEtaLabel(),
      ].filter((entry): entry is string => !!entry);
      if (!transferDetails.length) {
        return 'Das ZIP-Archiv wird in den Browser übertragen.';
      }
      return `Das ZIP-Archiv wird in den Browser übertragen. ${transferDetails.join(' · ')}`;
    }
    return this.downloadJob?.message || null;
  }

  ngOnInit() {
    this.acpId = this.route.parent?.snapshot.paramMap.get('acpId') || '';
    this.load();
  }

  load() {
    this.api.getFiles(this.acpId).subscribe((f) => {
      this.files = f;
      this.syncSelectionWithFiles(f);
      this.applyFilters();
      if (!this.selectedPreviewFile) {
        return;
      }

      const updatedSelection = f.find((file) => file.id === this.selectedPreviewFile?.id) || null;
      if (!updatedSelection) {
        this.clearPreview();
        return;
      }

      this.selectedPreviewFile = updatedSelection;
    });
  }

  get selectedPreviewDownloadUrl(): string {
    if (!this.selectedPreviewFile) {
      return '';
    }
    return this.getDownloadUrl(this.selectedPreviewFile);
  }

  get selectedPreviewInlineUrl(): string {
    if (!this.selectedPreviewFile) {
      return '';
    }
    return this.api.getFileContentUrl(this.acpId, this.selectedPreviewFile.id, {
      disposition: 'inline',
    });
  }

  get availableFileTypes(): string[] {
    const byNormalized = new Map<string, string>();
    for (const file of this.files) {
      const rawType = String(file.fileType || '').trim();
      if (!rawType) {
        continue;
      }
      const key = this.normalizeText(rawType);
      if (!byNormalized.has(key)) {
        byNormalized.set(key, rawType);
      }
    }
    return Array.from(byNormalized.values()).sort((a, b) =>
      a.localeCompare(b, 'de', { sensitivity: 'base' }),
    );
  }

  get hasFilesWithoutType(): boolean {
    return this.files.some((file) => !String(file.fileType || '').trim());
  }

  get selectedFilesCount(): number {
    return this.selectedFileIds.size;
  }

  get selectedFiles(): AcpFile[] {
    return this.files.filter((file) => this.selectedFileIds.has(file.id));
  }

  get visibleSelectedFilesCount(): number {
    return this.filteredFiles.filter((file) => this.selectedFileIds.has(file.id)).length;
  }

  get allVisibleFilesSelected(): boolean {
    return (
      this.filteredFiles.length > 0 && this.visibleSelectedFilesCount === this.filteredFiles.length
    );
  }

  get someVisibleFilesSelected(): boolean {
    return this.visibleSelectedFilesCount > 0 && !this.allVisibleFilesSelected;
  }

  hasActiveFilters(): boolean {
    return (
      this.searchQuery.trim().length > 0 ||
      this.selectedFileType !== this.FILE_TYPE_FILTER_ALL ||
      this.selectedValidationFilter !== 'all'
    );
  }

  applyFilters() {
    const search = this.normalizeText(this.searchQuery);
    const selectedType = this.selectedFileType;

    this.filteredFiles = this.files.filter((file) => {
      if (search && !this.normalizeText(file.originalName).includes(search)) {
        return false;
      }

      if (selectedType === this.FILE_TYPE_FILTER_NONE) {
        if (String(file.fileType || '').trim()) {
          return false;
        }
      } else if (selectedType !== this.FILE_TYPE_FILTER_ALL) {
        if (this.normalizeText(file.fileType) !== this.normalizeText(selectedType)) {
          return false;
        }
      }

      if (this.selectedValidationFilter !== 'all') {
        const state = this.getValidationState(file);
        if (state !== this.selectedValidationFilter) {
          return false;
        }
      }

      return true;
    });
  }

  resetFilters() {
    this.searchQuery = '';
    this.selectedFileType = this.FILE_TYPE_FILTER_ALL;
    this.selectedValidationFilter = 'all';
    this.applyFilters();
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const selectedFiles = Array.from(input.files);
    this.uploadError = null;
    this.lastSyncReport = null;
    this.lastValidationSummary = null;
    this.lastConflictSummary = null;
    this.processingJob = null;
    this.processing = false;
    this.uploadPercent = 0;
    this.uploadProgress = '';

    const conflicts = this.findUploadConflicts(selectedFiles);
    const decisions = new Map<number, UploadConflictDecision>();

    if (conflicts.length) {
      const resolvedConflicts = await this.openConflictDialog(conflicts);
      if (!resolvedConflicts) {
        input.value = '';
        return;
      }

      for (const conflict of resolvedConflicts) {
        if (!conflict.decision) {
          input.value = '';
          return;
        }
        decisions.set(conflict.selectedIndex, conflict.decision);
      }
    }

    const nonConflictingFiles: File[] = [];
    const replacementFiles: File[] = [];
    let skippedCount = 0;

    selectedFiles.forEach((file, index) => {
      const decision = decisions.get(index);
      if (!decision) {
        nonConflictingFiles.push(file);
        return;
      }

      if (decision === 'replace') {
        replacementFiles.push(file);
      } else {
        skippedCount += 1;
      }
    });

    if (conflicts.length) {
      this.lastConflictSummary = {
        conflicts: conflicts.length,
        replaced: replacementFiles.length,
        skipped: skippedCount,
      };
    }

    const totalToUpload = nonConflictingFiles.length + replacementFiles.length;
    if (totalToUpload === 0) {
      input.value = '';
      return;
    }

    this.uploading = true;
    const chunkSize = 50;
    const totalBytes = nonConflictingFiles
      .concat(replacementFiles)
      .reduce((sum, file) => sum + file.size, 0);
    const uploadedFileIds: string[] = [];
    let uploadedBytes = 0;
    let uploadedFilesCount = 0;

    const uploadInChunks = async (batchFiles: File[], strategy?: 'overwrite'): Promise<void> => {
      for (let i = 0; i < batchFiles.length; i += chunkSize) {
        const chunk = batchFiles.slice(i, i + chunkSize);
        const chunkBytes = chunk.reduce((sum, file) => sum + file.size, 0);

        const fd = new FormData();
        for (const file of chunk) {
          fd.append('files', file);
        }

        const uploadResult = await firstValueFrom(
          this.api
            .uploadFiles(this.acpId, fd, strategy ? { conflictStrategy: strategy } : undefined)
            .pipe(
              tap((httpEvent) => {
                if (httpEvent.type !== HttpEventType.UploadProgress) {
                  return;
                }
                const loaded = typeof httpEvent.loaded === 'number' ? httpEvent.loaded : 0;
                this.updateUploadProgress(
                  uploadedBytes + loaded,
                  totalBytes,
                  uploadedFilesCount,
                  totalToUpload,
                );
              }),
              filter((httpEvent) => httpEvent.type === HttpEventType.Response),
              map((httpEvent) => httpEvent.body as FileUploadResponse),
            ),
        );

        uploadedBytes += chunkBytes;
        uploadedFilesCount += chunk.length;
        this.updateUploadProgress(uploadedBytes, totalBytes, uploadedFilesCount, totalToUpload);
        uploadedFileIds.push(...uploadResult.files.map((file) => file.id));
      }
    };

    try {
      await uploadInChunks(nonConflictingFiles);
      await uploadInChunks(replacementFiles, 'overwrite');

      this.uploading = false;
      this.processing = true;
      this.uploadProgress = '';
      this.uploadPercent = 100;

      const job = await firstValueFrom(
        this.api.startFileProcessing(this.acpId, {
          fileIds: uploadedFileIds,
          runCleanup: replacementFiles.length > 0,
        }),
      );
      this.processingJob = job;

      const completedJob = await this.waitForJob(job.id, (nextJob) => {
        this.processingJob = nextJob;
      });
      this.processingJob = completedJob;
      this.lastSyncReport = completedJob.syncReport || null;
      this.lastValidationSummary = completedJob.validationSummary || null;
      this.load();
      this.validateFiles();
    } catch (err) {
      this.uploadError = this.getUploadErrorMessage(err);
      console.error('Upload Error:', err);
      this.load();
    } finally {
      this.uploading = false;
      this.processing = false;
      this.uploadProgress = '';
      input.value = '';
    }
  }

  validateFiles() {
    this.validating = true;
    this.api.validateUnitFiles(this.acpId).subscribe({
      next: ({ unitResults, validationSummary }) => {
        this.validationResults = unitResults;
        this.lastValidationSummary = validationSummary;
        this.load();
        this.validating = false;
      },
      error: () => {
        this.validating = false;
      },
    });
  }

  async downloadAllFiles() {
    if (!this.files.length || this.isBusy) {
      return;
    }
    await this.downloadArchive([], `acp-${this.acpId}-all-files.zip`);
  }

  async downloadSelectedFiles() {
    if (this.selectedFilesCount === 0 || this.isBusy) {
      return;
    }
    await this.downloadArchive(
      this.selectedFiles.map((file) => file.id),
      `acp-${this.acpId}-selected-files.zip`,
    );
  }

  get deleteDialogTitle(): string {
    switch (this.deleteDialogMode) {
      case 'single':
        return 'Datei löschen';
      case 'selected':
        return 'Ausgewählte Dateien löschen';
      default:
        return 'Alle Dateien löschen';
    }
  }

  get deleteDialogMessage(): string {
    switch (this.deleteDialogMode) {
      case 'single': {
        const name = this.deleteDialogTarget?.originalName || 'diese Datei';
        return `Soll "${name}" wirklich gelöscht werden?`;
      }
      case 'selected':
        return `Sollen wirklich ${this.deleteDialogSelectedFiles.length} ausgewählte Datei(en) gelöscht werden?`;
      default:
        return 'Sollen wirklich alle Dateien dieses ACP gelöscht werden?';
    }
  }

  get deleteDialogDetails(): string[] {
    if (this.deleteDialogMode === 'single') {
      return ['Die Datei wird dauerhaft entfernt.'];
    }
    if (this.deleteDialogMode === 'selected') {
      const files = this.deleteDialogSelectedFiles;
      const details = [`${files.length} Datei(en) werden dauerhaft entfernt.`];
      details.push(...files.slice(0, 5).map((file) => file.originalName));
      if (files.length > 5) {
        details.push(`... und ${files.length - 5} weitere Datei(en).`);
      }
      details.push(
        'Validierungsergebnisse und abhängige Dateiverweise können dadurch ungültig werden.',
      );
      return details;
    }
    return [
      `${this.files.length} Datei(en) werden dauerhaft entfernt.`,
      'Validierungsergebnisse und abhängige Dateiverweise können dadurch ungültig werden.',
    ];
  }

  get deleteDialogConfirmLabel(): string {
    switch (this.deleteDialogMode) {
      case 'single':
        return 'Datei löschen';
      case 'selected':
        return 'Auswahl löschen';
      default:
        return 'Alle löschen';
    }
  }

  get deleteDialogSelectedFiles(): AcpFile[] {
    const filesById = new Map(this.files.map((file) => [file.id, file]));
    return this.deleteDialogSelectedFileIds
      .map((id) => filesById.get(id))
      .filter((file): file is AcpFile => !!file);
  }

  openDeleteFileDialog(file: AcpFile) {
    this.deleteDialogMode = 'single';
    this.deleteDialogTarget = file;
    this.deleteDialogSelectedFileIds = [];
    this.deleteDialogError = '';
    this.deleteDialogBusy = false;
    this.deleteDialogOpen = true;
  }

  openDeleteSelectedFilesDialog() {
    if (this.selectedFilesCount === 0) {
      return;
    }
    this.deleteDialogMode = 'selected';
    this.deleteDialogTarget = null;
    this.deleteDialogSelectedFileIds = Array.from(this.selectedFileIds);
    this.deleteDialogError = '';
    this.deleteDialogBusy = false;
    this.deleteDialogOpen = true;
  }

  openDeleteAllFilesDialog() {
    this.deleteDialogMode = 'all';
    this.deleteDialogTarget = null;
    this.deleteDialogSelectedFileIds = [];
    this.deleteDialogError = '';
    this.deleteDialogBusy = false;
    this.deleteDialogOpen = true;
  }

  closeDeleteDialog() {
    if (this.deleteDialogBusy) return;
    this.deleteDialogOpen = false;
    this.deleteDialogTarget = null;
    this.deleteDialogSelectedFileIds = [];
    this.deleteDialogError = '';
  }

  confirmDeleteDialog() {
    if (this.deleteDialogBusy) return;
    this.deleteDialogBusy = true;
    this.deleteDialogError = '';

    if (this.deleteDialogMode === 'single') {
      if (!this.deleteDialogTarget) {
        this.deleteDialogBusy = false;
        this.deleteDialogError = 'Keine Datei ausgewählt.';
        return;
      }
      this.api.deleteFile(this.acpId, this.deleteDialogTarget.id).subscribe({
        next: () => {
          this.finishDelete([this.deleteDialogTarget!.id]);
        },
        error: (err) => {
          this.deleteDialogBusy = false;
          this.deleteDialogError = err?.error?.message || 'Fehler beim Löschen der Datei.';
        },
      });
      return;
    }

    if (this.deleteDialogMode === 'selected') {
      if (this.deleteDialogSelectedFileIds.length === 0) {
        this.deleteDialogBusy = false;
        this.deleteDialogError = 'Keine Dateien ausgewählt.';
        return;
      }
      this.api.bulkDeleteFiles(this.acpId, this.deleteDialogSelectedFileIds).subscribe({
        next: () => {
          this.finishDelete(this.deleteDialogSelectedFileIds);
        },
        error: (err) => {
          this.deleteDialogBusy = false;
          this.deleteDialogError = err?.error?.message || 'Fehler beim Löschen der Dateien.';
        },
      });
      return;
    }

    this.api.deleteAllFiles(this.acpId).subscribe({
      next: () => {
        this.validationResults = [];
        this.clearSelection();
        this.finishDelete(this.files.map((file) => file.id));
      },
      error: (err) => {
        this.deleteDialogBusy = false;
        this.deleteDialogError = err?.error?.message || 'Fehler beim Löschen der Dateien.';
      },
    });
  }

  getDownloadUrl(file: AcpFile): string {
    return this.api.getFileDownloadUrl(this.acpId, file.id);
  }

  openPreview(file: AcpFile) {
    if (this.selectedPreviewFile?.id === file.id) {
      if (!this.previewLoading) {
        this.clearPreview();
      }
      return;
    }

    this.selectedPreviewFile = file;
    this.previewLoading = true;
    this.previewError = '';
    this.selectedPreview = null;

    this.api.getFilePreview(this.acpId, file.id).subscribe({
      next: (preview) => {
        if (this.selectedPreviewFile?.id !== file.id) {
          return;
        }
        this.selectedPreview = preview;
        this.previewLoading = false;
      },
      error: (err) => {
        if (this.selectedPreviewFile?.id !== file.id) {
          return;
        }
        this.previewError = err?.error?.message || 'Die Vorschau konnte nicht geladen werden.';
        this.previewLoading = false;
      },
    });
  }

  clearPreview() {
    this.selectedPreviewFile = null;
    this.selectedPreview = null;
    this.previewLoading = false;
    this.previewError = '';
  }

  isFileSelected(fileId: string): boolean {
    return this.selectedFileIds.has(fileId);
  }

  toggleFileSelection(fileId: string, selected: boolean) {
    const nextSelection = new Set(this.selectedFileIds);
    if (selected) {
      nextSelection.add(fileId);
    } else {
      nextSelection.delete(fileId);
    }
    this.selectedFileIds = nextSelection;
  }

  toggleVisibleFileSelection(selected: boolean) {
    if (selected) {
      this.selectVisibleFiles();
      return;
    }
    const nextSelection = new Set(this.selectedFileIds);
    this.filteredFiles.forEach((file) => nextSelection.delete(file.id));
    this.selectedFileIds = nextSelection;
  }

  selectVisibleFiles() {
    const nextSelection = new Set(this.selectedFileIds);
    this.filteredFiles.forEach((file) => nextSelection.add(file.id));
    this.selectedFileIds = nextSelection;
  }

  clearSelection() {
    this.selectedFileIds = new Set<string>();
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  issueTrack(issue: any, index: number): string {
    return `${issue?.severity || 'unknown'}-${issue?.message || ''}-${issue?.path || ''}-${index}`;
  }

  conflictTrack(entry: UploadConflictEntry, index: number): string {
    return `${entry.selectedIndex}-${this.normalizeFileName(entry.incoming.name)}-${index}`;
  }

  setConflictDecision(index: number, decision: UploadConflictDecision) {
    this.conflictEntries = this.conflictEntries.map((entry, currentIndex) => {
      if (currentIndex !== index) {
        return entry;
      }
      return { ...entry, decision };
    });
  }

  applyDecisionToAll(decision: UploadConflictDecision) {
    this.conflictEntries = this.conflictEntries.map((entry) => ({
      ...entry,
      decision,
    }));
  }

  canConfirmConflictDialog(): boolean {
    return this.conflictEntries.every((entry) => !!entry.decision);
  }

  cancelConflictDialog() {
    this.closeConflictDialog(null);
  }

  confirmConflictDialog() {
    if (!this.canConfirmConflictDialog()) {
      return;
    }
    this.closeConflictDialog(this.conflictEntries);
  }

  private openConflictDialog(
    conflicts: UploadConflictEntry[],
  ): Promise<UploadConflictEntry[] | null> {
    this.conflictEntries = conflicts.map((entry) => ({ ...entry, decision: undefined }));
    this.conflictDialogOpen = true;

    return new Promise((resolve) => {
      this.conflictDialogResolver = resolve;
    });
  }

  private closeConflictDialog(result: UploadConflictEntry[] | null) {
    const resolver = this.conflictDialogResolver;
    this.conflictDialogResolver = null;
    this.conflictDialogOpen = false;

    const payload = result ? result.map((entry) => ({ ...entry })) : null;
    this.conflictEntries = [];
    resolver?.(payload);
  }

  private findUploadConflicts(selectedFiles: File[]): UploadConflictEntry[] {
    const existingByName = new Map<string, AcpFile[]>();

    for (const file of this.files) {
      const key = this.normalizeFileName(file.originalName);
      if (!key) {
        continue;
      }
      const bucket = existingByName.get(key) || [];
      bucket.push(file);
      existingByName.set(key, bucket);
    }

    const conflicts: UploadConflictEntry[] = [];

    selectedFiles.forEach((incoming, selectedIndex) => {
      const key = this.normalizeFileName(incoming.name);
      const existingMatch = key ? existingByName.get(key)?.[0] : undefined;

      if (existingMatch) {
        conflicts.push({
          selectedIndex,
          incoming,
          existing: existingMatch,
        });
      }
    });

    return conflicts;
  }

  private updateUploadProgress(
    uploadedBytes: number,
    totalBytes: number,
    uploadedFilesCount: number,
    totalFiles: number,
  ) {
    const normalizedTotal = Math.max(totalBytes, 1);
    this.uploadPercent = Math.max(
      0,
      Math.min(100, Math.round((Math.min(uploadedBytes, normalizedTotal) / normalizedTotal) * 100)),
    );
    this.uploadProgress =
      `${uploadedFilesCount} von ${totalFiles} Datei(en), ` +
      `${this.formatSize(Math.min(uploadedBytes, totalBytes))} von ${this.formatSize(totalBytes)}`;
  }

  private async waitForJob(
    jobId: string,
    setJobState: (job: FileProcessingJob) => void,
  ): Promise<FileProcessingJob> {
    if (typeof EventSource === 'undefined') {
      return this.pollJob(jobId, setJobState);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const eventSource = new EventSource(
        this.api.getFileProcessingJobEventsUrl(this.acpId, jobId),
      );

      const finish = (job: FileProcessingJob, error?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        eventSource.close();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(job);
      };

      eventSource.onmessage = (event) => {
        let job: FileProcessingJob;
        try {
          job = JSON.parse(event.data) as FileProcessingJob;
        } catch {
          eventSource.close();
          void this.pollJob(jobId, setJobState)
            .then((fallbackJob) =>
              finish(
                fallbackJob,
                fallbackJob.status === 'failed' ? fallbackJob.error || undefined : undefined,
              ),
            )
            .catch(reject);
          return;
        }

        setJobState(job);
        if (job.status === 'completed') {
          finish(job);
          return;
        }
        if (job.status === 'failed') {
          finish(job, job.error || 'Job fehlgeschlagen.');
        }
      };

      eventSource.onerror = () => {
        if (settled) {
          return;
        }
        eventSource.close();
        void this.pollJob(jobId, setJobState)
          .then((job) => {
            setJobState(job);
            if (job.status === 'failed') {
              finish(job, job.error || 'Job fehlgeschlagen.');
              return;
            }
            finish(job);
          })
          .catch(reject);
      };
    });
  }

  private async pollJob(
    jobId: string,
    setJobState: (job: FileProcessingJob) => void,
  ): Promise<FileProcessingJob> {
    for (;;) {
      const job = await firstValueFrom(this.api.getFileProcessingJob(this.acpId, jobId));
      setJobState(job);
      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }
      await this.sleep(1000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private finishDelete(deletedFileIds: string[]) {
    const deletedIds = new Set(deletedFileIds);
    this.deleteDialogBusy = false;
    this.deleteDialogOpen = false;
    this.deleteDialogTarget = null;
    this.deleteDialogSelectedFileIds = [];
    this.deleteDialogError = '';

    if (this.selectedPreviewFile && deletedIds.has(this.selectedPreviewFile.id)) {
      this.clearPreview();
    }

    if (this.selectedFileIds.size) {
      this.selectedFileIds = new Set(
        Array.from(this.selectedFileIds).filter((id) => !deletedIds.has(id)),
      );
    }

    this.load();
  }

  private syncSelectionWithFiles(files: AcpFile[]) {
    if (this.selectedFileIds.size === 0) {
      return;
    }

    const existingIds = new Set(files.map((file) => file.id));
    this.selectedFileIds = new Set(
      Array.from(this.selectedFileIds).filter((id) => existingIds.has(id)),
    );
  }

  private async downloadArchive(fileIds: string[], fallbackFileName: string) {
    this.downloading = true;
    this.downloadError = null;
    this.downloadJob = null;
    this.downloadTransferActive = false;
    this.downloadTransferStartedAt = null;
    this.downloadTransferredBytes = 0;
    this.downloadTransferTotalBytes = null;

    try {
      const job = await firstValueFrom(this.api.startFileDownloadJob(this.acpId, { fileIds }));
      this.downloadJob = job;

      const completedJob = await this.waitForJob(job.id, (nextJob) => {
        this.downloadJob = nextJob;
      });
      this.downloadJob = completedJob;
      this.downloadTransferActive = true;
      this.downloadTransferStartedAt = null;

      const response = await fetch(this.api.getFileJobArchiveUrl(this.acpId, completedJob.id));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await this.readDownloadResponseBlob(response);
      if (!blob || blob.size === 0) {
        throw new Error('Archive response is empty');
      }

      this.triggerBrowserDownload(
        blob,
        this.getArchiveFileName(response, completedJob.archiveFileName || fallbackFileName),
      );
    } catch (err: any) {
      this.downloadError =
        err?.error?.message || err?.message || 'Fehler beim Herunterladen der Dateien.';
    } finally {
      this.downloading = false;
      this.downloadTransferActive = false;
      this.downloadTransferStartedAt = null;
      this.downloadTransferredBytes = 0;
      this.downloadTransferTotalBytes = null;
      if (!this.downloadError) {
        this.downloadJob = null;
      }
    }
  }

  private getArchiveFileName(
    response: { headers: { get(name: string): string | null } },
    fallbackFileName: string,
  ): string {
    const contentDisposition = response.headers.get('content-disposition') || '';
    const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch?.[1]) {
      return decodeURIComponent(encodedMatch[1]);
    }

    const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (plainMatch?.[1]) {
      return plainMatch[1];
    }

    return fallbackFileName;
  }

  private async readDownloadResponseBlob(response: Response): Promise<Blob> {
    const totalHeader = Number(response.headers.get('content-length') || '');
    this.downloadTransferTotalBytes =
      Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;

    if (!response.body) {
      this.downloadTransferStartedAt = this.downloadTransferStartedAt || Date.now();
      const blob = await response.blob();
      this.downloadTransferredBytes = blob.size;
      if (!this.downloadTransferTotalBytes && blob.size > 0) {
        this.downloadTransferTotalBytes = blob.size;
      }
      return blob;
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loadedBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      this.downloadTransferStartedAt = this.downloadTransferStartedAt || Date.now();
      chunks.push(value.slice());
      loadedBytes += value.byteLength;
      this.downloadTransferredBytes = loadedBytes;
    }

    if (!this.downloadTransferTotalBytes && loadedBytes > 0) {
      this.downloadTransferTotalBytes = loadedBytes;
    }

    return new Blob(chunks, {
      type: response.headers.get('content-type') || 'application/zip',
    });
  }

  private triggerBrowserDownload(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  private isByteBasedDownloadJob(job: FileProcessingJob): boolean {
    return job.jobType === 'archive-download' && job.phase === 'zip-files';
  }

  private getDownloadTransferRateLabel(): string | null {
    if (
      !this.downloadTransferActive ||
      !this.downloadTransferStartedAt ||
      this.downloadTransferredBytes <= 0
    ) {
      return null;
    }

    const elapsedSeconds = Math.max((Date.now() - this.downloadTransferStartedAt) / 1000, 0.001);
    const bytesPerSecond = this.downloadTransferredBytes / elapsedSeconds;
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
      return null;
    }

    return `${this.formatSize(bytesPerSecond)}/s`;
  }

  private getDownloadTransferEtaLabel(): string | null {
    if (
      !this.downloadTransferActive ||
      !this.downloadTransferStartedAt ||
      !this.downloadTransferTotalBytes ||
      this.downloadTransferTotalBytes <= this.downloadTransferredBytes
    ) {
      return null;
    }

    const elapsedSeconds = Math.max((Date.now() - this.downloadTransferStartedAt) / 1000, 0.001);
    const bytesPerSecond = this.downloadTransferredBytes / elapsedSeconds;
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
      return null;
    }

    const remainingSeconds =
      (this.downloadTransferTotalBytes - this.downloadTransferredBytes) / bytesPerSecond;
    if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
      return null;
    }

    return `${this.formatRemainingTime(remainingSeconds)} verbleibend`;
  }

  private formatRemainingTime(seconds: number): string {
    const normalizedSeconds = Math.max(Math.ceil(seconds), 1);
    if (normalizedSeconds < 60) {
      return `${normalizedSeconds} s`;
    }

    const minutes = Math.floor(normalizedSeconds / 60);
    const remainingSeconds = normalizedSeconds % 60;
    if (minutes < 60) {
      if (!remainingSeconds) {
        return `${minutes} min`;
      }
      return `${minutes} min ${remainingSeconds} s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (!remainingMinutes) {
      return `${hours} h`;
    }
    return `${hours} h ${remainingMinutes} min`;
  }

  private normalizeFileName(fileName: string): string {
    return String(fileName || '')
      .trim()
      .toLowerCase();
  }

  private getValidationState(file: AcpFile): FileValidationState {
    if (!file.validationResult) {
      return 'unchecked';
    }
    return file.validationResult.valid ? 'ok' : 'error';
  }

  private normalizeText(value: string | null | undefined): string {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  private getUploadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const conflicts = Array.isArray(error.error?.conflicts)
        ? error.error.conflicts.filter((entry: unknown) => typeof entry === 'string')
        : [];

      if (error.status === 409) {
        if (conflicts.length) {
          return `Konflikt erkannt: ${conflicts.join(', ')}. Bitte für diese Dateien "Ersetzen" oder "Überspringen" wählen und erneut hochladen.`;
        }
        return 'Konflikt erkannt. Bitte prüfen, ob bestehende Dateien ersetzt oder übersprungen werden sollen.';
      }

      if (error.status === 413) {
        return 'Die ausgewählte Datei ist größer als das aktuell erlaubte Upload-Limit des Servers.';
      }

      if (typeof error.error === 'string') {
        const message = error.error.trim();
        if (message.toLowerCase() === 'file too large') {
          return 'Die ausgewählte Datei ist größer als das aktuell erlaubte Upload-Limit des Servers.';
        }
        if (message) {
          return message;
        }
      }

      if (typeof error.error?.message === 'string') {
        return error.error.message;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Upload fehlgeschlagen. Bitte erneut versuchen.';
  }
}
