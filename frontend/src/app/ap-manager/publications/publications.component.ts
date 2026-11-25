import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApManagerContextComponent } from '../shared/ap-manager-context.component';
import { PublicTaskContentComponent } from '../../views/public-task/public-task-content.component';
import {
  PublicTaskInput,
  PublicTaskPreview,
  PublicTaskSummary,
  PublicTasksService,
} from '../../views/public-task/public-tasks.service';

@Component({
  selector: 'app-publications',
  standalone: true,
  imports: [FormsModule, DatePipe, ApManagerContextComponent, PublicTaskContentComponent],
  template: `
    <app-ap-manager-context />
    <h1>Öffentliche Aufgaben</h1>
    <p>
      Veröffentlichen Sie einzelne Aufgaben mit Stimulus, Kodieranweisung und Metadaten unter einem
      dauerhaften Link.
    </p>
    @if (error) {
      <p class="alert alert-danger" role="alert">{{ error }}</p>
    }
    @if (loading) {
      <p role="status">Aufgaben werden geladen …</p>
    }
    <form class="card" (ngSubmit)="preview()">
      <h2>Veröffentlichung vorbereiten</h2>
      <p>
        Die Vorschau enthält die gesamte Aufgabe und alle Metadaten ihrer Quelldatei. Interne
        Review- und Studio-Kommentare werden nicht übernommen.
      </p>
      <label for="publication-unit">Aufgabe</label>
      <select
        id="publication-unit"
        name="unit"
        [(ngModel)]="input.unitId"
        (ngModelChange)="clearPreview()"
        required
        [disabled]="busy || loading"
      >
        <option value="">Bitte wählen</option>
        @for (unit of units; track $index) {
          <option [value]="unit.id">{{ unit.name }} ({{ unit.id }})</option>
        }
      </select>
      <label for="publication-copyright">Copyright-Hinweis zum Stimulus</label>
      <textarea
        id="publication-copyright"
        name="copyright"
        [(ngModel)]="input.copyrightNotice"
        (ngModelChange)="clearPreview()"
        required
        maxlength="10000"
        rows="3"
        [disabled]="busy"
      ></textarea>
      <label for="publication-comments">Öffentliche Kommentare (optional)</label>
      <textarea
        id="publication-comments"
        name="comments"
        [(ngModel)]="input.publicComments"
        (ngModelChange)="clearPreview()"
        maxlength="20000"
        rows="3"
        [disabled]="busy"
      ></textarea>
      <button
        class="btn btn-outline"
        type="submit"
        [disabled]="busy || loading || !input.unitId || !input.copyrightNotice.trim()"
      >
        Vorschau prüfen
      </button>
    </form>
    @if (draft) {
      <section class="card approval">
        <h2>Öffentliche Vorschau</h2>
        <p>
          Mit der Freigabe werden genau diese Inhalte ohne Anmeldung sichtbar. Der Stand bleibt auch
          bei Änderungen oder Löschung des Quellpakets erhalten. Der Link hat kein automatisches
          Ablaufdatum.
        </p>
        <app-public-task-content [snapshot]="draft.snapshot" />
        <button type="button" class="btn btn-primary" (click)="publish()" [disabled]="busy">
          Diesen Stand öffentlich freigeben
        </button>
      </section>
    }
    <section class="card">
      <h2>Veröffentlichte Stände</h2>
      @if (!publications.length && !loading) {
        <p>Noch keine Veröffentlichungen.</p>
      }
      @for (task of publications; track task.id) {
        <article class="publication">
          <h3>{{ task.title }}</h3>
          <p>
            {{ task.createdAt | date: 'dd.MM.yyyy HH:mm' }} ·
            {{ task.published ? 'Öffentlich' : 'Zurückgezogen' }}
          </p>
          <a [href]="task.path" target="_blank" rel="noopener">{{ absoluteUrl(task.path) }}</a>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            (click)="setPublished(task)"
            [disabled]="busy"
          >
            {{
              task.published
                ? 'Veröffentlichung zurückziehen'
                : 'Unter demselben Link wieder freigeben'
            }}
          </button>
        </article>
      }
    </section>
  `,
  styles: [
    `
      .card {
        padding: 24px;
        margin-bottom: 24px;
      }
      h2 {
        margin-top: 0;
      }
      label {
        display: block;
        margin-top: 16px;
        margin-bottom: 6px;
        font-weight: 600;
      }
      select,
      textarea {
        display: block;
        width: 100%;
        max-width: 900px;
        box-sizing: border-box;
        padding: 10px;
        font: inherit;
      }
      form button {
        margin-top: 16px;
      }
      .approval {
        border: 2px solid var(--color-primary);
      }
      .publication {
        border-top: 1px solid var(--color-border);
        padding: 16px 0;
      }
      .publication a {
        display: block;
        overflow-wrap: anywhere;
        margin-bottom: 12px;
      }
    `,
  ],
})
export class PublicationsComponent implements OnInit {
  apId = '';
  units: { id: string; name: string }[] = [];
  publications: PublicTaskSummary[] = [];
  input: PublicTaskInput = { unitId: '', copyrightNotice: '', publicComments: '' };
  draft: PublicTaskPreview | null = null;
  loading = true;
  busy = false;
  error = '';

  constructor(
    private route: ActivatedRoute,
    private api: PublicTasksService,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit() {
    this.apId =
      this.route.parent?.snapshot.paramMap.get('apId') ||
      this.route.snapshot.paramMap.get('apId') ||
      '';
    forkJoin({ units: this.api.units(this.apId), publications: this.api.list(this.apId) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.units = data.units;
          this.publications = data.publications;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.showError(err);
        },
      });
  }

  clearPreview() {
    this.draft = null;
  }

  preview() {
    if (this.busy || !this.input.unitId || !this.input.copyrightNotice.trim()) return;
    this.busy = true;
    this.error = '';
    this.draft = null;
    this.api
      .preview(this.apId, this.input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.draft = draft;
          this.busy = false;
        },
        error: (err) => this.showError(err),
      });
  }

  publish() {
    if (!this.draft || this.busy) return;
    this.busy = true;
    this.error = '';
    this.api
      .create(this.apId, this.input, this.draft.sourceRevision)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (task) => {
          this.publications = [task, ...this.publications];
          this.draft = null;
          this.busy = false;
        },
        error: (err) => {
          this.draft = null;
          this.showError(err);
        },
      });
  }

  setPublished(task: PublicTaskSummary) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.api
      .setPublished(this.apId, task.id, !task.published)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.publications = this.publications.map((entry) =>
            entry.id === task.id ? result : entry,
          );
          this.busy = false;
        },
        error: (err) => this.showError(err),
      });
  }

  absoluteUrl(path: string) {
    return new URL(path, window.location.origin).href;
  }

  private showError(err: { error?: { message?: string | string[] } }) {
    this.busy = false;
    const message = err.error?.message;
    this.error = Array.isArray(message)
      ? message.join(' ')
      : message || 'Die Veröffentlichung konnte nicht verarbeitet werden.';
  }
}
