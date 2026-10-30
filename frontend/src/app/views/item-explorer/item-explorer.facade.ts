import type { PreviewStart } from '../../core/services/preview-visibility';
import {
  ItemExplorerImportService,
  ItemExplorerImportResult,
} from './item-explorer-import.service';
import {
  ItemExplorerTableService,
  ItemExplorerTableColumnContext,
  ItemExplorerTableFilterContext,
} from './item-explorer-table.service';
import { ItemExplorerPlayerService } from './item-explorer-player.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { ItemExplorerDraftService, ItemExplorerDraftResult } from './item-explorer-draft.service';
import { ItemExplorerCollectionsService } from './item-explorer-collections.service';
import { ItemExplorerPersonalDataService } from './item-explorer-personal-data.service';
import { ItemExplorerCommentsService } from './item-explorer-comments.service';
import { Injectable, OnDestroy, Optional } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ApiService } from '../../core/services/api.service';
import { rewriteGeoGebraAssetUrls } from '../../core/utils/geogebra-player-html.util';
import { AuthService } from '../../core/services/auth.service';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { BreadcrumbItem } from '../../shared/components/breadcrumb.component';
import { CodingAsText } from '@iqb/responses';
import { finalize, firstValueFrom, ReplaySubject, Subscription, takeUntil } from 'rxjs';
import {
  ItemCollection,
  ItemExplorerChangeLogEntry,
  ItemExplorerSharedState,
  ItemExplorerStateEnvelope,
  ItemExplorerPerspective,
} from '../../core/models/api.models';
import type {
  ItemExplorerHeaderViewModel,
  ItemExplorerTableViewModel,
  ItemExplorerPreviewViewModel,
  ItemExplorerCodingDialogViewModel,
  ItemExplorerCollectionsViewModel,
  ItemExplorerMetadataDrawerViewModel,
  ItemExplorerUploadDialogsViewModel,
  ItemExplorerColumnManagerDialogViewModel,
  ItemExplorerResponseStateDialogsViewModel,
  ItemExplorerHistoryDialogViewModel,
  ItemExplorerDraftDialogsViewModel,
} from './item-explorer.view-models';
import {
  CodingVariableFocusResolution,
  DeepReadonly,
  ExplorerItem,
  ItemExplorerTableColumn,
  MetadataColumn,
  MetadataSettings,
  PersonalItemTagConfig,
  PreviewTargetOption,
  ReadonlyExplorerItem,
  ReadonlyItemParameterUploadSuccess,
} from './item-explorer.models';
import {
  ItemExplorerPlayerDomPort,
  ItemExplorerShellDomPort,
  ItemExplorerTableDomPort,
} from './item-explorer.dom-ports';
import {
  ItemExplorerPreviewCoordinator,
  ItemExplorerPreviewResult,
} from './item-explorer-preview-coordinator.service';
import {
  ItemExplorerLoadDiagnostics,
  ItemExplorerTimingToken,
} from './item-explorer-load-diagnostics.service';

import {
  ExplorerOptionalHeaderAction,
  normalizeReducedView,
} from '../../core/models/item-explorer-reduced-view';

type ItemListLoadOutcome = 'loaded' | 'version-mismatch' | 'superseded' | 'error';
@Injectable()
export class ItemExplorerFacade implements OnDestroy {
  private initialized = false;
  private destroyed = false;
  private readonly destroy$ = new ReplaySubject<void>(1);
  private readonly previewTargetItemPropertyKey = 'previewTargetId';
  private readonly excludedItemPropertyKey = 'excluded';
  private shellDom?: ItemExplorerShellDomPort;
  private tableDom?: ItemExplorerTableDomPort;

  acpId = '';
  canOpenFullUnit = false;
  private unitViewAccessRequest?: Subscription;
  private studioItemCommentsConfigured = false;
  private reducedView = normalizeReducedView(undefined);

  get reducedViewActive(): boolean {
    return this.reducedView.enabled && (this.isReadOnlyPreview || !this.hasExplorerEditPermission);
  }
  get showStudioItemComments(): boolean {
    return this.studioItemCommentsConfigured && !this.reducedViewActive;
  }
  get showExplorerHeader(): boolean {
    return !this.reducedViewActive || this.reducedView.showHeader;
  }
  isHeaderActionVisible(action: ExplorerOptionalHeaderAction): boolean {
    // Returning to editing must always remain possible for managers.
    if (action === 'readonlyPreview' && this.isReadOnlyPreview && this.canToggleReadOnlyPreview)
      return true;
    return (
      !this.reducedViewActive || (this.showExplorerHeader && this.reducedView.headerActions[action])
    );
  }
  get showTableToolbarArea(): boolean {
    return !this.reducedViewActive || this.reducedView.showTableToolbarArea;
  }
  get showExplorerItemPanel(): boolean {
    return !this.reducedViewActive || this.reducedView.showExplorerItemPanel;
  }
  get showItemInfo(): boolean {
    return !this.reducedViewActive || this.reducedView.showItemInfo;
  }
  get showPlayerPreview(): boolean {
    return !this.reducedViewActive || this.reducedView.showPlayerPreview;
  }
  get columns() {
    return this.table.columns;
  }
  items: ExplorerItem[] = [];
  get filteredItems() {
    return this.table.filteredItems;
  }
  get hasEmpiricalDifficulty() {
    return this.table.hasEmpiricalDifficulty;
  }
  get hasMeanTaskDifficulty() {
    return this.table.hasMeanTaskDifficulty;
  }
  get hasPartialCredit() {
    return this.table.hasPartialCredit;
  }
  get itemSubIdLabel() {
    return this.table.itemSubIdLabel;
  }
  get filterText() {
    return this.table.filterText;
  }
  isFullscreen = false;
  get sortField() {
    return this.table.sortField;
  }
  get sortIsMeta() {
    return this.table.sortIsMeta;
  }
  get sortDir() {
    return this.table.sortDir;
  }
  breadcrumbs: BreadcrumbItem[] = [];
  get columnFilters() {
    return this.table.columnFilters;
  }
  get showExcludedItems() {
    return this.table.showExcludedItems;
  }

  // Selection
  selectedItem: ExplorerItem | null = null;
  selectedIndex = -1;
  private get playerFrameRefreshPending() {
    return this.player.playerFrameRefreshPending;
  }
  get unit() {
    return this.player.unit;
  }
  get playerSrcDoc() {
    return this.player.playerSrcDoc;
  }
  get currentPage() {
    return this.player.currentPage;
  }
  get totalPages() {
    return this.player.totalPages;
  }
  get pagingMode() {
    return this.player.pagingMode;
  }
  get playerHeight() {
    return this.player.playerHeight;
  }

  // Overlays
  showOverlay: 'coding' | null = null;
  showMetadataDrawer = false;
  unitMetadataCache: Record<string, any[]> = {};
  codingSchemeCache: Record<string, any> = {};
  get currentCodingSchemeAsText() {
    return this.coding.currentCodingSchemeAsText;
  }
  currentUnitMetadata: any[] = [];
  get currentCodingScheme() {
    return this.coding.currentCodingScheme;
  }

  // Tags
  enableTags = false;
  availableTags: string[] = [];
  get showAudioVideoCodingVariables() {
    return this.coding.showAudioVideoCodingVariables;
  }
  get showGeneralCodingInstructions() {
    return this.coding.showGeneralCodingInstructions;
  }
  get preferManualCodingInstructions() {
    return this.coding.preferManualCodingInstructions;
  }
  get itemExplorerConditionalVisibilityEnabled() {
    return this.player.itemExplorerConditionalVisibilityEnabled;
  }
  get playerFocusHighlightEnabled() {
    return this.player.playerFocusHighlightEnabled;
  }
  get syntheticPreviewState(): boolean {
    return this.player.syntheticPreviewState;
  }

  get previewMode() {
    return this.player.previewMode;
  }
  get presentationMessage() {
    return this.previewUserFacingMessage || this.player.presentationMessage;
  }
  get preparingPresentation() {
    return this.player.preparingPresentation;
  }
  get hasPreviewContext() {
    return !!this.selectedItem?.previewStart?.context;
  }
  get hasCurrentResponseState() {
    return this.player.hasCurrentResponseState;
  }

  setPreviewMode(value: string): void {
    if (!['reference', 'answers', 'flow'].includes(value)) return;
    this.previewUserFacingMessage = '';
    this.player.changePreviewMode(value as 'reference' | 'answers' | 'flow');
    this.correctSolutionRequested = false;
    if (
      this.selectedItem &&
      this.hasReusablePreviewUnit(this.selectedItem) &&
      this.previewCoordinator.status.kind === 'unavailable'
    )
      this.previewCoordinator.markReady(this.selectedItem);
    this.startPlayerIfReady();
  }

  capturePreviewContext(): void {
    if (!this.canEditExplorer || !this.selectedItem || this.isCorrectSolutionActive) return;
    const context = this.player.capturePreviewContext({
      item: this.selectedItem,
      target: this.selectedPreviewTarget,
    });
    if (!context) {
      this.previewUserFacingMessage =
        'Bitte das ausgewählte Item im Player sichtbar öffnen und die Aktualisierung der Ansicht abwarten. Erst dann kann diese Ansicht übernommen werden.';
      return;
    }
    this.player.changePreviewMode('reference');
    this.persistPreviewStart({ values: {}, context });
  }

  clearPreviewContext(): void {
    if (!this.canEditExplorer || !this.selectedItem) return;
    const start = this.selectedItem.previewStart;
    this.persistPreviewStart({
      values: start?.values || {},
      ...(start?.page === undefined ? {} : { page: start.page }),
    });
  }

  get previewStateVariables() {
    return (this.player.previewDefinition?.stateVariables || []).map((v) => ({
      id: v.id!,
      label: v.alias || v.id!,
      value: this.selectedItem?.previewStart?.values?.[v.id!] ?? '',
    }));
  }

  get previewStartPage() {
    return this.selectedItem?.previewStart?.page ?? '';
  }

  get previewStartPages() {
    return (this.player.previewDefinition?.pages || [])
      .filter(
        (p) => p.alwaysVisible !== true && p.alwaysVisible !== 'true' && p.alwaysVisible !== 1,
      )
      .map((_, i) => i);
  }

  get showPreviewStartPageSelector(): boolean {
    if (!this.definitionContent || !this.selectedItem) return false;
    const target = this.getEffectivePlayerTarget(this.selectedItem);
    if (!target) return false;
    return this.player.resolveTargetLocation(target)?.isAlwaysVisiblePage === true;
  }

  setPreviewStartPage(value: string) {
    this.persistPreviewStart({
      values: this.selectedItem?.previewStart?.values || {},
      ...(value === '' ? {} : { page: Number(value) }),
    });
  }

  setPreviewStateValue(id: string, value: string) {
    const values = { ...this.selectedItem?.previewStart?.values };
    if (value === '') delete values[id];
    else values[id] = value;
    this.persistPreviewStart({ page: this.selectedItem?.previewStart?.page, values });
  }

  private persistPreviewStart(start: PreviewStart) {
    if (!this.canEditExplorer || !this.selectedItem) return;
    this.selectedItem.previewStart = start;
    this.queueItemPropertyPatch(
      this.selectedItem,
      'PREVIEW_START_CHANGED',
      { previewStart: start },
      true,
    );
    this.updatePreviewTargetSelection(this.getStoredPreviewTargetId(this.selectedItem));
  }

  itemExplorerPlayerTargetInfoEnabled = false;
  get itemCommentsEnabled() {
    return this.comments.itemCommentsEnabled;
  }

  get codingCommentsEnabled() {
    return this.comments.codingCommentsEnabled;
  }

  get itemCommentCounts() {
    return this.comments.itemCommentCounts;
  }
  get codingCommentCounts() {
    return this.comments.codingCommentCounts;
  }
  get itemCommentCountsLoading() {
    return this.comments.itemCommentCountsLoading;
  }
  get itemCommentCountsAvailable() {
    return this.comments.itemCommentCountsAvailable;
  }
  get itemCommentCountsError() {
    return this.comments.itemCommentCountsError;
  }
  get itemCommentRefreshToken() {
    return this.comments.itemCommentRefreshToken;
  }
  get itemCommentSessionToken() {
    return this.comments.itemCommentSessionToken;
  }
  commentThreadInitiallyOpen = false;
  get commentExportInProgress() {
    return this.comments.commentExportInProgress;
  }
  get commentExportError() {
    return this.comments.commentExportError;
  }

  private initialCommentTarget: {
    unitId: string;
    itemId: string;
    openCoding?: boolean;
  } | null = null;
  private selectingInitialCommentTarget = false;
  get showOnlyItemsWithEmpiricalDifficulty() {
    return this.table.showOnlyItemsWithEmpiricalDifficulty;
  }
  itemTags: Record<string, string[]> = {};
  persistUserPreferences = false;
  useServerPreferences = false;

  // Personal row-level working data (never part of the shared Explorer state)
  get enablePersonalItemData() {
    return this.personalData.enablePersonalItemData;
  }
  get personalItemCategoryLabel() {
    return this.personalData.personalItemCategoryLabel;
  }
  get personalItemCategoryValues() {
    return this.personalData.personalItemCategoryValues;
  }
  get personalItemTagLabel() {
    return this.personalData.personalItemTagLabel;
  }
  get personalItemTags() {
    return this.personalData.personalItemTags;
  }
  get personalItemData() {
    return this.personalData.personalItemData;
  }
  get personalColumnFilters() {
    return this.personalData.personalColumnFilters;
  }
  get personalDataLoadState() {
    return this.personalData.personalDataLoadState;
  }
  get personalDataSaveState() {
    return this.personalData.personalDataSaveState;
  }
  get personalDataError() {
    return this.personalData.personalDataError;
  }
  get personalExportInProgress() {
    return this.personalData.personalExportInProgress;
  }
  get personalExportError() {
    return this.personalData.personalExportError;
  }
  get allPersonalDataExportInProgress() {
    return this.personalData.allPersonalDataExportInProgress;
  }
  get allPersonalDataExportError() {
    return this.personalData.allPersonalDataExportError;
  }
  get collectionDataExportError() {
    return this.personalData.collectionDataExportError;
  }
  get showDiscardPersonalItemDataDialog() {
    return this.personalData.showDiscardPersonalItemDataDialog;
  }

  private authSessionSubscription: Subscription | null = null;
  private readonly authStorageListener = (event: StorageEvent) => {
    if (!event.key || event.key === 'ch_token') {
      this.syncItemCommentCountSession();
      this.syncPersonalItemDataSession();
      this.syncItemCollectionSession();
    }
  };

  // Personal named item collections
  get enableItemCollections() {
    return this.collections.enableItemCollections;
  }
  get itemCollections() {
    return this.collections.itemCollections;
  }
  get activeCollectionId() {
    return this.collections.activeCollectionId;
  }
  get collectionViewMode() {
    return this.collections.collectionViewMode;
  }
  get collectionLoadState() {
    return this.collections.collectionLoadState;
  }
  get collectionBusy() {
    return this.collections.collectionBusy;
  }
  get collectionError() {
    return this.collections.collectionError;
  }
  get sharedCollectionsTruncated() {
    return this.collections.sharedCollectionsTruncated;
  }
  get showCollectionDialog() {
    return this.collections.showCollectionDialog;
  }
  private readonly listPageSize = 10;
  private get definitionContent() {
    return this.player.definitionContent;
  }
  private get playerFrameReady() {
    return this.player.playerFrameReady;
  }
  private itemListLoadToken = 0;
  private itemListSlowTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSlowTimer: ReturnType<typeof setTimeout> | null = null;
  private playerReadyTiming: ItemExplorerTimingToken | null = null;
  itemListSlow = false;
  previewSlow = false;
  previewLoadPhase = '';

  // File Upload
  get showUploadReport() {
    return this.imports.showUploadReport;
  }
  get uploadResult() {
    return this.imports.uploadResult;
  }
  get isUploading() {
    return this.imports.isUploading;
  }
  get showUploadWarningDialog() {
    return this.imports.showUploadWarningDialog;
  }
  get uploadWarningMessages() {
    return this.imports.uploadWarningMessages;
  }
  get uploadWarningBusy() {
    return this.imports.uploadWarningBusy;
  }
  get uploadWarningError() {
    return this.imports.uploadWarningError;
  }

  get showErrorDialog() {
    return this.imports.showErrorDialog;
  }
  get errorMessage() {
    return this.imports.errorMessage;
  }

  // Metadata column management
  isAcpManager = false;
  private explorerEditingAllowed = false;
  get canEditExplorer(): boolean {
    return this.explorerEditingAllowed && !this.draft.discarding;
  }
  canPublishExplorer = false;
  hasExplorerEditPermission = false;
  hasExplorerPublishPermission = false;
  viewPerspective: ItemExplorerPerspective = 'editor';
  perspectiveSwitchBusy = false;
  get showColumnManager() {
    return this.table.showColumnManager;
  }
  get allColumns() {
    return this.table.allColumns;
  }
  get metadataSettings() {
    return this.table.metadataSettings;
  }
  get columnFilterText() {
    return this.table.columnFilterText;
  }
  get itemOrder() {
    return this.table.itemOrder;
  }

  // Shared draft state
  get explorerUiStatus() {
    return this.draft.explorerUiStatus;
  }
  get explorerVersion() {
    return this.draft.explorerVersion;
  }
  get explorerPublishedVersion() {
    return this.draft.explorerPublishedVersion;
  }
  get lastExplorerChangeInfo() {
    return this.draft.lastExplorerChangeInfo;
  }
  get latestExplorerState() {
    return this.draft.latestExplorerState;
  }
  itemListError = '';
  itemListLoading = false;

  // History
  showHistoryOverlay = false;
  historyLoading = false;
  historyError = '';
  historyEntries: ItemExplorerChangeLogEntry[] = [];
  historyFilterUser = '';
  historyFilterType = '';
  historyFilterFrom = '';
  historyFilterTo = '';

  // Save preview
  get showSavePreviewDialog() {
    return this.draft.showSavePreviewDialog;
  }
  get draftPreviewSummary() {
    return this.draft.draftPreviewSummary;
  }
  get lastDraftOperationError() {
    return this.draft.lastDraftOperationError;
  }

  // Draft / destructive dialogs
  get showDiscardDraftDialog() {
    return this.draft.showDiscardDraftDialog;
  }
  get discardDraftDialogBusy() {
    return this.draft.discardDraftDialogBusy;
  }
  get discardDraftDialogError() {
    return this.draft.discardDraftDialogError;
  }
  showClearEmpiricalDifficultiesDialog = false;
  clearEmpiricalDifficultiesBusy = false;
  clearEmpiricalDifficultiesError = '';
  showRenumberDialog = false;
  renumberBusy = false;
  renumberError = '';
  numberingSuccessMessage = '';
  get draftSaveSuccessMessage() {
    return this.draft.draftSaveSuccessMessage;
  }

  // Leave with pending changes dialog
  showLeaveWithChangesDialog = false;
  leaveWithChangesDialogState: 'idle' | 'saving' | 'discarding' = 'idle';
  leaveWithChangesDialogError = '';
  private leaveWithChangesResolver: ((value: boolean) => void) | null = null;

  // Coding scheme display filtering
  get codingSearchText() {
    return this.coding.codingSearchText;
  }
  get codingSortField() {
    return this.coding.codingSortField;
  }
  get codingSortDir() {
    return this.coding.codingSortDir;
  }
  get currentResponseData() {
    return this.player.currentResponseData;
  }
  get hasResponseState() {
    return this.player.hasResponseState;
  }
  get isFallbackState() {
    return this.player.isFallbackState;
  }
  correctSolutionRequested = false;
  get codingInformation() {
    return this.coding.codingInformation;
  }

  get correctSolutionPrefill() {
    return this.coding.correctSolutionPrefill;
  }
  showRawDataOverlay = false;
  allResponseStates: any[] = [];
  previewUserFacingMessage = '';
  get selectedPreviewTargetId() {
    return this.coding.selectedPreviewTargetId;
  }
  get customPreviewTargetDraft() {
    return this.coding.customPreviewTargetDraft;
  }
  get previewTargetResolution() {
    return this.coding.previewTargetResolution;
  }

  // Response State Confirmation Dialogs
  showSaveConfirmDialog = false;
  showDeleteConfirmDialog = false;
  confirmDialogState: 'idle' | 'saving' | 'deleting' = 'idle';
  confirmDialogError = '';

  get filteredCodingSchemeAsText(): CodingAsText[] {
    return this.coding.filteredCodingSchemeAsText(this.selectedItem, this.definitionContent);
  }

  shouldShowGeneralCodingInstruction(coding: DeepReadonly<CodingAsText>): boolean {
    return this.coding.shouldShowGeneralCodingInstruction(coding);
  }

  getCodingVariableDisplayLabel(coding: DeepReadonly<CodingAsText>): string {
    return this.coding.getCodingVariableDisplayLabel(coding);
  }

  shouldShowAutomaticCodingRules(code: DeepReadonly<CodingAsText['codes'][number]>): boolean {
    return this.coding.shouldShowAutomaticCodingRules(code);
  }

  get codingVariableFocus(): CodingVariableFocusResolution {
    return this.coding.codingVariableFocus(this.selectedItem, this.definitionContent);
  }

  get codingVariableFocusMessage(): string {
    return this.coding.codingVariableFocusMessage(this.selectedItem, this.definitionContent);
  }

  get excludedItemsCount(): number {
    return this.table.excludedItemsCount(this.items);
  }

  get totalItemsCount(): number {
    return this.table.totalItemsCount(this.items);
  }

  get canExportAllComments(): boolean {
    this.configureComments();
    return this.comments.canExportAllComments;
  }

  getItemCommentCount(item?: ReadonlyExplorerItem | null): number {
    return this.comments.getItemCommentCount(item);
  }

  getCodingCommentCount(item?: ReadonlyExplorerItem | null): number {
    return this.comments.getCodingCommentCount(item);
  }

  updateItemCommentCount(event: {
    targetType?: 'BOOKLET' | 'UNIT' | 'ITEM' | 'CODING';
    unitId: string;
    itemId: string;
    count: number;
    refreshToken?: number;
  }): void {
    this.configureComments();
    return this.comments.updateItemCommentCount(event);
  }

  refreshItemComments(refreshSelectedThread = true): void {
    this.configureComments();
    return this.comments.refreshItemComments(refreshSelectedThread);
  }

  exportMyCommentsCsv(): void {
    this.configureComments();
    return this.comments.exportMyCommentsCsv();
  }

  exportMyCommentsXlsx(): void {
    this.configureComments();
    return this.comments.exportMyCommentsXlsx();
  }

  exportAllCommentsXlsx(): void {
    this.configureComments();
    return this.comments.exportAllCommentsXlsx();
  }

  get visibleItemsCount(): number {
    return this.table.visibleItemsCount(this.items);
  }

  get hiddenExcludedItemsCount(): number {
    return this.table.hiddenExcludedItemsCount(this.items);
  }

  get hiddenMissingDifficultyItemsCount(): number {
    return this.table.hiddenMissingDifficultyItemsCount(this.items);
  }

  get referenceNumberVisible(): boolean {
    return this.table.referenceNumberVisible();
  }

  get canResetMetadataSettings(): boolean {
    return this.table.canResetMetadataSettings();
  }

  get activeItemCollection(): ItemCollection | null {
    this.configureCollections();
    return this.collections.activeItemCollection;
  }

  get canEditActiveCollection(): boolean {
    this.configureCollections();
    return this.collections.canEditActiveCollection;
  }

  get activeCollectionItems(): Array<{
    rowKey: string;
    position: number;
    item: ExplorerItem | null;
  }> {
    this.configureCollections();
    return this.collections.activeCollectionItems;
  }

  get selectedPreviewTarget(): string {
    const storedId = this.getStoredPreviewTargetId(this.selectedItem);
    if (storedId) {
      return storedId;
    }
    if (this.previewTargetResolution.blocksAutomaticTarget) {
      return '';
    }
    return this.previewTargetResolution.defaultTargetId || this.getPlayerTarget(this.selectedItem);
  }

  get selectedItemTarget(): string {
    return this.previewTargetResolution.itemTarget || this.getItemCodingTarget(this.selectedItem);
  }

  get previewTargetOptions(): PreviewTargetOption[] {
    return this.previewTargetResolution.options;
  }

  get selectedItemUsesDerivedTarget(): boolean {
    return this.previewTargetResolution.isDerived;
  }

  get showPreviewTargetSelector(): boolean {
    return this.previewTargetOptions.length > 0;
  }

  get hasStoredPreviewTargetOverride(): boolean {
    return this.getStoredPreviewTargetId(this.selectedItem).length > 0;
  }

  get previewTargetDefaultOptionLabel(): string {
    if (this.previewTargetResolution.defaultTargetId) {
      const option = this.findPreviewTargetOption(
        this.previewTargetResolution.defaultTargetId,
        this.previewTargetResolution.options,
      );
      return `Standardziel verwenden (${option?.label || this.previewTargetResolution.defaultTargetId})`;
    }
    return 'Kein Standardziel hinterlegt';
  }

  get showPlayerTargetInfo(): boolean {
    return this.canEditExplorer && this.itemExplorerPlayerTargetInfoEnabled;
  }

  get isReadOnlyPreview(): boolean {
    return this.viewPerspective === 'read-only';
  }

  get canToggleReadOnlyPreview(): boolean {
    return this.hasExplorerEditPermission;
  }

  get showReadOnlyPreviewBanner(): boolean {
    return this.isReadOnlyPreview && this.hasExplorerEditPermission;
  }

  get showExplorerDraftStatus(): boolean {
    return this.canEditExplorer;
  }

  get showExplorerKeyboardHints(): boolean {
    return this.canEditExplorer;
  }

  get canPreviewSelectedItem(): boolean {
    return this.canPreviewItem(this.selectedItem) && !this.previewUnavailableReason;
  }

  get correctSolutionAvailable(): boolean {
    return this.correctSolutionPrefill.status === 'available';
  }

  get isCorrectSolutionActive(): boolean {
    return this.correctSolutionRequested && this.correctSolutionAvailable;
  }

  get correctSolutionToggleTitle(): string {
    if (this.correctSolutionRequested) {
      return 'Musterlösung ausblenden und den vorherigen Player-Zustand wiederherstellen';
    }
    return this.correctSolutionAvailable
      ? 'Eindeutig aus dem Kodierschema abgeleitete Musterlösung anzeigen'
      : 'Musterlösungsmodus einschalten; für dieses Item ist derzeit keine eindeutige Lösung verfügbar';
  }

  get canSaveCurrentResponseState(): boolean {
    return (
      !this.previewUpdateInProgress && !this.isCorrectSolutionActive && this.player.isAnswerSession
    );
  }

  get loadingUnit(): boolean {
    return this.previewCoordinator.status.kind === 'loading-unit';
  }

  get previewUpdateInProgress(): boolean {
    return this.previewCoordinator.status.kind === 'loading-response';
  }

  get previewUnavailableReason(): string {
    const status = this.previewCoordinator.status;
    return status.kind === 'unavailable' || status.kind === 'error' ? status.reason : '';
  }

  get previewUnavailableMessage(): string {
    if (!this.previewUnavailableReason) return '';
    if (this.previewUserFacingMessage) return this.previewUserFacingMessage;
    if (this.showPlayerTargetInfo) return this.previewUnavailableReason;
    return 'Für dieses Item ist keine zielgenaue Player-Vorschau verfügbar.';
  }

  get isPreviewLoading(): boolean {
    if (!this.selectedItem || this.previewUnavailableReason) {
      return false;
    }

    const status = this.previewCoordinator.status.kind;
    return status === 'loading-unit' || this.playerFrameRefreshPending;
  }

  get shouldRenderPlayerFrame(): boolean {
    const status = this.previewCoordinator.status.kind;
    return (
      !!this.selectedItem &&
      !this.previewUnavailableReason &&
      !this.isPreviewLoading &&
      !!this.playerSrcDoc &&
      !!this.definitionContent &&
      (status === 'ready' || status === 'loading-response')
    );
  }

  toggleCodingSort(field: 'id' | 'label') {
    return this.coding.toggleCodingSort(field);
  }

  getCodingSortIndicator(field: 'id' | 'label'): string {
    return this.coding.getCodingSortIndicator(field);
  }

  get reviewerColumnsRestricted(): boolean {
    return (
      !this.canEditExplorer &&
      this.latestExplorerState?.publishedState?.metadataColumns
        ?.restrictReviewerColumnsToManagerSelection === true
    );
  }

  isReviewerColumnAllowed(key: string): boolean {
    return this.table.isReviewerColumnAllowed(this.tableColumnContext(), key);
  }

  setRestrictReviewerColumns(value: boolean) {
    return this.table.setRestrictReviewerColumns(this.tableColumnContext(), value);
  }

  get allTableColumns(): ItemExplorerTableColumn[] {
    return this.table.allTableColumns(this.tableColumnContext());
  }

  get tableColumns(): ItemExplorerTableColumn[] {
    return this.table.tableColumns(this.tableColumnContext());
  }

  get filteredAllColumns(): ItemExplorerTableColumn[] {
    return this.table.filteredAllColumns(this.tableColumnContext());
  }

  get explorerStatusLabel(): string {
    switch (this.explorerUiStatus) {
      case 'DIRTY':
        return 'Ungespeichert';
      case 'SAVING':
        return 'Speichern läuft';
      case 'SAVED':
        return 'Gespeichert';
      case 'ERROR':
        return 'Fehler';
      default:
        return 'Keine unveröffentlichten Änderungen';
    }
  }

  get filteredHistoryEntries(): ItemExplorerChangeLogEntry[] {
    const userNeedle = this.historyFilterUser.trim().toLowerCase();
    const typeNeedle = this.historyFilterType.trim().toLowerCase();
    const fromDate = this.historyFilterFrom ? new Date(`${this.historyFilterFrom}T00:00:00`) : null;
    const toDate = this.historyFilterTo ? new Date(`${this.historyFilterTo}T23:59:59.999`) : null;
    return this.historyEntries.filter((entry) => {
      const user = (entry.actorUsername || '').toLowerCase();
      const type = (entry.changeType || '').toLowerCase();
      const matchesUser = !userNeedle || user.includes(userNeedle);
      const matchesType = !typeNeedle || type.includes(typeNeedle);
      const entryDate = new Date(entry.createdAt);
      const matchesFrom = !fromDate || entryDate >= fromDate;
      const matchesTo = !toDate || entryDate <= toDate;
      return matchesUser && matchesType && matchesFrom && matchesTo;
    });
  }

  constructor(
    private api: ApiService,
    public sanitizer: DomSanitizer,
    private authService: AuthService,
    private pendingPersonalSessionStorage: PendingPersonalSessionStorageService,
    private readonly previewCoordinator: ItemExplorerPreviewCoordinator,
    readonly comments: ItemExplorerCommentsService,
    readonly personalData: ItemExplorerPersonalDataService,
    readonly collections: ItemExplorerCollectionsService,
    readonly draft: ItemExplorerDraftService,
    readonly coding: ItemExplorerCodingService,
    readonly player: ItemExplorerPlayerService,
    readonly table: ItemExplorerTableService,
    readonly imports: ItemExplorerImportService,
    @Optional() private readonly diagnostics?: ItemExplorerLoadDiagnostics,
  ) {
    this.draft.flushRequested$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      void this.flushDraftPatch();
    });
    this.collections.collectionsChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.applyFilter(false));
    this.personalData.dataChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.applyFilter(false));
    this.comments.countsChanged$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.ensureTableColumnDefaults();
      this.applyFilter(false);
    });
    this.player.sessionChanges$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.confirmDialogState = 'idle';
      this.confirmDialogError = '';
      this.showSaveConfirmDialog = false;
      this.showDeleteConfirmDialog = false;
    });
    this.previewCoordinator.results$
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => this.applyPreviewResult(result));
  }

  private readonly draftResultApplications = new WeakMap<
    ItemExplorerDraftResult,
    Promise<boolean>
  >();

  private applyDraftResult(result: ItemExplorerDraftResult): Promise<boolean> {
    const existing = this.draftResultApplications.get(result);
    if (existing) return existing;
    const application = this.performDraftResultApplication(result);
    this.draftResultApplications.set(result, application);
    return application;
  }

  private async performDraftResultApplication(result: ItemExplorerDraftResult): Promise<boolean> {
    if (this.destroyed) return false;
    if (result.kind === 'conflict') {
      let reloaded = false;
      try {
        reloaded = await this.reloadSharedExplorerStateAndItems(true);
      } finally {
        this.draft.finishConflictRecovery(reloaded);
      }
      return false;
    }
    if (result.kind === 'failed') {
      if (result.rollbackTags) this.rollbackItemTagsToLatestExplorerState();
      return false;
    }
    if (result.kind === 'cancelled' || result.kind === 'busy' || result.kind === 'version-only') {
      return false;
    }
    if (result.kind === 'applied') {
      if (!this.draft.canApplyEnvelope(result.envelope)) return false;
      this.applySharedExplorerEnvelope(result.envelope, result.markSaved);
    }
    return true;
  }

  private tableColumnContext(): ItemExplorerTableColumnContext {
    return {
      canEditExplorer: this.canEditExplorer,
      reviewerColumnsRestricted: this.reviewerColumnsRestricted,
      reviewerVisibleColumns:
        this.latestExplorerState?.publishedState?.metadataColumns?.layout?.visible,
      itemCommentsEnabled: this.itemCommentsEnabled,
      enableTags: this.enableTags,
      showPersonalItemData: this.showPersonalItemData,
      personalItemCategoryLabel: this.personalItemCategoryLabel,
      personalItemTagLabel: this.personalItemTagLabel,
      enableItemCollections: this.enableItemCollections,
    };
  }

  private tableFilterContext(): ItemExplorerTableFilterContext {
    return {
      ...this.tableColumnContext(),
      itemCommentCountsAvailable: this.itemCommentCountsAvailable,
      commentCountsByRow: new Map(
        this.items.map((item) => [this.getStableRowKey(item), this.getItemCommentCount(item)]),
      ),
      itemTags: this.itemTags,
      personalColumnFilters: this.personalColumnFilters,
      personalItemData: this.personalItemData,
      globalFilterText: this.showTableToolbarArea ? this.filterText : '',
      activeCollectionRowKeys:
        this.showTableToolbarArea &&
        this.collectionViewMode === 'active' &&
        this.activeItemCollection
          ? new Set(this.activeItemCollection.rowKeys)
          : null,
    };
  }

  private configureDraft(): void {
    this.draft.configure({
      acpId: this.acpId,
      canEdit: this.explorerEditingAllowed,
      canPublish: this.canPublishExplorer,
    });
  }

  private configureCollections(): void {
    this.collections.configure({
      acpId: this.acpId,
      identity: this.pendingPersonalSessionStorage.resolveIdentityFromToken(
        this.authService.getToken(),
      ),
      perspective: this.getPerspectiveForViewerRequests(),
      items: this.items,
      itemsAvailable: !this.itemListLoading && !this.itemListError,
    });
  }

  private configurePersonalData(): void {
    this.personalData.configure({
      acpId: this.acpId,
      identity: this.pendingPersonalSessionStorage.resolveIdentityFromToken(
        this.authService.getToken(),
      ),
      perspective: this.getPerspectiveForViewerRequests(),
      canExportAll: this.hasExplorerEditPermission,
      perspectiveSwitchBusy: this.perspectiveSwitchBusy,
    });
  }

  private configureComments(): void {
    this.comments.configure({
      acpId: this.acpId,
      identity: this.pendingPersonalSessionStorage.resolveIdentityFromToken(
        this.authService.getToken(),
      ),
      loggedIn: this.authService.isLoggedIn,
      canExport: this.hasExplorerEditPermission,
    });
  }

  get headerViewModel(): ItemExplorerHeaderViewModel {
    return this;
  }

  get tableViewModel(): ItemExplorerTableViewModel {
    return this;
  }

  get collectionsViewModel(): ItemExplorerCollectionsViewModel {
    return this;
  }

  get previewViewModel(): ItemExplorerPreviewViewModel {
    return this;
  }

  get codingDialogViewModel(): ItemExplorerCodingDialogViewModel {
    return this;
  }

  get metadataDrawerViewModel(): ItemExplorerMetadataDrawerViewModel {
    return this;
  }

  get uploadDialogsViewModel(): ItemExplorerUploadDialogsViewModel {
    return this;
  }

  get columnManagerDialogViewModel(): ItemExplorerColumnManagerDialogViewModel {
    return this;
  }

  get responseStateDialogsViewModel(): ItemExplorerResponseStateDialogsViewModel {
    return this;
  }

  get historyDialogViewModel(): ItemExplorerHistoryDialogViewModel {
    return this;
  }

  get draftDialogsViewModel(): ItemExplorerDraftDialogsViewModel {
    return this;
  }

  registerShellDom(port: ItemExplorerShellDomPort): void {
    this.shellDom = port;
  }

  unregisterShellDom(port: ItemExplorerShellDomPort): void {
    if (this.shellDom === port) this.shellDom = undefined;
  }

  registerTableDom(port: ItemExplorerTableDomPort): void {
    this.tableDom = port;
  }

  unregisterTableDom(port: ItemExplorerTableDomPort): void {
    if (this.tableDom === port) this.tableDom = undefined;
  }

  registerPlayerDom(port: ItemExplorerPlayerDomPort): void {
    this.player.registerPlayerDom(port);
    this.startPlayerIfReady();
  }

  unregisterPlayerDom(port: ItemExplorerPlayerDomPort): void {
    this.player.unregisterPlayerDom(port);
  }

  playerFrameChanged(hasFrame: boolean): void {
    this.player.playerFrameChanged(hasFrame);
    if (hasFrame) this.startPlayerIfReady();
  }

  setFilterText(value: string): void {
    this.table.filterText = value;
  }

  setColumnFilter(key: string, value: string): void {
    this.columnFilters[key] = value;
  }

  setPersonalColumnFilter(key: string, value: string): void {
    this.personalColumnFilters[key] = value;
  }

  setCodingSearchText(value: string): void {
    this.coding.codingSearchText = value;
  }

  setHistoryFilter(
    key: 'historyFilterUser' | 'historyFilterType' | 'historyFilterFrom' | 'historyFilterTo',
    value: string,
  ): void {
    this[key] = value;
  }

  setSelectedPreviewTargetId(value: string): void {
    this.coding.selectedPreviewTargetId = value;
  }

  setCustomPreviewTargetDraft(value: string): void {
    this.coding.customPreviewTargetDraft = value;
  }

  setPagingMode(value: ItemExplorerFacade['pagingMode']): void {
    this.player.pagingMode = value;
  }

  setColumnFilterText(value: string): void {
    this.table.columnFilterText = value;
  }

  openCollectionDialog(): void {
    this.configureCollections();
    return this.collections.openCollectionDialog();
  }

  closeCollectionDialog(): void {
    this.configureCollections();
    return this.collections.closeCollectionDialog();
  }

  setMetadataDrawerOpen(open: boolean): void {
    this.showMetadataDrawer = open;
  }

  closeUploadReport(reloadItems = false): void {
    this.imports.closeReport();
    if (reloadItems) this.reloadItems();
  }

  closeUploadErrorDialog(): void {
    this.imports.closeError();
  }

  cancelItemParameterUploadWarnings(): void {
    if (this.imports.cancelWarnings()) this.restoreFocusAfterOverlayClose();
  }

  async confirmItemParameterUploadWarnings(): Promise<void> {
    if (this.destroyed) return;
    await this.applyImportResult(
      await this.imports.confirmWarnings({ acpId: this.acpId, baseVersion: this.explorerVersion }),
    );
  }

  init(
    acpId: string,
    initialCommentTarget?: {
      unitId: string;
      itemId: string;
      open?: boolean;
      openCoding?: boolean;
    },
  ) {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.acpId = acpId;
    if (initialCommentTarget?.unitId && initialCommentTarget.itemId) {
      this.initialCommentTarget = {
        unitId: initialCommentTarget.unitId,
        itemId: initialCommentTarget.itemId,
        openCoding: initialCommentTarget.openCoding === true,
      };
      this.commentThreadInitiallyOpen = initialCommentTarget.open === true;
    }
    this.breadcrumbs = [
      { label: 'Content Hub', route: ['/'] },
      { label: 'ACP', route: ['/view', this.acpId] },
      { label: 'Item-Explorer' },
    ];

    window.addEventListener('storage', this.authStorageListener);
    this.authSessionSubscription = this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.checkUserRole();
        this.syncItemCommentCountSession();
        this.syncPersonalItemDataSession();
        this.syncItemCollectionSession();
      });

    // Check if user is ACP Manager
    this.checkUserRole();

    // Load feature config and metadata settings
    this.api
      .getAcpStartPage(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          const fc = data?.featureConfig || {};
          this.studioItemCommentsConfigured = fc.showStudioItemComments === true;
          this.reducedView = normalizeReducedView(fc.itemExplorerReducedView);
          const commentTargets = Array.isArray(fc.commentTargets) ? fc.commentTargets : [];
          this.comments.itemCommentsConfigured = Boolean(
            fc.enableCommenting && (commentTargets.length === 0 || commentTargets.includes('ITEM')),
          );
          this.comments.itemCommentsEnabled =
            this.comments.itemCommentsConfigured && this.authService.isLoggedIn;
          this.comments.codingCommentsConfigured = Boolean(
            fc.enableCommenting && commentTargets.includes('CODING'),
          );
          this.comments.codingCommentsEnabled =
            this.comments.codingCommentsConfigured && this.authService.isLoggedIn;
          this.enableTags = !!fc.enableItemListTags;
          this.availableTags = fc.availableTags || [];
          this.coding.showAudioVideoCodingVariables = fc.showAudioVideoCodingVariables !== false;
          this.coding.showGeneralCodingInstructions = fc.showGeneralCodingInstructions === true;
          this.coding.preferManualCodingInstructions = fc.preferManualCodingInstructions !== false;
          this.player.itemExplorerConditionalVisibilityEnabled =
            fc.enableItemExplorerConditionalVisibility === true;
          this.player.playerFocusHighlightEnabled = fc.enablePlayerFocusHighlight === true;
          this.itemExplorerPlayerTargetInfoEnabled = fc.showItemExplorerPlayerTargetInfo === true;
          this.table.showOnlyItemsWithEmpiricalDifficulty =
            fc.showOnlyItemsWithEmpiricalDifficulty === true;
          this.table.itemSubIdLabel = String(fc.itemSubIdLabel || 'Sub-ID').trim() || 'Sub-ID';
          this.personalData.configureFeatures(fc);
          this.collections.enableItemCollections = fc.enableItemCollections === true;
          // Explorer uses ACP-shared draft/published state instead of per-user preferences.
          this.persistUserPreferences = false;
          this.useServerPreferences = false;

          // Load metadata column settings
          this.table.metadataSettings = this.resolveMetadataSettings(fc);
          this.ensureTableColumnDefaults();
          this.table.configuredMetadataColumns = this.resolveConfiguredMetadataColumns(fc);
          void this.reloadSharedExplorerStateAndItems();
          this.syncItemCommentCountSession();
          this.syncPersonalItemDataSession();
          this.syncItemCollectionSession();
          this.startPlayerIfReady();
        },
        error: (error) => {
          if (this.destroyed) return;
          console.error('Failed to load Item Explorer feature configuration', error);
          this.itemListError = 'Die Konfiguration des Item-Explorers konnte nicht geladen werden.';
          this.draft.explorerUiStatus = 'ERROR';
        },
      });
  }

  // --- Reload Items ---
  reloadItems(
    onSettled?: (outcome: ItemListLoadOutcome) => void,
    expectedExplorerState?: ItemExplorerStateEnvelope,
  ) {
    const loadToken = ++this.itemListLoadToken;
    const timing = this.diagnostics?.start('item-list') || null;
    let settled = false;
    let outcome: ItemListLoadOutcome = 'error';
    const settle = () => {
      if (settled) return;
      settled = true;
      this.diagnostics?.finish(timing, { outcome });
      if (loadToken === this.itemListLoadToken) {
        this.clearItemListSlowTimer();
      }
      onSettled?.(outcome);
    };
    this.itemListError = '';
    this.itemListLoading = true;
    this.startItemListSlowTimer();

    // Load item list from .vomd files
    this.api
      .getFileItemList(this.acpId, {
        perspective: this.getPerspectiveForViewerRequests(expectedExplorerState),
      })
      .pipe(takeUntil(this.destroy$), finalize(settle))
      .subscribe({
        next: (result) => {
          if (loadToken !== this.itemListLoadToken) {
            outcome = 'superseded';
            settle();
            return;
          }
          if (!this.itemListMatchesCurrentExplorerState(result, expectedExplorerState)) {
            outcome = 'version-mismatch';
            this.itemListLoading = false;
            if (!onSettled) {
              void this.reloadSharedExplorerStateAndItems();
            }
            settle();
            return;
          }
          this.items = (result.items || []).map((item: ExplorerItem) => ({
            ...item,
            unitLabel: item.unitLabel || '',
            description: item.description || '',
            metadata: item.metadata || {},
            rowKey: item.rowKey || item.uuid || `${item.unitId}_${item.itemId}`,
            bookletOccurrences: Array.isArray(item.bookletOccurrences)
              ? item.bookletOccurrences.map((occurrence) => ({
                  booklet: occurrence.booklet || '',
                  position: occurrence.position ?? null,
                }))
              : [],
          }));
          this.table.allColumns = this.getAvailableMetadataColumns(result.columns || []);
          this.table.columns = this.filterVisibleColumns(this.allColumns);
          this.table.itemSubIdLabel =
            String(result.subIdLabel || this.itemSubIdLabel).trim() || 'Sub-ID';
          this.table.hasPartialCredit = this.items.some((item) => !!item.subId);
          this.hydrateItemTagsFromItems();
          if (expectedExplorerState) {
            this.applySharedExplorerEnvelope(expectedExplorerState);
          } else {
            this.applyExplorerStateToItems();
          }
          this.table.hasEmpiricalDifficulty = this.items.some(
            (item: any) =>
              item.empiricalDifficulty !== undefined && item.empiricalDifficulty !== null,
          );
          this.reconcileMeanTaskDifficultyState();
          this.table.filteredItems = [...this.items];
          this.unitMetadataCache = result.unitMetadata || {};
          this.codingSchemeCache = result.codingSchemes || {};
          this.applyFilter(false); // re-apply current filters and sort
          this.selectInitialCommentTarget();
          if (this.enableItemCollections && this.collectionLoadState === 'loaded') {
            this.recalculateCollectionSummaries();
          }
          this.itemListLoading = false;
          outcome = 'loaded';
          settle();
        },
        error: (error) => {
          if (loadToken !== this.itemListLoadToken) {
            outcome = 'superseded';
            settle();
            return;
          }
          console.error('Failed to load explorer item list', error);
          this.itemListError =
            error?.status === 403
              ? this.getItemListAccessMessage()
              : 'Die Item-Liste konnte nicht geladen werden.';
          this.table.allColumns = [];
          this.table.columns = [];
          this.items = [];
          this.table.filteredItems = [];
          this.itemTags = {};
          this.table.hasEmpiricalDifficulty = false;
          this.table.hasMeanTaskDifficulty = false;
          this.table.hasPartialCredit = false;
          this.unitMetadataCache = {};
          this.codingSchemeCache = {};
          this.clearSelectedItem();
          this.itemListLoading = false;
          settle();
        },
      });
  }

  ngOnDestroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.itemListLoadToken += 1;
    this.destroy$.next();
    this.destroy$.complete();
    window.removeEventListener('storage', this.authStorageListener);
    this.authSessionSubscription?.unsubscribe();
    this.authSessionSubscription = null;
    this.clearItemListSlowTimer();
    this.clearPreviewSlowTimer();
    this.cancelPlayerReadyTiming();
    this.previewCoordinator.clear();
    this.leaveWithChangesResolver?.(false);
    this.leaveWithChangesResolver = null;
    this.shellDom = undefined;
    this.tableDom = undefined;
  }

  handleBeforeUnload(event: BeforeUnloadEvent) {
    const hasPendingSharedDraft = this.canPublishExplorer && this.hasPendingDraftChanges();
    if (!hasPendingSharedDraft && !this.hasPendingPersonalItemDataChanges()) {
      return;
    }
    event.preventDefault();
    event.returnValue = true;
  }

  handleWindowKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) {
      return;
    }

    const lowerKey = event.key.toLowerCase();
    // Disabled controls can move focus outside a modal while its request is pending.
    if (
      document.querySelector('dialog[open]') ||
      (event.target instanceof Element && event.target.closest('dialog[open]'))
    ) {
      if ((event.ctrlKey || event.metaKey) && lowerKey === 's') event.preventDefault();
      return;
    }
    if (lowerKey === 'escape' && this.closeTopmostOverlay()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && lowerKey === 's' && this.canPublishExplorer) {
      event.preventDefault();
      if (!this.hasModalOverlay()) {
        this.openSavePreviewDialog();
      }
      return;
    }

    if (this.hasModalOverlay()) {
      return;
    }

    if (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.tableDom?.focusFilter();
    }
  }

  handleFullscreenChange() {
    this.isFullscreen = this.shellDom?.isFullscreen() ?? false;
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (this.hasPendingPersonalItemDataChanges()) {
      return this.savePersonalChangesBeforeLeaving();
    }
    return this.canDeactivateSharedExplorer();
  }

  private async savePersonalChangesBeforeLeaving(): Promise<boolean> {
    const saved = await this.flushPersonalItemDataSaveAndWait();
    if (!saved) return false;
    return this.canDeactivateSharedExplorer();
  }

  private canDeactivateSharedExplorer(): boolean | Promise<boolean> {
    if (!this.canPublishExplorer || !this.hasPendingDraftChanges()) {
      return true;
    }
    return this.confirmLeaveWithUnsavedChanges();
  }

  private getAvailableMetadataColumns(sourceColumns: MetadataColumn[]): MetadataColumn[] {
    return this.table.getAvailableMetadataColumns(sourceColumns);
  }

  getMetadataColumnDisplayValue(
    item: ReadonlyExplorerItem,
    column: DeepReadonly<MetadataColumn>,
  ): string {
    return this.table.getMetadataColumnDisplayValue(item, column);
  }

  private syncItemCollectionSession() {
    this.configureCollections();
    return this.collections.syncItemCollectionSession();
  }

  loadItemCollections(preserveError = false) {
    this.configureCollections();
    return this.collections.loadItemCollections(preserveError);
  }

  async createCollection(requestedName?: string): Promise<ItemCollection | null> {
    this.configureCollections();
    return this.collections.createCollection(requestedName);
  }

  async activateCollection(collectionId: string | null) {
    this.configureCollections();
    return this.collections.activateCollection(collectionId);
  }

  isItemInActiveCollection(item: ReadonlyExplorerItem): boolean {
    this.configureCollections();
    return this.collections.isItemInActiveCollection(item);
  }

  async toggleItemInActiveCollection(item: ReadonlyExplorerItem) {
    this.configureCollections();
    return this.collections.toggleItemInActiveCollection(item);
  }

  async removeRowFromActiveCollection(rowKey: string): Promise<boolean> {
    this.configureCollections();
    return this.collections.removeRowFromActiveCollection(rowKey);
  }

  async removeRowsFromActiveCollection(rowKeys: string[]): Promise<boolean> {
    this.configureCollections();
    return this.collections.removeRowsFromActiveCollection(rowKeys);
  }

  async clearActiveCollection(): Promise<boolean> {
    this.configureCollections();
    return this.collections.clearActiveCollection();
  }

  async renameActiveCollection(requestedName: string) {
    this.configureCollections();
    return this.collections.renameActiveCollection(requestedName);
  }

  async deleteActiveCollection() {
    this.configureCollections();
    return this.collections.deleteActiveCollection();
  }

  async exportActiveCollection() {
    this.configureCollections();
    return this.collections.exportActiveCollection();
  }

  async setActiveCollectionShared(shared: boolean) {
    this.configureCollections();
    return this.collections.setActiveCollectionShared(shared);
  }

  async copyActiveCollection() {
    this.configureCollections();
    return this.collections.copyActiveCollection();
  }

  formatDuration(rawSeconds: number): string {
    this.configureCollections();
    return this.collections.formatDuration(rawSeconds);
  }

  async setCollectionViewMode(mode: 'all' | 'active') {
    this.configureCollections();
    return this.collections.setCollectionViewMode(mode);
  }

  private recalculateCollectionSummaries() {
    this.configureCollections();
    return this.collections.recalculateCollectionSummaries();
  }

  // --- Filtering ---
  applyFilter(shouldPersist = true) {
    this.table.applyFilter(this.tableFilterContext(), this.items);
    this.syncSelectionAfterListMutation();
    if (shouldPersist) this.saveUiPreferences();
  }

  isItemExcluded(item?: ReadonlyExplorerItem | null): boolean {
    return this.table.isItemExcluded(item);
  }

  toggleShowExcludedItems() {
    this.table.showExcludedItems = !this.showExcludedItems;
    this.applyFilter(false);
  }

  async toggleFullscreen(): Promise<void> {
    this.isFullscreen = (await this.shellDom?.toggleFullscreen()) ?? false;
  }

  toggleSelectedItemExclusion() {
    if (!this.canEditExplorer || !this.selectedItem) {
      return;
    }

    const item = this.selectedItem;
    const nextExcluded = !this.isItemExcluded(item);
    this.updateItemExclusion(item, nextExcluded);
    this.applyFilter(false);
  }

  // --- Sorting ---
  onTableKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (this.filteredItems.length === 0) {
      return;
    }

    const hasModifier = event.ctrlKey || event.metaKey;
    if (hasModifier && event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelectedItem(-1);
      return;
    }
    if (hasModifier && event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelectedItem(1);
      return;
    }

    if (hasModifier) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectFilteredItemAt(this.getKeyboardNavigationIndex(1), true);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.selectFilteredItemAt(this.getKeyboardNavigationIndex(-1), true);
        return;
      case 'Home':
        event.preventDefault();
        this.selectFilteredItemAt(0, true);
        return;
      case 'End':
        event.preventDefault();
        this.selectFilteredItemAt(this.filteredItems.length - 1, true);
        return;
      case 'PageDown':
        event.preventDefault();
        this.selectFilteredItemAt(this.getKeyboardNavigationIndex(this.listPageSize), true);
        return;
      case 'PageUp':
        event.preventDefault();
        this.selectFilteredItemAt(this.getKeyboardNavigationIndex(-this.listPageSize), true);
        return;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        this.selectFilteredItemAt(this.getKeyboardNavigationIndex(0), true);
        return;
      default:
        return;
    }
  }

  sortBy(field: string) {
    this.table.sortBy(this.tableFilterContext(), field);
    this.syncSelectionAfterListMutation();
    this.saveUiPreferences();
  }

  sortByMeta(colId: string) {
    this.table.sortByMeta(this.tableFilterContext(), colId);
    this.syncSelectionAfterListMutation();
    this.saveUiPreferences();
  }

  private applySort(shouldPersist = true) {
    this.table.applySort(this.tableFilterContext());
    this.syncSelectionAfterListMutation();
    if (shouldPersist) this.saveUiPreferences();
  }

  private ensureVisibleSortField() {
    return this.table.ensureVisibleSortField(this.tableColumnContext());
  }

  // --- CSV Upload Handling ---
  getUploadSuccessFieldSummary(success: ReadonlyItemParameterUploadSuccess): string {
    return this.imports.getUploadSuccessFieldSummary(success);
  }

  getUploadSuccessBookletSummary(success: ReadonlyItemParameterUploadSuccess): string {
    return this.imports.getUploadSuccessBookletSummary(success);
  }

  async onCsvFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.destroyed) return;
    input.value = '';
    await this.applyImportResult(
      await this.imports.upload(file, { acpId: this.acpId, baseVersion: this.explorerVersion }),
    );
  }

  private async applyImportResult(outcome: ItemExplorerImportResult): Promise<void> {
    if (this.destroyed || !this.imports.isCurrent(outcome)) return;
    try {
      if (outcome.kind === 'warning') {
        this.rememberFocusBeforeOverlay();
        this.imports.openWarnings();
      } else if (outcome.kind === 'imported') {
        if (typeof outcome.result.showOnlyItemsWithEmpiricalDifficulty === 'boolean') {
          this.table.showOnlyItemsWithEmpiricalDifficulty =
            outcome.result.showOnlyItemsWithEmpiricalDifficulty;
        }
        if (outcome.result.explorerState)
          this.applySharedExplorerEnvelope(outcome.result.explorerState, true);
        this.reloadItems();
      } else if (outcome.kind === 'conflict') {
        let reloaded = false;
        try {
          reloaded = await this.reloadSharedExplorerStateAndItems();
        } catch (error) {
          console.error('Failed to reload after item parameter upload conflict', error);
        }
        if (!this.destroyed) this.imports.finishConflict(outcome, reloaded);
      }
    } finally {
      this.imports.finishOperation(outcome);
    }
  }

  openClearEmpiricalDifficultiesDialog() {
    this.rememberFocusBeforeOverlay();
    this.showClearEmpiricalDifficultiesDialog = true;
    this.clearEmpiricalDifficultiesBusy = false;
    this.clearEmpiricalDifficultiesError = '';
  }

  closeClearEmpiricalDifficultiesDialog() {
    if (this.clearEmpiricalDifficultiesBusy) return;
    this.showClearEmpiricalDifficultiesDialog = false;
    this.clearEmpiricalDifficultiesError = '';
    this.restoreFocusAfterOverlayClose();
  }

  confirmClearEmpiricalDifficulties() {
    if (this.clearEmpiricalDifficultiesBusy) return;
    this.clearEmpiricalDifficultiesBusy = true;
    this.clearEmpiricalDifficultiesError = '';
    this.draft.lastDraftOperationError = '';

    this.api
      .clearEmpiricalDifficulties(this.acpId, {
        draft: true,
        baseVersion: this.explorerVersion,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          if (result.explorerState) {
            this.applySharedExplorerEnvelope(result.explorerState, true);
          }
          this.reloadItems();
          this.clearEmpiricalDifficultiesBusy = false;
          this.closeClearEmpiricalDifficultiesDialog();
        },
        error: (err) => {
          console.error(err);
          this.clearEmpiricalDifficultiesBusy = false;
          if (err?.status === 409) {
            this.clearEmpiricalDifficultiesError =
              'Konflikt beim Speichern des Entwurfs. Der Explorer wurde neu geladen.';
            this.draft.lastDraftOperationError = this.clearEmpiricalDifficultiesError;
            void this.reloadSharedExplorerStateAndItems();
            return;
          }
          this.clearEmpiricalDifficultiesError =
            err?.error?.message || 'Fehler beim Löschen der Itemschwierigkeiten.';
          this.draft.lastDraftOperationError = this.clearEmpiricalDifficultiesError;
        },
      });
  }

  openRenumberDialog() {
    if (this.isRenumberingBlocked()) return;
    this.rememberFocusBeforeOverlay();
    this.showRenumberDialog = true;
    this.renumberBusy = false;
    this.renumberError = '';
    this.numberingSuccessMessage = '';
  }

  closeRenumberDialog() {
    if (this.renumberBusy) return;
    this.showRenumberDialog = false;
    this.renumberError = '';
    this.restoreFocusAfterOverlayClose();
  }

  confirmRenumber() {
    if (this.renumberBusy) return;
    if (this.isRenumberingBlocked()) {
      this.renumberError = this.getRenumberingBlockedMessage();
      return;
    }
    this.renumberBusy = true;
    this.renumberError = '';

    this.api
      .recalculateItemRowNumbers(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          const count = Number(result?.renumberedCount) || 0;
          this.renumberBusy = false;
          this.closeRenumberDialog();
          this.numberingSuccessMessage = `${
            count === 1
              ? 'Eine Referenznummer im vollständigen Itembestand wurde'
              : `${count} Referenznummern im vollständigen Itembestand wurden`
          } neu vergeben. ${this.filteredItems.length} Zeilen werden aktuell angezeigt.`;
          this.reloadItems();
        },
        error: (error) => {
          console.error('Failed to recalculate item row numbers', error);
          this.renumberBusy = false;
          this.renumberError =
            error?.error?.message || 'Die Nummerierung konnte nicht neu berechnet werden.';
          if (error?.status === 409) {
            void this.reloadSharedExplorerStateAndItems();
          }
        },
      });
  }

  isRenumberingBlocked(): boolean {
    return (
      !this.latestExplorerState ||
      this.perspectiveSwitchBusy ||
      this.itemListLoading ||
      this.hasPendingDraftChanges() ||
      this.explorerUiStatus === 'SAVING'
    );
  }

  getRenumberingActionTitle(): string {
    return this.isRenumberingBlocked()
      ? this.getRenumberingBlockedMessage()
      : 'Referenznummern im vollständigen Itembestand neu vergeben';
  }

  getRenumberingBlockedMessage(): string {
    if (!this.latestExplorerState) {
      return 'Bitte warten Sie, bis der Explorer-Status geladen wurde.';
    }
    if (this.perspectiveSwitchBusy) {
      return 'Bitte warten Sie, bis der Ansichtswechsel abgeschlossen wurde.';
    }
    if (this.itemListLoading) {
      return 'Bitte warten Sie, bis die Item-Liste geladen wurde.';
    }
    return this.explorerUiStatus === 'SAVING'
      ? 'Bitte warten Sie, bis die Explorer-Änderungen gespeichert wurden.'
      : 'Bitte speichern oder verwerfen Sie den Entwurf, bevor Sie Referenznummern neu vergeben.';
  }

  getSortIndicator(field: string): string {
    return this.table.getSortIndicator(field);
  }

  getMetaSortIndicator(colId: string): string {
    return this.table.getMetaSortIndicator(colId);
  }

  resetPlayer() {
    this.previewCoordinator.cancel();
    this.player.reset();
    this.previewUserFacingMessage = '';
    this.coding.correctSolutionPrefill = {
      status: 'unavailable',
      responses: [],
      message: 'Die Player-Daten für die Musterlösung werden geladen.',
    };
  }

  private startItemListSlowTimer(): void {
    this.clearItemListSlowTimer();
    this.itemListSlowTimer = setTimeout(() => {
      this.itemListSlowTimer = null;
      this.itemListSlow = true;
    }, 1500);
  }

  private clearItemListSlowTimer(): void {
    if (this.itemListSlowTimer) {
      clearTimeout(this.itemListSlowTimer);
      this.itemListSlowTimer = null;
    }
    this.itemListSlow = false;
  }

  private startPreviewSlowTimer(phase: string): void {
    this.clearPreviewSlowTimer();
    this.previewLoadPhase = phase;
    this.previewSlowTimer = setTimeout(() => {
      this.previewSlowTimer = null;
      this.previewSlow = true;
    }, 1500);
  }

  private clearPreviewSlowTimer(): void {
    if (this.previewSlowTimer) {
      clearTimeout(this.previewSlowTimer);
      this.previewSlowTimer = null;
    }
    this.previewSlow = false;
    this.previewLoadPhase = '';
  }

  private cancelPlayerReadyTiming(): void {
    if (!this.playerReadyTiming) return;
    this.diagnostics?.finish(this.playerReadyTiming, { outcome: 'cancelled' });
    this.playerReadyTiming = null;
  }

  // --- Item Selection ---
  selectItem(readonlyItem: ReadonlyExplorerItem, index: number) {
    const item = readonlyItem as ExplorerItem;
    if (!this.selectingInitialCommentTarget) {
      this.commentThreadInitiallyOpen = false;
    }
    item.rowKey = this.getStableRowKey(item);
    if (
      this.selectedItem &&
      this.getStableRowKey(this.selectedItem) === this.getStableRowKey(item) &&
      (!this.showExplorerItemPanel || this.previewCoordinator.status.kind !== 'idle')
    ) {
      this.selectedIndex = index;
      return;
    }

    this.cancelPlayerReadyTiming();
    if (!this.showExplorerItemPanel) {
      this.selectedItem = item;
      this.selectedIndex = index;
      this.resetPlayer();
      this.clearPreviewSlowTimer();
      return;
    }
    const reuseLoadedUnit = this.hasReusablePreviewUnit(item);
    this.selectedItem = item;
    this.selectedIndex = index;
    if (!reuseLoadedUnit) {
      this.resetPlayer();
    }
    this.player.beginSelection(true);
    this.startPreviewSlowTimer(
      reuseLoadedUnit ? 'gespeicherter Zustand' : 'Aufgabendaten, Player und Definition',
    );

    this.previewUserFacingMessage = '';
    this.coding.correctSolutionPrefill = {
      status: 'unavailable',
      responses: [],
      message: 'Die Kodierung und Player-Daten für die Musterlösung werden geladen.',
    };

    // Load unit metadata and coding scheme from cache
    this.currentUnitMetadata = this.unitMetadataCache[item.unitId] || [];
    this.coding.setScheme(this.codingSchemeCache[item.unitId] || null);
    this.syncPreviewTargetResolution(item);
    this.refreshCorrectSolutionPrefill();

    if (!this.canPreviewItem(item) && !this.itemExplorerConditionalVisibilityEnabled) {
      this.previewCoordinator.markUnavailable(this.getMissingPreviewTargetMessage());
      this.clearPreviewSlowTimer();
      return;
    }

    this.loadPreviewSelection(item, reuseLoadedUnit);
  }

  private loadPreviewSelection(item: ExplorerItem, reuseUnit: boolean): void {
    this.previewCoordinator.select({
      acpId: this.acpId,
      perspective: this.getPerspectiveForViewerRequests(),
      item,
      itemList: this.filteredItems.map((candidate) => ({
        itemId: candidate.itemId,
        unitId: candidate.unitId,
        rowKey: this.getStableRowKey(candidate),
      })),
      reuseUnit,
    });
  }

  private applyPreviewResult(result: ItemExplorerPreviewResult): void {
    if (
      this.destroyed ||
      !this.showExplorerItemPanel ||
      !this.selectedItem ||
      this.getStableRowKey(result.item) !== this.getStableRowKey(this.selectedItem)
    ) {
      return;
    }

    this.clearPreviewSlowTimer();
    if (!result.reuseUnit && result.assets) {
      this.applyPreviewAssets(result.assets);
    }
    this.applyResponseStateResult(result.responseState);
    this.refreshCorrectSolutionPrefill();

    if (this.previewCoordinator.status.kind !== 'ready') {
      this.previewUserFacingMessage =
        this.previewCoordinator.status.kind === 'error'
          ? this.previewCoordinator.status.reason
          : '';
      return;
    }

    this.playerReadyTiming = this.hasReusablePreviewUnit(result.item)
      ? this.diagnostics?.start('player-ready') || null
      : null;
    this.startPlayerIfReady();
  }

  private applyPreviewAssets(assets: NonNullable<ItemExplorerPreviewResult['assets']>): void {
    this.player.applyAssets({
      unit: assets.unit,
      srcDoc:
        assets.unit && assets.playerHtml !== null
          ? this.sanitizer.bypassSecurityTrustHtml(rewriteGeoGebraAssetUrls(assets.playerHtml))
          : null,
      definition: assets.definition,
    });
    this.syncPreviewTargetResolution(this.selectedItem);
  }

  private applyResponseStateResult(result: any): void {
    this.player.applyResponseState(result?.state?.responseData ?? null, !!result?.isFallback);
  }

  private hasReusablePreviewUnit(item: ExplorerItem): boolean {
    return this.unit?.id === item.unitId && !!this.playerSrcDoc && !!this.definitionContent;
  }

  // --- Response State ---
  saveCurrentResponseState() {
    this.rememberFocusBeforeOverlay();
    if (this.syntheticPreviewState) {
      this.confirmDialogError =
        'Ein vorbereiteter Vorschauzustand kann nicht als Antwortzustand gespeichert werden.';
      this.showSaveConfirmDialog = true;
      return;
    }
    if (this.isCorrectSolutionActive) {
      this.confirmDialogError =
        'Die Musterlösung ist nur eine Vorschau und kann nicht als Player-Eingabe gespeichert werden. Blenden Sie sie zuerst aus.';
      this.showSaveConfirmDialog = true;
      return;
    }
    if (this.previewCoordinator.status.kind !== 'ready') {
      this.confirmDialogError =
        'Der Zustand des ausgewählten Items wird noch geladen. Bitte versuchen Sie es gleich erneut.';
      this.showSaveConfirmDialog = true;
      return;
    }
    if (!this.selectedItem || !this.currentResponseData) {
      this.confirmDialogError =
        'Kein Zustand zum Speichern vorhanden. Bitte füllen Sie zuerst das Formular aus.';
      this.showSaveConfirmDialog = true;
      return;
    }
    this.confirmDialogError = '';
    this.showSaveConfirmDialog = true;
  }

  confirmSaveResponseState() {
    if (this.syntheticPreviewState) {
      this.confirmDialogError =
        'Ein vorbereiteter Vorschauzustand kann nicht als Antwortzustand gespeichert werden.';
      return;
    }
    if (
      !this.selectedItem ||
      !this.currentResponseData ||
      this.isCorrectSolutionActive ||
      !this.player.isAnswerSession ||
      !this.player.activePlayerSessionId ||
      this.previewCoordinator.status.kind !== 'ready'
    ) {
      this.confirmDialogError =
        'Der Zustand des ausgewählten Items ist noch nicht vollständig geladen.';
      return;
    }

    this.confirmDialogState = 'saving';
    const responseData = this.currentResponseData;
    const responseItem = this.selectedItem;
    const responseSession = this.player.responseSessionToken;

    this.api
      .saveResponseState(
        this.acpId,
        this.selectedItem.itemId,
        this.selectedItem.unitId,
        responseData,
        this.selectedItem.rowKey,
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (
            this.selectedItem !== responseItem ||
            this.player.responseSessionToken !== responseSession
          )
            return;
          this.player.markResponseStateSaved(responseData);
          this.confirmDialogState = 'idle';
          this.closeSaveConfirmDialog();
        },
        error: (err) => {
          if (
            this.selectedItem !== responseItem ||
            this.player.responseSessionToken !== responseSession
          )
            return;
          console.error('Error saving response state:', err);
          this.confirmDialogState = 'idle';
          this.confirmDialogError = 'Fehler beim Speichern des Zustands.';
        },
      });
  }

  resetResponseState() {
    if (!this.selectedItem) return;
    this.rememberFocusBeforeOverlay();
    this.confirmDialogError = '';
    this.showDeleteConfirmDialog = true;
  }

  confirmDeleteResponseState() {
    if (!this.selectedItem) return;

    this.confirmDialogState = 'deleting';
    const responseItem = this.selectedItem;
    const responseSession = this.player.responseSessionToken;

    this.api
      .deleteResponseState(
        this.acpId,
        this.selectedItem.itemId,
        this.selectedItem.unitId,
        this.selectedItem.rowKey,
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (
            this.selectedItem !== responseItem ||
            this.player.responseSessionToken !== responseSession
          )
            return;
          this.player.clearResponseState();
          this.confirmDialogState = 'idle';
          this.closeDeleteConfirmDialog();
        },
        error: (err) => {
          if (
            this.selectedItem !== responseItem ||
            this.player.responseSessionToken !== responseSession
          )
            return;
          console.error('Error deleting response state:', err);
          this.confirmDialogState = 'idle';
          this.confirmDialogError = 'Fehler beim Löschen des Zustands.';
        },
      });
  }

  loadAllResponseStates() {
    this.rememberFocusBeforeOverlay();
    this.api
      .getAllResponseStates(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (states) => {
          this.allResponseStates = states;
          this.showRawDataOverlay = true;
        },
        error: (err) => {
          console.error('Error loading response states:', err);
          alert('Fehler beim Laden der gespeicherten Zustände.');
        },
      });
  }

  navigateItem(delta: number) {
    this.selectFilteredItemAt(this.selectedIndex + delta, true);
  }

  toggleCorrectSolution(): void {
    if (!this.selectedItem) return;

    const wasActive = this.isCorrectSolutionActive;
    this.correctSolutionRequested = !this.correctSolutionRequested;
    const isActive = this.isCorrectSolutionActive;
    if (!wasActive && isActive) this.player.captureAnswersForSolution();

    if (wasActive === isActive || this.previewCoordinator.status.kind !== 'ready') return;
    this.startPlayerIfReady();
  }

  onPreviewTargetSelectionChange() {
    this.coding.customPreviewTargetDraft = '';
    this.updatePreviewTargetSelection(this.selectedPreviewTargetId);
  }

  applyCustomPreviewTarget() {
    const customTarget = String(this.customPreviewTargetDraft || '').trim();
    if (!customTarget) {
      if (this.hasStoredPreviewTargetOverride) {
        this.resetPreviewTargetSelection();
      }
      return;
    }

    this.coding.selectedPreviewTargetId = '';
    this.updatePreviewTargetSelection(customTarget);
  }

  resetPreviewTargetSelection() {
    this.coding.selectedPreviewTargetId = '';
    this.coding.customPreviewTargetDraft = '';
    this.updatePreviewTargetSelection('');
  }

  private updatePreviewTargetSelection(targetId: string) {
    this.previewUserFacingMessage = '';
    if (!this.selectedItem) {
      return;
    }

    this.persistPreviewTargetSelection(this.selectedItem, targetId);
    this.syncPreviewTargetResolution(this.selectedItem);

    if (!this.canPreviewItem(this.selectedItem)) {
      this.clearPreviewSlowTimer();
      this.cancelPlayerReadyTiming();
      this.previewCoordinator.markUnavailable(this.getMissingPreviewTargetMessage());
      return;
    }

    const previewStatus = this.previewCoordinator.status.kind;
    if (
      previewStatus !== 'loading-unit' &&
      previewStatus !== 'loading-response' &&
      previewStatus !== 'ready'
    ) {
      this.reloadPreviewAfterTargetChange(this.selectedItem);
      return;
    }

    if (previewStatus === 'loading-unit' || previewStatus === 'loading-response') {
      return;
    }
    this.previewCoordinator.markReady(this.selectedItem);
    this.startPlayerIfReady();
  }

  private reloadPreviewAfterTargetChange(item: ExplorerItem): void {
    const reuseLoadedUnit = this.hasReusablePreviewUnit(item);

    this.cancelPlayerReadyTiming();
    if (!reuseLoadedUnit) {
      this.resetPlayer();
    }
    this.player.beginSelection();
    this.startPreviewSlowTimer(
      reuseLoadedUnit ? 'gespeicherter Zustand' : 'Aufgabendaten, Player und Definition',
    );
    this.loadPreviewSelection(item, reuseLoadedUnit);
  }

  onPlayerLoaded(): void {
    this.player.onPlayerLoaded();
    this.startPlayerIfReady();
  }

  onPagingModeChange(): void {
    this.player.onPagingModeChange();
  }

  handlePlayerMessage(msg: unknown): void {
    this.player.handlePlayerMessage(msg, {
      ready: this.previewCoordinator.status.kind === 'ready',
      solutionActive: this.isCorrectSolutionActive,
    });
  }

  private startPlayerIfReady(): void {
    if (!this.selectedItem || this.previewCoordinator.status.kind !== 'ready') return;
    const target = this.getEffectivePlayerTarget(this.selectedItem);
    const result = this.player.start({
      item: this.selectedItem,
      rowKey: this.getStableRowKey(this.selectedItem),
      target,
      printLabels: this.pagingMode === 'print-ids' ? this.buildPrintLabelOverrides() : {},
      solution: this.isCorrectSolutionActive ? this.correctSolutionPrefill : null,
    });
    if (result.kind === 'waiting') return;
    if (result.kind === 'unavailable') {
      this.previewUserFacingMessage =
        result.reason === 'unresolved-visibility' ? result.message : '';
      this.previewCoordinator.markUnavailable(
        result.reason === 'unresolved-visibility'
          ? result.message
          : result.reason === 'missing-target'
            ? this.getMissingPreviewTargetMessage()
            : `Das Player-Ziel "${target}" kommt in der Aufgabendefinition nicht vor.`,
      );
    }
    this.diagnostics?.finish(this.playerReadyTiming, {
      outcome: result.kind === 'unavailable' ? result.reason : 'started',
    });
    this.playerReadyTiming = null;
  }

  private getPersistedOrDefaultPlayerTarget(item?: ReadonlyExplorerItem | null): string {
    const storedTarget = this.getStoredPreviewTargetId(item);
    if (storedTarget) {
      return storedTarget;
    }
    return this.getPlayerTarget(item);
  }

  getPlayerTarget(item?: ReadonlyExplorerItem | null): string {
    return this.coding.getPlayerTarget(item);
  }

  private getItemCodingTarget(item?: ReadonlyExplorerItem | null): string {
    return this.coding.getItemCodingTarget(item);
  }

  private getEffectivePlayerTarget(item?: ReadonlyExplorerItem | null): string {
    if (!item) return '';
    if (
      this.selectedItem &&
      this.getStableRowKey(this.selectedItem) === this.getStableRowKey(item)
    ) {
      return this.selectedPreviewTarget;
    }
    return this.getPersistedOrDefaultPlayerTarget(item);
  }

  canPreviewItem(item?: ReadonlyExplorerItem | null): boolean {
    return (
      this.getEffectivePlayerTarget(item).length > 0 ||
      !!(
        item &&
        this.itemExplorerConditionalVisibilityEnabled &&
        this.player.previewMode === 'flow'
      )
    );
  }

  private syncPreviewTargetResolution(item?: ReadonlyExplorerItem | null) {
    return this.coding.syncPreviewTargetResolution(this.definitionContent, item);
  }

  private findPreviewTargetOption(
    targetId: string,
    options: PreviewTargetOption[],
  ): PreviewTargetOption | undefined {
    return this.coding.findPreviewTargetOption(this.definitionContent, targetId, options);
  }

  private refreshCorrectSolutionPrefill(): void {
    return this.coding.refreshCorrectSolutionPrefill(this.selectedItem, this.definitionContent);
  }

  private buildPrintLabelOverrides(): Record<string, string> {
    return this.coding.buildPrintLabelOverrides(
      this.definitionContent,
      this.items,
      String(this.unit?.id || this.selectedItem?.unitId || '').trim(),
    );
  }

  private getStoredPreviewTargetId(item?: ReadonlyExplorerItem | null): string {
    return this.coding.getStoredPreviewTargetId(item);
  }

  private persistPreviewTargetSelection(item: ExplorerItem, targetId: string) {
    const previousTargetId = this.getStoredPreviewTargetId(item);
    const normalizedTargetId = String(targetId || '').trim();
    if (previousTargetId === normalizedTargetId) {
      return;
    }
    item.previewTargetId = normalizedTargetId || undefined;

    if (!this.canEditExplorer || this.draft.patchSuppressed) {
      return;
    }

    this.queueItemPropertyPatch(
      item,
      'PREVIEW_TARGET_CHANGED',
      {
        [this.previewTargetItemPropertyKey]: normalizedTargetId,
      },
      true,
    );
  }

  private updateItemExclusion(item: ExplorerItem, excluded: boolean) {
    item.excluded = excluded ? true : undefined;

    if (!this.canEditExplorer || this.draft.patchSuppressed) {
      return;
    }

    this.queueItemPropertyPatch(
      item,
      'ITEM_EXCLUSION_CHANGED',
      {
        [this.excludedItemPropertyKey]: excluded,
      },
      true,
    );
  }

  private queueItemPropertyPatch(
    item: ExplorerItem,
    changeType: string,
    propertyPatch: Record<string, unknown>,
    flushImmediately = false,
  ) {
    const itemKey = this.getExistingItemStateKey(item) || this.getPrimaryItemStateKey(item);
    if (!itemKey) {
      return;
    }

    this.queueDraftPatch(
      changeType,
      {
        itemPropertiesPatch: {
          [itemKey]: propertyPatch,
        },
      },
      flushImmediately,
    );
  }

  private getPrimaryItemStateKey(item?: ExplorerItem | null): string {
    if (!item) return '';

    const resolvedItemId = item.itemId?.startsWith(`${item.unitId}_`)
      ? item.itemId
      : `${item.unitId}_${item.itemId}`;

    for (const candidate of [item.rowKey, item.uuid, resolvedItemId, item.itemId]) {
      const key = String(candidate || '').trim();
      if (key) {
        return key;
      }
    }

    return '';
  }

  private getExistingItemStateKey(item?: ExplorerItem | null): string {
    if (!item) return '';

    const activeState = this.getExplorerStateForCurrentPerspective();
    const itemProperties = this.isRecord(activeState?.itemProperties)
      ? (activeState.itemProperties as Record<string, Record<string, unknown>>)
      : {};

    for (const key of this.getItemStateKeys(item)) {
      if (this.isRecord(itemProperties[key])) {
        return key;
      }
    }

    return '';
  }

  private getMissingPreviewTargetMessage(): string {
    return 'Für dieses Item ist in den Explorer-Daten keine Player-Variable hinterlegt. Sie können ein manuelles Sprungziel setzen.';
  }

  // --- Personal item working data ---
  get showPersonalItemData(): boolean {
    this.configurePersonalData();
    return this.personalData.showPersonalItemData;
  }

  get canEditPersonalItemData(): boolean {
    this.configurePersonalData();
    return this.personalData.canEditPersonalItemData;
  }

  get canChangePersonalItemData(): boolean {
    this.configurePersonalData();
    return this.personalData.canChangePersonalItemData;
  }

  get canExportAllPersonalItemData(): boolean {
    this.configurePersonalData();
    return this.personalData.canExportAllPersonalItemData;
  }

  retryPersonalItemDataLoad() {
    this.configurePersonalData();
    return this.personalData.retryPersonalItemDataLoad();
  }

  setPersonalItemCategory(rowKey: string, value: unknown) {
    this.configurePersonalData();
    return this.personalData.setPersonalItemCategory(rowKey, value);
  }

  setPersonalItemNote(rowKey: string, value: unknown) {
    this.configurePersonalData();
    return this.personalData.setPersonalItemNote(rowKey, value);
  }

  addPersonalItemTagToRow(rowKey: string, event: Event) {
    this.configurePersonalData();
    return this.personalData.addPersonalItemTagToRow(rowKey, event);
  }

  removePersonalItemTagFromRow(rowKey: string, tag: string) {
    this.configurePersonalData();
    return this.personalData.removePersonalItemTagFromRow(rowKey, tag);
  }

  availablePersonalTagsForRow(rowKey: string): PersonalItemTagConfig[] {
    return this.personalData.availablePersonalTagsForRow(rowKey);
  }

  getPersonalTagColor(label: string): string {
    return this.personalData.getPersonalTagColor(label);
  }

  flushPersonalItemDataSave() {
    return this.personalData.flushPersonalItemDataSave();
  }

  async exportPersonalItemDataXlsx() {
    this.configurePersonalData();
    return this.personalData.exportPersonalItemDataXlsx(
      this.filteredItems.map((item) => this.getStableRowKey(item)),
    );
  }

  async exportAllPersonalItemDataCsv(scope: 'all' | 'collection' = 'all') {
    const collection = scope === 'collection' ? this.activeItemCollection : null;
    if (
      scope === 'collection' &&
      (!this.enableItemCollections ||
        !collection ||
        this.collectionBusy ||
        this.collectionLoadState !== 'loaded')
    )
      return;
    this.configurePersonalData();
    return this.personalData.exportAllPersonalItemDataCsv(collection);
  }

  retryPersonalItemDataSave() {
    this.configurePersonalData();
    return this.personalData.retryPersonalItemDataSave();
  }

  openDiscardPersonalItemDataDialog() {
    this.configurePersonalData();
    const result = this.personalData.openDiscardPersonalItemDataDialog();
    if (this.showDiscardPersonalItemDataDialog) this.rememberFocusBeforeOverlay();
    return result;
  }

  closeDiscardPersonalItemDataDialog() {
    this.configurePersonalData();
    const result = this.personalData.closeDiscardPersonalItemDataDialog();
    this.restoreFocusAfterOverlayClose();
    return result;
  }

  confirmDiscardPersonalItemDataChanges() {
    this.configurePersonalData();
    const result = this.personalData.confirmDiscardPersonalItemDataChanges();
    this.restoreFocusAfterOverlayClose();
    return result;
  }

  private syncPersonalItemDataSession() {
    this.configurePersonalData();
    return this.personalData.syncPersonalItemDataSession();
  }

  private flushPersonalItemDataSaveAndWait(): Promise<boolean> {
    this.configurePersonalData();
    return this.personalData.flushPersonalItemDataSaveAndWait();
  }

  private hasPendingPersonalItemDataChanges(): boolean {
    return this.personalData.hasPendingPersonalItemDataChanges();
  }

  // --- Shared ACP tags ---
  addItemTag(uuid: string, event: Event) {
    if (!this.canEditExplorer) return;
    const tag = (event.target as HTMLSelectElement).value;
    if (!tag) return;
    if (!this.itemTags[uuid]) this.itemTags[uuid] = [];
    if (!this.itemTags[uuid].includes(tag)) {
      this.itemTags[uuid].push(tag);
      this.saveTags();
      this.applyFilter(false);
    }
    (event.target as HTMLSelectElement).value = '';
  }

  removeItemTag(uuid: string, tag: string) {
    if (!this.canEditExplorer) return;
    if (this.itemTags[uuid]) {
      const nextTags = this.itemTags[uuid].filter((t) => t !== tag);
      this.itemTags = { ...this.itemTags, [uuid]: nextTags };
      const item = this.items.find((candidate) => candidate.rowKey === uuid);
      if (item) item.tags = [...nextTags];
      this.saveTags();
      this.applyFilter(false);
    }
  }

  addCustomTag(uuid: string, event: any) {
    if (!this.canEditExplorer) return;
    const input = event.target as HTMLInputElement;
    const tag = input.value.trim();
    if (!tag) return;
    if (!this.itemTags[uuid]) this.itemTags[uuid] = [];
    if (!this.itemTags[uuid].includes(tag)) {
      this.itemTags[uuid].push(tag);
      this.saveTags();
      this.applyFilter(false);
    }
    input.value = '';
  }

  private saveTags() {
    const normalizedTags = this.normalizeTags(this.itemTags);
    this.itemTags = normalizedTags;
    if (!this.canEditExplorer) {
      return;
    }
    this.queueDraftPatch('TAGS_CHANGED', { tags: normalizedTags });
  }

  private loadPersistedTags() {
    // Explorer uses shared ACP state; tags are loaded with the versioned item-list snapshot.
    this.applyFilter(false);
  }

  private hydrateItemTagsFromItems() {
    const tagsFromItems: Record<string, string[]> = {};
    for (const item of this.items) {
      if (item.rowKey && Array.isArray(item.tags) && item.tags.length) {
        tagsFromItems[item.rowKey] = [...item.tags];
      }
    }
    this.itemTags = tagsFromItems;
  }

  // --- Helpers ---
  extractLabel(label: any): string {
    if (!label) return '';
    if (typeof label === 'string') return label;
    if (Array.isArray(label)) {
      const de = label.find((l: any) => l.lang === 'de');
      return de?.value || label[0]?.value || '';
    }
    if (label && typeof label === 'object') {
      return label['de'] || label['value'] || JSON.stringify(label);
    }
    return '';
  }

  extractValueText(valueAsText: any): string {
    if (valueAsText === undefined || valueAsText === null) return '';
    if (typeof valueAsText === 'string') return valueAsText;
    if (typeof valueAsText === 'number') return valueAsText.toString();
    if (typeof valueAsText === 'boolean') return valueAsText ? 'Ja' : 'Nein';

    if (Array.isArray(valueAsText)) {
      const de = valueAsText.find((v: any) => v.lang === 'de');
      if (de) return de.value;
      if (valueAsText.every((v) => v && typeof v === 'object' && v.value)) {
        return valueAsText.map((v) => v.value).join(', ');
      }
      return valueAsText.map((v) => this.extractValueText(v)).join(', ');
    }
    if (typeof valueAsText === 'object') {
      return valueAsText['de'] || valueAsText['value'] || '';
    }
    return '';
  }

  getSummaryMetadata(): any[] {
    if (!this.currentUnitMetadata) return [];
    // Prefer these IDs for summary
    const priorityIds = [
      'level',
      'subject',
      'competence',
      'format',
      'time',
      'duration',
      'difficulty',
    ];
    const summary = this.currentUnitMetadata.filter((m) =>
      priorityIds.some((pid) => m.id.toLowerCase().includes(pid)),
    );
    // If no priority items found, show the first 4 entries
    if (summary.length === 0 && this.currentUnitMetadata.length > 0) {
      return this.currentUnitMetadata.slice(0, 4);
    }
    return summary.slice(0, 4);
  }

  downloadUnit() {
    const url = `/api/acp/${this.acpId}/files?unitId=${this.selectedItem?.unitId}&format=zip`;
    window.open(this.api.appendAuthToken(url), '_blank');
  }

  // --- Metadata Column Management ---
  checkUserRole() {
    this.canOpenFullUnit = false;
    this.unitViewAccessRequest?.unsubscribe();
    this.unitViewAccessRequest = this.api
      .getCapabilities(this.acpId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (access) => {
          this.canOpenFullUnit = access.canViewUnit === true;
        },
        error: () => {
          this.canOpenFullUnit = false;
        },
      });
    this.isAcpManager = this.authService.hasAcpRole(this.acpId, 'ACP_MANAGER');
    this.hasExplorerEditPermission = this.latestExplorerState?.canEdit ?? false;
    this.hasExplorerPublishPermission = this.hasExplorerEditPermission;
    this.comments.itemCommentsEnabled =
      this.comments.itemCommentsConfigured && this.authService.isLoggedIn;
    this.comments.codingCommentsEnabled =
      this.comments.codingCommentsConfigured && this.authService.isLoggedIn;
    const oidcProfileStillLoading =
      this.authService.isLoggedIn &&
      this.authService.isOidcUser &&
      this.authService.currentUser === null;
    if (this.latestExplorerState && !this.hasExplorerEditPermission && !oidcProfileStillLoading) {
      this.viewPerspective = 'read-only';
    }
    this.syncEffectiveExplorerPermissions();
  }

  async toggleReadOnlyPreview() {
    if (
      this.destroyed ||
      !this.canToggleReadOnlyPreview ||
      this.perspectiveSwitchBusy ||
      this.draft.operationBusy ||
      !this.latestExplorerState
    ) {
      return;
    }

    const nextPerspective: ItemExplorerPerspective = this.isReadOnlyPreview
      ? 'editor'
      : 'read-only';

    if (nextPerspective === 'read-only') {
      const flushed = await this.flushDraftPatch();
      if (
        !flushed ||
        this.destroyed ||
        this.draft.operationBusy ||
        this.draft.hasUnflushedChanges
      ) {
        return;
      }
    }

    this.perspectiveSwitchBusy = true;
    this.viewPerspective = nextPerspective;
    this.syncEffectiveExplorerPermissions();
    this.itemListError = '';

    await this.reloadSharedExplorerStateAndItems();
    if (this.destroyed) return;
    this.perspectiveSwitchBusy = false;
  }

  private syncEffectiveExplorerPermissions() {
    const inEditorPerspective = this.viewPerspective === 'editor';
    this.explorerEditingAllowed = this.hasExplorerEditPermission && inEditorPerspective;
    this.canPublishExplorer = this.hasExplorerPublishPermission && inEditorPerspective;
    this.configureDraft();
    this.configurePersonalData();
    if (!this.showExplorerItemPanel) {
      this.resetPlayer();
      this.clearPreviewSlowTimer();
      this.cancelPlayerReadyTiming();
    }
  }

  private getExplorerStateForCurrentPerspective(
    envelope: ItemExplorerStateEnvelope | null = this.latestExplorerState,
  ): ItemExplorerSharedState | Record<string, unknown> {
    if (!envelope) {
      return {};
    }

    const stateCandidate =
      envelope.canEdit && this.viewPerspective === 'editor'
        ? envelope.draftState
        : envelope.publishedState;

    if (this.isRecord(stateCandidate)) {
      return stateCandidate;
    }

    if (this.isRecord(envelope.activeState)) {
      return envelope.activeState;
    }

    return {};
  }

  private getPerspectiveForViewerRequests(
    envelope?: ItemExplorerStateEnvelope,
  ): ItemExplorerPerspective {
    const canEdit = envelope?.canEdit ?? this.hasExplorerEditPermission;
    return this.isReadOnlyPreview || !canEdit ? 'read-only' : 'editor';
  }

  private getItemListAccessMessage(): string {
    return 'Die Item-Liste ist für diese Ansicht nicht freigegeben.';
  }

  filterVisibleColumns(allColumns: MetadataColumn[]): MetadataColumn[] {
    return this.table.filterVisibleColumns(this.tableColumnContext(), allColumns);
  }

  isColumnVisible(column: ItemExplorerTableColumn | MetadataColumn): boolean {
    return this.table.isColumnVisible(this.tableColumnContext(), column);
  }

  getColumnWidth(column: ItemExplorerTableColumn | MetadataColumn): number {
    return this.table.getColumnWidth(column);
  }

  setColumnWidth(column: ItemExplorerTableColumn | MetadataColumn, value: unknown) {
    return this.table.setColumnWidth(this.tableColumnContext(), column, value);
  }

  private ensureTableColumnDefaults(): void {
    return this.table.ensureTableColumnDefaults(this.tableColumnContext());
  }

  isTableColumnSortable(column: ItemExplorerTableColumn): boolean {
    return this.table.isTableColumnSortable(column);
  }

  sortTableColumn(column: ItemExplorerTableColumn) {
    if (!this.isTableColumnSortable(column)) return;
    this.table.sortTableColumn(this.tableFilterContext(), column);
    this.syncSelectionAfterListMutation();
    this.saveUiPreferences();
  }

  getTableColumnSortIndicator(column: ItemExplorerTableColumn): string {
    return this.table.getTableColumnSortIndicator(column);
  }

  getTableColumnDisplayValue(
    item: ReadonlyExplorerItem,
    column: DeepReadonly<ItemExplorerTableColumn>,
  ): string {
    return this.table.getTableColumnDisplayValue(item, column);
  }

  isStickyTableColumn(
    column: DeepReadonly<ItemExplorerTableColumn>,
    _columns: ReadonlyArray<DeepReadonly<ItemExplorerTableColumn>> = this.tableColumns,
  ): boolean {
    return this.table.isStickyTableColumn(column);
  }

  getStickyTableColumnLeft(
    column: DeepReadonly<ItemExplorerTableColumn>,
    columns: ReadonlyArray<DeepReadonly<ItemExplorerTableColumn>> = this.tableColumns,
  ): number | null {
    return this.table.getStickyTableColumnLeft(column, columns, this.enableItemCollections);
  }

  private clearHiddenTableColumnFilters() {
    const visiblePersonalFilters = this.table.clearHiddenTableColumnFilters(
      this.tableColumnContext(),
    );
    this.personalData.retainVisibleColumnFilters(visiblePersonalFilters);
  }

  toggleColumnVisibility(column: ItemExplorerTableColumn | MetadataColumn) {
    return this.table.toggleColumnVisibility(this.tableColumnContext(), column);
  }

  moveColumnUp(column: ItemExplorerTableColumn | MetadataColumn) {
    return this.table.moveColumnUp(this.tableColumnContext(), column);
  }

  moveColumnDown(column: ItemExplorerTableColumn | MetadataColumn) {
    return this.table.moveColumnDown(this.tableColumnContext(), column);
  }

  canMoveTableColumn(column: DeepReadonly<ItemExplorerTableColumn>, delta: -1 | 1): boolean {
    return this.table.canMoveTableColumn(this.tableColumnContext(), column, delta);
  }

  toggleManualOrderMode() {
    this.table.toggleManualOrderMode(this.tableFilterContext(), this.items);
    this.syncSelectionAfterListMutation();
    this.saveUiPreferences();
  }

  canMoveSelectedItem(delta: number): boolean {
    return (
      this.canEditExplorer &&
      !!this.selectedItem &&
      this.table.canMoveRow(this.items, this.selectedItem.rowKey, delta)
    );
  }

  moveSelectedItem(delta: number): void {
    if (
      !this.canEditExplorer ||
      !this.selectedItem ||
      !this.table.moveRow(this.items, this.selectedItem.rowKey, delta)
    )
      return;
    this.applySort(false);
    this.queueDraftPatch('ITEM_ORDER_CHANGED', { itemOrder: [...this.itemOrder] }, true);
  }

  saveMetadataSettings(): void {
    const result = this.table.completeColumnManager(this.tableColumnContext());
    this.personalData.retainVisibleColumnFilters(result.visiblePersonalFilterKeys);
    this.applyFilter(false);
    this.restoreFocusAfterOverlayClose();
    this.queueDraftPatch('METADATA_COLUMNS_CHANGED', result.patch, true);
  }

  resetToDefault() {
    return this.table.resetToDefault(this.tableColumnContext());
  }

  toggleReferenceNumberVisibility() {
    return this.table.toggleReferenceNumberVisibility(this.tableColumnContext());
  }

  private resolveMetadataSettings(featureConfig: Record<string, any>): MetadataSettings {
    return this.table.resolveMetadataSettings(featureConfig);
  }

  private resolveConfiguredMetadataColumns(featureConfig: Record<string, any>): MetadataColumn[] {
    return this.table.resolveConfiguredMetadataColumns(featureConfig);
  }

  private buildUiPreferences(): Record<string, unknown> {
    return this.table.buildUiPreferences();
  }

  private applyUiPreferences(rawUi: unknown) {
    return this.table.applyUiPreferences(rawUi);
  }

  private saveUiPreferences() {
    if (!this.canEditExplorer || this.draft.patchSuppressed) {
      return;
    }
    this.queueDraftPatch('UI_STATE_CHANGED', {
      ui: this.buildUiPreferences(),
    });
  }

  private async confirmLeaveWithUnsavedChanges(): Promise<boolean> {
    if (this.leaveWithChangesResolver) {
      return false;
    }

    this.rememberFocusBeforeOverlay();
    this.showLeaveWithChangesDialog = true;
    this.leaveWithChangesDialogState = 'idle';
    this.leaveWithChangesDialogError = '';

    return new Promise<boolean>((resolve) => {
      this.leaveWithChangesResolver = resolve;
    });
  }

  stayOnPage() {
    if (this.leaveWithChangesDialogState !== 'idle') return;
    this.resolveLeaveWithChangesDialog(false);
  }

  async saveAndLeave() {
    if (this.leaveWithChangesDialogState !== 'idle') return;
    this.leaveWithChangesDialogState = 'saving';
    this.leaveWithChangesDialogError = '';
    const saved = await this.saveExplorerDraft(true);
    if (this.destroyed) return;
    if (saved) {
      this.resolveLeaveWithChangesDialog(true);
      return;
    }
    this.leaveWithChangesDialogState = 'idle';
    this.leaveWithChangesDialogError = this.lastDraftOperationError || 'Speichern fehlgeschlagen.';
  }

  async discardAndLeave() {
    if (this.leaveWithChangesDialogState !== 'idle') return;
    this.leaveWithChangesDialogState = 'discarding';
    this.leaveWithChangesDialogError = '';
    const discarded = await this.discardExplorerDraft(true);
    if (this.destroyed) return;
    if (discarded) {
      this.resolveLeaveWithChangesDialog(true);
      return;
    }
    this.leaveWithChangesDialogState = 'idle';
    this.leaveWithChangesDialogError = this.lastDraftOperationError || 'Verwerfen fehlgeschlagen.';
  }

  private resolveLeaveWithChangesDialog(result: boolean) {
    const resolver = this.leaveWithChangesResolver;
    this.leaveWithChangesResolver = null;
    this.showLeaveWithChangesDialog = false;
    this.leaveWithChangesDialogState = 'idle';
    this.leaveWithChangesDialogError = '';
    if (!result) {
      this.restoreFocusAfterOverlayClose();
    }
    resolver?.(result);
  }

  private async fetchSharedExplorerState(): Promise<ItemExplorerStateEnvelope | null> {
    if (this.destroyed) return null;
    try {
      const envelope = await firstValueFrom(
        this.api.getItemExplorerState(this.acpId, this.isReadOnlyPreview ? 'read-only' : 'editor'),
      );
      return this.destroyed ? null : envelope;
    } catch (error) {
      if (this.destroyed) return null;
      console.error('Failed to load shared explorer state', error);
      this.draft.explorerUiStatus = 'ERROR';
      return null;
    }
  }

  private async reloadSharedExplorerStateAndItems(
    preserveDraftOperationError = false,
  ): Promise<boolean> {
    const draftOperationError = preserveDraftOperationError ? this.lastDraftOperationError : '';
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const envelope = await this.fetchSharedExplorerState();
      if (!envelope || this.destroyed) return false;
      const outcome = await new Promise<ItemListLoadOutcome>((resolve) =>
        this.reloadItems(resolve, envelope),
      );
      if (outcome === 'loaded' && preserveDraftOperationError) {
        this.draft.lastDraftOperationError = draftOperationError;
        this.draft.explorerUiStatus = 'ERROR';
      }
      if (outcome !== 'version-mismatch') return outcome === 'loaded';
    }

    if (!this.destroyed) {
      this.itemListError =
        'Der Item-Explorer wurde während des Ladens mehrfach geändert. Bitte erneut laden.';
      this.draft.explorerUiStatus = 'ERROR';
    }
    return false;
  }

  private itemListMatchesCurrentExplorerState(
    result: unknown,
    expectedExplorerState: ItemExplorerStateEnvelope | undefined,
  ): boolean {
    if (!this.isRecord(result) || result['itemExplorerStateVersion'] === undefined) {
      // Compatibility for older cached responses and focused unit tests. The
      // current backend always supplies the version marker.
      return true;
    }
    const explorerState = expectedExplorerState || this.latestExplorerState;
    if (!explorerState) return false;

    const responseVersion = Number(result['itemExplorerStateVersion']);
    const expectedVersion =
      explorerState.canEdit && this.viewPerspective === 'editor'
        ? explorerState.version
        : explorerState.publishedVersion;
    return Number.isInteger(responseVersion) && responseVersion === expectedVersion;
  }

  private getPreviewStartFingerprint(item: ReadonlyExplorerItem | null): string {
    return JSON.stringify([
      item?.previewStart?.page ?? null,
      Object.entries(item?.previewStart?.values || {}).sort(([a], [b]) => a.localeCompare(b)),
      item?.previewStart?.context
        ? [
            item.previewStart.context.definitionKey,
            item.previewStart.context.target,
            item.previewStart.context.page,
            Object.entries(item.previewStart.context.dataParts).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ]
        : null,
    ]);
  }

  private applySharedExplorerEnvelope(envelope: ItemExplorerStateEnvelope, markSaved = false) {
    this.draft.acceptEnvelope(envelope, markSaved);
    this.hasExplorerEditPermission = envelope.canEdit;
    this.hasExplorerPublishPermission = envelope.canPublish;
    if (!this.hasExplorerEditPermission) {
      this.viewPerspective = 'read-only';
    }
    this.syncEffectiveExplorerPermissions();

    const activeState = this.getExplorerStateForCurrentPerspective(envelope);
    this.draft.setPatchSuppressed(true);
    try {
      this.applyUiPreferences((activeState as ItemExplorerSharedState).ui);
      this.itemTags = this.normalizeTags((activeState as ItemExplorerSharedState).tags);
      this.table.metadataSettings = this.resolveMetadataSettings({
        metadataColumns: (activeState as ItemExplorerSharedState).metadataColumns,
      });
      this.ensureTableColumnDefaults();
      this.table.columns = this.filterVisibleColumns(this.allColumns);
      this.clearHiddenTableColumnFilters();
      this.ensureVisibleSortField();
      this.table.itemOrder = Array.isArray((activeState as ItemExplorerSharedState).itemOrder)
        ? (activeState as ItemExplorerSharedState).itemOrder!.filter(
            (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
          )
        : [];
    } finally {
      this.draft.setPatchSuppressed(false);
    }

    const previousPreviewStart = this.getPreviewStartFingerprint(this.selectedItem);
    const previousPreviewTarget = this.selectedItem
      ? this.getEffectivePlayerTarget(this.selectedItem)
      : '';
    this.applyExplorerStateToItems();
    if (this.selectedItem) {
      this.syncPreviewTargetResolution(this.selectedItem);
      const nextPreviewTarget = this.getEffectivePlayerTarget(this.selectedItem);
      if (
        (previousPreviewTarget !== nextPreviewTarget ||
          previousPreviewStart !== this.getPreviewStartFingerprint(this.selectedItem)) &&
        this.definitionContent &&
        this.unit
      ) {
        const previewStatus = this.previewCoordinator.status.kind;
        if (previewStatus === 'ready') {
          if (this.playerFrameReady) this.startPlayerIfReady();
        } else if (previewStatus !== 'loading-unit' && previewStatus !== 'loading-response') {
          this.reloadPreviewAfterTargetChange(this.selectedItem);
        }
      }
    }
  }

  private applyExplorerStateToItems() {
    const activeState = this.getExplorerStateForCurrentPerspective();
    if (!activeState || this.items.length === 0) {
      return;
    }

    const itemProperties = this.isRecord(activeState.itemProperties)
      ? (activeState.itemProperties as Record<string, Record<string, unknown>>)
      : {};
    const stateTags = this.normalizeTags(activeState.tags);

    for (const item of this.items) {
      const keys = this.getItemStateKeys(item);
      const itemProps = this.getItemPropsForKeys(itemProperties, keys);

      const empiricalDifficultyRaw = itemProps?.['empiricalDifficulty'];
      if (empiricalDifficultyRaw === undefined || empiricalDifficultyRaw === null) {
        delete item.empiricalDifficulty;
      } else {
        const parsed = Number(empiricalDifficultyRaw);
        if (Number.isFinite(parsed)) {
          item.empiricalDifficulty = parsed;
        } else {
          delete item.empiricalDifficulty;
        }
      }

      item.previewStart = itemProps?.['previewStart'] as PreviewStart | undefined;

      const previewTargetId = String(itemProps?.[this.previewTargetItemPropertyKey] || '').trim();
      if (previewTargetId) {
        item.previewTargetId = previewTargetId;
      } else {
        delete item.previewTargetId;
      }

      if (itemProps?.[this.excludedItemPropertyKey] === true) {
        item.excluded = true;
      } else {
        delete item.excluded;
      }

      const tagsFromState = this.getTagsForKeys(stateTags, keys);
      if (tagsFromState !== null) {
        item.tags = tagsFromState;
      } else if (Array.isArray(itemProps?.['tags'])) {
        item.tags = this.normalizeTagValues(itemProps['tags']);
      } else if (!Array.isArray(item.tags)) {
        item.tags = [];
      }
    }

    this.hydrateItemTagsFromItems();
    if (Object.keys(stateTags).length) {
      this.itemTags = { ...this.itemTags, ...stateTags };
    }

    this.table.reconcileItemOrder(this.items);

    this.table.hasEmpiricalDifficulty = this.items.some(
      (item: any) => item.empiricalDifficulty !== undefined && item.empiricalDifficulty !== null,
    );
    this.reconcileMeanTaskDifficultyState();
    this.applyFilter(false);
  }

  private reconcileMeanTaskDifficultyState(): void {
    if (this.table.reconcileMeanTaskDifficultyState(this.items)) this.saveUiPreferences();
  }

  private getItemStateKeys(item: ExplorerItem): string[] {
    const keys = new Set<string>();
    const resolvedItemId = item.itemId?.startsWith(`${item.unitId}_`)
      ? item.itemId
      : `${item.unitId}_${item.itemId}`;

    for (const candidate of [item.rowKey, item.uuid, resolvedItemId, item.itemId]) {
      const key = String(candidate || '').trim();
      if (key) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }

  private getItemPropsForKeys(
    itemProperties: Record<string, Record<string, unknown>>,
    keys: string[],
  ): Record<string, unknown> | null {
    const merged: Record<string, unknown> = {};
    let found = false;
    for (const key of [...keys].reverse()) {
      if (this.isRecord(itemProperties[key])) {
        Object.assign(merged, itemProperties[key]);
        found = true;
      }
    }
    return found ? merged : null;
  }

  private getTagsForKeys(tagsMap: Record<string, string[]>, keys: string[]): string[] | null {
    for (const key of keys) {
      const tags = tagsMap[key];
      if (Array.isArray(tags)) {
        return this.normalizeTagValues(tags);
      }
    }
    return null;
  }

  private normalizeTagValues(values: unknown[]): string[] {
    return Array.from(
      new Set(
        values.map((value) => String(value || '').trim()).filter((value) => value.length > 0),
      ),
    );
  }

  hasPendingDraftChanges(): boolean {
    return this.draft.hasPendingDraftChanges();
  }

  openSavePreviewDialog() {
    this.configureDraft();
    this.draft.openSavePreviewDialog();
    if (this.showSavePreviewDialog) this.rememberFocusBeforeOverlay();
  }

  cancelSavePreviewDialog() {
    this.configureDraft();
    this.draft.cancelSavePreviewDialog();
    this.restoreFocusAfterOverlayClose();
  }

  confirmSaveExplorerDraft() {
    this.draft.showSavePreviewDialog = false;
    void this.saveExplorerDraft(true);
  }

  openDiscardExplorerDraftDialog() {
    this.configureDraft();
    this.draft.openDiscardExplorerDraftDialog();
    if (this.showDiscardDraftDialog) this.rememberFocusBeforeOverlay();
  }

  closeDiscardDraftDialog() {
    this.configureDraft();
    this.draft.closeDiscardDraftDialog();
    if (!this.showDiscardDraftDialog) this.restoreFocusAfterOverlayClose();
  }

  async confirmDiscardDraftDialog() {
    if (this.discardDraftDialogBusy) return;
    this.draft.discardDraftDialogBusy = true;
    this.draft.discardDraftDialogError = '';
    const discarded = await this.discardExplorerDraft(true);
    if (this.destroyed) return;
    this.draft.discardDraftDialogBusy = false;
    if (discarded) {
      this.closeDiscardDraftDialog();
      return;
    }
    this.draft.discardDraftDialogError =
      this.lastDraftOperationError || 'Entwurfsänderungen konnten nicht verworfen werden.';
  }

  async saveExplorerDraft(force = false): Promise<boolean> {
    if (this.destroyed || !this.canPublishExplorer || this.draft.operationBusy) return false;
    if (!force) {
      this.openSavePreviewDialog();
      return false;
    }
    this.configureDraft();
    try {
      const result = await this.draft.saveExplorerDraft();
      const saved = await this.applyDraftResult(result);
      if (
        saved &&
        !this.destroyed &&
        result.kind === 'applied' &&
        this.draft.canApplyEnvelope(result.envelope)
      ) {
        this.reloadItems();
        if (!this.showLeaveWithChangesDialog) this.restoreFocusAfterOverlayClose();
      }
      return saved && !this.draft.hasUnflushedChanges;
    } finally {
      this.draft.finishOperation();
    }
  }

  async discardExplorerDraft(skipConfirm = false): Promise<boolean> {
    if (this.destroyed || !this.canPublishExplorer || this.draft.operationBusy) return false;
    if (!skipConfirm) {
      this.openDiscardExplorerDraftDialog();
      return false;
    }
    this.configureDraft();
    try {
      const saved = await this.applyDraftResult(await this.draft.discardExplorerDraft());
      if (saved && !this.destroyed) {
        this.reloadItems();
        if (!this.showLeaveWithChangesDialog) this.restoreFocusAfterOverlayClose();
      }
      return saved && !this.draft.hasUnflushedChanges;
    } finally {
      this.draft.finishOperation();
    }
  }

  showHistory() {
    this.rememberFocusBeforeOverlay();
    this.showHistoryOverlay = true;
    this.historyLoading = true;
    this.historyError = '';
    this.api
      .getItemExplorerChanges(this.acpId, 300)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (entries) => {
          this.historyEntries = entries || [];
          this.historyLoading = false;
        },
        error: (error) => {
          console.error('Failed to load history', error);
          this.historyLoading = false;
          this.historyError = 'Änderungsverlauf konnte nicht geladen werden.';
        },
      });
  }

  openCodingOverlay() {
    if (!this.showExplorerItemPanel) return;
    this.rememberFocusBeforeOverlay();
    this.coding.codingSearchText = '';
    this.showOverlay = 'coding';
  }

  closeCodingOverlay() {
    if (this.showOverlay !== 'coding') {
      return;
    }
    this.showOverlay = null;
    this.restoreFocusAfterOverlayClose();
  }

  openColumnManager() {
    if (!this.isHeaderActionVisible('columnManager') || this.showColumnManager) return;
    this.rememberFocusBeforeOverlay();
    this.table.openColumnManager();
  }

  closeColumnManager() {
    if (!this.showColumnManager) return;
    this.table.closeColumnManager(this.tableColumnContext());
    this.restoreFocusAfterOverlayClose();
  }

  closeSaveConfirmDialog() {
    if (this.confirmDialogState !== 'idle') {
      return;
    }
    this.showSaveConfirmDialog = false;
    this.confirmDialogError = '';
    this.restoreFocusAfterOverlayClose();
  }

  closeDeleteConfirmDialog() {
    if (this.confirmDialogState !== 'idle') {
      return;
    }
    this.showDeleteConfirmDialog = false;
    this.confirmDialogError = '';
    this.restoreFocusAfterOverlayClose();
  }

  closeRawDataOverlay() {
    if (!this.showRawDataOverlay) {
      return;
    }
    this.showRawDataOverlay = false;
    this.restoreFocusAfterOverlayClose();
  }

  closeHistoryOverlay() {
    if (!this.showHistoryOverlay) {
      return;
    }
    this.showHistoryOverlay = false;
    this.restoreFocusAfterOverlayClose();
  }

  getItemRowId(item: ReadonlyExplorerItem): string {
    const rawId = this.getStableRowKey(item);
    return `item-explorer-row-${String(rawId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  exportHistoryCsv() {
    if (!this.filteredHistoryEntries.length) {
      return;
    }

    const escapeCsv = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Zeit', 'Nutzer', 'Rolle', 'Aktion', 'Draft-Version', 'Published-Version', 'Diff'],
      ...this.filteredHistoryEntries.map((entry) => [
        new Date(entry.createdAt).toISOString(),
        entry.actorUsername || '',
        entry.actorRole || '',
        entry.changeType || '',
        entry.draftVersion ?? '',
        entry.publishedVersion ?? '',
        JSON.stringify(entry.diff || {}),
      ]),
    ];

    const content = rows.map((row) => row.map((cell) => escapeCsv(cell)).join(';')).join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `item-explorer-history-${this.acpId}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  private selectFilteredItemAt(index: number, shouldScroll = false) {
    if (this.filteredItems.length === 0) {
      this.clearSelectedItem();
      return;
    }

    const targetIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));
    this.selectItem(this.filteredItems[targetIndex], targetIndex);
    if (shouldScroll) {
      this.scrollActiveRowIntoView();
    }
  }

  private getKeyboardNavigationIndex(delta: number): number {
    const currentIndex = this.getSelectedFilteredIndex();
    if (currentIndex === -1) {
      return delta < 0 ? this.filteredItems.length - 1 : 0;
    }
    return currentIndex + delta;
  }

  private getSelectedFilteredIndex(): number {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
      const itemAtIndex = this.filteredItems[this.selectedIndex];
      if (
        itemAtIndex &&
        this.selectedItem &&
        this.getStableRowKey(itemAtIndex) === this.getStableRowKey(this.selectedItem)
      ) {
        return this.selectedIndex;
      }
    }

    if (!this.selectedItem) {
      return -1;
    }

    return this.filteredItems.findIndex(
      (item) => this.getStableRowKey(item) === this.getStableRowKey(this.selectedItem),
    );
  }

  private scrollActiveRowIntoView() {
    this.tableDom?.scrollToSelection();
  }

  private syncSelectionAfterListMutation() {
    if (this.filteredItems.length === 0) {
      this.clearSelectedItem();
      return;
    }

    if (!this.selectedItem) {
      this.selectedIndex = -1;
      return;
    }

    const selectedIndex = this.filteredItems.findIndex(
      (item) => this.getStableRowKey(item) === this.getStableRowKey(this.selectedItem),
    );
    if (selectedIndex >= 0) {
      this.selectItem(this.filteredItems[selectedIndex], selectedIndex);
      return;
    }

    this.selectFilteredItemAt(0);
  }

  private clearSelectedItem() {
    if (!this.selectedItem && this.selectedIndex === -1) {
      return;
    }

    this.previewCoordinator.cancel();
    this.clearPreviewSlowTimer();
    this.cancelPlayerReadyTiming();
    this.selectedItem = null;
    this.selectedIndex = -1;
    this.currentUnitMetadata = [];
    this.coding.setScheme(null);
    this.player.applyResponseState(null);
    this.coding.correctSolutionPrefill = {
      status: 'unavailable',
      responses: [],
      message: 'Für dieses Item wurde noch keine Musterlösung ermittelt.',
    };
    this.coding.selectedPreviewTargetId = '';
    this.coding.customPreviewTargetDraft = '';
    this.syncPreviewTargetResolution(null);
    this.resetPlayer();
  }

  private getStableRowKey(item?: ReadonlyExplorerItem | null): string {
    if (!item) return '';
    return String(item.rowKey || item.uuid || `${item.unitId}_${item.itemId}`).trim();
  }

  private rememberFocusBeforeOverlay() {
    if (this.hasModalOverlay()) return;
    this.shellDom?.rememberFocusBeforeOverlay();
  }

  private restoreFocusAfterOverlayClose() {
    if (this.hasModalOverlay()) return;
    if (!this.shellDom?.restoreFocusAfterOverlayClose()) {
      this.tableDom?.focusFallback();
    }
  }

  private hasModalOverlay(): boolean {
    return (
      this.showOverlay === 'coding' ||
      this.showUploadWarningDialog ||
      this.showUploadReport ||
      this.showErrorDialog ||
      this.showColumnManager ||
      this.showSaveConfirmDialog ||
      this.showDeleteConfirmDialog ||
      this.showRawDataOverlay ||
      this.showHistoryOverlay ||
      this.showSavePreviewDialog ||
      this.showDiscardDraftDialog ||
      this.showDiscardPersonalItemDataDialog ||
      this.showClearEmpiricalDifficultiesDialog ||
      this.showRenumberDialog ||
      this.showLeaveWithChangesDialog
    );
  }

  private closeTopmostOverlay(): boolean {
    if (this.showUploadWarningDialog) {
      this.cancelItemParameterUploadWarnings();
      return true;
    }
    if (this.showLeaveWithChangesDialog) {
      this.stayOnPage();
      return true;
    }
    if (this.showClearEmpiricalDifficultiesDialog) {
      this.closeClearEmpiricalDifficultiesDialog();
      return true;
    }
    if (this.showRenumberDialog) {
      this.closeRenumberDialog();
      return true;
    }
    if (this.showDiscardDraftDialog) {
      this.closeDiscardDraftDialog();
      return true;
    }
    if (this.showDiscardPersonalItemDataDialog) {
      this.closeDiscardPersonalItemDataDialog();
      return true;
    }
    if (this.showSavePreviewDialog) {
      this.cancelSavePreviewDialog();
      return true;
    }
    if (this.showDeleteConfirmDialog) {
      this.closeDeleteConfirmDialog();
      return true;
    }
    if (this.showSaveConfirmDialog) {
      this.closeSaveConfirmDialog();
      return true;
    }
    if (this.showHistoryOverlay) {
      this.closeHistoryOverlay();
      return true;
    }
    if (this.showRawDataOverlay) {
      this.closeRawDataOverlay();
      return true;
    }
    if (this.showColumnManager) {
      this.closeColumnManager();
      return true;
    }
    if (this.showErrorDialog) {
      this.imports.closeError();
      this.restoreFocusAfterOverlayClose();
      return true;
    }
    if (this.showUploadReport) {
      this.imports.closeReport();
      this.restoreFocusAfterOverlayClose();
      return true;
    }
    if (this.showOverlay === 'coding') {
      this.closeCodingOverlay();
      return true;
    }
    if (this.showMetadataDrawer) {
      this.showMetadataDrawer = false;
      return true;
    }
    return false;
  }

  private queueDraftPatch(
    changeType: string,
    patch: Record<string, unknown>,
    flushImmediately = false,
  ) {
    this.configureDraft();
    this.draft.queueDraftPatch(changeType, patch, flushImmediately);
  }

  private async flushDraftPatch(): Promise<boolean> {
    this.configureDraft();
    return this.applyDraftResult(await this.draft.flushDraftPatch());
  }

  private rollbackItemTagsToLatestExplorerState(): void {
    const activeState = this.getExplorerStateForCurrentPerspective();
    const stateTags = this.normalizeTags(activeState.tags);
    const itemProperties = this.isRecord(activeState.itemProperties)
      ? (activeState.itemProperties as Record<string, Record<string, unknown>>)
      : {};

    for (const item of this.items) {
      const keys = this.getItemStateKeys(item);
      const tagsFromState = this.getTagsForKeys(stateTags, keys);
      const itemProps = this.getItemPropsForKeys(itemProperties, keys);
      item.tags =
        tagsFromState !== null
          ? [...tagsFromState]
          : Array.isArray(itemProps?.['tags'])
            ? this.normalizeTagValues(itemProps['tags'])
            : [];
    }
    this.itemTags = {};
    this.hydrateItemTagsFromItems();
    if (Object.keys(stateTags).length) {
      this.itemTags = { ...this.itemTags, ...stateTags };
    }
    this.applyFilter(false);
  }

  private normalizeTags(rawTags: unknown): Record<string, string[]> {
    if (!this.isRecord(rawTags)) {
      return {};
    }

    const tags: Record<string, string[]> = {};
    for (const [itemId, values] of Object.entries(rawTags)) {
      const normalizedItemId = String(itemId || '').trim();
      if (!normalizedItemId || !Array.isArray(values)) continue;

      const normalizedValues = Array.from(
        new Set(
          values.map((value) => String(value || '').trim()).filter((value) => value.length > 0),
        ),
      );

      // An explicit empty array is a deletion tombstone. Dropping it would
      // allow stale tags from the imported item payload to reappear when the
      // server returns the updated draft state.
      tags[normalizedItemId] = normalizedValues;
    }

    return tags;
  }

  private syncItemCommentCountSession(): void {
    this.configureComments();
    return this.comments.syncItemCommentCountSession();
  }

  private selectInitialCommentTarget(): void {
    const target = this.initialCommentTarget;
    if (!target) return;
    const matchesTarget = (item: ReadonlyExplorerItem) => {
      if (item.unitId !== target.unitId) return false;
      if (item.itemId === target.itemId) return true;
      const prefix = `${target.unitId}_`;
      return (
        item.itemId === `${prefix}${target.itemId}` || target.itemId === `${prefix}${item.itemId}`
      );
    };
    const item = this.items.find(matchesTarget);
    if (!item) return;
    const openCoding = target.openCoding === true;
    this.initialCommentTarget = null;
    let index = this.filteredItems.findIndex(
      (entry) => this.getStableRowKey(entry) === this.getStableRowKey(item),
    );
    if (index < 0) {
      this.table.filterText = '';
      this.table.columnFilters = {};
      this.personalData.personalColumnFilters = {};
      this.collections.collectionViewMode = 'all';
      if (this.isItemExcluded(item)) this.table.showExcludedItems = true;
      this.applyFilter(false);
      index = this.filteredItems.findIndex(
        (entry) => this.getStableRowKey(entry) === this.getStableRowKey(item),
      );
    }
    this.selectingInitialCommentTarget = true;
    try {
      this.selectItem(item, index);
      if (openCoding) this.openCodingOverlay();
    } finally {
      this.selectingInitialCommentTarget = false;
    }
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
