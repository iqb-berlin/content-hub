import { Component, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { ApiService } from '../../core/services/api.service';
import { VoudService } from '../../core/services/voud.service';
import { UnitViewData } from '../../core/models/api.models';
import {
  GEOGEBRA_PLAYER_RESOURCE_BASE,
  rewriteGeoGebraAssetUrls,
} from '../../core/utils/geogebra-player-html.util';
import { BreadcrumbComponent, BreadcrumbItem } from '../../shared/components/breadcrumb.component';
import { MetadataPanelComponent } from '../metadata-panel/metadata-panel.component';
import { ItemCommentThreadComponent } from '../comment-thread/item-comment-thread.component';

@Component({
  selector: 'app-item-view',
  standalone: true,
  imports: [
    RouterLink,
    BreadcrumbComponent,
    MetadataPanelComponent,
    FormsModule,
    ItemCommentThreadComponent,
  ],
  template: `
    @if (unit && item) {
      <app-breadcrumb [items]="breadcrumbs" />

      <div class="item-header">
        <h1>Item: {{ item.name || item.itemId || item.id }}</h1>
        <div class="item-actions">
          <select
            class="btn btn-outline btn-sm"
            [(ngModel)]="printMode"
            (change)="onPrintModeChange()"
          >
            <option value="off">Print: Aus</option>
            <option value="on">Print: Ein</option>
            <option value="on-with-ids">Print: Ein + IDs</option>
          </select>
          <a [routerLink]="['/view', acpId, 'item-explorer']" class="btn btn-outline btn-sm"
            >← Zum Item-Explorer</a
          >
        </div>
      </div>

      @if (showCommentBtn) {
        <app-item-comment-thread
          [acpId]="acpId"
          [targetType]="'ITEM'"
          [unitId]="item.unitId"
          [itemId]="item.itemId || item.id || itemId"
          [enabled]="showCommentBtn"
        />
      }

      <div class="item-layout">
        <div class="player-area">
          <div class="player-container card" [class.print-mode]="printMode !== 'off'">
            @if (playerSrcDoc) {
              <iframe
                #playerFrame
                [srcdoc]="playerSrcDoc"
                class="player-iframe"
                [style.height]="playerHeight"
                [class.print-mode]="printMode !== 'off'"
                sandbox="allow-scripts allow-same-origin allow-downloads"
                (load)="onPlayerLoaded()"
              >
              </iframe>
            } @else {
              <div class="empty-state">
                <div style="font-size:2.5rem;margin-bottom:12px">🎮</div>
                <h3>Kein Player verfügbar</h3>
              </div>
            }
          </div>
          <div class="item-highlight-info card" [class.focus-ok]="highlightApplied">
            <span
              class="badge"
              [class.badge-success]="highlightApplied"
              [class.badge-info]="!highlightApplied"
            >
              {{
                highlightApplied
                  ? playerFocusHighlightEnabled
                    ? '✅ Fokus aktiv'
                    : '✅ Fokus gesetzt'
                  : playerFocusHighlightEnabled
                    ? '🎯 Fokus wird gesetzt'
                    : '🎯 Fokus wird gesucht'
              }}
            </span>
            <p>
              Dieses Item befindet sich in der Aufgabe <strong>{{ unit.name }}</strong>
              @if (highlightItemId) {
                (<code>{{ highlightItemId }}</code
                >)
              }
              .
            </p>
            @if (focusWarning) {
              <p class="focus-warning">{{ focusWarning }}</p>
            }
          </div>
        </div>

        <div class="meta-area">
          <app-metadata-panel
            [unit]="unit"
            [highlightItemId]="highlightItemId"
          ></app-metadata-panel>
        </div>
      </div>
    } @else if (!loading) {
      <div class="empty-state"><h3>Item nicht gefunden</h3></div>
    }
  `,
  styles: [
    `
      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .item-header h1 {
        margin-bottom: 0;
      }
      .item-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .item-layout {
        display: grid;
        grid-template-columns: 1fr 380px;
        gap: 16px;
      }
      .player-container {
        padding: 0;
        overflow: auto;
        min-height: 600px;
      }
      .player-container.print-mode {
        display: block;
        overflow: visible;
        flex: none;
        height: auto;
        min-height: 1000px;
        border: none;
      }
      .player-iframe {
        width: 100%;
        min-height: 550px;
        border: none;
        display: block;
      }
      .player-iframe.print-mode {
        min-height: 1000px;
        height: auto;
      }
      .item-highlight-info {
        margin-top: 12px;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .item-highlight-info p {
        margin: 0;
        font-size: 0.9rem;
        color: var(--color-text-secondary);
      }
      .item-highlight-info.focus-ok {
        border-left: 4px solid var(--color-success);
        background: rgba(39, 174, 96, 0.05);
      }
      .focus-warning {
        color: #a76d00;
        font-size: 0.82rem;
      }
      @media (max-width: 900px) {
        .item-layout {
          grid-template-columns: 1fr;
        }
        .item-header {
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;
        }
      }
    `,
  ],
})
export class ItemViewComponent implements OnInit, OnDestroy {
  @ViewChild('playerFrame') playerFrame!: ElementRef<HTMLIFrameElement>;

  acpId = '';
  itemId = '';
  unit: UnitViewData | null = null;
  item: any = null;
  playerSrcDoc: any = null;
  breadcrumbs: BreadcrumbItem[] = [];
  loading = true;
  playerHeight = '100%';
  printMode: 'off' | 'on' | 'on-with-ids' = 'off';
  showCommentBtn = false;
  highlightItemId = '';
  highlightApplied = false;
  playerFocusHighlightEnabled = false;
  focusWarning = '';
  private responseStateReady = false;
  private responseStateData: Record<string, any> | null = null;
  private featureConfigReady = false;

  private definitionContent: string | null = null;
  private playerFrameReady = false;
  private unitLoadToken = 0;
  private startSessionCounter = 0;
  private focusRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private legacyPageNavigationTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly legacyPageNavigationDelaysMs = [160, 520, 1100];

  private messageHandler = this.onPlayerMessage.bind(this);
  private autoResizeInterval: any;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private sanitizer: DomSanitizer,
    private voudService: VoudService,
  ) {}

  ngOnInit() {
    this.acpId = this.route.snapshot.paramMap.get('acpId') || '';
    this.itemId = this.route.snapshot.paramMap.get('itemId') || '';

    window.addEventListener('message', this.messageHandler);

    this.api.getAcpStartPage(this.acpId).subscribe({
      next: (data) => {
        const fc = data?.featureConfig || {};
        const commentTargets = Array.isArray(fc.commentTargets) ? fc.commentTargets : [];
        this.showCommentBtn = !!(fc.enableCommenting && commentTargets.includes('ITEM'));
        this.playerFocusHighlightEnabled = fc.enablePlayerFocusHighlight === true;
        this.featureConfigReady = true;
        this.startPlayerIfReady();
      },
      error: () => {
        this.featureConfigReady = true;
        this.startPlayerIfReady();
      },
    });

    this.api.getViewItems(this.acpId).subscribe((items) => {
      this.item = items.find((i: any) => i.itemId === this.itemId || i.id === this.itemId);
      if (!this.item) {
        this.loading = false;
        return;
      }

      this.api.getViewUnit(this.acpId, this.item.unitId).subscribe((u) => {
        this.unit = u;
        this.highlightItemId = this.resolveHighlightItemId(u, this.itemId, this.item?.itemId);
        this.breadcrumbs = [
          { label: 'Content Hub', route: ['/'] },
          { label: 'ACP', route: ['/view', this.acpId] },
          { label: 'Item-Explorer', route: ['/view', this.acpId, 'item-explorer'] },
          { label: this.item.name || this.item.itemId || this.item.id },
        ];

        u.dependencies = (u.dependencies || []).map((d) => ({
          ...d,
          downloadUrl: this.api.appendAuthToken(d.downloadUrl),
        }));

        this.loading = false;
        this.currentlyLoadingUnit();
        this.loadResponseStateForItem();
        const token = ++this.unitLoadToken;
        this.loadPlayerHtml(u.dependencies || [], token);
        this.loadDefinition(u.dependencies || [], token);
      });
    });
  }

  ngOnDestroy() {
    window.removeEventListener('message', this.messageHandler);
    this.stopAutoResize();
    this.clearFocusRetryTimer();
    this.clearLegacyPageNavigationTimers();
  }

  onPlayerLoaded() {
    if (!this.unit || !this.playerFrame?.nativeElement?.contentWindow) return;
    this.playerFrameReady = true;
    this.startPlayerIfReady();
  }

  onPrintModeChange() {
    const src = this.playerSrcDoc;
    if (!src) return;
    this.playerFrameReady = false;
    this.playerSrcDoc = null;
    this.highlightApplied = false;
    this.focusWarning = '';
    this.clearFocusRetryTimer();
    this.clearLegacyPageNavigationTimers();
    setTimeout(() => {
      this.playerSrcDoc = src;
    }, 50);
  }

  private onPlayerMessage(event: MessageEvent) {
    const frameWindow = this.playerFrame?.nativeElement?.contentWindow;
    if (frameWindow && event.source !== frameWindow) return;

    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'vopResizeNotification':
        if (msg.height !== undefined) {
          this.playerHeight = `${msg.height}px`;
        }
        break;
    }
  }

  private sendToPlayer(msg: any) {
    this.playerFrame?.nativeElement?.contentWindow?.postMessage(msg, '*');
  }

  private currentlyLoadingUnit() {
    this.playerFrameReady = false;
    this.definitionContent = null;
    this.highlightApplied = false;
    this.focusWarning = '';
    this.responseStateReady = false;
    this.responseStateData = null;
    this.playerHeight = '100%';
    this.clearFocusRetryTimer();
    this.clearLegacyPageNavigationTimers();
  }

  private loadPlayerHtml(dependencies: any[], token: number) {
    const playerDep = dependencies.find(
      (d: any) => String(d?.type || '').toLowerCase() === 'player',
    );
    if (!playerDep?.downloadUrl) {
      this.playerSrcDoc = null;
      return;
    }

    fetch(playerDep.downloadUrl)
      .then((res) => res.text())
      .then((html) => {
        if (token !== this.unitLoadToken) return;
        this.playerSrcDoc = this.sanitizer.bypassSecurityTrustHtml(rewriteGeoGebraAssetUrls(html));
      })
      .catch(() => {
        if (token !== this.unitLoadToken) return;
        this.playerSrcDoc = null;
      });
  }

  private loadDefinition(dependencies: any[], token: number) {
    const definitionDep = dependencies.find((d: any) => {
      const type = String(d?.type || '').toLowerCase();
      return type === 'unit_definition' || type === 'unitdefinition' || type === 'definition';
    });

    if (!definitionDep?.downloadUrl) {
      this.definitionContent = null;
      return;
    }

    fetch(definitionDep.downloadUrl)
      .then((res) => res.text())
      .then((definition) => {
        if (token !== this.unitLoadToken) return;
        this.definitionContent = definition;
        this.startPlayerIfReady();
      })
      .catch(() => {
        if (token !== this.unitLoadToken) return;
        this.definitionContent = null;
      });
  }

  private startPlayerIfReady() {
    if (
      !this.featureConfigReady ||
      !this.playerFrameReady ||
      !this.definitionContent ||
      !this.unit ||
      !this.item ||
      !this.responseStateReady
    )
      return;

    const variableRef = this.item.sourceVariable || this.item.variableId || '';
    const startPage = variableRef
      ? this.voudService.resolvePlayerTargetLocation(this.definitionContent, variableRef)
          ?.scrollPageIndex
      : undefined;
    const sessionId = `review-item-${this.itemId}-${this.startSessionCounter + 1}`;

    this.startSessionCounter += 1;
    this.sendToPlayer({
      type: 'vopStartCommand',
      sessionId,
      unitDefinition: this.definitionContent,
      unitState: {
        dataParts:
          this.responseStateData && Object.keys(this.responseStateData).length > 0
            ? this.responseStateData
            : {},
      },
      playerConfig: {
        stateReportPolicy: 'none',
        pagingMode: this.printMode !== 'off' ? 'concat-scroll' : 'buttons',
        printMode: this.printMode,
        logPolicy: 'disabled',
        directDownloadUrl: GEOGEBRA_PLAYER_RESOURCE_BASE,
        startPage: startPage !== undefined ? startPage.toString() : undefined,
        enabledNavigationTargets: ['next', 'previous', 'first', 'last', 'end'],
      },
    });
    this.scheduleLegacyPageNavigation(sessionId, startPage, this.printMode === 'off');

    if (this.printMode === 'off') {
      this.playerHeight = '100%';
      this.stopAutoResize();
    } else {
      this.playerHeight = '2000px';
      this.startAutoResize();
    }

    this.schedulePlayerFocus();
  }

  private scheduleLegacyPageNavigation(
    sessionId: string,
    startPage: number | undefined,
    enabled: boolean,
  ) {
    this.clearLegacyPageNavigationTimers();
    if (!enabled || startPage === undefined) return;

    const target = startPage.toString();
    this.legacyPageNavigationDelaysMs.forEach((delayMs) => {
      const timer = setTimeout(() => {
        this.sendToPlayer({
          type: 'vopPageNavigationCommand',
          sessionId,
          target,
        });
      }, delayMs);
      this.legacyPageNavigationTimers.push(timer);
    });
  }

  private schedulePlayerFocus() {
    this.highlightApplied = false;
    this.focusWarning = '';
    this.clearFocusRetryTimer();

    let attempts = 0;
    const maxAttempts = 16;

    const run = () => {
      attempts += 1;
      const focused = this.tryFocusItemInPlayer();
      if (focused || attempts >= maxAttempts) {
        if (!focused) {
          this.focusWarning =
            'Automatischer Fokus im Player war nicht eindeutig möglich, Metadaten-Highlight bleibt aktiv.';
        }
        return;
      }
      this.focusRetryTimer = setTimeout(run, 250);
    };

    this.focusRetryTimer = setTimeout(run, 180);
  }

  private tryFocusItemInPlayer(): boolean {
    const frame = this.playerFrame?.nativeElement;
    const doc = frame?.contentDocument || frame?.contentWindow?.document;
    if (!doc || !doc.body) return false;

    for (const selector of this.getFocusSelectors()) {
      const target = doc.querySelector(selector) as HTMLElement | null;
      if (target) {
        this.applyFocus(doc, target);
        return true;
      }
    }

    const textTarget = this.findElementByText(doc, [
      this.item?.name,
      this.highlightItemId,
      this.item?.sourceVariable,
      this.item?.variableId,
    ]);
    if (textTarget) {
      this.applyFocus(doc, textTarget);
      return true;
    }

    return false;
  }

  private getFocusSelectors(): string[] {
    const selectors: string[] = [];

    const itemId = this.escapeSelectorValue(this.highlightItemId);
    if (itemId) {
      selectors.push(
        `[data-item-id="${itemId}"]`,
        `[data-itemid="${itemId}"]`,
        `[data-id="${itemId}"]`,
        `[id="${itemId}"]`,
      );
    }

    this.getResolvedVariableRefs().forEach((identifier) => {
      const variableRef = this.escapeSelectorValue(identifier);
      if (!variableRef) return;
      selectors.push(
        `[data-element-id="${variableRef}"]`,
        `[data-element-alias="${variableRef}"]`,
        `[data-list-alias="${variableRef}"]`,
        `[data-variable-id="${variableRef}"]`,
        `[data-variable="${variableRef}"]`,
        `[data-alias="${variableRef}"]`,
        `[data-ref="${variableRef}"]`,
        `[data-source-variable="${variableRef}"]`,
        `[name="${variableRef}"]`,
        `[id="${variableRef}"]`,
      );
    });

    return Array.from(new Set(selectors));
  }

  private getResolvedVariableRefs(): string[] {
    const variableRef = String(this.item?.sourceVariable || this.item?.variableId || '').trim();
    if (!variableRef) return [];
    if (!this.definitionContent) return [variableRef];

    return this.voudService.getFocusIdentifiers(this.definitionContent, variableRef);
  }

  private findElementByText(
    doc: Document,
    candidates: Array<string | undefined>,
  ): HTMLElement | null {
    const needles = candidates
      .map((v) => (v || '').trim().toLowerCase())
      .filter((v) => v.length > 1);

    if (!needles.length) return null;

    const nodes = Array.from(doc.querySelectorAll<HTMLElement>('label, span, div, p, li, button'));
    const maxScan = Math.min(nodes.length, 3000);

    for (let i = 0; i < maxScan; i++) {
      const node = nodes[i];
      const text = (node.textContent || '').trim().toLowerCase();
      if (!text) continue;
      if (needles.some((n) => text === n || text.includes(n))) {
        return node;
      }
    }

    return null;
  }

  private applyFocus(doc: Document, target: HTMLElement) {
    doc
      .querySelectorAll('.cp-item-focus-highlight')
      .forEach((el) => el.classList.remove('cp-item-focus-highlight'));
    if (this.playerFocusHighlightEnabled) {
      this.ensureFocusStyle(doc);
      target.classList.add('cp-item-focus-highlight');
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    try {
      target.focus({ preventScroll: true });
    } catch {
      // ignore focus errors for non-focusable elements
    }

    this.highlightApplied = true;
    this.focusWarning = '';
  }

  private ensureFocusStyle(doc: Document) {
    if (doc.getElementById('cp-item-focus-style')) return;

    const style = doc.createElement('style');
    style.id = 'cp-item-focus-style';
    style.textContent = `
      .cp-item-focus-highlight {
        outline: 3px solid #e67e22 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(230, 126, 34, 0.25) !important;
        border-radius: 4px !important;
        transition: box-shadow 0.2s ease;
      }
    `;
    doc.head?.appendChild(style);
  }

  private escapeSelectorValue(value: string): string {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  private resolveHighlightItemId(
    unit: UnitViewData,
    routeItemId: string,
    listedItemId?: string,
  ): string {
    const candidates = [routeItemId, listedItemId].filter((v): v is string => !!v && v.length > 0);

    for (const unitItem of unit.items || []) {
      const unitItemId = typeof unitItem?.id === 'string' ? unitItem.id : '';
      if (!unitItemId) continue;

      const withPrefix =
        unitItem.useUnitAliasAsPrefix !== false ? `${unit.id}_${unitItemId}` : unitItemId;

      if (candidates.includes(unitItemId) || candidates.includes(withPrefix)) {
        return unitItemId;
      }
    }

    const prefix = `${unit.id}_`;
    if (routeItemId.startsWith(prefix)) {
      return routeItemId.slice(prefix.length);
    }

    return routeItemId;
  }

  private loadResponseStateForItem() {
    if (!this.unit || !this.item) {
      this.responseStateReady = true;
      this.responseStateData = null;
      this.startPlayerIfReady();
      return;
    }

    const unitId = String(this.item.unitId || this.unit.id || '').trim();
    const currentItemId = String(this.highlightItemId || '').trim();
    if (!unitId || !currentItemId) {
      this.responseStateReady = true;
      this.responseStateData = null;
      this.startPlayerIfReady();
      return;
    }

    const fallbackItemList = this.buildStateFallbackItemList(this.unit, currentItemId);

    this.api
      .getResponseStateWithFallback(this.acpId, currentItemId, unitId, fallbackItemList)
      .subscribe({
        next: (result) => {
          const data = result?.state?.responseData;
          if (data && typeof data === 'object' && Object.keys(data).length > 0) {
            this.responseStateData = data;
          } else {
            this.responseStateData = null;
          }
          this.responseStateReady = true;
          this.startPlayerIfReady();
        },
        error: () => {
          this.responseStateData = null;
          this.responseStateReady = true;
          this.startPlayerIfReady();
        },
      });
  }

  private buildStateFallbackItemList(
    unit: UnitViewData,
    currentItemId: string,
  ): { itemId: string; unitId: string }[] {
    const unitId = String(unit.id || '').trim();
    const result = (unit.items || [])
      .map((unitItem: any) => {
        const itemId = String(unitItem?.id || '').trim();
        if (!itemId || !unitId) {
          return null;
        }
        return { itemId, unitId };
      })
      .filter((entry): entry is { itemId: string; unitId: string } => Boolean(entry));

    if (!result.length && unitId && currentItemId) {
      return [{ itemId: currentItemId, unitId }];
    }

    return result;
  }

  private clearFocusRetryTimer() {
    if (this.focusRetryTimer) {
      clearTimeout(this.focusRetryTimer);
      this.focusRetryTimer = null;
    }
  }

  private clearLegacyPageNavigationTimers() {
    this.legacyPageNavigationTimers.forEach((timer) => clearTimeout(timer));
    this.legacyPageNavigationTimers = [];
  }

  private startAutoResize() {
    this.stopAutoResize();
    this.autoResizeInterval = setInterval(() => {
      try {
        const frame = this.playerFrame?.nativeElement;
        const doc = frame?.contentDocument || frame?.contentWindow?.document;
        if (doc && doc.body) {
          const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 600);
          if (height > 0 && this.playerHeight !== `${height}px`) {
            this.playerHeight = `${height}px`;
          }
        }
      } catch (_e) {
        // Fallback for cross-origin or other errors
      }
    }, 500);
  }

  private stopAutoResize() {
    if (this.autoResizeInterval) {
      clearInterval(this.autoResizeInterval);
      this.autoResizeInterval = null;
    }
  }
}
