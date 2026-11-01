import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { AcpSnapshot, SnapshotCurrentDiff } from '../../core/models/api.models';
import { AcpManagerContextComponent } from '../shared/acp-manager-context.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';

@Component({
  selector: 'app-snapshots',
  standalone: true,
  imports: [FormsModule, DatePipe, AcpManagerContextComponent, ConfirmDialogComponent],
  template: `
    <app-acp-manager-context />

    <div class="page-header">
      <h1>Sicherungsstände</h1>
      <button
        class="btn btn-outline btn-state"
        (click)="showCreate = !showCreate"
        [attr.aria-expanded]="showCreate"
        aria-controls="snapshot-create-form"
      >
        + Snapshot erstellen
      </button>
    </div>

    @if (actionSuccess) {
      <div class="alert alert-success">{{ actionSuccess }}</div>
    }

    @if (showCreate) {
      <div id="snapshot-create-form" class="card">
        <div class="form-group">
          <label>Changelog</label>
          <textarea
            [(ngModel)]="changelog"
            rows="3"
            placeholder="Änderungen beschreiben..."
          ></textarea>
        </div>
        <div class="toolbar">
          <button class="btn btn-primary" (click)="create()">Erstellen</button>
          <button class="btn btn-outline" (click)="showCreate = false">Abbrechen</button>
        </div>
      </div>
    }

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Erstellt</th>
            <th>Changelog</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          @for (snap of snapshots; track snap.id) {
            <tr>
              <td>
                <strong>v{{ snap.versionNumber }}</strong>
              </td>
              <td>{{ snap.createdAt | date: 'dd.MM.yyyy HH:mm' }}</td>
              <td>{{ snap.changelog || '–' }}</td>
              <td>
                <button class="btn btn-sm btn-outline" (click)="previewDiff(snap)">
                  {{ loadingDiffSnapshotId === snap.id ? 'Lade…' : 'Diff zum aktuellen Stand' }}
                </button>
                <button class="btn btn-sm btn-outline" (click)="openRestoreDialog(snap)">
                  Wiederherstellen
                </button>
                <button class="btn btn-sm btn-danger" (click)="openDeleteDialog(snap)">
                  Löschen
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (!snapshots.length) {
        <div class="empty-state"><h3>Noch keine Snapshots vorhanden</h3></div>
      }
    </div>

    @if (diffPreview) {
      <div class="card">
        <h3>Diff-Vorschau zu Version v{{ diffPreviewSnapshotVersion }}</h3>
        <p><strong>AP-Index geändert:</strong> {{ diffPreview.indexChanged ? 'Ja' : 'Nein' }}</p>
        <p><strong>Unverändert:</strong> {{ diffPreview.unchanged }} Dateien</p>

        <div class="form-group">
          <label>Neu im aktuellen Stand</label>
          <div>{{ diffPreview.added.length ? diffPreview.added.join(', ') : 'Keine' }}</div>
        </div>
        <div class="form-group">
          <label>Fehlen im aktuellen Stand</label>
          <div>{{ diffPreview.removed.length ? diffPreview.removed.join(', ') : 'Keine' }}</div>
        </div>
        <div class="form-group">
          <label>Inhaltlich geändert</label>
          <div>{{ diffPreview.modified.length ? diffPreview.modified.join(', ') : 'Keine' }}</div>
        </div>
      </div>
    }

    @if (diffError) {
      <div class="card">
        <p style="color:#b00020;">
          <strong>Diff konnte nicht geladen werden:</strong> {{ diffError }}
        </p>
      </div>
    }

    <app-confirm-dialog
      [open]="actionDialogOpen"
      [title]="actionDialogTitle"
      [message]="actionDialogMessage"
      [details]="actionDialogDetails"
      [error]="actionDialogError"
      [busy]="actionDialogBusy"
      busyLabel="Bitte warten..."
      [confirmLabel]="actionDialogConfirmLabel"
      [confirmVariant]="actionDialogKind === 'delete' ? 'danger' : 'primary'"
      (confirmed)="confirmActionDialog()"
      (cancelled)="closeActionDialog()"
    />
  `,
})
export class SnapshotsComponent implements OnInit {
  acpId = '';
  snapshots: AcpSnapshot[] = [];
  showCreate = false;
  changelog = '';
  diffPreview: SnapshotCurrentDiff | null = null;
  diffPreviewSnapshotVersion: number | null = null;
  diffError = '';
  loadingDiffSnapshotId: string | null = null;
  actionDialogOpen = false;
  actionDialogKind: 'restore' | 'delete' = 'restore';
  actionDialogSnapshot: AcpSnapshot | null = null;
  actionDialogBusy = false;
  actionDialogError = '';
  actionSuccess = '';

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.acpId = this.route.parent?.snapshot.paramMap.get('acpId') || '';
    this.load();
  }

  load() {
    this.api.getSnapshots(this.acpId).subscribe((s) => (this.snapshots = s));
  }

  create() {
    this.actionSuccess = '';
    this.api.createSnapshot(this.acpId, this.changelog).subscribe({
      next: () => {
        this.showCreate = false;
        this.changelog = '';
        this.load();
      },
    });
  }

  previewDiff(snap: AcpSnapshot) {
    this.actionSuccess = '';
    this.loadingDiffSnapshotId = snap.id;
    this.diffError = '';
    this.api.getSnapshotCurrentDiff(this.acpId, snap.id).subscribe({
      next: (diff) => {
        this.diffPreview = diff;
        this.diffPreviewSnapshotVersion = snap.versionNumber;
        this.loadingDiffSnapshotId = null;
      },
      error: (err) => {
        this.diffPreview = null;
        this.diffPreviewSnapshotVersion = null;
        this.diffError = err?.error?.message || 'Unbekannter Fehler';
        this.loadingDiffSnapshotId = null;
      },
    });
  }

  get actionDialogTitle(): string {
    if (!this.actionDialogSnapshot) return 'Bestätigen';
    return this.actionDialogKind === 'restore'
      ? `Snapshot v${this.actionDialogSnapshot.versionNumber} wiederherstellen`
      : `Snapshot v${this.actionDialogSnapshot.versionNumber} löschen`;
  }

  get actionDialogMessage(): string {
    if (this.actionDialogKind === 'restore') {
      return 'Der aktuelle AP-Stand wird durch die Daten dieses Snapshots ersetzt.';
    }
    return 'Dieser Snapshot wird dauerhaft entfernt.';
  }

  get actionDialogDetails(): string[] {
    if (this.actionDialogKind === 'restore') {
      return [
        'AP-Index und zugehörige Dateien werden auf diesen Versionsstand zurückgesetzt.',
        'Nicht gespeicherte aktuelle Änderungen gehen dabei verloren.',
      ];
    }
    return ['Die Löschung kann nicht rückgängig gemacht werden.'];
  }

  get actionDialogConfirmLabel(): string {
    return this.actionDialogKind === 'restore' ? 'Wiederherstellen' : 'Snapshot löschen';
  }

  openRestoreDialog(snap: AcpSnapshot) {
    this.actionDialogKind = 'restore';
    this.actionDialogSnapshot = snap;
    this.actionDialogError = '';
    this.actionDialogBusy = false;
    this.actionDialogOpen = true;
    this.actionSuccess = '';
  }

  openDeleteDialog(snap: AcpSnapshot) {
    this.actionDialogKind = 'delete';
    this.actionDialogSnapshot = snap;
    this.actionDialogError = '';
    this.actionDialogBusy = false;
    this.actionDialogOpen = true;
    this.actionSuccess = '';
  }

  closeActionDialog() {
    if (this.actionDialogBusy) return;
    this.actionDialogOpen = false;
    this.actionDialogError = '';
    this.actionDialogSnapshot = null;
  }

  confirmActionDialog() {
    if (this.actionDialogBusy || !this.actionDialogSnapshot) return;
    const snapshot = this.actionDialogSnapshot;
    this.actionDialogBusy = true;
    this.actionDialogError = '';

    if (this.actionDialogKind === 'restore') {
      this.api.restoreSnapshot(this.acpId, snapshot.id).subscribe({
        next: () => {
          this.actionDialogBusy = false;
          this.actionDialogOpen = false;
          this.actionSuccess = `Snapshot v${snapshot.versionNumber} wurde wiederhergestellt.`;
          this.load();
        },
        error: (err) => {
          this.actionDialogBusy = false;
          this.actionDialogError =
            err?.error?.message || 'Unbekannter Fehler beim Wiederherstellen.';
        },
      });
      return;
    }

    this.api.deleteSnapshot(this.acpId, snapshot.id).subscribe({
      next: () => {
        if (this.diffPreview?.snapshotId === snapshot.id) {
          this.diffPreview = null;
          this.diffPreviewSnapshotVersion = null;
          this.diffError = '';
        }
        this.actionDialogBusy = false;
        this.actionDialogOpen = false;
        this.actionSuccess = `Snapshot v${snapshot.versionNumber} wurde gelöscht.`;
        this.load();
      },
      error: (err) => {
        this.actionDialogBusy = false;
        this.actionDialogError = err?.error?.message || 'Unbekannter Fehler beim Löschen.';
      },
    });
  }
}
