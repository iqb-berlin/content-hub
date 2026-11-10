import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { Ap } from '../../core/models/api.models';

@Component({
  selector: 'app-ap-list',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-header">
      <h1>{{ auth.isAdmin ? 'Assessment Packages' : 'Meine AP-Pakete' }}</h1>
      @if (auth.isAdmin) {
        <button
          class="btn btn-outline btn-state"
          (click)="showCreate = !showCreate"
          [attr.aria-expanded]="showCreate"
          aria-controls="ap-create-form"
        >
          + AP anlegen
        </button>
      }
    </div>

    @if (showCreate && auth.isAdmin) {
      <div id="ap-create-form" class="card">
        <h3>Neues AP anlegen</h3>
        <form (ngSubmit)="createAp()">
          <div class="form-group">
            <label>Package-ID</label>
            <input
              [(ngModel)]="newAp.packageId"
              name="packageId"
              required
              placeholder="z.B. vera-2026-math"
            />
          </div>
          <div class="form-group">
            <label>Name</label>
            <input [(ngModel)]="newAp.name" name="name" required />
          </div>
          <div class="form-group">
            <label>Beschreibung</label>
            <textarea [(ngModel)]="newAp.description" name="description" rows="2"></textarea>
          </div>
          <div class="toolbar">
            <button type="submit" class="btn btn-primary">Anlegen</button>
            <button type="button" class="btn btn-outline" (click)="showCreate = false">
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    }

    @if (error) {
      <div class="alert alert-error">{{ error }}</div>
    }

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Package-ID</th>
            <th>Name</th>
            <th>Beschreibung</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          @for (ap of aps; track ap.id) {
            <tr>
              <td>
                <code>{{ ap.packageId }}</code>
              </td>
              <td>
                @if (editingId === ap.id && canRename(ap)) {
                  <input
                    [(ngModel)]="editName"
                    (keyup.enter)="saveRename(ap)"
                    (keyup.escape)="cancelRename()"
                    class="input-sm"
                  />
                  <button
                    class="btn btn-sm btn-primary"
                    (click)="saveRename(ap)"
                    style="margin-left:4px"
                  >
                    Speichern
                  </button>
                  <button
                    class="btn btn-sm btn-outline"
                    (click)="cancelRename()"
                    style="margin-left:4px"
                  >
                    Abbrechen
                  </button>
                } @else {
                  {{ ap.name }}
                  @if (canRename(ap)) {
                    <button
                      class="btn btn-sm btn-link"
                      (click)="startRename(ap)"
                      style="margin-left:8px"
                      title="Umbenennen"
                    >
                      ✏️
                    </button>
                  }
                }
              </td>
              <td>{{ ap.description || '–' }}</td>
              <td>
                @if (canManage(ap)) {
                  <a [routerLink]="['/manage', ap.id]" class="btn btn-sm btn-outline">Verwalten</a>
                } @else {
                  <span class="text-muted">Keine Verwaltungsrechte</span>
                }
                @if (auth.isAdmin) {
                  <button
                    class="btn btn-sm btn-danger"
                    (click)="deleteAp(ap)"
                    style="margin-left:8px"
                  >
                    Löschen
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (!aps.length) {
        <div class="empty-state">
          <h3>
            {{ auth.isAdmin ? 'Keine APs vorhanden' : 'Keine zugewiesenen AP-Pakete vorhanden' }}
          </h3>
        </div>
      }
    </div>
  `,
})
export class ApListComponent implements OnInit {
  aps: Ap[] = [];
  showCreate = false;
  error = '';
  newAp = { packageId: '', name: '', description: '' };
  editingId: string | null = null;
  editName = '';

  constructor(
    private api: ApiService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.getAps().subscribe({
      next: (aps) => (this.aps = aps),
      error: (err) => (this.error = err.error?.message || 'Fehler beim Laden'),
    });
  }

  createAp() {
    if (!this.auth.isAdmin) return;
    this.api.createAp(this.newAp).subscribe({
      next: () => {
        this.showCreate = false;
        this.newAp = { packageId: '', name: '', description: '' };
        this.load();
      },
      error: (err) => (this.error = err.error?.message || 'Fehler beim Anlegen'),
    });
  }

  deleteAp(ap: Ap) {
    if (!this.auth.isAdmin) return;
    if (confirm(`AP "${ap.name}" wirklich löschen?`)) {
      this.api.deleteAp(ap.id).subscribe({ next: () => this.load() });
    }
  }

  canManage(ap: Ap): boolean {
    return this.auth.isAdmin || this.auth.hasApRole(ap.id, 'AP_MANAGER');
  }

  canRename(ap: Ap): boolean {
    return this.canManage(ap);
  }

  startRename(ap: Ap) {
    if (!this.canRename(ap)) return;
    this.editingId = ap.id;
    this.editName = ap.name;
  }

  cancelRename() {
    this.editingId = null;
    this.editName = '';
  }

  saveRename(ap: Ap) {
    if (!this.canRename(ap)) return;
    if (!this.editName.trim()) {
      this.error = 'Name darf nicht leer sein';
      return;
    }
    this.api.updateAp(ap.id, { name: this.editName.trim() }).subscribe({
      next: () => {
        this.editingId = null;
        this.editName = '';
        this.load();
      },
      error: (err) => (this.error = err.error?.message || 'Fehler beim Umbenennen'),
    });
  }
}
