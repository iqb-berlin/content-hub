import { sequenceLabel } from '../../shared/sequence-label';
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { BreadcrumbComponent, BreadcrumbItem } from '../../shared/components/breadcrumb.component';
import { BookletSelectionComponent } from '../../shared/components/booklet-selection.component';

@Component({
  selector: 'app-acp-start',
  standalone: true,
  imports: [RouterLink, BreadcrumbComponent, BookletSelectionComponent],
  template: `
    @if (data) {
      <app-breadcrumb [items]="breadcrumbs" />

      <div class="acp-header">
        <div class="acp-header-main">
          <h1>{{ data.name }}</h1>
          @if (canManageAcp) {
            <a [routerLink]="['/manage', acpId]" class="btn btn-outline btn-sm"
              >← Zur ACP-Übersicht</a
            >
          }
        </div>
        @if (data.description) {
          <p class="desc">{{ data.description }}</p>
        }
      </div>

      <div class="sections-grid">
        <!-- Item Explorer — availability and start-page visibility are configured separately -->
        @if (capabilityAccess?.canViewExplorer && fc.showItemExplorerOnStartPage !== false) {
          <a [routerLink]="['/view', acpId, 'item-explorer']" class="card section-card">
            <div class="section-icon">🔭</div>
            <h3>Item-Explorer</h3>
            <p>Items durchsuchen, prüfen und kommentieren</p>
          </a>
        }

        <!-- Preserve the legacy navigation flag as fallback for existing ACPs. -->
        @if (
          data.units?.length &&
          (fc.showUnitListOnStartPage ?? fc.enableUnitListNavigation) !== false
        ) {
          <a [routerLink]="['/view', acpId, 'units']" class="card section-card">
            <div class="section-icon">📝</div>
            <h3>Aufgaben ansehen</h3>
            <p>
              Vollständige Aufgaben öffnen · {{ data.units.length }}
              {{ data.units.length === 1 ? 'Aufgabe' : 'Aufgaben' }}
            </p>
          </a>
        }

        <!-- Sequence availability and start-page visibility are configured separately. -->
        @if (
          visibleSequences.length &&
          fc.enableSequenceNavigation !== false &&
          fc.showSequencesOnStartPage !== false
        ) {
          <div class="card section-card sequences-card">
            <div class="section-icon">📋</div>
            <h3>Testhefte und Aufgabenfolgen</h3>
            <div class="seq-list">
              @for (seq of visibleSequences; track seq.kind + ':' + seq.id) {
                <a
                  [queryParams]="seq.kind === 'booklet' ? { kind: 'booklet' } : {}"
                  [routerLink]="['/view', acpId, 'sequence', seq.id]"
                  class="seq-link"
                >
                  {{ sequenceLabel(seq) }}
                </a>
              }
            </div>
          </div>
        }

        <!-- Downloads — only if any download flag is enabled -->
        @if (fc.allowIndexDownload || fc.allowUnitDownload || fc.allowFileDownload) {
          <div class="card section-card">
            <div class="section-icon">⬇️</div>
            <h3>Downloads</h3>
            <div class="download-links">
              @if (fc.allowIndexDownload) {
                <button class="btn btn-outline btn-sm" (click)="downloadIndex()">
                  ACP-Index (JSON)
                </button>
              }
              @if (fc.allowUnitDownload) {
                <span class="download-info">Aufgaben-Download verfügbar in Aufgabenansicht</span>
              }
            </div>
          </div>
        }

        @if (capabilityAccess?.canReview) {
          <section class="card section-card review-card" aria-labelledby="review-heading">
            <div class="section-icon">💬</div>
            <h3 id="review-heading">Review</h3>
            @if (capabilityAccess?.canManageReview) {
              <a class="btn btn-outline btn-sm" [routerLink]="['/view', acpId, 'review', 'manage']"
                >Review verwalten</a
              >
            }
            <p>Testheft auswählen und direkt im Review-Arbeitsplatz öffnen.</p>
            <app-booklet-selection
              [acpId]="acpId"
              [booklets]="reviewBooklets"
              actionLabel="Review öffnen"
            />
          </section>
        }
      </div>
      @if (fc.showIndexOnStartPage !== false) {
        <a class="index-link" [routerLink]="['/view', acpId, 'index']"
          >Paketstruktur (ACP-Index) ansehen</a
        >
      }
    } @else {
      <div class="empty-state">
        <h3>Lade ACP-Daten...</h3>
      </div>
    }
  `,
  styles: [
    `
      .acp-header {
        margin-bottom: 32px;
      }
      .acp-header-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .acp-header h1 {
        font-size: 2rem;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .desc {
        color: var(--color-text-secondary);
        font-size: 1.05rem;
        line-height: 1.6;
      }

      .index-link {
        display: inline-block;
        margin-top: 20px;
      }
      .sections-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
        gap: 20px;
      }

      .section-card {
        display: flex;
        flex-direction: column;
        text-decoration: none;
        color: inherit;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
        border: 1px solid var(--color-border);
      }
      a.section-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        text-decoration: none;
      }
      .section-icon {
        font-size: 2rem;
        margin-bottom: 12px;
      }
      .section-card h3 {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 6px;
      }
      .section-card p {
        color: var(--color-text-secondary);
        font-size: 0.9rem;
        line-height: 1.5;
      }
      .review-card {
        grid-column: 1 / -1;
      }

      .seq-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 8px;
      }
      .seq-link {
        display: block;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 0.9rem;
        color: var(--color-primary-light);
        transition: background 0.15s;
      }
      .seq-link:hover {
        background: rgba(41, 128, 185, 0.06);
        text-decoration: none;
      }

      .download-links {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
      }
      .download-info {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class AcpStartComponent implements OnInit, OnDestroy {
  acpId = '';
  data: any = null;
  fc: any = {}; // feature config
  breadcrumbs: BreadcrumbItem[] = [];
  canManageAcp = false;
  private readonly destroy$ = new Subject<void>();

  constructor(
    @Inject(Router) private router: Router,
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ApiService) private api: ApiService,
    @Inject(AuthService) private auth: AuthService,
  ) {}

  capabilityAccess: any;
  ngOnInit() {
    this.acpId = this.route.snapshot.paramMap.get('acpId') || '';
    this.api
      .getCapabilities(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((a) => (this.capabilityAccess = a));
    this.updateManagerState();
    this.auth.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.updateManagerState();
    });

    this.api
      .getAcpStartPage(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((d) => {
        this.data = d;
        this.fc = d?.featureConfig || {};
        this.updateBreadcrumbs();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  downloadIndex() {
    window.open(this.api.getViewIndexExportUrl(this.acpId), '_blank');
  }

  sequenceLabel = sequenceLabel;

  get reviewBooklets(): any[] {
    return (this.data?.sequences || []).filter((sequence: any) => sequence.kind === 'booklet');
  }

  get visibleSequences(): any[] {
    const sequences = this.data?.sequences || [];
    return this.capabilityAccess?.canReview
      ? sequences.filter((sequence: any) => sequence.kind !== 'booklet')
      : sequences;
  }

  private updateManagerState(): void {
    this.canManageAcp = this.auth.hasAcpRole(this.acpId, 'ACP_MANAGER');
    if (this.canManageAcp) {
      void this.router.navigate(['/manage', this.acpId], { replaceUrl: true });
    }
    this.updateBreadcrumbs();
  }

  private updateBreadcrumbs(): void {
    if (!this.data) return;
    const managerCrumb: BreadcrumbItem[] = this.canManageAcp
      ? [{ label: 'Verwaltung', route: ['/manage', this.acpId] }]
      : [];
    this.breadcrumbs = [
      { label: 'Content Hub', route: ['/'] },
      ...managerCrumb,
      { label: this.data?.name || 'ACP' },
    ];
  }
}
