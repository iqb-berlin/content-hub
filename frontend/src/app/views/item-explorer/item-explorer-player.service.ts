import { Injectable, Inject, OnDestroy } from '@angular/core';
import { VoudService } from '../../core/services/voud.service';
import { GEOGEBRA_PLAYER_RESOURCE_BASE } from '../../core/utils/geogebra-player-html.util';
import { ItemExplorerPlayerDomPort } from './item-explorer.dom-ports';
import { ReadonlyExplorerItem } from './item-explorer.models';
import {
  mergePlayerSolutionIntoDataParts,
  PlayerSolutionPrefill,
} from './item-explorer-solution-prefill';

export interface ItemExplorerPlayerStartRequest {
  item: ReadonlyExplorerItem;
  rowKey: string;
  target: string;
  printLabels: Record<string, string>;
  solution: PlayerSolutionPrefill | null;
}
export type ItemExplorerPlayerStartResult =
  | { kind: 'waiting' | 'started' }
  | { kind: 'unavailable'; reason: 'missing-target' | 'unresolved-target' };

/** Owns the frame, protocol session and all delayed player work. */
@Injectable()
export class ItemExplorerPlayerService implements OnDestroy {
  private destroyed = false;
  constructor(@Inject(VoudService) private readonly voudService: VoudService) {}

  private playerDom?: ItemExplorerPlayerDomPort;

  playerFrameRefreshPending = false;

  unit: any = null;

  playerSrcDoc: any = null;

  currentPage = 1;

  totalPages = 1;

  pagingMode:
    | 'buttons'
    | 'separate'
    | 'concat-scroll'
    | 'concat-scroll-snap'
    | 'view-all'
    | 'print-ids' = 'buttons';

  playerHeight = '100%';

  itemExplorerConditionalVisibilityEnabled = false;

  playerFocusHighlightEnabled = false;

  private focusRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private playerFrameRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  private legacyPageNavigationTimers: ReturnType<typeof setTimeout>[] = [];

  private readonly legacyPageNavigationDelaysMs = [160, 520, 1100];

  definitionContent: string | null = null;

  playerFrameReady = false;

  activePlayerSessionId: string | null = null;

  private startSessionCounter = 0;

  currentResponseData: Record<string, any> | null = null;

  hasResponseState = false;

  isFallbackState = false;

  restoreResponseDataAfterSolution = false;

  applyAssets(assets: { unit: any; srcDoc: any; definition: string | null }): void {
    if (this.destroyed) return;
    this.unit = assets.unit;
    this.playerSrcDoc = assets.unit ? assets.srcDoc : null;
    this.definitionContent = assets.unit ? assets.definition : null;
  }

  applyResponseState(data: Record<string, any> | null, isFallback = false): void {
    if (this.destroyed) return;
    this.currentResponseData = data && Object.keys(data).length ? data : null;
    this.hasResponseState = this.currentResponseData !== null;
    this.isFallbackState = this.hasResponseState && isFallback;
  }

  beginSelection(resetPages = false): void {
    if (this.destroyed) return;
    this.invalidateSession();
    this.applyResponseState(null);
    this.restoreResponseDataAfterSolution = false;
    if (resetPages) {
      this.currentPage = 1;
      this.totalPages = 1;
    }
  }

  private invalidateSession(): void {
    this.activePlayerSessionId = null;
    this.clearFocusRetryTimer();
    this.clearLegacyPageNavigationTimers();
    this.playerDom?.stopAutoResize();
  }

  registerPlayerDom(port: ItemExplorerPlayerDomPort): void {
    if (!this.destroyed) this.playerDom = port;
  }

  unregisterPlayerDom(port: ItemExplorerPlayerDomPort): void {
    if (this.playerDom !== port) return;
    this.invalidateSession();
    this.playerDom = undefined;
    this.playerFrameReady = false;
  }

  playerFrameChanged(hasFrame: boolean): void {
    if (!hasFrame) {
      this.playerFrameReady = false;
      this.invalidateSession();
    }
  }

  onPlayerLoaded(): void {
    if (!this.destroyed && this.unit && this.playerDom?.hasFrame()) this.playerFrameReady = true;
  }

  onPagingModeChange() {
    if (this.destroyed) return;
    this.invalidateSession();
    const src = this.playerSrcDoc;
    this.playerFrameReady = false;
    this.playerFrameRefreshPending = true;
    this.playerSrcDoc = null;
    if (this.playerFrameRefreshTimeout) clearTimeout(this.playerFrameRefreshTimeout);
    this.playerFrameRefreshTimeout = setTimeout(() => {
      this.playerFrameRefreshTimeout = null;
      this.playerSrcDoc = src;
      this.playerFrameRefreshPending = false;
    }, 50);
  }

  handlePlayerMessage(msg: unknown, context: { ready: boolean; solutionActive: boolean }): void {
    if (this.destroyed || !msg || typeof msg !== 'object') return;
    const playerMessage = msg as Record<string, any>;

    switch (playerMessage['type']) {
      case 'vopStateChangedNotification':
        if (!context.ready || !this.activePlayerSessionId) {
          break;
        }
        {
          const messageSessionId = String(
            playerMessage['sessionId'] || playerMessage['playerState']?.sessionId || '',
          ).trim();
          if (messageSessionId !== this.activePlayerSessionId) {
            break;
          }
        }
        if (playerMessage['playerState']?.currentPage !== undefined) {
          this.currentPage = playerMessage['playerState'].currentPage + 1;
        }
        if (playerMessage['playerState']?.validPages !== undefined) {
          this.totalPages = playerMessage['playerState'].validPages.length || this.totalPages;
        }
        // Capture response data from unitState.dataParts
        if (playerMessage['unitState']?.dataParts && !context.solutionActive) {
          this.currentResponseData = playerMessage['unitState'].dataParts;
          this.restoreResponseDataAfterSolution = false;
        }
        break;

      case 'vopPageNavigationCommand':
        if (playerMessage['target'] !== undefined) {
          this.currentPage = playerMessage['target'] + 1;
        }
        break;

      case 'vopResizeNotification':
        if (playerMessage['height'] !== undefined) {
          this.playerHeight = `${playerMessage['height']}px`;
        }
        break;
    }
  }

  private schedulePlayerFocus(request: ItemExplorerPlayerStartRequest) {
    this.clearFocusRetryTimer();

    let attempts = 0;
    const maxAttempts = 16;

    const run = () => {
      attempts += 1;
      const focused = this.tryFocusItemInPlayer(request.item, request.target);
      if (focused || attempts >= maxAttempts) {
        return;
      }
      this.focusRetryTimer = setTimeout(run, 250);
    };

    this.focusRetryTimer = setTimeout(run, 180);
  }

  tryFocusItemInPlayer(selectedItem: ReadonlyExplorerItem | null, target: string): boolean {
    if (this.destroyed || !selectedItem || !this.playerDom) return false;

    const variableRef = target;
    return this.playerDom.focus(
      this.getFocusSelectors(selectedItem, target),
      [selectedItem.itemId, variableRef, selectedItem.description],
      this.playerFocusHighlightEnabled,
    );
  }

  start(request: ItemExplorerPlayerStartRequest): ItemExplorerPlayerStartResult {
    if (this.destroyed || !this.playerFrameReady || !this.definitionContent || !this.unit) {
      return { kind: 'waiting' };
    }

    const previewTarget = request.target;
    if (!previewTarget) {
      return { kind: 'unavailable', reason: 'missing-target' };
    }
    const targetLocation = this.voudService.resolvePlayerTargetLocation(
      this.definitionContent,
      previewTarget,
    );
    if (!targetLocation) {
      return { kind: 'unavailable', reason: 'unresolved-target' };
    }
    const startPage = targetLocation.scrollPageIndex;
    const sessionId = `explorer-${request.rowKey || 'none'}-${this.startSessionCounter + 1}`;
    const usesPagedNavigation = this.pagingMode !== 'view-all' && this.pagingMode !== 'print-ids';
    const playerDefinition = this.getPlayerDefinitionContent();

    this.startSessionCounter += 1;
    this.activePlayerSessionId = sessionId;
    this.sendToPlayer({
      type: 'vopStartCommand',
      sessionId,
      unitDefinition: playerDefinition,
      unitState: {
        dataParts: this.getPlayerStartDataParts(request.solution),
      },
      playerConfig: {
        stateReportPolicy: 'none',
        pagingMode:
          this.pagingMode === 'view-all' || this.pagingMode === 'print-ids'
            ? 'concat-scroll'
            : this.pagingMode,
        printMode:
          this.pagingMode === 'view-all'
            ? 'on'
            : this.pagingMode === 'print-ids'
              ? 'on-with-ids'
              : 'off',
        logPolicy: 'disabled',
        directDownloadUrl: GEOGEBRA_PLAYER_RESOURCE_BASE,
        startPage: startPage !== undefined ? startPage.toString() : undefined,
        enabledNavigationTargets: ['next', 'previous', 'first', 'last', 'end'],
      },
    });
    this.playerDom?.setPrintLabelOverrides(
      this.pagingMode === 'print-ids' ? request.printLabels : {},
    );
    this.scheduleLegacyPageNavigation(sessionId, startPage, usesPagedNavigation);

    if (usesPagedNavigation) {
      this.playerHeight = '100%';
      this.playerDom?.stopAutoResize();
    } else {
      this.playerHeight = '2000px';
      this.playerDom?.startAutoResize((height) => {
        if (this.destroyed || this.activePlayerSessionId !== sessionId) return;
        const nextHeight = `${height}px`;
        if (this.playerHeight !== nextHeight) this.playerHeight = nextHeight;
      });
    }
    this.schedulePlayerFocus(request);
    return { kind: 'started' };
  }

  private getPlayerStartDataParts(solution: PlayerSolutionPrefill | null): Record<string, any> {
    if (solution) {
      return mergePlayerSolutionIntoDataParts(this.currentResponseData, solution.responses);
    }
    if (
      this.currentResponseData &&
      (this.hasResponseState || this.restoreResponseDataAfterSolution)
    ) {
      return this.currentResponseData;
    }
    return {};
  }

  private getPlayerDefinitionContent(): string {
    if (!this.definitionContent) return '';
    if (this.itemExplorerConditionalVisibilityEnabled) {
      return this.definitionContent;
    }
    return this.voudService.stripConditionalVisibility(this.definitionContent);
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

  getFocusSelectors(selectedItem: ReadonlyExplorerItem | null, target: string): string[] {
    if (!selectedItem) return [];

    const selectors: string[] = [];

    for (const itemId of this.getCandidateItemIds(selectedItem)) {
      const escaped = this.escapeSelectorValue(itemId);
      if (!escaped) continue;
      selectors.push(
        `[data-item-id="${escaped}"]`,
        `[data-itemid="${escaped}"]`,
        `[data-id="${escaped}"]`,
        `[id="${escaped}"]`,
      );
    }

    this.getResolvedVariableRefs(target).forEach((identifier) => {
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

  private getResolvedVariableRefs(variableRef: string): string[] {
    if (!variableRef) return [];
    if (!this.definitionContent) return [variableRef];

    return this.voudService.getFocusIdentifiers(this.definitionContent, variableRef);
  }

  private getCandidateItemIds(selectedItem: ReadonlyExplorerItem | null): string[] {
    if (!selectedItem) return [];

    const unitId = String(this.unit?.id || selectedItem.unitId || '').trim();
    const selectedItemId = String(selectedItem.itemId || '').trim();
    const resolvedItemId = this.resolveFocusItemId(selectedItem);
    const withPrefix = (value: string) => (unitId && value ? `${unitId}_${value}` : '');

    const candidates = new Set<string>();
    for (const candidate of [
      resolvedItemId,
      selectedItemId,
      withPrefix(resolvedItemId),
      withPrefix(selectedItemId),
    ]) {
      if (candidate) {
        candidates.add(candidate);
      }
    }

    if (unitId && selectedItemId.startsWith(`${unitId}_`)) {
      candidates.add(selectedItemId.slice(unitId.length + 1));
    }

    return Array.from(candidates);
  }

  private resolveFocusItemId(selectedItem: ReadonlyExplorerItem | null): string {
    if (!selectedItem) return '';

    const selectedItemId = String(selectedItem.itemId || '').trim();
    const unitItems = Array.isArray(this.unit?.items) ? this.unit.items : [];
    const unitId = String(this.unit?.id || selectedItem.unitId || '').trim();

    for (const unitItem of unitItems) {
      const unitItemId = typeof unitItem?.id === 'string' ? unitItem.id : '';
      if (!unitItemId) continue;

      const prefixedId =
        unitItem.useUnitAliasAsPrefix !== false ? `${unitId}_${unitItemId}` : unitItemId;

      if (selectedItemId === unitItemId || selectedItemId === prefixedId) {
        return unitItemId;
      }
    }

    if (unitId && selectedItemId.startsWith(`${unitId}_`)) {
      return selectedItemId.slice(unitId.length + 1);
    }

    return selectedItemId;
  }

  private escapeSelectorValue(value: string): string {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
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

  private sendToPlayer(msg: any) {
    if (!this.destroyed) this.playerDom?.postMessage(msg);
  }

  reset(): void {
    this.invalidateSession();
    if (this.playerFrameRefreshTimeout) clearTimeout(this.playerFrameRefreshTimeout);
    this.playerFrameRefreshTimeout = null;
    this.playerSrcDoc = null;
    this.unit = null;
    this.definitionContent = null;
    this.playerFrameReady = false;
    this.activePlayerSessionId = null;
    this.playerFrameRefreshPending = false;
    this.restoreResponseDataAfterSolution = false;
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();
    this.playerDom = undefined;
  }
}
