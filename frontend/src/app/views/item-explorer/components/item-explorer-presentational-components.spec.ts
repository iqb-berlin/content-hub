/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { ItemExplorerCodingDialogComponent } from './coding-dialog/item-explorer-coding-dialog.component';
import codingTemplate from './coding-dialog/item-explorer-coding-dialog.component.html?raw';
import { ItemExplorerCollectionsComponent } from './collections/item-explorer-collections.component';
import collectionsTemplate from './collections/item-explorer-collections.component.html?raw';
import { ItemExplorerColumnManagerDialogComponent } from './column-manager-dialog/item-explorer-column-manager-dialog.component';
import columnManagerTemplate from './column-manager-dialog/item-explorer-column-manager-dialog.component.html?raw';
import { ItemExplorerDraftDialogsComponent } from './draft-dialogs/item-explorer-draft-dialogs.component';
import draftDialogsTemplate from './draft-dialogs/item-explorer-draft-dialogs.component.html?raw';
import { ItemExplorerHeaderComponent } from './header/item-explorer-header.component';
import headerTemplate from './header/item-explorer-header.component.html?raw';
import { ItemExplorerHistoryDialogComponent } from './history-dialog/item-explorer-history-dialog.component';
import historyTemplate from './history-dialog/item-explorer-history-dialog.component.html?raw';
import { ItemExplorerMetadataDrawerComponent } from './metadata-drawer/item-explorer-metadata-drawer.component';
import metadataTemplate from './metadata-drawer/item-explorer-metadata-drawer.component.html?raw';
import { ItemExplorerResponseStateDialogsComponent } from './response-state-dialogs/item-explorer-response-state-dialogs.component';
import responseStateTemplate from './response-state-dialogs/item-explorer-response-state-dialogs.component.html?raw';
import { ItemExplorerUploadDialogsComponent } from './upload-dialogs/item-explorer-upload-dialogs.component';
import uploadTemplate from './upload-dialogs/item-explorer-upload-dialogs.component.html?raw';

describe('ItemExplorer presentational components', () => {
  it.each([
    ['header', 'headerViewModel', (facade: any) => new ItemExplorerHeaderComponent(facade)],
    [
      'collections',
      'collectionsViewModel',
      (facade: any) => new ItemExplorerCollectionsComponent(facade),
    ],
    [
      'coding dialog',
      'codingDialogViewModel',
      (facade: any) => new ItemExplorerCodingDialogComponent(facade),
    ],
    [
      'metadata drawer',
      'metadataDrawerViewModel',
      (facade: any) => new ItemExplorerMetadataDrawerComponent(facade),
    ],
    [
      'upload dialogs',
      'uploadDialogsViewModel',
      (facade: any) => new ItemExplorerUploadDialogsComponent(facade),
    ],
    [
      'column manager',
      'columnManagerDialogViewModel',
      (facade: any) => new ItemExplorerColumnManagerDialogComponent(facade),
    ],
    [
      'response state dialogs',
      'responseStateDialogsViewModel',
      (facade: any) => new ItemExplorerResponseStateDialogsComponent(facade),
    ],
    [
      'history dialog',
      'historyDialogViewModel',
      (facade: any) => new ItemExplorerHistoryDialogComponent(facade),
    ],
    [
      'draft dialogs',
      'draftDialogsViewModel',
      (facade: any) => new ItemExplorerDraftDialogsComponent(facade),
    ],
  ])('binds the %s to its dedicated facade slice', (_name, sliceName, createComponent) => {
    const slice = {};
    const component = createComponent({ [sliceName]: slice });

    expect(component.vm).toBe(slice);
  });

  it.each([
    ['header fullscreen', headerTemplate, '(click)="vm.toggleFullscreen()"'],
    ['header save', headerTemplate, '(click)="vm.openSavePreviewDialog()"'],
    ['collections create', collectionsTemplate, "openNameDialog('create', listActionsTrigger)"],
    ['collections delete', collectionsTemplate, '(click)="deleteActiveCollection()"'],
    ['coding close', codingTemplate, '(click)="vm.closeCodingOverlay()"'],
    ['metadata close', metadataTemplate, '(click)="vm.setMetadataDrawerOpen(false)"'],
    ['upload close', uploadTemplate, '(click)="vm.closeUploadReport(true)"'],
    ['column save', columnManagerTemplate, '(click)="vm.saveMetadataSettings()"'],
    ['response save', responseStateTemplate, '(click)="vm.confirmSaveResponseState()"'],
    ['history refresh', historyTemplate, '(click)="vm.showHistory()"'],
    ['draft save', draftDialogsTemplate, '(click)="vm.confirmSaveExplorerDraft()"'],
  ])('keeps the %s action binding in the production template', (_name, template, binding) => {
    expect(template).toContain(binding);
  });

  it('keeps the default-column reset available for an explicitly empty selection', () => {
    expect(columnManagerTemplate).toContain('[disabled]="!vm.canResetMetadataSettings"');
  });

  it('tracks unified column-manager entries by their namespaced key', () => {
    expect(columnManagerTemplate).toContain('@for (col of vm.filteredAllColumns; track col.key)');
    expect(columnManagerTemplate).not.toContain('track col.id');
  });

  it('gives the collection selector an accessible name', () => {
    expect(collectionsTemplate).toContain('aria-label="Aktive persönliche Auswahlliste auswählen"');
  });

  it('marks header and collection modes as semantic state buttons', () => {
    expect(headerTemplate.match(/class="btn btn-outline btn-sm btn-state"/g)).toHaveLength(3);
    expect(headerTemplate).toContain('[attr.aria-pressed]="vm.sortField === \'__manual__\'"');
    expect(headerTemplate).toContain('(click)="vm.toggleManualOrderMode()"');
    expect(headerTemplate).toContain('Manuell sortieren');
    expect(headerTemplate).not.toContain('btn-state-indicator');
    expect(collectionsTemplate.match(/class="btn btn-outline btn-sm btn-state"/g)).toHaveLength(2);
    expect(collectionsTemplate).toContain(
      '[attr.aria-pressed]="vm.collectionViewMode === \'all\'"',
    );
    expect(collectionsTemplate).toContain(
      '[attr.aria-pressed]="vm.collectionViewMode === \'active\'"',
    );
    expect(collectionsTemplate).not.toContain('btn-state-indicator');
  });

  it('links the metadata disclosure to its controlled drawer', () => {
    expect(metadataTemplate).toContain('id="item-explorer-metadata-drawer"');
  });

  it('only shows movement controls in manual mode and binds their availability', () => {
    const manualControls = headerTemplate.match(
      /@if \(vm.sortField === '__manual__'\) \{([\s\S]*?)\n {6}\}/,
    )?.[1];
    expect(manualControls).toBeDefined();
    expect(manualControls).toContain('[disabled]="!vm.canMoveSelectedItem(-1)"');
    expect(manualControls).toContain('[disabled]="!vm.canMoveSelectedItem(1)"');
    expect(manualControls).toContain('aria-label="Ausgewähltes Item nach oben verschieben"');
    expect(manualControls).toContain('aria-label="Ausgewähltes Item nach unten verschieben"');
  });

  it('renders collection details as an accessible paginated modal', () => {
    expect(collectionsTemplate).toContain('role="dialog"');
    expect(collectionsTemplate).toContain('aria-modal="true"');
    expect(collectionsTemplate).toContain('pagedCollectionItems');
    expect(collectionsTemplate).toContain('Alle Einträge auf dieser Seite auswählen');
    expect(collectionsTemplate).toContain('[error]="removeConfirmationError"');
  });

  it('binds ACP coding flags to general and manual instructions', () => {
    expect(codingTemplate).toContain('vm.shouldShowGeneralCodingInstruction(coding)');
    expect(codingTemplate).toContain('vm.shouldShowAutomaticCodingRules(code)');
    expect(codingTemplate).toContain('Allgemeiner Kodierungshinweis:');
    expect(codingTemplate).toContain('<strong>Manuelle Kodieranweisung:</strong>');
    expect(codingTemplate).not.toContain("? 'Manuelle Kodieranweisung:'");
  });

  it('distinguishes exact answers, codebook rules and unavailable coding information', () => {
    expect(codingTemplate).toContain('data-testid="coding-information"');
    expect(codingTemplate).toContain('{{ vm.codingInformation.title }}');
    expect(codingTemplate).toContain("vm.codingInformation.status === 'exact'");
    expect(codingTemplate).toContain('{{ answer.valueLabel }}');
    expect(codingTemplate).toContain('<strong>Automatische Kodiervorschrift:</strong>');
    expect(codingTemplate).toContain("? 'alle Regelgruppen (UND)'");
    expect(codingTemplate).toContain(": 'eine Regelgruppe (ODER)'");
  });

  it('renders the selected variable and its relevant source rule groups', () => {
    expect(codingTemplate).toContain('vm.codingInformation.ruleGroups');
    expect(codingTemplate).toContain('<strong>Quelle:</strong>');
    expect(codingTemplate).toContain('<strong>Verarbeitung:</strong>');
  });

  it('uses the coding variable id as the unambiguous card heading', () => {
    expect(codingTemplate).toContain('<h4>Kodiervariable {{ coding.id }}</h4>');
    expect(codingTemplate).not.toContain('<h4>{{ coding.label || coding.id }}</h4>');
  });

  it('hides internal coding and player target ids for an unambiguous mapping', () => {
    expect(codingTemplate).not.toContain('Interne Kodier-ID:');
    expect(codingTemplate).toContain('vm.codingVariableFocus.usedLegacyFallback');
    expect(codingTemplate).toContain('Die Zuordnung wurde eindeutig über das Player-/Anzeige-Ziel');
  });

  it('places a separate coding comment thread inside the coding overlay', () => {
    expect(codingTemplate).toContain('<app-item-comment-thread');
    expect(codingTemplate).toContain('[targetType]="\'CODING\'"');
    expect(codingTemplate).toContain('[unitId]="vm.selectedItem.unitId"');
    expect(codingTemplate).toContain('[itemId]="vm.selectedItem.itemId"');
  });

  it('shows derived-variable source ids only when player diagnostics are enabled', () => {
    expect(codingTemplate).toContain(
      '@if (vm.showPlayerTargetInfo && vm.codingVariableFocus.isDerived)',
    );
  });

  it('exposes read-only sharing and private-copy actions for collections', () => {
    expect(collectionsTemplate).toContain('Für diesen ACP freigeben');
    expect(collectionsTemplate.replace(/\s+/g, ' ')).toContain(
      "'Geteilt von ' + vm.activeItemCollection?.ownerLabel",
    );
    expect(collectionsTemplate).toContain('vm.copyActiveCollection()');
    expect(collectionsTemplate).toContain('collection.ownedByCurrentUser');
  });

  it('filters and paginates large collections without exposing more than 50 rows', () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
      rowKey: `row-${index}`,
      position: index + 1,
      item: {
        unitLabel: `Aufgabe ${index}`,
        itemId: `item-${index}`,
        subId: String(index),
      },
    }));
    const vm = { activeCollectionItems: entries };
    const component = new ItemExplorerCollectionsComponent({ collectionsViewModel: vm } as any);

    expect(component.pagedCollectionItems).toHaveLength(50);
    component.nextPage();
    expect(component.pagedCollectionItems[0].position).toBe(51);

    component.toggleCurrentPage(true);
    expect(component.selectedCount).toBe(50);
    component.setCollectionFilterText('item-9999');
    expect(component.selectedCount).toBe(0);
    expect(component.filteredCollectionItems.map((entry) => entry.rowKey)).toEqual(['row-9999']);
    expect(component.collectionPage).toBe(1);
  });
});
