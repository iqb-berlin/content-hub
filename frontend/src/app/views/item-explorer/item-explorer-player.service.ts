import { Injectable, Inject, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { readPreviewDefinition } from '../../core/services/preview-visibility';
import { collectVoudNodes, findVoudIdentifierMatches } from '../../core/services/voud-nodes';
import {
  preparePreviewPresentation,
  previewDefinitionKey,
  readPreviewContext,
  PreviewContext,
} from '../../core/services/preview-presentation';
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
  | { kind: 'unavailable'; reason: 'missing-target' | 'unresolved-target' }
  | { kind: 'unavailable'; reason: 'unresolved-visibility'; message: string };

interface PreviewResponseSession {
  id: string | null;
  origin: 'answers' | 'visibility' | 'solution';
  initialDataParts: Record<string, any>;
  dataParts: Record<string, any> | null;
  reportedAt: number;
}

interface PresentationSession {
  request: ItemExplorerPlayerStartRequest;
  queue: number[];
  triggers: string[];
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  preparedPage: number;
  presenting: boolean;
}

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

  previewMode: 'reference' | 'answers' | 'flow' = 'reference';
  presentationMessage = '';
  private presentation: PresentationSession | null = null;

  get preparingPresentation(): boolean {
    return this.presentation !== null;
  }

  private workingAnswerData: Record<string, any> | null = null;
  private flowStarted = false;
  private pendingFlowPage: number | null = null;

  private focusRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private playerFrameRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  private legacyPageNavigationTimers: ReturnType<typeof setTimeout>[] = [];

  private readonly legacyPageNavigationDelaysMs = [160, 520, 1100];

  definitionContent: string | null = null;

  playerFrameReady = false;

  readonly sessionChanges$ = new Subject<void>();

  private responseSession: PreviewResponseSession = {
    id: null,
    origin: 'answers',
    initialDataParts: {},
    dataParts: null,
    reportedAt: 0,
  };

  get activePlayerSessionId(): string | null {
    return this.responseSession.id;
  }

  get responseSessionToken(): object {
    return this.responseSession;
  }

  get syntheticPreviewState(): boolean {
    return this.responseSession.origin === 'visibility';
  }

  get isAnswerSession(): boolean {
    return this.responseSession.origin === 'answers';
  }

  private startSessionCounter = 0;

  get currentResponseData(): Record<string, any> | null {
    return this.responseSession.dataParts;
  }

  get hasCurrentResponseState(): boolean {
    const changedAt = this.playerDom?.getLastInteractionTime?.() || 0;
    return (
      !!this.currentResponseData && (!changedAt || this.responseSession.reportedAt > changedAt)
    );
  }

  private savedResponseData: Record<string, any> | null = null;

  hasResponseState = false;

  isFallbackState = false;

  private responseBeforeSolution: {
    origin: 'answers' | 'visibility';
    page: number;
    dataParts: Record<string, any> | null;
  } | null = null;

  private previewDefinitionSource: string | null | undefined;
  private previewDefinitionCache: ReturnType<typeof readPreviewDefinition> = null;

  get previewDefinition() {
    if (this.previewDefinitionSource !== this.definitionContent) {
      this.previewDefinitionSource = this.definitionContent;
      this.previewDefinitionCache = readPreviewDefinition(this.definitionContent || '');
    }
    return this.previewDefinitionCache;
  }

  resolveTargetLocation(target: string) {
    return this.definitionContent
      ? this.voudService.resolvePlayerTargetLocation(this.definitionContent, target)
      : undefined;
  }

  captureAnswersForSolution(): void {
    if (this.responseSession.origin === 'solution') return;
    // Preserve edits in prepared contexts too, without making that context saveable.
    // A restarted frame may not have reported yet; retain its initial snapshot.
    this.responseBeforeSolution = {
      origin: this.responseSession.origin,
      page: this.currentPage - 1,
      dataParts:
        this.currentResponseData ||
        this.responseBeforeSolution?.dataParts ||
        (this.syntheticPreviewState ||
        this.previewMode === 'flow' ||
        Object.keys(this.responseSession.initialDataParts).length
          ? this.responseSession.initialDataParts
          : this.savedResponseData),
    };
  }

  applyAssets(assets: { unit: any; srcDoc: any; definition: string | null }): void {
    if (this.destroyed) return;
    this.unit = assets.unit;
    this.playerSrcDoc = assets.unit ? assets.srcDoc : null;
    this.definitionContent = assets.unit ? assets.definition : null;
  }

  applyResponseState(data: Record<string, any> | null, isFallback = false): void {
    if (this.destroyed) return;
    this.savedResponseData = data && Object.keys(data).length ? data : null;
    this.workingAnswerData = null;
    this.responseBeforeSolution = null;
    this.responseSession.dataParts = null;
    this.responseSession.initialDataParts = {};
    this.hasResponseState = this.savedResponseData !== null;
    this.isFallbackState = this.hasResponseState && isFallback;
  }

  markResponseStateSaved(data: Record<string, any>): void {
    this.savedResponseData = data;
    this.hasResponseState = true;
    this.isFallbackState = false;
  }

  clearResponseState(): void {
    this.flowStarted = false;
    this.pendingFlowPage = null;
    this.workingAnswerData = null;
    this.savedResponseData = null;
    this.hasResponseState = false;
    this.isFallbackState = false;
    this.responseSession.dataParts = null;
    this.responseSession.initialDataParts = {};
    this.responseBeforeSolution = null;
  }

  beginSelection(resetPages = false): void {
    if (this.destroyed) return;
    this.invalidateSession();
    this.clearResponseState();
    this.previewMode = 'reference';
    this.presentationMessage = '';
    this.workingAnswerData = null;
    if (resetPages) {
      this.currentPage = 1;
      this.totalPages = 1;
    }
  }

  private invalidateSession(): void {
    const session = this.responseSession;
    this.beginResponseSession(null, session.origin, session.dataParts || session.initialDataParts);
    this.clearFocusRetryTimer();
    this.clearLegacyPageNavigationTimers();
    this.clearPresentation();
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
          const page = Number(playerMessage['playerState'].currentPage);
          if (
            Number.isInteger(page) &&
            page >= 0 &&
            (this.pendingFlowPage === null || page === this.pendingFlowPage)
          ) {
            this.currentPage = page + 1;
            this.pendingFlowPage = null;
          }
        }
        if (playerMessage['playerState']?.validPages !== undefined) {
          this.totalPages = playerMessage['playerState'].validPages.length || this.totalPages;
        }
        // Capture response data from unitState.dataParts
        if (
          playerMessage['unitState']?.dataParts &&
          this.responseSession.origin !== 'solution' &&
          !context.solutionActive
        ) {
          this.responseSession.dataParts = {
            ...this.responseSession.initialDataParts,
            ...this.responseSession.dataParts,
            ...playerMessage['unitState'].dataParts,
          };
          // Receipt time cannot prove freshness: an older snapshot may already be queued.
          const reportedAt = Number(playerMessage['timeStamp']);
          this.responseSession.reportedAt = Number.isFinite(reportedAt) ? reportedAt : 0;
          this.responseBeforeSolution = null;
        }
        this.advancePresentation();
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
      const visible =
        !this.itemExplorerConditionalVisibilityEnabled ||
        !this.playerDom?.isTargetVisible ||
        this.playerDom.isTargetVisible(this.getFocusSelectors(null, request.target));
      const focused = visible && this.tryFocusItemInPlayer(request.item, request.target);
      if (focused || attempts >= maxAttempts) {
        if (
          !visible &&
          this.itemExplorerConditionalVisibilityEnabled &&
          this.previewMode === 'reference'
        ) {
          this.presentationMessage =
            'Das Item ist im aktuellen Ablauf noch nicht sichtbar. Bitte den regulären Aufgabenablauf verwenden und einen Vorschaukontext übernehmen.';
        }
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
    const regularFlow =
      this.itemExplorerConditionalVisibilityEnabled && this.previewMode === 'flow';
    if (!previewTarget && !regularFlow) {
      return { kind: 'unavailable', reason: 'missing-target' };
    }
    const targetLocation = regularFlow
      ? { scrollPageIndex: 0 }
      : this.resolveTargetLocation(previewTarget);
    if (!targetLocation) {
      return { kind: 'unavailable', reason: 'unresolved-target' };
    }
    let startPage = targetLocation.scrollPageIndex;
    let origin: PreviewResponseSession['origin'] = this.responseBeforeSolution?.origin || 'answers';
    let dataParts = this.getPlayerStartDataParts();
    this.clearFocusRetryTimer();
    this.clearLegacyPageNavigationTimers();
    this.clearPresentation();
    this.presentationMessage = '';
    let navigation: number[] | undefined;
    let triggerIds: string[] = [];
    if (this.itemExplorerConditionalVisibilityEnabled && this.previewMode === 'reference') {
      const resolved = preparePreviewPresentation(
        this.definitionContent,
        previewTarget,
        request.item.previewStart,
      );
      if (resolved.kind === 'unavailable') {
        this.invalidateSession();
        return { kind: 'unavailable', reason: 'unresolved-visibility', message: resolved.reason };
      }
      startPage = resolved.page;
      origin = 'visibility';
      const print = this.pagingMode === 'view-all' || this.pagingMode === 'print-ids';
      dataParts = print ? resolved.printDataParts || resolved.dataParts : resolved.dataParts;
      navigation = print ? undefined : resolved.navigate;
      triggerIds = resolved.triggerIds || [];
      this.presentationMessage = resolved.message;
      if (this.responseBeforeSolution?.origin === 'visibility') {
        // Restore the full prepared snapshot, including edits and persistent stimuli.
        // Replaying triggers again could change that already reached context.
        dataParts = this.responseBeforeSolution.dataParts || dataParts;
        startPage = this.responseBeforeSolution.page;
        navigation = undefined;
        triggerIds = [];
      }
    } else if (regularFlow) {
      startPage = this.flowStarted ? this.currentPage - 1 : 0;
      if (!this.flowStarted) dataParts = {};
      this.presentationMessage =
        'Regulärer Aufgabenablauf. Eine erreichte Itemansicht kann als Referenzkontext übernommen werden.';
    }
    if (request.solution) {
      dataParts = mergePlayerSolutionIntoDataParts(
        dataParts,
        request.solution.responses,
        request.solution.status === 'available' ? request.solution.dropLists : undefined,
      );
      origin = 'solution';
    }
    const sessionId = `explorer-${request.rowKey || 'none'}-${this.startSessionCounter + 1}`;
    const usesPagedNavigation = this.pagingMode !== 'view-all' && this.pagingMode !== 'print-ids';
    const playerDefinition = this.getPlayerDefinitionContent();

    this.startSessionCounter += 1;
    this.beginResponseSession(sessionId, origin, dataParts);
    if (regularFlow) this.flowStarted = true;
    // Aspect may initially report page 0 before accepting the restored page.
    // Keep that transient notification from resetting a quick solution toggle.
    this.pendingFlowPage =
      regularFlow && startPage !== undefined && startPage > 0 ? startPage : null;
    this.currentPage = (startPage ?? 0) + 1;
    if (navigation && (navigation.length || triggerIds.length)) {
      this.presentation = {
        request,
        queue: navigation,
        triggers: triggerIds,
        controller: new AbortController(),
        timer: null,
        attempts: 0,
        preparedPage: -1,
        presenting: false,
      };
    }
    this.sendToPlayer({
      type: 'vopStartCommand',
      sessionId,
      unitDefinition: playerDefinition,
      unitState: {
        dataParts,
      },
      playerConfig: {
        stateReportPolicy: 'eager',
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
    if (navigation === undefined)
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
    if (!this.preparingPresentation && !regularFlow) this.schedulePlayerFocus(request);
    return { kind: 'started' };
  }

  changePreviewMode(mode: 'reference' | 'answers' | 'flow'): void {
    // A solution keeps the real answers separately; a restored answer session
    // may only have its initial snapshot until the next player notification.
    const answers = this.isAnswerSession
      ? this.currentResponseData ||
        (Object.keys(this.responseSession.initialDataParts).length
          ? this.responseSession.initialDataParts
          : null)
      : null;
    const answerSnapshot =
      this.responseBeforeSolution?.origin === 'answers'
        ? this.responseBeforeSolution.dataParts || answers
        : answers;
    if (answerSnapshot) this.workingAnswerData = answerSnapshot;
    this.invalidateSession();
    this.responseBeforeSolution = null;
    if (mode !== this.previewMode) this.flowStarted = false;
    this.pendingFlowPage = null;
    this.previewMode = mode;
  }

  capturePreviewContext(request: {
    item: ReadonlyExplorerItem;
    target: string;
  }): PreviewContext | null {
    if (
      !this.definitionContent ||
      !this.activePlayerSessionId ||
      this.preparingPresentation ||
      !this.hasCurrentResponseState ||
      !request.target ||
      !this.playerDom?.isTargetVisible?.(this.getFocusSelectors(null, request.target))
    )
      return null;
    const location = this.resolveTargetLocation(request.target);
    if (
      !location ||
      (location.scrollPageIndex !== undefined && location.scrollPageIndex !== this.currentPage - 1)
    )
      return null;
    const dataParts = Object.fromEntries(
      ['stateVariableCodes', 'elementCodes', 'geometryVariableCodes']
        .filter((key) => typeof this.currentResponseData?.[key] === 'string')
        .map((key) => [key, this.currentResponseData![key]]),
    );
    return readPreviewContext({
      definitionKey: previewDefinitionKey(this.definitionContent),
      target: request.target,
      page: this.currentPage - 1,
      dataParts,
    });
  }

  private clearPresentation(): void {
    const preparation = this.presentation;
    this.presentation = null;
    if (!preparation) return;
    preparation.controller.abort();
    if (preparation.timer) clearTimeout(preparation.timer);
  }

  private advancePresentation(): void {
    const preparation = this.presentation;
    if (!preparation || !this.activePlayerSessionId || preparation.presenting) return;
    if (
      preparation.triggers.length &&
      this.playerDom?.preparePage &&
      preparation.preparedPage !== this.currentPage - 1
    ) {
      if (preparation.timer) clearTimeout(preparation.timer);
      preparation.timer = null;
      preparation.preparedPage = this.currentPage - 1;
      preparation.presenting = true;
      void this.playerDom
        .preparePage(preparation.triggers, preparation.controller.signal)
        .catch(() => {
          if (this.presentation === preparation) {
            this.clearPresentation();
            this.presentationMessage = 'Der Vorschaukontext benötigt den regulären Aufgabenablauf.';
          }
        })
        .finally(() => {
          if (this.presentation !== preparation) return;
          preparation.presenting = false;
          this.advancePresentation();
        });
      return;
    }
    if (preparation.queue[0] === this.currentPage - 1) {
      preparation.queue.shift();
      preparation.attempts = 0;
      if (preparation.timer) clearTimeout(preparation.timer);
      preparation.timer = null;
    }
    if (preparation.timer) return;
    preparation.timer = setTimeout(
      () => {
        if (this.presentation !== preparation) return;
        preparation.timer = null;
        const page = preparation.queue[0];
        if (page === undefined || preparation.attempts >= 4) {
          this.clearPresentation();
          if (page !== undefined)
            this.presentationMessage =
              'Die Referenzansicht konnte nicht vollständig vorbereitet werden. Bitte den regulären Aufgabenablauf verwenden und einen Vorschaukontext übernehmen.';
          else this.schedulePlayerFocus(preparation.request);
          return;
        }
        preparation.attempts++;
        this.sendToPlayer({
          type: 'vopPageNavigationCommand',
          sessionId: this.activePlayerSessionId,
          target: String(page),
        });
        this.advancePresentation();
      },
      preparation.attempts ? 500 : 180,
    );
  }

  private beginResponseSession(
    id: string | null,
    origin: PreviewResponseSession['origin'],
    initialDataParts: Record<string, any> = {},
  ): void {
    this.responseSession = { id, origin, initialDataParts, dataParts: null, reportedAt: 0 };
    this.sessionChanges$.next();
  }

  private getPlayerStartDataParts(): Record<string, any> {
    const answers = this.isAnswerSession
      ? this.currentResponseData || this.responseSession.initialDataParts
      : null;
    if (this.responseBeforeSolution?.dataParts) return this.responseBeforeSolution.dataParts;
    // A live session (including its snapshot during frame recreation) is newer than
    // the answer cache retained across view changes. Flow never falls back to saved answers.
    if (answers && (this.previewMode === 'flow' || Object.keys(answers).length)) return answers;
    if (this.previewMode === 'flow') return {};
    if (this.previewMode === 'answers' && this.workingAnswerData) return this.workingAnswerData;
    if (!this.hasResponseState) return {};
    return this.savedResponseData || {};
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
    if (!selectedItem || this.itemExplorerConditionalVisibilityEnabled) {
      const matches = findVoudIdentifierMatches(
        (this.previewDefinition?.pages || []).flatMap((page) =>
          collectVoudNodes(page).map((node) => ({ node })),
        ),
        target,
      );
      if (matches.length !== 1) return [];
      const { id, alias } = matches[0].node;
      // Internal IDs and public aliases are different namespaces. Crossing them
      // can match a different item (for example OIB DHB001's id 04 / alias 05).
      return [
        ...(typeof id === 'string' && id
          ? [
              `[data-element-id="${this.escapeSelectorValue(id)}"]`,
              `[id="${this.escapeSelectorValue(id)}"]`,
            ]
          : []),
        ...(typeof alias === 'string' && alias
          ? [
              `[data-element-alias="${this.escapeSelectorValue(alias)}"]`,
              `[data-list-alias="${this.escapeSelectorValue(alias)}"]`,
            ]
          : []),
      ];
    }
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
    this.playerFrameRefreshPending = false;
    this.clearResponseState();
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();
    this.playerDom = undefined;
    this.sessionChanges$.complete();
  }
}
