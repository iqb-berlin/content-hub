import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-credential-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-wrapper">
      <div class="card login-card">
        <h1>AP-Zugang</h1>
        <p class="subtitle">Anmeldung mit Zugangsdaten</p>
        @if (error) {
          <div class="alert alert-error">{{ error }}</div>
        }
        <form (ngSubmit)="onSubmit()">
          <div class="form-group">
            <label for="username">Benutzername</label>
            <input id="username" [(ngModel)]="username" name="username" required autofocus />
          </div>
          <div class="form-group">
            <label for="password">Kennwort</label>
            <input id="password" type="password" [(ngModel)]="password" name="password" required />
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%" [disabled]="loading">
            {{ loading ? 'Anmelden...' : 'Zugang öffnen' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      .login-wrapper {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 60vh;
      }
      .login-card {
        width: 100%;
        max-width: 400px;
      }
      .subtitle {
        color: var(--color-text-secondary);
        margin-bottom: 24px;
      }
    `,
  ],
})
export class CredentialLoginComponent implements OnInit {
  apId = '';
  username = '';
  password = '';
  loading = false;
  error = '';

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit() {
    this.apId = this.route.snapshot.paramMap.get('apId') || '';
  }

  onSubmit() {
    this.loading = true;
    this.error = '';
    this.auth.credentialLogin(this.apId, this.username, this.password).subscribe({
      next: () => {
        this.router.navigate(['/view', this.apId]);
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Anmeldung fehlgeschlagen';
        this.loading = false;
      },
    });
  }
}
