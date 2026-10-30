import {
  Component,
  ElementRef,
  inject,
  NO_ERRORS_SCHEMA,
  provideZonelessChangeDetection,
  ɵresolveComponentResources,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemExplorerPreviewComponent } from './item-explorer-preview.component';
import { ItemExplorerFacade } from '../../item-explorer.facade';
import { ItemCommentThreadComponent } from '../../../comment-thread/item-comment-thread.component';
import { ApiService } from '../../../../core/services/api.service';
import template from './item-explorer-preview.component.html?raw';
import commentThreadTemplate from '../../../comment-thread/item-comment-thread.component.html?raw';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  schemas: [NO_ERRORS_SCHEMA],
  template,
})
class PreviewAccessTemplateHarness {
  readonly vm = inject(ItemExplorerFacade).previewViewModel;
}

function createPreview() {
  const feature = {
    registerPlayerDom: vi.fn(),
    unregisterPlayerDom: vi.fn(),
    playerFrameChanged: vi.fn(),
    handlePlayerMessage: vi.fn(),
    previewViewModel: {},
  } as any;
  const component = new ItemExplorerPreviewComponent(feature);
  return { component, feature };
}

describe('ItemExplorerPreviewComponent', () => {
  it('tracks frame inputs and native media changes, and stops tracking replaced frames', () => {
    vi.useFakeTimers();
    const { component } = createPreview();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML =
      '<input><div data-element-id="audio"><audio></audio><input type="range"><button>Lautstärke</button></div><button>Weiter</button><p>Text</p>';
    try {
      component.playerFrame = new ElementRef(frame);
      component.postMessage({ type: 'vopStartCommand' });
      expect(component.getLastInteractionTime()).toBe(0);
      doc.querySelector('p')!.click();
      expect(component.getLastInteractionTime()).toBe(0);
      doc.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
      expect(component.getLastInteractionTime()).toBe(Date.now());
      vi.advanceTimersByTime(20);
      const inputTime = component.getLastInteractionTime();
      doc.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
      doc
        .querySelector('input[type="range"]')!
        .dispatchEvent(new Event('input', { bubbles: true }));
      doc.querySelector('[data-element-id="audio"] button')!.click();
      expect(component.getLastInteractionTime()).toBe(inputTime);
      doc.querySelector('audio')!.dispatchEvent(new Event('timeupdate'));
      expect(component.getLastInteractionTime()).toBe(Date.now());
      component.playerFrame = undefined;
      const last = component.getLastInteractionTime();
      vi.advanceTimersByTime(20);
      doc.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
      expect(component.getLastInteractionTime()).toBe(last);
    } finally {
      component.ngOnDestroy();
      frame.remove();
      vi.useRealTimers();
    }
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'offers the complete unit with effective access %s and a visible player %s',
    async (canOpenFullUnit, showPlayerPreview) => {
      const item = { itemId: 'item', unitId: 'unit' };
      const feature = {
        registerPlayerDom: vi.fn(),
        unregisterPlayerDom: vi.fn(),
        playerFrameChanged: vi.fn(),
        previewViewModel: {
          acpId: 'acp',
          selectedItem: item,
          selectedIndex: 0,
          filteredItems: [item],
          showItemInfo: true,
          showPlayerPreview,
          isItemExcluded: () => false,
          previewUnavailableReason: 'unsupported condition',
          previewUnavailableMessage: 'Keine Vorschau verfügbar.',
          canOpenFullUnit,
        },
      };
      TestBed.configureTestingModule({
        imports: [PreviewAccessTemplateHarness],
        providers: [provideRouter([]), { provide: ItemExplorerFacade, useValue: feature }],
      });
      const fixture = TestBed.createComponent(PreviewAccessTemplateHarness);
      try {
        fixture.detectChanges();
        await fixture.whenStable();
        const link = fixture.nativeElement.querySelector('.empty-state a');
        expect(Boolean(link)).toBe(canOpenFullUnit && showPlayerPreview);
        if (link) expect(link.getAttribute('href')).toBe('/view/acp/unit/unit');
      } finally {
        fixture.destroy();
        TestBed.resetTestingModule();
      }
    },
  );
  afterEach(() => TestBed.resetTestingModule());

  it('shows Studio comments only for the selected item when the ACP enables them', async () => {
    const comments = [{ id: 1, body: 'Studio hint for item 1', hidden: false }];
    const item = { itemId: 'i1', unitId: 'u1', uuid: 'a', studioComments: comments };
    const vm = {
      selectedItem: item,
      filteredItems: [item],
      showStudioItemComments: false,
      isItemExcluded: () => false,
      updateItemCommentCount: vi.fn(),
    };
    const feature = {
      previewViewModel: vm,
      registerPlayerDom: vi.fn(),
      unregisterPlayerDom: vi.fn(),
      playerFrameChanged: vi.fn(),
    };
    await ɵresolveComponentResources(async (url: string) => {
      if (url.endsWith('item-explorer-preview.component.html')) return template;
      if (url.endsWith('item-comment-thread.component.html')) return commentThreadTemplate;
      if (url.endsWith('.css')) return '';
      throw new Error(`Unexpected component resource: ${url}`);
    });
    (ItemCommentThreadComponent as any).ctorParameters = () => [{ type: ApiService }];
    await TestBed.configureTestingModule({
      imports: [ItemExplorerPreviewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ItemExplorerFacade, useValue: feature },
        { provide: ApiService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ItemExplorerPreviewComponent);
    const root: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Studio-Kommentare"]')).toBeNull();

    vm.showStudioItemComments = true;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Studio-Kommentare"]')?.textContent).toContain(
      'Studio hint for item 1',
    );
    vm.selectedItem = { ...item, itemId: 'i2', uuid: 'b', studioComments: [] };
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Studio-Kommentare"]')).toBeNull();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows Studio comments only for the selected item when the ACP enables them', async () => {
    const comments = [{ id: 1, body: 'Studio hint for item 1', hidden: false }];
    const item = { itemId: 'i1', unitId: 'u1', uuid: 'a', studioComments: comments };
    const vm = {
      selectedItem: item,
      filteredItems: [item],
      showStudioItemComments: false,
      isItemExcluded: () => false,
      updateItemCommentCount: vi.fn(),
    };
    const feature = {
      previewViewModel: vm,
      registerPlayerDom: vi.fn(),
      unregisterPlayerDom: vi.fn(),
      playerFrameChanged: vi.fn(),
    };
    await ɵresolveComponentResources(async (url: string) => {
      if (url.endsWith('item-explorer-preview.component.html')) return template;
      if (url.endsWith('item-comment-thread.component.html')) return commentThreadTemplate;
      if (url.endsWith('.css')) return '';
      throw new Error(`Unexpected component resource: ${url}`);
    });
    (ItemCommentThreadComponent as any).ctorParameters = () => [{ type: ApiService }];
    await TestBed.configureTestingModule({
      imports: [ItemExplorerPreviewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ItemExplorerFacade, useValue: feature },
        { provide: ApiService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ItemExplorerPreviewComponent);
    const root: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Studio-Kommentare"]')).toBeNull();

    vm.showStudioItemComments = true;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Studio-Kommentare"]')?.textContent).toContain(
      'Studio hint for item 1',
    );
    vm.selectedItem = { ...item, itemId: 'i2', uuid: 'b', studioComments: [] };
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Studio-Kommentare"]')).toBeNull();
  });

  it('exposes metadata and exclusion state with the matching semantics', () => {
    expect(template.match(/class="btn btn-outline btn-sm btn-state"/g)).toHaveLength(4);
    expect(template).toContain('[attr.aria-expanded]="vm.showMetadataDrawer"');
    expect(template).toContain('aria-controls="item-explorer-metadata-drawer"');
    expect(template).toContain('[attr.aria-pressed]="vm.isItemExcluded(vm.selectedItem)"');
    expect(template).not.toContain('btn-state-indicator');
  });

  it('names the scroll region, player frame and paging selector', () => {
    expect(template).toContain('aria-label="Item-Vorschau"');
    expect(template).toContain('[title]="\'Player-Vorschau für Item \' + vm.selectedItem.itemId"');
    expect(template).toContain('aria-label="Seitendarstellung der Player-Vorschau"');
  });

  it('offers a dedicated fullscreen action for the player preview', () => {
    expect(template).toContain('#playerContainer');
    expect(template).toContain('(click)="togglePlayerFullscreen()"');
    expect(template).toContain("'Player-Vorschau im Vollbild anzeigen'");
    expect(template).toContain("'Vollbild der Player-Vorschau beenden'");
  });

  it('offers a labelled, non-persistent correct-solution mode', () => {
    expect(template).toContain('(click)="vm.toggleCorrectSolution()"');
    expect(template).toContain('[attr.aria-pressed]="vm.correctSolutionRequested"');
    expect(template).toContain(
      '[disabled]="!vm.canPreviewSelectedItem && !vm.correctSolutionRequested"',
    );
    expect(template).toContain('Musterlösung – nicht gespeichert');
    expect(template).toContain('Keine eindeutige Musterlösung');
    expect(template.replace(/\s+/g, ' ')).toContain(
      'Aus den hinterlegten Bewertungsregeln lässt sich keine eindeutige Antwort ableiten.',
    );
    expect(template).toContain('<summary>Technische Details</summary>');
    expect(template).toContain('<span>{{ vm.correctSolutionPrefill.message }}</span>');
    expect(template).toContain('[disabled]="!vm.canSaveCurrentResponseState"');
  });

  it('opens and closes the existing player container with the Fullscreen API', async () => {
    const { component } = createPreview();
    const container = document.createElement('div');
    const toggle = document.createElement('button');
    const focus = vi.spyOn(toggle, 'focus');
    let fullscreenElement: Element | null = null;
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = container;
    });
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
    });
    Object.defineProperty(container, 'requestFullscreen', { value: requestFullscreen });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    component.playerContainerElement = new ElementRef(container);
    component.fullscreenToggleElement = new ElementRef(toggle);

    try {
      await component.togglePlayerFullscreen();
      expect(component.isPlayerFullscreen).toBe(true);
      await component.togglePlayerFullscreen();
      component.handlePlayerFullscreenChange();

      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(exitFullscreen).toHaveBeenCalledOnce();
      expect(component.isPlayerFullscreen).toBe(false);
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      component.ngOnDestroy();
      if (fullscreenDescriptor) {
        Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor);
      } else {
        delete (document as any).fullscreenElement;
      }
      if (exitDescriptor) {
        Object.defineProperty(document, 'exitFullscreen', exitDescriptor);
      } else {
        delete (document as any).exitFullscreen;
      }
    }
  });

  it('uses a closable fullscreen fallback when the browser API is unavailable', async () => {
    const { component } = createPreview();
    const container = document.createElement('div');
    const toggle = document.createElement('button');
    const focus = vi.spyOn(toggle, 'focus');
    component.playerContainerElement = new ElementRef(container);
    component.fullscreenToggleElement = new ElementRef(toggle);

    await component.togglePlayerFullscreen();

    expect(component.isPlayerFullscreenFallback).toBe(true);
    expect(component.isPlayerFullscreen).toBe(true);

    component.handlePlayerFullscreenKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.isPlayerFullscreenFallback).toBe(false);
    expect(component.isPlayerFullscreen).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    component.ngOnDestroy();
  });

  it('does not activate the fallback when leaving native fullscreen fails', async () => {
    const { component } = createPreview();
    const container = document.createElement('div');
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    const exitFullscreen = vi.fn().mockRejectedValue(new Error('fullscreen exit blocked'));
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => container,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    component.playerContainerElement = new ElementRef(container);

    try {
      await component.togglePlayerFullscreen();

      expect(exitFullscreen).toHaveBeenCalledOnce();
      expect(component.isPlayerFullscreen).toBe(true);
      expect(component.isPlayerFullscreenFallback).toBe(false);
    } finally {
      component.ngOnDestroy();
      if (fullscreenDescriptor) {
        Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor);
      } else {
        delete (document as any).fullscreenElement;
      }
      if (exitDescriptor) {
        Object.defineProperty(document, 'exitFullscreen', exitDescriptor);
      } else {
        delete (document as any).exitFullscreen;
      }
    }
  });

  it('owns iframe messages and ignores messages from other windows', () => {
    const { component, feature } = createPreview();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const frame = new ElementRef(iframe);
    component.playerFrame = frame;
    const ownMessage = new MessageEvent('message', {
      source: iframe.contentWindow,
      data: { type: 'vopResizeNotification', height: 900 },
    });
    const foreignMessage = new MessageEvent('message', {
      source: window,
      data: { type: 'vopResizeNotification', height: 1 },
    });

    window.dispatchEvent(ownMessage);
    window.dispatchEvent(foreignMessage);

    expect(feature.playerFrameChanged).toHaveBeenCalledWith(true);
    expect(feature.handlePlayerMessage).toHaveBeenCalledOnce();
    expect(feature.handlePlayerMessage).toHaveBeenCalledWith(ownMessage.data);
    expect(component.vm).toBe(feature.previewViewModel);

    component.playerFrame = undefined;
    expect(feature.playerFrameChanged).toHaveBeenLastCalledWith(false);
    component.ngOnDestroy();
    iframe.remove();
    expect(feature.unregisterPlayerDom).toHaveBeenCalledWith(component);
  });

  it('focuses and highlights targets inside the player document', () => {
    const { component } = createPreview();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const target = iframe.contentDocument!.createElement('button');
    target.id = 'target';
    Object.defineProperty(target, 'getClientRects', { value: () => [{ width: 10, height: 10 }] });
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView });
    Object.defineProperty(target, 'focus', { value: focus });
    iframe.contentDocument!.body.appendChild(target);
    component.playerFrame = new ElementRef(iframe);

    expect(component.focus(['#target'], [], true)).toBe(true);
    expect(target.classList.contains('ch-item-focus-highlight')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();

    component.ngOnDestroy();
    iframe.remove();
  });

  it('does not focus a hidden target through an unrelated text fallback', () => {
    const { component } = createPreview();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML =
      '<button id="target" style="display:none">Item</button><p>Item</p>';
    component.playerFrame = new ElementRef(iframe);
    expect(component.isTargetVisible(['#target'])).toBe(false);
    expect(component.focus(['#target'], ['Item'], true)).toBe(false);
    component.ngOnDestroy();
    iframe.remove();
  });

  it('replaces Aspect print aliases without changing the underlying player model', () => {
    const { component } = createPreview();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const label = iframe.contentDocument!.createElement('div');
    label.className = 'element-label';
    label.textContent = '04';
    iframe.contentDocument!.body.appendChild(label);
    component.playerFrame = new ElementRef(iframe);

    component.setPrintLabelOverrides({ '04': 'DLB01303' });

    expect(label.textContent).toBe('DLB01303');
    expect(label.dataset['cpOriginalPrintLabel']).toBe('04');

    component.setPrintLabelOverrides({});
    expect(label.textContent).toBe('04');
    expect(label.dataset['cpOriginalPrintLabel']).toBeUndefined();

    component.ngOnDestroy();
    iframe.remove();
  });
});
