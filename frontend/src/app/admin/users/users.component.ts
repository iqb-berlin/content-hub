import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { User } from '../../core/models/api.models';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [FormsModule, ConfirmDialogComponent],
  template: `
    <div class="page-header">
      <h1>Nutzerverwaltung</h1>
      <button
        class="btn btn-outline btn-state"
        (click)="showCreate = !showCreate"
        [attr.aria-expanded]="showCreate"
        aria-controls="user-create-form"
      >
        + Nutzer anlegen
      </button>
    </div>

    @if (showCreate) {
      <div id="user-create-form" class="card">
        <h3>Neuen Nutzer anlegen</h3>
        <form (ngSubmit)="createUser()">
          <div class="form-group">
            <label>Keycloak-Benutzername</label>
            <input [(ngModel)]="newUser.username" name="username" required />
          </div>
          <div class="form-group">
            <label>Anzeigename</label>
            <input [(ngModel)]="newUser.displayName" name="displayName" />
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
      <div class="table-scroll" role="region" aria-label="Nutzerliste" tabindex="0">
        <table class="table">
          <thead>
            <tr>
              <th>Benutzername</th>
              <th>Anzeigename</th>
              <th>Admin</th>
              <th>OIDC</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            @for (user of users; track user.id) {
              <tr>
                <td>{{ user.username }}</td>
                <td>{{ user.displayName || '–' }}</td>
                <td>
                  <span
                    class="badge"
                    [class.badge-success]="user.isAppAdmin"
                    [class.badge-info]="!user.isAppAdmin"
                  >
                    {{ user.isAppAdmin ? 'Admin' : 'Nutzer' }}
                  </span>
                </td>
                <td>
                  @if (user.oidcSub) {
                    <span class="badge badge-success" title="{{ user.oidcSub }}">✓ Verknüpft</span>
                  } @else {
                    <span class="badge badge-warning">Noch nicht mit Keycloak verknüpft</span>
                  }
                </td>
                <td>
                  <button class="btn btn-sm btn-outline" (click)="toggleAdmin(user)">
                    {{ user.isAppAdmin ? 'Admin entziehen' : 'Zum Admin' }}
                  </button>
                  <button
                    class="btn btn-sm btn-danger"
                    (click)="openDeleteUserDialog(user)"
                    style="margin-left:8px"
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (!users.length) {
        <div class="empty-state"><h3>Keine Nutzer vorhanden</h3></div>
      }
    </div>

    <app-confirm-dialog
      [open]="deleteDialogOpen"
      [title]="deleteDialogTitle"
      [message]="deleteDialogMessage"
      [details]="deleteDialogDetails"
      [error]="deleteDialogError"
      [busy]="deleteDialogBusy"
      busyLabel="Lösche Nutzer..."
      confirmLabel="Nutzer löschen"
      confirmVariant="danger"
      (confirmed)="confirmDeleteUser()"
      (cancelled)="closeDeleteUserDialog()"
    />
  `,
  styles: `
    .table-scroll {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
  `,
})
export class UsersComponent implements OnInit {
  users: User[] = [];
  showCreate = false;
  error = '';
  newUser = { username: '', displayName: '' };
  deleteDialogOpen = false;
  deleteDialogBusy = false;
  deleteDialogError = '';
  deleteDialogUser: User | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.getUsers().subscribe({
      next: (users) => (this.users = users),
      error: (err) => (this.error = err.error?.message || 'Fehler beim Laden'),
    });
  }

  createUser() {
    if (!this.newUser.username.trim()) {
      this.error = 'Der Keycloak-Benutzername ist erforderlich';
      return;
    }

    this.error = '';
    this.api.createUser(this.newUser).subscribe({
      next: () => {
        this.showCreate = false;
        this.newUser = { username: '', displayName: '' };
        this.load();
      },
      error: (err) => (this.error = err.error?.message || 'Fehler beim Anlegen'),
    });
  }

  toggleAdmin(user: User) {
    this.api.setAppAdmin(user.id, !user.isAppAdmin).subscribe({ next: () => this.load() });
  }

  get deleteDialogTitle(): string {
    if (!this.deleteDialogUser) return 'Nutzer löschen';
    return `Nutzer "${this.deleteDialogUser.username}" löschen`;
  }

  get deleteDialogMessage(): string {
    return 'Der Benutzerzugang wird dauerhaft entfernt.';
  }

  get deleteDialogDetails(): string[] {
    return [
      'Diese Aktion kann nicht rückgängig gemacht werden.',
      'Falls die Person letzter AP-Manager in einem AP ist, wird das Löschen verhindert.',
    ];
  }

  openDeleteUserDialog(user: User) {
    this.deleteDialogUser = user;
    this.deleteDialogError = '';
    this.deleteDialogBusy = false;
    this.deleteDialogOpen = true;
  }

  closeDeleteUserDialog() {
    if (this.deleteDialogBusy) return;
    this.deleteDialogOpen = false;
    this.deleteDialogError = '';
    this.deleteDialogUser = null;
  }

  confirmDeleteUser() {
    if (!this.deleteDialogUser || this.deleteDialogBusy) return;
    this.deleteDialogBusy = true;
    this.deleteDialogError = '';

    this.api.deleteUser(this.deleteDialogUser.id).subscribe({
      next: () => {
        this.deleteDialogBusy = false;
        this.deleteDialogOpen = false;
        this.deleteDialogUser = null;
        this.load();
      },
      error: (err) => {
        this.deleteDialogBusy = false;
        this.deleteDialogError = this.mapDeleteError(err);
      },
    });
  }

  private mapDeleteError(err: any): string {
    const message = String(err?.error?.message || '');

    if (message.includes('would have no AP_MANAGER')) {
      return 'Löschen nicht möglich: Diese Person ist in mindestens einem AP der letzte AP-Manager.';
    }

    return message || 'Fehler beim Löschen des Nutzers.';
  }
}
