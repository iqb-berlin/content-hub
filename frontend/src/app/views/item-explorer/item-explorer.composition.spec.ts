import { ItemExplorerImportService } from './item-explorer-import.service';
import { ItemExplorerTableService } from './item-explorer-table.service';
import { ItemExplorerPlayerService } from './item-explorer-player.service';
import { ItemExplorerCodingService } from './item-explorer-coding.service';
import { ItemExplorerDraftService } from './item-explorer-draft.service';
import { ItemExplorerCollectionsService } from './item-explorer-collections.service';
import { ItemExplorerPersonalDataService } from './item-explorer-personal-data.service';
import { ItemExplorerCommentsService } from './item-explorer-comments.service';
import { ItemExplorerBrowser } from './item-explorer-browser.service';
/// <reference types="vite/client" />

import { of } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, provideZonelessChangeDetection } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingPersonalSessionStorageService } from '../../core/services/pending-personal-session-storage.service';
import { ItemExplorerPreviewLoader } from './item-explorer-preview-loader.service';
import { ItemExplorerPreviewCoordinator } from './item-explorer-preview-coordinator.service';
import { ItemExplorerLoadDiagnostics } from './item-explorer-load-diagnostics.service';
import { BreadcrumbComponent } from '../../shared/components/breadcrumb.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { SplitPaneComponent } from '../../shared/components/split-pane.component';
import codingDialogTemplate from './components/coding-dialog/item-explorer-coding-dialog.component.html?raw';
import collectionsTemplate from './components/collections/item-explorer-collections.component.html?raw';
import columnManagerTemplate from './components/column-manager-dialog/item-explorer-column-manager-dialog.component.html?raw';
import draftDialogsTemplate from './components/draft-dialogs/item-explorer-draft-dialogs.component.html?raw';
import headerTemplate from './components/header/item-explorer-header.component.html?raw';
import historyDialogTemplate from './components/history-dialog/item-explorer-history-dialog.component.html?raw';
import metadataDrawerTemplate from './components/metadata-drawer/item-explorer-metadata-drawer.component.html?raw';
import previewTemplate from './components/preview/item-explorer-preview.component.html?raw';
import responseStateDialogsTemplate from './components/response-state-dialogs/item-explorer-response-state-dialogs.component.html?raw';
import tableTemplate from './components/table/item-explorer-table.component.html?raw';
import uploadDialogsTemplate from './components/upload-dialogs/item-explorer-upload-dialogs.component.html?raw';
import shellTemplate from './item-explorer.component.html?raw';
import { ItemExplorerFacade } from './item-explorer.facade';

@Component({
  selector: 'app-item-explorer-header',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  template: headerTemplate,
})
class ItemExplorerHeaderTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).headerViewModel;
}

@Component({
  selector: 'app-item-explorer-collections',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: collectionsTemplate,
})
class ItemExplorerCollectionsTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).collectionsViewModel;
  collectionName = '';
  nameMode = 'create';
  nameError = '';
  nameSaving = false;
}

@Component({
  selector: 'app-item-explorer-table',
  standalone: true,
  imports: [CommonModule, FormsModule, ItemExplorerCollectionsTemplateHarness],
  template: tableTemplate,
})
class ItemExplorerTableTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).tableViewModel;

  onTableKeydown(event: KeyboardEvent): void {
    this.vm.onTableKeydown(event);
  }
}

@Component({
  selector: 'app-item-explorer-preview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: previewTemplate,
})
class ItemExplorerPreviewTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).previewViewModel;
}

@Component({
  selector: 'app-item-explorer-coding-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: codingDialogTemplate,
})
class ItemExplorerCodingDialogTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).codingDialogViewModel;
}

@Component({
  selector: 'app-item-explorer-metadata-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: metadataDrawerTemplate,
})
class ItemExplorerMetadataDrawerTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).metadataDrawerViewModel;
}

@Component({
  selector: 'app-item-explorer-upload-dialogs',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  template: uploadDialogsTemplate,
})
class ItemExplorerUploadDialogsTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).uploadDialogsViewModel;
}

@Component({
  selector: 'app-item-explorer-column-manager-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: columnManagerTemplate,
})
class ItemExplorerColumnManagerDialogTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).columnManagerDialogViewModel;
}

@Component({
  selector: 'app-item-explorer-response-state-dialogs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: responseStateDialogsTemplate,
})
class ItemExplorerResponseStateDialogsTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).responseStateDialogsViewModel;
}

@Component({
  selector: 'app-item-explorer-history-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: historyDialogTemplate,
})
class ItemExplorerHistoryDialogTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).historyDialogViewModel;
}

@Component({
  selector: 'app-item-explorer-draft-dialogs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: draftDialogsTemplate,
})
class ItemExplorerDraftDialogsTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).draftDialogsViewModel;
}

@Component({
  selector: 'app-item-explorer-template-harness',
  standalone: true,
  imports: [
    BreadcrumbComponent,
    SplitPaneComponent,
    ItemExplorerHeaderTemplateHarness,
    ItemExplorerTableTemplateHarness,
    ItemExplorerPreviewTemplateHarness,
    ItemExplorerCodingDialogTemplateHarness,
    ItemExplorerMetadataDrawerTemplateHarness,
    ItemExplorerUploadDialogsTemplateHarness,
    ItemExplorerColumnManagerDialogTemplateHarness,
    ItemExplorerResponseStateDialogsTemplateHarness,
    ItemExplorerHistoryDialogTemplateHarness,
    ItemExplorerDraftDialogsTemplateHarness,
  ],
  template: shellTemplate,
})
class ItemExplorerShellTemplateHarness implements OnInit {
  private readonly facade = inject(ItemExplorerFacade);
  private readonly route = inject(ActivatedRoute);

  get isFullscreenActive(): boolean {
    return this.facade.isFullscreen;
  }

  get breadcrumbs() {
    return this.facade.breadcrumbs;
  }

  ngOnInit(): void {
    this.facade.init(this.route.snapshot.paramMap.get('acpId') || '');
  }
}

function createFacade(): ItemExplorerFacade {
  const api = {} as any;
  const diagnostics = new ItemExplorerLoadDiagnostics();
  const previewLoader = new ItemExplorerPreviewLoader(api, diagnostics);
  const previewCoordinator = new ItemExplorerPreviewCoordinator(api, previewLoader, diagnostics);
  return new ItemExplorerFacade(
    api,
    { bypassSecurityTrustHtml: (html: string) => html } as any,
    {
      hasAcpRole: () => false,
      isAdmin: false,
      isLoggedIn: false,
      currentUser$: { subscribe: () => ({ unsubscribe: vi.fn() }) },
      getToken: () => null,
    } as any,
    new PendingPersonalSessionStorageService(),
    previewCoordinator,
    new ItemExplorerCommentsService(api as any, new ItemExplorerBrowser()),
    new ItemExplorerPersonalDataService(
      api as any,
      new PendingPersonalSessionStorageService(),
      new ItemExplorerBrowser(),
    ),
    new ItemExplorerCollectionsService(api as any, new ItemExplorerBrowser()),
    new ItemExplorerDraftService(api as any),
    new ItemExplorerCodingService({} as any),
    new ItemExplorerPlayerService({} as any),
    new ItemExplorerTableService(),
    new ItemExplorerImportService(api as any),
    diagnostics,
  );
}

async function renderExplorer(facade: ItemExplorerFacade) {
  await TestBed.configureTestingModule({
    imports: [ItemExplorerShellTemplateHarness],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser$: of(null) } },
      { provide: ItemExplorerFacade, useValue: facade },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: { get: () => 'acp-42' } } },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ItemExplorerShellTemplateHarness);
  fixture.detectChanges();

  return fixture;
}

describe('ItemExplorer production template composition', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders every production feature template against the same route-local facade', async () => {
    const facade = createFacade();
    const init = vi.spyOn(facade, 'init').mockImplementation(() => undefined);

    const fixture = await renderExplorer(facade);

    for (const selector of [
      'app-item-explorer-header',
      'app-item-explorer-table',
      'app-item-explorer-preview',
      'app-item-explorer-coding-dialog',
      'app-item-explorer-metadata-drawer',
      'app-item-explorer-upload-dialogs',
      'app-item-explorer-column-manager-dialog',
      'app-item-explorer-response-state-dialogs',
      'app-item-explorer-history-dialog',
      'app-item-explorer-draft-dialogs',
    ]) {
      expect(fixture.nativeElement.querySelectorAll(selector), selector).toHaveLength(1);
    }
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Item-Explorer');
    expect(fixture.nativeElement.querySelector('.table-toolbar .filter-input')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Item auswählen');

    const table = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ItemExplorerTableTemplateHarness,
    ).componentInstance as ItemExplorerTableTemplateHarness;
    const preview = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ItemExplorerPreviewTemplateHarness,
    ).componentInstance as ItemExplorerPreviewTemplateHarness;
    expect(table.vm).toBe(facade.tableViewModel);
    expect(preview.vm).toBe(facade.previewViewModel);
    expect(init).toHaveBeenCalledWith('acp-42');
  }, 15_000);
  it('updates breadcrumbs and fullscreen controls through the rendered toolbar', async () => {
    const facade = createFacade();
    vi.spyOn(facade, 'init').mockImplementation(() => undefined);
    facade.breadcrumbs = [{ label: 'Package 42' }, { label: 'Explorer' }];
    const toggleFullscreen = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    facade.registerShellDom({
      toggleFullscreen,
      isFullscreen: () => false,
      rememberFocusBeforeOverlay: () => undefined,
      restoreFocusAfterOverlayClose: () => true,
    });
    const fixture = await renderExplorer(facade);
    try {
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('app-breadcrumb')?.textContent).toContain('Package 42');
      const button = root.querySelector<HTMLButtonElement>(
        '[title="Item-Explorer im Vollbild anzeigen"]',
      )!;
      button.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(toggleFullscreen).toHaveBeenCalledTimes(1);
      expect(root.querySelector('app-breadcrumb')).toBeNull();
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.textContent).toContain('Vollbild beenden');
      button.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(root.querySelector('app-breadcrumb')?.textContent).toContain('Package 42');
      expect(button.getAttribute('aria-pressed')).toBe('false');
    } finally {
      facade.comments.ngOnDestroy();
      facade.personalData.ngOnDestroy();
      facade.collections.ngOnDestroy();
      facade.draft.ngOnDestroy();
      facade.player.ngOnDestroy();
      facade.ngOnDestroy();
    }
  });

  it.each([false, true])('renders editing controls only when permission is %s', async (canEdit) => {
    const facade = createFacade();
    vi.spyOn(facade, 'init').mockImplementation(() => undefined);
    (facade as any).explorerEditingAllowed = canEdit;
    const fixture = await renderExplorer(facade);
    try {
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelectorAll('[aria-label="Reihenfolge"]')).toHaveLength(canEdit ? 1 : 0);
      expect(root.querySelectorAll('[aria-label="Verwaltung"]')).toHaveLength(canEdit ? 1 : 0);
      if (canEdit)
        expect(root.querySelector('[aria-label="Reihenfolge"]')?.textContent).toContain(
          'Manuell sortieren',
        );
    } finally {
      facade.comments.ngOnDestroy();
      facade.personalData.ngOnDestroy();
      facade.collections.ngOnDestroy();
      facade.draft.ngOnDestroy();
      facade.player.ngOnDestroy();
      facade.ngOnDestroy();
    }
  });
});
