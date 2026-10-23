import { ItemExplorerImportService } from './item-explorer-import.service';
import { ItemExplorerTableService } from './item-explorer-table.service';
import { ItemExplorerPlayerService } from './item-explorer-player.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { ItemExplorerDraftService } from './item-explorer-draft.service';
import { ItemExplorerCollectionsService } from './item-explorer-collections.service';
import { ItemExplorerPersonalDataService } from './item-explorer-personal-data.service';
import { ItemExplorerCommentsService } from './item-explorer-comments.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';
import {
  Component,
  ElementRef,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/components/breadcrumb.component';
import { SplitPaneComponent } from '../../shared/components/split-pane.component';
import { ItemExplorerFacade } from './item-explorer.facade';
import { ItemExplorerHeaderComponent } from './components/header/item-explorer-header.component';
import { ItemExplorerTableComponent } from './components/table/item-explorer-table.component';
import { ItemExplorerPreviewComponent } from './components/preview/item-explorer-preview.component';
import { ItemExplorerCodingDialogComponent } from './components/coding-dialog/item-explorer-coding-dialog.component';
import { ItemExplorerMetadataDrawerComponent } from './components/metadata-drawer/item-explorer-metadata-drawer.component';
import { ItemExplorerUploadDialogsComponent } from './components/upload-dialogs/item-explorer-upload-dialogs.component';
import { ItemExplorerColumnManagerDialogComponent } from './components/column-manager-dialog/item-explorer-column-manager-dialog.component';
import { ItemExplorerResponseStateDialogsComponent } from './components/response-state-dialogs/item-explorer-response-state-dialogs.component';
import { ItemExplorerHistoryDialogComponent } from './components/history-dialog/item-explorer-history-dialog.component';
import { ItemExplorerDraftDialogsComponent } from './components/draft-dialogs/item-explorer-draft-dialogs.component';
import { ItemExplorerShellDomPort } from './item-explorer.dom-ports';
import { ItemExplorerPreviewLoader } from './item-explorer-preview-loader.service';
import { ItemExplorerLoadDiagnostics } from './item-explorer-load-diagnostics.service';
import { ItemExplorerPreviewCoordinator } from './item-explorer-preview-coordinator.service';

@Component({
  selector: 'app-item-explorer',
  standalone: true,
  imports: [
    BreadcrumbComponent,
    SplitPaneComponent,
    ItemExplorerHeaderComponent,
    ItemExplorerTableComponent,
    ItemExplorerPreviewComponent,
    ItemExplorerCodingDialogComponent,
    ItemExplorerMetadataDrawerComponent,
    ItemExplorerUploadDialogsComponent,
    ItemExplorerColumnManagerDialogComponent,
    ItemExplorerResponseStateDialogsComponent,
    ItemExplorerHistoryDialogComponent,
    ItemExplorerDraftDialogsComponent,
  ],
  providers: [
    ItemExplorerFacade,
    ItemExplorerDraftService,
    ItemExplorerCodingService,
    ItemExplorerPlayerService,
    ItemExplorerTableService,
    ItemExplorerImportService,
    ItemExplorerCollectionsService,
    ItemExplorerPersonalDataService,
    ItemExplorerCommentsService,
    ItemExplorerBrowser,
    ItemExplorerPreviewLoader,
    ItemExplorerPreviewCoordinator,
    ItemExplorerLoadDiagnostics,
  ],
  templateUrl: './item-explorer.component.html',
  styleUrl: './item-explorer.component.css',
  encapsulation: ViewEncapsulation.None,
})
export class ItemExplorerComponent implements OnInit, OnDestroy, ItemExplorerShellDomPort {
  private root?: ElementRef<HTMLDivElement>;
  private overlayReturnFocus: HTMLElement | null = null;
  private focusRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('explorerRoot')
  set explorerRoot(value: ElementRef<HTMLDivElement> | undefined) {
    this.root = value;
  }

  constructor(
    @Inject(ActivatedRoute) private readonly route: ActivatedRoute,
    @Inject(ItemExplorerFacade) private readonly feature: ItemExplorerFacade,
  ) {
    this.feature.registerShellDom(this);
  }

  get isFullscreenActive(): boolean {
    return this.feature.isFullscreen;
  }

  get breadcrumbs() {
    return this.feature.breadcrumbs;
  }

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    const unitId = query?.get('unitId') || '';
    const itemId = query?.get('itemId') || '';
    const acpId = this.route.snapshot.paramMap.get('acpId') || '';
    if (unitId && itemId) {
      this.feature.init(acpId, {
        unitId,
        itemId,
        open: query?.get('comments') === 'open',
        openCoding: query?.get('coding') === 'open',
      });
    } else {
      this.feature.init(acpId);
    }
  }

  ngOnDestroy(): void {
    if (this.focusRestoreTimer) clearTimeout(this.focusRestoreTimer);
    this.feature.unregisterShellDom(this);
  }

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    this.feature.handleBeforeUnload(event);
  }

  @HostListener('window:keydown', ['$event'])
  handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === '/' && this.isEditableTarget(event.target)) return;
    this.feature.handleWindowKeydown(event);
  }

  @HostListener('document:fullscreenchange')
  handleFullscreenChange(): void {
    this.feature.handleFullscreenChange();
  }

  canDeactivate(): boolean | Promise<boolean> {
    return this.feature.canDeactivate();
  }

  async toggleFullscreen(): Promise<boolean> {
    const root = this.root?.nativeElement;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else {
        await root?.requestFullscreen?.();
      }
    } catch (error) {
      console.error('Failed to toggle fullscreen mode', error);
    }
    return this.isFullscreen();
  }

  isFullscreen(): boolean {
    return document.fullscreenElement === this.root?.nativeElement;
  }

  rememberFocusBeforeOverlay(): void {
    const activeElement = document.activeElement;
    this.overlayReturnFocus = activeElement instanceof HTMLElement ? activeElement : null;
  }

  restoreFocusAfterOverlayClose(): boolean {
    const target = this.overlayReturnFocus;
    this.overlayReturnFocus = null;
    if (!target?.isConnected) return false;
    if (this.focusRestoreTimer) clearTimeout(this.focusRestoreTimer);
    this.focusRestoreTimer = setTimeout(() => {
      this.focusRestoreTimer = null;
      target.focus({ preventScroll: true });
    }, 0);
    return true;
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.isContentEditable ||
      Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
    );
  }
}
