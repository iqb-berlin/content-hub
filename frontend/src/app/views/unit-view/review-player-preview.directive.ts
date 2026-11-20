import {
  computed,
  Directive,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  signal,
} from '@angular/core';

const MIN_REVIEW_PLAYER_SCALE = 0.6;

@Directive({
  selector: '[appReviewPlayerPreview]',
  exportAs: 'reviewPlayerPreview',
  host: {
    '[class.review-player-preview]': 'viewport() !== null',
    '[class.review-player-preview-too-small]': 'tooSmall()',
    '[style.--review-player-reference-width.px]': 'viewport()?.width',
    '[style.--review-player-scale]': 'viewport()?.scale',
  },
})
export class ReviewPlayerPreviewDirective implements OnChanges, OnDestroy {
  @Input() appReviewPlayerPreview: HTMLElement | null = null;
  @Output() reviewPreviewHidden = new EventEmitter<void>();

  protected readonly viewport = signal<{ width: number; scale: number } | null>(null);
  readonly tooSmall = computed(() => (this.viewport()?.scale ?? 1) < MIN_REVIEW_PLAYER_SCALE);

  private readonly container = inject(ElementRef<HTMLElement>).nativeElement;
  private observer?: ResizeObserver;

  ngOnChanges() {
    this.observer?.disconnect();
    this.viewport.set(null);

    const layout = this.appReviewPlayerPreview;
    if (!layout || typeof ResizeObserver === 'undefined') return;

    this.observer = new ResizeObserver(() => {
      const availableWidth = this.container.clientWidth;
      const horizontalBorder = this.container.offsetWidth - availableWidth;
      // The grid spans the same width when the Review column is collapsed.
      const width = layout.clientWidth - horizontalBorder;
      if (width <= 0) return;

      const scale = Math.min(1, availableWidth / width);
      const previous = this.viewport();
      if (previous?.width !== width || previous.scale !== scale) {
        const wasTooSmall = this.tooSmall();
        this.viewport.set({ width, scale });
        if (!wasTooSmall && this.tooSmall()) this.reviewPreviewHidden.emit();
      }
    });
    this.observer.observe(layout);
    this.observer.observe(this.container);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
