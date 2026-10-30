import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import {
  catchError,
  of,
  combineLatest,
  distinctUntilChanged,
  map,
  Subject,
  switchMap,
  takeUntil,
} from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { FeatureConfig, TaskSequence } from '../../core/models/api.models';
import { BreadcrumbComponent, BreadcrumbItem } from '../../shared/components/breadcrumb.component';
import { sequenceLabel } from '../../shared/sequence-label';
import { unitLabel } from '../../shared/unit-label';
import { ItemCommentThreadComponent } from '../comment-thread/item-comment-thread.component';
import { UnitViewComponent } from '../unit-view/unit-view.component';

interface ReviewBookletOption {
  id: string;
  name?: unknown;
}

@Component({
  selector: 'app-task-sequence',
  host: { '[class.review-workspace-view]': 'isBooklet' },
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    BreadcrumbComponent,
    ItemCommentThreadComponent,
    UnitViewComponent,
  ],
  template: `
    @if (sequence) {
      <app-breadcrumb [items]="breadcrumbs" />

      @if (!isBooklet) {
        <div class="seq-header">
          <h1>{{ sequence.name || sequence.id }}</h1>
          <div class="seq-actions">
            @if (showDownloadBtn) {
              <button
                class="btn btn-outline btn-sm"
                (click)="downloadSequence()"
                [disabled]="!hasUnits"
              >
                ⬇️ Download Aufgabenfolge
              </button>
            }
          </div>
        </div>
      }

      @if (showCommentBtn && !isBooklet) {
        <app-item-comment-thread
          [acpId]="acpId"
          [targetType]="'BOOKLET'"
          [bookletId]="sequenceId"
          [enabled]="showCommentBtn"
        />
      }

      <div
        #reviewWorkspace
        class="review-workspace"
        [class.fullscreen-fallback]="isFallbackFullscreen"
        [attr.aria-busy]="sequenceLoading"
      >
        @if (isBooklet) {
          <div class="workspace-heading">
            <div>
              <span class="workspace-eyebrow">Testheft-Review</span>
              <h2>{{ sequenceId }}</h2>
              <p>
                {{ bookletName }} <span aria-hidden="true">·</span>
                {{ sequence.units.length }} Aufgaben
              </p>
            </div>
            @if (reviewBooklets.length > 1) {
              <button
                class="btn btn-outline booklet-switcher"
                (click)="toggleBookletList()"
                [attr.aria-expanded]="bookletListOpen"
                [attr.aria-label]="
                  'Testheft wechseln, aktuell ' +
                  bookletName +
                  ', ' +
                  currentBookletPosition +
                  ' von ' +
                  reviewBooklets.length
                "
                aria-controls="review-booklet-list"
              >
                Testheft wechseln <span aria-hidden="true">⌄</span>
              </button>
            }
          </div>
        }
        <!-- Navigation bar -->
        <div class="nav-bar">
          <div class="sequence-navigation">
            <button class="btn btn-primary" [disabled]="!canGoPrev" (click)="prev()">
              ← Zurück
            </button>
            @if (hasUnits && currentUnit) {
              <span class="nav-info">
                @if (isBooklet) {
                  <span>Aufgabe</span>
                  <strong
                    >{{ currentIndex + 1 }}
                    <span class="position-total">von {{ sequence.units.length }}</span></strong
                  >
                } @else {
                  Aufgabe {{ currentIndex + 1 }} / {{ sequence.units.length }}:
                  <strong>{{ currentUnit.name || currentUnit.id }}</strong>
                  @if (currentUnit.blockPath?.length) {
                    <small> · {{ currentUnit.blockPath?.join(' / ') }}</small>
                  }
                }
              </span>
            } @else {
              <span class="nav-info"><strong>Keine Aufgabe in dieser Aufgabenfolge</strong></span>
            }
            <button class="btn btn-primary" [disabled]="!canGoNext" (click)="next()">
              Weiter →
            </button>
          </div>
          <div class="workspace-actions">
            @if (isBooklet && currentUnit && !sequenceLoading) {
              <a
                class="btn btn-outline btn-sm"
                [href]="unitHref(currentIndex)"
                (click)="copyUnitLink($event)"
                title="Direktlink zur aktuellen Aufgabe kopieren"
                aria-label="Direktlink zur Aufgabe kopieren"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  aria-hidden="true"
                >
                  <path
                    d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 9l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
                    transform="translate(1 -1)"
                  />
                </svg>
                Link kopieren
              </a>
            }
            @if (showDownloadBtn && isBooklet) {
              <button
                class="btn btn-outline btn-sm"
                (click)="downloadSequence()"
                [disabled]="!hasUnits"
              >
                ⬇️ Download Testheft
              </button>
            }
            @if (showUnitListBtn) {
              <button
                class="btn btn-outline btn-sm btn-state"
                (click)="toggleUnitList()"
                [disabled]="sequenceLoading"
                [attr.aria-expanded]="unitListOpen"
                aria-controls="task-sequence-unit-list"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  aria-hidden="true"
                >
                  <path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" />
                </svg>
                Aufgabenliste
              </button>
            }
            <button class="btn btn-outline btn-sm" (click)="toggleFullscreen()">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                aria-hidden="true"
              >
                <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
              </svg>
              {{ isFullscreen ? 'Vollbild beenden' : 'Vollbild' }}
            </button>
          </div>
        </div>

        @if (unitLinkMessage) {
          <p role="status" class="help-text">{{ unitLinkMessage }}</p>
        }
        @if (manualUnitLink) {
          <label class="manual-unit-link">
            Direktlink zum manuellen Kopieren
            <input
              #manualLinkInput
              readonly
              [value]="manualUnitLink"
              (focus)="manualLinkInput.select()"
            />
          </label>
        }

        @if (invalidUnitLink) {
          <p role="status" class="help-text">
            Die verlinkte Aufgabe wurde in diesem Testheft nicht gefunden. Der Direktlink ist
            ungültig oder veraltet.
            @if (hasUnits) {
              Die erste Aufgabe wird angezeigt.
            }
          </p>
        }

        <!-- Current unit review -->
        @if (hasUnits && currentUnit) {
          <div class="unit-embed card">
            <app-unit-view
              [acpId]="acpId"
              [unitId]="currentUnit.id"
              [bookletId]="sequenceId"
              [bookletName]="bookletName"
              [embedded]="true"
              [reviewMode]="isBooklet && canReview"
              [featureConfigOverride]="featureConfig"
            />
          </div>
        } @else {
          <div class="unit-embed card">
            <div class="embed-body">
              <p class="help-text">
                Diese Aufgabenfolge enthält aktuell keine referenzierten Aufgaben.
              </p>
            </div>
          </div>
        }

        <!-- Unit list popup -->
        @if (unitListOpen && hasUnits) {
          <div class="popup-overlay" (click)="unitListOpen = false">
            <div id="task-sequence-unit-list" class="popup card" (click)="$event.stopPropagation()">
              <div class="popup-header">
                <h3>Aufgaben in dieser Folge</h3>
                <button class="btn btn-outline btn-sm" (click)="unitListOpen = false">✕</button>
              </div>
              @for (unit of sequence.units; track unit.occurrenceId || $index; let i = $index) {
                <div class="unit-list-row">
                  <button
                    class="unit-list-item"
                    [class.active]="i === currentIndex"
                    [attr.aria-current]="i === currentIndex ? 'step' : null"
                    (click)="jumpTo(i)"
                  >
                    <span class="unit-num">{{ i + 1 }}</span>
                    <span>
                      @if (unit.blockPath?.length) {
                        <small>{{ unit.blockPath?.join(' / ') }} · </small>
                      }
                      {{ isBooklet ? unitLabel(unit) : unit.name || unit.id }}
                      @if (unit.alias) {
                        <small> · Alias: {{ unit.alias }}</small>
                      }
                    </span>
                  </button>
                  @if (isBooklet) {
                    <a
                      class="unit-direct-link"
                      [routerLink]="['/view', acpId, 'sequence', sequenceId]"
                      [queryParams]="unitLinkParams(i)"
                      queryParamsHandling="merge"
                      [attr.aria-label]="
                        'Direktlink zu Aufgabe ' + (i + 1) + ': ' + unitLabel(unit)
                      "
                      title="Direktlink zur Aufgabe"
                      (click)="unitListOpen = false"
                      >🔗</a
                    >
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Booklet selection popup -->
        @if (bookletListOpen) {
          <div class="popup-overlay" (click)="closeBookletList()">
            <div
              id="review-booklet-list"
              class="popup booklet-popup card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-booklet-list-heading"
              (click)="$event.stopPropagation()"
            >
              <div class="popup-header">
                <h3 id="review-booklet-list-heading">Testheft wechseln</h3>
                <button
                  class="btn btn-outline btn-sm"
                  aria-label="Testheftauswahl schließen"
                  (click)="closeBookletList()"
                >
                  ✕
                </button>
              </div>
              <label class="booklet-search">
                <span>Testhefte durchsuchen</span>
                <input
                  type="search"
                  placeholder="Bezeichnung oder Booklet-ID"
                  [(ngModel)]="bookletSearchText"
                />
              </label>
              <div class="booklet-result-count">
                {{ filteredReviewBooklets.length }} von {{ reviewBooklets.length }} Testheften
              </div>
              <div class="booklet-list-items">
                @for (booklet of filteredReviewBooklets; track booklet.id) {
                  <button
                    class="unit-list-item booklet-list-item"
                    [class.active]="booklet.id === sequenceId"
                    [attr.aria-current]="booklet.id === sequenceId ? 'page' : null"
                    (click)="switchBooklet(booklet.id)"
                  >
                    <span class="booklet-list-identity">
                      <span class="booklet-id-row">
                        @if (booklet.id === sequenceId) {
                          <span class="current-booklet-check" aria-hidden="true">✓</span>
                        }
                        <code class="booklet-id">{{ booklet.id }}</code>
                      </span>
                      @if (hasDistinctBookletName(booklet)) {
                        <span class="booklet-name">{{ bookletDisplayName(booklet) }}</span>
                      }
                    </span>
                    @if (booklet.id === sequenceId) {
                      <span class="current-booklet-label">Aktuell geöffnet</span>
                    }
                  </button>
                } @empty {
                  <p class="help-text">Keine Testhefte entsprechen dem Filter.</p>
                }
              </div>
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="empty-state"><h3>Lade Aufgabenfolge...</h3></div>
    }
  `,
  styles: [
    `
      .seq-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .seq-header h1 {
        margin-bottom: 0;
      }
      .seq-actions {
        display: flex;
        gap: 8px;
      }
      .manual-unit-link {
        display: grid;
        gap: 8px;
        margin-bottom: 16px;
      }
      .manual-unit-link input {
        width: 100%;
        min-width: 0;
      }

      .nav-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 16px;
        background: var(--color-bg);
        border-radius: var(--radius);
        margin-bottom: 16px;
      }
      .sequence-navigation,
      .workspace-actions {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .sequence-navigation {
        flex: 1;
        justify-content: center;
      }
      .workspace-actions {
        min-width: 0;
        flex-wrap: wrap;
      }
      .booklet-switcher {
        min-width: 0;
        max-width: 100%;
      }
      .nav-info {
        font-size: 0.95rem;
        color: var(--color-text-secondary);
      }
      .sequence-navigation .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--color-border);
        border-color: var(--color-border);
        color: var(--color-text-secondary);
        box-shadow: none;
      }

      .unit-embed {
        padding: 16px;
      }
      .review-workspace:fullscreen,
      .review-workspace.fullscreen-fallback {
        overflow: auto;
        padding: 16px;
        background: var(--color-bg);
      }
      .review-workspace.fullscreen-fallback {
        position: fixed;
        inset: 0;
        z-index: 2000;
      }
      .review-workspace:fullscreen .nav-bar,
      .review-workspace.fullscreen-fallback .nav-bar {
        position: sticky;
        top: 0;
        z-index: 20;
        box-shadow: var(--shadow);
      }
      .popup-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .popup {
        width: 100%;
        max-width: 420px;
        max-height: 70vh;
        overflow-y: auto;
      }
      .popup-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .popup-header h3 {
        margin: 0;
      }
      .booklet-popup {
        max-width: 560px;
      }
      .booklet-search {
        display: grid;
        gap: 6px;
        margin-bottom: 8px;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .booklet-search input {
        width: 100%;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font: inherit;
      }
      .booklet-result-count {
        margin-bottom: 8px;
        color: var(--color-text-secondary);
        font-size: 0.82rem;
      }
      .booklet-list-items {
        max-height: min(50vh, 480px);
        overflow-y: auto;
      }
      .unit-list-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 10px 12px;
        border: none;
        background: none;
        font-family: inherit;
        font-size: 0.9rem;
        cursor: pointer;
        border-radius: 6px;
        text-align: left;
        transition: background 0.15s;
      }
      .unit-list-row {
        display: flex;
        align-items: center;
      }
      .unit-list-row .unit-list-item {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .unit-direct-link {
        padding: 12px;
        flex-shrink: 0;
      }
      .unit-list-item:hover {
        background: var(--color-bg);
      }
      .unit-list-item.active {
        background: rgba(41, 128, 185, 0.1);
        font-weight: 600;
      }
      .unit-num {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--color-bg);
        font-weight: 600;
        font-size: 0.8rem;
      }
      .unit-list-item.active .unit-num {
        background: var(--color-primary);
        color: white;
      }
      .booklet-list-item {
        justify-content: space-between;
        gap: 16px;
      }
      .booklet-list-item.active {
        background: rgba(41, 128, 185, 0.16);
        box-shadow: inset 4px 0 0 var(--color-primary);
      }
      .booklet-list-identity {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      .booklet-id-row {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .booklet-id {
        color: inherit;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 700;
      }
      .current-booklet-check {
        color: var(--color-primary);
        font-size: 1rem;
        line-height: 1;
      }
      .booklet-name {
        min-width: 0;
        color: var(--color-text-secondary);
        font-size: 0.8rem;
        font-weight: 400;
        overflow-wrap: anywhere;
      }
      .current-booklet-label {
        flex: 0 0 auto;
        padding: 3px 7px;
        border-radius: 999px;
        background: var(--color-primary);
        color: white;
        font-size: 0.72rem;
        font-weight: 700;
        white-space: nowrap;
      }

      @media (max-width: 768px) {
        .seq-header {
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;
        }
        .nav-bar {
          flex-direction: column;
          gap: 12px;
        }
        .sequence-navigation {
          flex-wrap: wrap;
        }
        .workspace-actions {
          width: 100%;
          justify-content: center;
        }
        .booklet-switcher {
          flex-basis: 100%;
        }
      }
    `,
  ],
})
export class TaskSequenceComponent implements OnInit, OnDestroy {
  @ViewChild('reviewWorkspace') reviewWorkspace?: ElementRef<HTMLElement>;

  acpId = '';
  sequenceId = '';
  sequenceKind?: 'booklet';
  canReview = false;
  sequence: TaskSequence | null = null;
  sequenceLoading = false;
  currentIndex = 0;
  invalidUnitLink = false;
  unitLinkMessage = '';
  manualUnitLink = '';
  breadcrumbs: BreadcrumbItem[] = [];
  reviewBooklets: ReviewBookletOption[] = [];
  readonly unitLabel = unitLabel;

  get bookletName(): string {
    return this.sequence ? sequenceLabel(this.sequence) || 'Testheft' : 'Testheft';
  }

  unitListOpen = false;
  bookletListOpen = false;
  bookletSearchText = '';
  showCommentBtn = false;
  showDownloadBtn = false;
  showUnitListBtn = true;
  featureConfig: FeatureConfig | null = null;
  isFullscreen = false;
  isFallbackFullscreen = false;

  private readonly destroy$ = new Subject<void>();
  private unitLinkCopyRequest = 0;

  private readonly fullscreenChangeHandler = () => {
    this.isFullscreen =
      this.isFallbackFullscreen ||
      document.fullscreenElement === this.reviewWorkspace?.nativeElement;
    this.changeDetector.markForCheck();
  };
  private readonly fullscreenKeyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isFallbackFullscreen) this.closeFallbackFullscreen();
  };

  constructor(
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(Router) private router: Router,
    @Inject(Location) private location: Location,
    @Inject(ApiService) private api: ApiService,
    @Inject(ChangeDetectorRef) private changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('keydown', this.fullscreenKeyHandler);
    this.acpId = this.route.snapshot.paramMap.get('acpId') || '';

    this.api
      .getCapabilities(this.acpId)
      .pipe(
        catchError(() => of({ canReview: false })),
        takeUntil(this.destroy$),
      )
      .subscribe((capabilities) => {
        this.canReview = capabilities.canReview === true;
        this.changeDetector.markForCheck();
      });

    this.api
      .getAcpStartPage(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        const fc: FeatureConfig = data?.featureConfig || {};
        this.featureConfig = fc;
        this.reviewBooklets = (Array.isArray(data?.sequences) ? data.sequences : [])
          .filter(
            (sequence: any) =>
              sequence?.kind === 'booklet' &&
              typeof sequence.id === 'string' &&
              sequence.id.trim().length > 0,
          )
          .map((sequence: any) => ({ ...sequence, id: sequence.id.trim() }))
          .sort((left: ReviewBookletOption, right: ReviewBookletOption) =>
            left.id.localeCompare(right.id, 'de', { numeric: true }),
          );
        this.applyFeatureConfig(fc);
      });

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        map(([params, queryParams]) => ({
          sequenceId: params.get('sequenceId') || '',
          sequenceKind: queryParams.get('kind') === 'booklet' ? ('booklet' as const) : undefined,
        })),
        distinctUntilChanged(
          (previous, current) =>
            previous.sequenceId === current.sequenceId &&
            previous.sequenceKind === current.sequenceKind,
        ),
        switchMap(({ sequenceId, sequenceKind }) => {
          this.clearUnitLinkFeedback();
          this.sequenceLoading = true;
          this.unitListOpen = false;
          this.changeDetector.markForCheck();
          return this.api
            .getViewSequence(this.acpId, sequenceId, sequenceKind)
            .pipe(
              switchMap((sequence) =>
                (sequenceKind === 'booklet'
                  ? this.route.queryParamMap
                  : of(this.route.snapshot.queryParamMap)
                ).pipe(map((queryParams) => ({ sequence, sequenceId, sequenceKind, queryParams }))),
              ),
            );
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(({ sequence, sequenceId, sequenceKind, queryParams }) => {
        this.clearUnitLinkFeedback();
        this.sequenceLoading = false;
        this.sequenceId = sequenceId;
        this.sequenceKind = sequenceKind;
        this.currentIndex = 0;
        this.unitListOpen = false;
        this.closeBookletList();
        if (this.featureConfig) this.applyFeatureConfig(this.featureConfig);
        this.sequence = this.normalizeSequence(sequence);
        this.selectLinkedUnit(queryParams);
        this.breadcrumbs = [
          { label: 'Content Hub', route: ['/'] },
          { label: 'ACP', route: ['/view', this.acpId] },
          {
            label: this.isBooklet ? this.sequenceId : this.sequence.name || 'Aufgabenfolge',
          },
        ];
        this.changeDetector.markForCheck();
      });
  }

  ngOnDestroy() {
    this.clearUnitLinkFeedback();
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('keydown', this.fullscreenKeyHandler);
  }

  get hasUnits(): boolean {
    return !!this.sequence?.units?.length;
  }

  get isBooklet(): boolean {
    return this.sequenceKind === 'booklet';
  }

  get currentUnit(): TaskSequence['units'][number] | null {
    if (!this.sequence?.units?.length) return null;
    return this.sequence.units[this.currentIndex] || null;
  }

  get canGoPrev(): boolean {
    return !this.sequenceLoading && this.hasUnits && this.currentIndex > 0;
  }

  get canGoNext(): boolean {
    return (
      !this.sequenceLoading &&
      this.hasUnits &&
      !!this.sequence &&
      this.currentIndex < this.sequence.units.length - 1
    );
  }

  get currentBookletPosition(): number {
    const index = this.reviewBooklets.findIndex((booklet) => booklet.id === this.sequenceId);
    return index >= 0 ? index + 1 : 0;
  }

  get filteredReviewBooklets(): ReviewBookletOption[] {
    const term = this.bookletSearchText.trim().toLocaleLowerCase('de');
    if (!term) return this.reviewBooklets;
    return this.reviewBooklets.filter((booklet) =>
      [booklet.id, this.bookletDisplayName(booklet)].some((value) =>
        value.toLocaleLowerCase('de').includes(term),
      ),
    );
  }

  prev() {
    if (!this.canGoPrev) return;
    this.jumpTo(this.currentIndex - 1);
  }

  next() {
    if (!this.canGoNext) return;
    this.jumpTo(this.currentIndex + 1);
  }

  jumpTo(index: number) {
    if (this.sequenceLoading || !this.sequence?.units?.length) return;
    const max = this.sequence.units.length - 1;
    if (!Number.isInteger(index) || index < 0 || index > max) return;
    if (this.isBooklet) {
      void this.router.navigate(['/view', this.acpId, 'sequence', this.sequenceId], {
        queryParams: this.unitLinkParams(index),
        queryParamsHandling: 'merge',
      });
    } else {
      this.currentIndex = index;
    }
    this.unitListOpen = false;
  }

  unitLinkParams(index: number): {
    kind: 'booklet';
    occurrence: string | null;
    position: number | null;
  } {
    const unit = this.sequence?.units[index];
    const occurrence = unit?.linkId || unit?.occurrenceId || null;
    return { kind: 'booklet', occurrence, position: occurrence ? null : index + 1 };
  }

  unitHref(index: number): string {
    const tree = this.router.createUrlTree(['/view', this.acpId, 'sequence', this.sequenceId], {
      queryParams: this.unitLinkParams(index),
      queryParamsHandling: 'merge',
    });
    return this.location.prepareExternalUrl(this.router.serializeUrl(tree));
  }

  async copyUnitLink(event: MouseEvent): Promise<void> {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (this.sequenceLoading || !this.isBooklet || !this.currentUnit) return;
    const href = (event.currentTarget as HTMLAnchorElement).href;
    this.clearUnitLinkFeedback();
    const request = this.unitLinkCopyRequest;
    try {
      await navigator.clipboard.writeText(href);
      if (request !== this.unitLinkCopyRequest) return;
      this.unitLinkMessage = 'Link kopiert.';
    } catch {
      if (request !== this.unitLinkCopyRequest) return;
      this.unitLinkMessage = 'Der Link konnte nicht automatisch kopiert werden.';
      this.manualUnitLink = href;
    }
    this.changeDetector.markForCheck();
  }

  private clearUnitLinkFeedback(): void {
    this.unitLinkCopyRequest += 1;
    this.unitLinkMessage = '';
    this.manualUnitLink = '';
  }

  private selectLinkedUnit(params: ParamMap) {
    this.invalidUnitLink = false;
    if (!this.isBooklet) return;
    const occurrence = params.get('occurrence');
    const position = params.get('position');
    if (occurrence === null && position === null) return;

    let index = -1;
    if (occurrence !== null && position === null && params.getAll('occurrence').length === 1) {
      const matches = this.sequence!.units.map((unit, index) => ({ unit, index })).filter(
        ({ unit }) => unit.linkId === occurrence || unit.occurrenceId === occurrence,
      );
      if (matches.length === 1) index = matches[0].index;
    } else if (
      occurrence === null &&
      position !== null &&
      params.getAll('position').length === 1 &&
      /^[1-9]\d*$/.test(position)
    ) {
      const value = Number(position);
      if (Number.isSafeInteger(value)) index = value - 1;
    }
    if (index >= 0 && index < this.sequence!.units.length) {
      this.currentIndex = index;
    } else {
      this.invalidUnitLink = true;
    }
  }

  toggleUnitList() {
    if (this.sequenceLoading || !this.hasUnits) return;
    this.closeBookletList();
    this.unitListOpen = !this.unitListOpen;
  }

  toggleBookletList() {
    this.unitListOpen = false;
    this.bookletListOpen = !this.bookletListOpen;
    if (!this.bookletListOpen) this.bookletSearchText = '';
  }

  closeBookletList() {
    this.bookletListOpen = false;
    this.bookletSearchText = '';
  }

  switchBooklet(bookletId: string) {
    if (!bookletId || !this.reviewBooklets.some((booklet) => booklet.id === bookletId)) return;
    this.closeBookletList();
    if (bookletId === this.sequenceId) return;
    void this.router.navigate(['/view', this.acpId, 'sequence', bookletId], {
      queryParams: { kind: 'booklet' },
    });
  }

  bookletDisplayName(booklet: ReviewBookletOption): string {
    return sequenceLabel(booklet) || booklet.id;
  }

  hasDistinctBookletName(booklet: ReviewBookletOption): boolean {
    return this.bookletDisplayName(booklet) !== booklet.id;
  }

  async toggleFullscreen() {
    const workspace = this.reviewWorkspace?.nativeElement;
    if (!workspace) return;
    if (this.isFallbackFullscreen) {
      this.closeFallbackFullscreen();
      return;
    }
    try {
      if (document.fullscreenElement === workspace) await document.exitFullscreen();
      else await workspace.requestFullscreen();
    } catch {
      this.isFallbackFullscreen = true;
      this.isFullscreen = true;
      this.changeDetector.markForCheck();
    }
  }

  private closeFallbackFullscreen() {
    this.isFallbackFullscreen = false;
    this.isFullscreen = false;
    this.changeDetector.markForCheck();
  }

  downloadSequence() {
    if (!this.hasUnits) return;
    // Download all units in the sequence as ZIP
    const url = `/api/acp/${this.acpId}/files?sequenceId=${encodeURIComponent(this.sequenceId)}&format=zip${this.sequenceKind === 'booklet' ? '&kind=booklet' : ''}`;
    window.open(this.api.appendAuthToken(url), '_blank');
  }

  private applyFeatureConfig(featureConfig: FeatureConfig) {
    const commentTargets = Array.isArray(featureConfig.commentTargets)
      ? featureConfig.commentTargets
      : [];
    this.showCommentBtn = !!(
      this.sequenceKind === 'booklet' &&
      featureConfig.enableCommenting &&
      commentTargets.includes('BOOKLET')
    );
    this.showDownloadBtn = !!featureConfig.allowUnitDownload;
    this.showUnitListBtn = this.isBooklet || featureConfig.enableSequenceNavigation !== false;
  }

  private normalizeSequence(raw: TaskSequence | null | undefined): TaskSequence {
    const units = (Array.isArray(raw?.units) ? raw.units : [])
      .filter((unit: any) => typeof unit?.id === 'string' && unit.id.trim().length > 0)
      .map((unit: any) => ({
        id: unit.id.trim(),
        occurrenceId: unit.occurrenceId,
        linkId: unit.linkId,
        alias: unit.alias,
        blockPath: unit.blockPath,
        name:
          typeof unit?.name === 'string' && unit.name.trim().length > 0
            ? unit.name
            : unit.id.trim(),
      }));

    return {
      id: raw?.id || this.sequenceId,
      name: raw?.name || raw?.id || this.sequenceId,
      units,
    };
  }
}
