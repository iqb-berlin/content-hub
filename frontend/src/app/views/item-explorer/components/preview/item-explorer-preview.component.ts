import { Component, ElementRef, HostListener, Inject, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ItemExplorerFacade } from '../../item-explorer.facade';
import { ItemExplorerPreviewViewModel } from '../../item-explorer.view-models';
import { ItemExplorerPlayerDomPort } from '../../item-explorer.dom-ports';
import { presentPlayerPreviewTriggers } from '../../../../core/utils/player-preview-triggers';
import { ItemCommentThreadComponent } from '../../../comment-thread/item-comment-thread.component';
import { StudioItemCommentsComponent } from '../studio-comments/studio-item-comments.component';

@Component({
  selector: 'app-item-explorer-preview',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ItemCommentThreadComponent,
    StudioItemCommentsComponent,
  ],
  templateUrl: './item-explorer-preview.component.html',
  styleUrl: './item-explorer-preview.component.css',
})
export class ItemExplorerPreviewComponent implements OnDestroy, ItemExplorerPlayerDomPort {
  private frame?: ElementRef<HTMLIFrameElement>;
  private playerContainer?: ElementRef<HTMLDivElement>;
  private fullscreenToggle?: ElementRef<HTMLButtonElement>;
  private autoResizeInterval: ReturnType<typeof setInterval> | null = null;
  private printLabelObserver: MutationObserver | null = null;
  private printLabelOverrides = new Map<string, string>();
  private lastInteractionTime = 0;
  private stopObservingInteractions?: () => void;
  isPlayerFullscreen = false;
  isPlayerFullscreenFallback = false;
  readonly vm: ItemExplorerPreviewViewModel;
  private readonly messageHandler = (event: MessageEvent) => {
    const frameWindow = this.frame?.nativeElement.contentWindow;
    if (!frameWindow || event.source !== frameWindow) return;
    this.feature.handlePlayerMessage(event.data);
  };

  @ViewChild('playerFrame')
  set playerFrame(value: ElementRef<HTMLIFrameElement> | undefined) {
    this.stopObservingInteractions?.();
    this.disconnectPrintLabelObserver();
    this.frame = value;
    this.feature.playerFrameChanged(Boolean(value));
    this.observePrintLabels();
  }

  @ViewChild('playerContainer')
  set playerContainerElement(value: ElementRef<HTMLDivElement> | undefined) {
    this.playerContainer = value;
    this.syncPlayerFullscreenState();
  }

  @ViewChild('fullscreenToggle')
  set fullscreenToggleElement(value: ElementRef<HTMLButtonElement> | undefined) {
    this.fullscreenToggle = value;
  }

  constructor(@Inject(ItemExplorerFacade) private readonly feature: ItemExplorerFacade) {
    this.vm = feature.previewViewModel;
    feature.registerPlayerDom(this);
    window.addEventListener('message', this.messageHandler);
  }

  ngOnDestroy(): void {
    this.stopObservingInteractions?.();
    window.removeEventListener('message', this.messageHandler);
    this.stopAutoResize();
    this.disconnectPrintLabelObserver();
    this.frame = undefined;
    this.feature.unregisterPlayerDom(this);
  }

  @HostListener('document:fullscreenchange')
  handlePlayerFullscreenChange(): void {
    const wasFullscreen = this.isPlayerFullscreen;
    this.syncPlayerFullscreenState();
    if (wasFullscreen && !this.isPlayerFullscreen) this.restoreFullscreenToggleFocus();
  }

  @HostListener('document:keydown', ['$event'])
  handlePlayerFullscreenKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.isPlayerFullscreenFallback) return;
    this.closePlayerFullscreenFallback();
  }

  async togglePlayerFullscreen(): Promise<void> {
    const container = this.playerContainer?.nativeElement;
    if (!container) return;

    if (this.isPlayerFullscreenFallback) {
      this.closePlayerFullscreenFallback();
      return;
    }

    if (document.fullscreenElement === container) {
      try {
        await document.exitFullscreen?.();
      } catch {
        this.syncPlayerFullscreenState();
        return;
      }
      this.syncPlayerFullscreenState();
      if (!this.isPlayerFullscreen) this.restoreFullscreenToggleFocus();
      return;
    }

    try {
      if (container.requestFullscreen) {
        await container.requestFullscreen();
      } else {
        this.openPlayerFullscreenFallback();
        return;
      }
      this.syncPlayerFullscreenState();
    } catch {
      this.openPlayerFullscreenFallback();
    }
  }

  hasFrame(): boolean {
    return Boolean(this.frame?.nativeElement.contentWindow);
  }

  postMessage(message: unknown): void {
    if ((message as { type?: string })?.type === 'vopStartCommand') this.observeInteractions();
    this.frame?.nativeElement.contentWindow?.postMessage(message, '*');
  }

  getLastInteractionTime(): number {
    return this.lastInteractionTime;
  }

  private observeInteractions(): void {
    this.stopObservingInteractions?.();
    this.lastInteractionTime = 0;
    const doc = this.getPlayerDocument();
    if (!doc) return;
    const changed = (event: Event) => {
      const target = event.target as Element | null;
      // Clicking ordinary text or focusing a control does not change player state.
      if (event.type === 'click' && !target?.closest?.('button, [role="button"]')) return;
      // Media UI inputs include volume. Playback/seek events below report progression.
      if (
        (event.type === 'input' || event.type === 'click') &&
        target?.closest?.('[data-element-id]')?.querySelector('audio, video')
      )
        return;
      this.lastInteractionTime = Date.now();
    };
    // Text controls also emit `change` on blur, after their input was already reported.
    const events = ['input', 'click', 'play', 'pause', 'timeupdate', 'seeked', 'ended'];
    for (const type of events) doc.addEventListener(type, changed, true);
    this.stopObservingInteractions = () => {
      for (const type of events) doc.removeEventListener(type, changed, true);
    };
  }

  isTargetVisible(selectors: string[]): boolean {
    const doc = this.getPlayerDocument();
    return (
      !!doc &&
      selectors.some((selector) => {
        const element = doc.querySelector<HTMLElement>(selector);
        return (
          !!element?.getClientRects().length &&
          doc.defaultView?.getComputedStyle(element).visibility !== 'hidden'
        );
      })
    );
  }

  async preparePage(ids: string[], signal: AbortSignal): Promise<void> {
    const doc = this.getPlayerDocument();
    if (doc) await presentPlayerPreviewTriggers(doc, ids, signal);
  }

  focus(
    selectors: string[],
    textCandidates: Array<string | undefined>,
    highlight: boolean,
  ): boolean {
    const doc = this.getPlayerDocument();
    if (!doc?.body) return false;

    const matchedTargets = selectors
      .map((selector) => doc.querySelector<HTMLElement>(selector))
      .filter((target): target is HTMLElement => !!target);
    const selectorTarget = matchedTargets.find((target) => !!target.getClientRects().length);
    if (matchedTargets.length && !selectorTarget) return false;
    const target = selectorTarget || this.findElementByText(doc, textCandidates);
    if (!target) return false;

    doc
      .querySelectorAll('.cp-item-focus-highlight')
      .forEach((element) => element.classList.remove('cp-item-focus-highlight'));
    if (highlight) {
      this.ensureFocusStyle(doc);
      target.classList.add('cp-item-focus-highlight');
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    try {
      target.focus({ preventScroll: true });
    } catch {
      // Some embedded player elements are intentionally not focusable.
    }
    return true;
  }

  setPrintLabelOverrides(overrides: Readonly<Record<string, string>>): void {
    this.printLabelOverrides = new Map(
      Object.entries(overrides).map(([identifier, label]) => [identifier.toLowerCase(), label]),
    );
    this.applyPrintLabelOverrides();
    this.observePrintLabels();
  }

  startAutoResize(onHeightChange: (height: number) => void): void {
    this.stopAutoResize();
    this.autoResizeInterval = setInterval(() => {
      try {
        const doc = this.getPlayerDocument();
        if (!doc?.body) return;
        const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 600);
        if (height > 0) onHeightChange(height);
      } catch {
        // Cross-origin player frames cannot be measured.
      }
    }, 500);
  }

  stopAutoResize(): void {
    if (!this.autoResizeInterval) return;
    clearInterval(this.autoResizeInterval);
    this.autoResizeInterval = null;
  }

  private syncPlayerFullscreenState(): void {
    this.isPlayerFullscreen =
      this.isPlayerFullscreenFallback ||
      document.fullscreenElement === this.playerContainer?.nativeElement;
  }

  private openPlayerFullscreenFallback(): void {
    this.isPlayerFullscreenFallback = true;
    this.isPlayerFullscreen = true;
  }

  private closePlayerFullscreenFallback(): void {
    this.isPlayerFullscreenFallback = false;
    this.isPlayerFullscreen = false;
    this.restoreFullscreenToggleFocus();
  }

  private restoreFullscreenToggleFocus(): void {
    this.fullscreenToggle?.nativeElement.focus({ preventScroll: true });
  }

  private getPlayerDocument(): Document | null {
    const frame = this.frame?.nativeElement;
    return frame?.contentDocument || frame?.contentWindow?.document || null;
  }

  private observePrintLabels(): void {
    const body = this.getPlayerDocument()?.body;
    if (!body) return;

    this.disconnectPrintLabelObserver();
    this.applyPrintLabelOverrides();
    this.printLabelObserver = new MutationObserver(() => this.applyPrintLabelOverrides());
    this.printLabelObserver.observe(body, { childList: true, subtree: true });
  }

  private disconnectPrintLabelObserver(): void {
    this.printLabelObserver?.disconnect();
    this.printLabelObserver = null;
  }

  private applyPrintLabelOverrides(): void {
    const doc = this.getPlayerDocument();
    if (!doc) return;

    doc.querySelectorAll<HTMLElement>('.element-label').forEach((labelElement) => {
      const storedIdentifier = labelElement.dataset['cpOriginalPrintLabel'];
      const currentText = (labelElement.textContent || '').trim();
      const identifier = (storedIdentifier || currentText).trim();
      if (!identifier) return;

      const replacement = this.printLabelOverrides.get(identifier.toLowerCase());
      if (replacement) {
        labelElement.dataset['cpOriginalPrintLabel'] = identifier;
        if (currentText !== replacement) labelElement.textContent = replacement;
      } else if (storedIdentifier) {
        labelElement.textContent = storedIdentifier;
        delete labelElement.dataset['cpOriginalPrintLabel'];
      }
    });
  }

  private findElementByText(
    doc: Document,
    candidates: Array<string | undefined>,
  ): HTMLElement | null {
    const needles = candidates
      .map((value) => (value || '').trim().toLowerCase())
      .filter((value) => value.length > 1);
    if (!needles.length) return null;

    const nodes = Array.from(doc.querySelectorAll<HTMLElement>('label, span, div, p, li, button'));
    const maxScan = Math.min(nodes.length, 3000);
    for (let index = 0; index < maxScan; index += 1) {
      const node = nodes[index];
      const text = (node.textContent || '').trim().toLowerCase();
      if (text && needles.some((needle) => text === needle || text.includes(needle))) return node;
    }
    return null;
  }

  private ensureFocusStyle(doc: Document): void {
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
}
