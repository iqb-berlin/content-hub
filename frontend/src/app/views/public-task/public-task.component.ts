import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, catchError, switchMap } from 'rxjs';
import { PublicTaskSnapshot, PublicTasksService } from './public-tasks.service';
import { PublicTaskContentComponent } from './public-task-content.component';

@Component({
  selector: 'app-public-task',
  standalone: true,
  imports: [PublicTaskContentComponent],
  template: `
    @if (loading) {
      <p role="status">Aufgabe wird geladen …</p>
    }
    @if (error) {
      <div class="card" role="alert">
        <h1>Aufgabe nicht verfügbar</h1>
        <p>{{ error }}</p>
      </div>
    }
    @if (snapshot) {
      <app-public-task-content [snapshot]="snapshot" />
    }
  `,
})
export class PublicTaskComponent implements OnInit {
  snapshot: PublicTaskSnapshot | null = null;
  loading = true;
  error = '';

  constructor(
    private route: ActivatedRoute,
    private api: PublicTasksService,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit() {
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          this.loading = true;
          this.snapshot = null;
          this.error = '';
          return this.api.get(params.get('publicationId') || '').pipe(
            catchError((err) => {
              this.loading = false;
              this.error =
                err.status === 404
                  ? 'Der Link ist unbekannt oder die Veröffentlichung wurde zurückgezogen.'
                  : 'Die Aufgabe konnte nicht geladen werden. Bitte versuchen Sie es später erneut.';
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (task) => {
          this.snapshot = task.snapshot;
          this.loading = false;
        },
      });
  }
}
