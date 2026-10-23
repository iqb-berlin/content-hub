import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-split-pane',
  standalone: true,
  template: `
    <div
      class="split-pane"
      #container
      [class.dragging]="isDragging"
      [class.single-pane]="hideRight"
    >
      <div class="pane pane-left" [style.width.%]="hideRight ? 100 : leftPercent">
        <ng-content select="[left]"></ng-content>
      </div>
      @if (!hideRight) {
        <div class="divider" [class.active]="isDragging" (mousedown)="onDragStart($event)">
          <div class="divider-handle"></div>
        </div>
        <div class="pane pane-right">
          <ng-content select="[right]"></ng-content>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .split-pane {
        display: flex;
        height: 100%;
        min-height: 0;
      }
      .split-pane.dragging {
        cursor: col-resize;
        user-select: none;
      }
      .split-pane.dragging .pane {
        pointer-events: none;
      }
      .pane {
        overflow: hidden;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .pane-left {
        flex-shrink: 0;
      }
      .pane-right {
        flex: 1;
        min-width: 0;
      }
      .divider {
        width: 8px;
        cursor: col-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        position: relative;
        z-index: 10;
        transition: background 0.15s;
      }
      .divider:hover,
      .divider.active {
        background: rgba(41, 128, 185, 0.08);
      }
      .divider-handle {
        width: 4px;
        height: 48px;
        border-radius: 2px;
        background: var(--color-border, #dfe6e9);
        transition:
          background 0.15s,
          height 0.15s;
      }
      .divider:hover .divider-handle,
      .divider.active .divider-handle {
        background: var(--color-primary-light, #2980b9);
        height: 64px;
      }
    `,
  ],
})
export class SplitPaneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('container') container!: ElementRef<HTMLElement>;

  private rightHidden = false;
  @Input()
  get hideRight(): boolean {
    return this.rightHidden;
  }
  set hideRight(value: boolean) {
    this.rightHidden = value;
    if (value) {
      this.isDragging = false;
      this.cleanupListeners();
    }
  }
  @Input() initialLeftPercent = 45;
  @Input() minLeftPx = 300;
  @Input() minRightPx = 350;

  leftPercent = 45;
  isDragging = false;

  private moveListener: ((e: MouseEvent) => void) | null = null;
  private upListener: (() => void) | null = null;

  ngAfterViewInit() {
    this.leftPercent = this.initialLeftPercent;
  }

  ngOnDestroy() {
    this.cleanupListeners();
  }

  onDragStart(event: MouseEvent) {
    if (this.hideRight) return;
    event.preventDefault();
    this.isDragging = true;

    this.moveListener = (e: MouseEvent) => {
      if (!this.container?.nativeElement) return;
      const rect = this.container.nativeElement.getBoundingClientRect();
      const totalWidth = rect.width;
      const x = e.clientX - rect.left;

      // Enforce minimum widths
      const minLeft = this.minLeftPx;
      const minRight = this.minRightPx;
      const clampedX = Math.max(minLeft, Math.min(totalWidth - minRight, x));

      this.leftPercent = (clampedX / totalWidth) * 100;
    };

    this.upListener = () => {
      this.isDragging = false;
      this.cleanupListeners();
    };

    document.addEventListener('mousemove', this.moveListener);
    document.addEventListener('mouseup', this.upListener);
  }

  private cleanupListeners() {
    if (this.moveListener) {
      document.removeEventListener('mousemove', this.moveListener);
      this.moveListener = null;
    }
    if (this.upListener) {
      document.removeEventListener('mouseup', this.upListener);
      this.upListener = null;
    }
  }
}
