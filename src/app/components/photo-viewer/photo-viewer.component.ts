import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Platform } from '@ionic/angular';

import { REVIEW_PREVIEW_SIZE } from '../../core/constants/app.constants';
import { ThumbnailService } from '../../core/services/thumbnail.service';
import { IconComponent } from '../icon/icon.component';

/** Full-screen look at a photo preview. Closes with the button, Escape, or the Android back button. */
@Component({
  selector: 'app-photo-viewer',
  template: `
    <section
      class="pf-viewer"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Full screen preview of ' + fileName()"
      (keydown.escape)="closed.emit()"
    >
      @if (shown()) {
        <img class="pf-viewer__image" [src]="shown()" [alt]="'Preview of ' + fileName()" />
      } @else {
        <p class="pf-viewer__empty">{{ failed() ? 'The preview could not be loaded.' : 'Loading preview…' }}</p>
      }
      <p class="pf-viewer__name">{{ fileName() }}</p>
      <button #closeButton type="button" class="pf-viewer__close" aria-label="Close full screen preview" (click)="closed.emit()">
        <app-icon name="close" [size]="22" [stroke]="2.4" />
      </button>
    </section>
  `,
  host: { class: 'pf-viewer-host' },
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewerComponent {
  /** A preview that is already loaded. */
  readonly src = input<string | null>(null);
  /** Otherwise the viewer loads the cached review-size preview for this URI (never the original). */
  readonly uri = input<string | null>(null);
  readonly fileName = input('');
  readonly closed = output<void>();

  readonly shown = computed(() => this.src() ?? this.loaded());

  readonly failed = signal(false);
  private readonly loaded = signal<string | null>(null);
  private readonly thumbnails = inject(ThumbnailService);
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    effect(() => {
      const uri = this.uri();
      if (!this.src() && uri) {
        this.thumbnails.preview(uri, REVIEW_PREVIEW_SIZE).then(
          (preview) => this.loaded.set(preview),
          () => this.failed.set(true),
        );
      }
    });
    afterNextRender(() => this.closeButton().nativeElement.focus());
    // Android back closes the viewer instead of leaving the review screen.
    const back = inject(Platform).backButton.subscribeWithPriority(110, () => this.closed.emit());
    inject(DestroyRef).onDestroy(() => back.unsubscribe());
  }
}
