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

import { ThumbnailService } from '../../core/services/thumbnail.service';
import { fullScreenPreviewSize } from '../../core/utils/preview-size';
import { IconComponent } from '../icon/icon.component';
import {
  containedSize,
  distance,
  DOUBLE_TAP_ZOOM,
  Frame,
  midpoint,
  NO_ZOOM,
  pan,
  Point,
  zoomAround,
  ZoomState,
} from './photo-zoom';

const TAP_SLOP_PX = 10;
const TAP_MS = 250;
const DOUBLE_TAP_MS = 300;
const KEY_ZOOM_STEP = 1.5;

interface GestureStart {
  zoom: ZoomState;
  points: Point[];
}

interface Tap {
  at: number;
  point: Point;
}

/**
 * Full-screen look at a photo preview. Closes with the button, Escape, or the Android back button.
 * Pinch (or double tap, or the + / - / 0 keys) zooms; one finger pans while zoomed.
 */
@Component({
  selector: 'app-photo-viewer',
  template: `
    <section
      class="pf-viewer"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Full screen preview of ' + fileName()"
      (keydown.escape)="closed.emit()"
      (keydown)="onKey($event)"
    >
      @if (shown()) {
        <img
          #image
          class="pf-viewer__image"
          draggable="false"
          [class.pf-viewer__image--animating]="animating()"
          [style.transform]="transform()"
          [src]="shown()"
          [alt]="'Preview of ' + fileName() + '. Pinch or double tap to zoom.'"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerEnd($event)"
          (pointercancel)="onPointerEnd($event)"
        />
      } @else {
        <p class="pf-viewer__empty">{{ failed() || loadFailed() ? 'The preview could not be loaded.' : 'Loading preview…' }}</p>
      }
      <p class="pf-viewer__name">{{ fileName() }}</p>
      <button #closeButton type="button" class="pf-viewer__close" aria-label="Close full screen preview" (click)="closed.emit()">
        <app-icon name="close" [size]="22" [stroke]="2.4" />
      </button>
      <!-- Optional details under the photo, such as the Nextcloud info sheet. -->
      <ng-content />
    </section>
  `,
  host: { class: 'pf-viewer-host' },
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewerComponent {
  /** A preview that is already loaded. */
  readonly src = input<string | null>(null);
  /** Otherwise the viewer loads the cached full-screen preview for this URI (never the original). */
  readonly uri = input<string | null>(null);
  readonly fileName = input('');
  /** Set when a preview passed in through `src` could not be loaded. */
  readonly loadFailed = input(false);
  readonly closed = output<void>();

  readonly shown = computed(() => this.src() ?? this.loaded());

  readonly failed = signal(false);
  readonly zoom = signal<ZoomState>(NO_ZOOM);
  readonly animating = signal(false);
  readonly transform = computed(() => {
    const { scale, x, y } = this.zoom();
    return scale === 1 ? null : `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  });

  private readonly loaded = signal<string | null>(null);
  private readonly thumbnails = inject(ThumbnailService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly image = viewChild<ElementRef<HTMLImageElement>>('image');
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly pointers = new Map<number, Point>();
  private gesture: GestureStart | null = null;
  private pressStart: Tap | null = null;
  private lastTap: Tap | null = null;

  constructor() {
    effect(() => {
      const uri = this.uri();
      if (!this.src() && uri) {
        this.thumbnails.preview(uri, fullScreenPreviewSize()).then(
          (preview) => this.loaded.set(preview),
          () => this.failed.set(true),
        );
      }
    });
    effect(() => {
      this.shown();
      this.zoom.set(NO_ZOOM);
    });
    afterNextRender(() => this.closeButton().nativeElement.focus());
    // Android back closes the viewer instead of leaving the review screen.
    const back = inject(Platform).backButton.subscribeWithPriority(110, () => this.closed.emit());
    inject(DestroyRef).onDestroy(() => back.unsubscribe());
  }

  onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone; the gesture still works without capture.
    }
    const point = this.toViewer(event);
    this.pointers.set(event.pointerId, point);
    this.animating.set(false);
    this.pressStart = this.pointers.size === 1 ? { at: event.timeStamp, point } : null;
    this.restartGesture();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId) || !this.gesture) {
      return;
    }
    this.pointers.set(event.pointerId, this.toViewer(event));
    const points = [...this.pointers.values()];
    const start = this.gesture;
    if (points.length >= 2 && start.points.length >= 2) {
      const startDistance = distance(start.points[0], start.points[1]);
      if (startDistance > 0) {
        const scale = (start.zoom.scale * distance(points[0], points[1])) / startDistance;
        const from = midpoint(start.points[0], start.points[1]);
        this.zoom.set(zoomAround(start.zoom, scale, from, midpoint(points[0], points[1]), this.frame()));
      }
    } else if (points.length === 1 && start.zoom.scale > 1) {
      const dx = points[0].x - start.points[0].x;
      const dy = points[0].y - start.points[0].y;
      this.zoom.set(pan(start.zoom, dx, dy, this.frame()));
    }
  }

  onPointerEnd(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) {
      return;
    }
    if (event.type === 'pointerup' && this.pointers.size === 0) {
      this.handleTap(event.timeStamp, this.toViewer(event));
    }
    this.restartGesture();
  }

  onKey(event: KeyboardEvent): void {
    const scale = this.zoom().scale;
    let next: number | null = null;
    if (event.key === '+' || event.key === '=') {
      next = scale * KEY_ZOOM_STEP;
    } else if (event.key === '-') {
      next = scale / KEY_ZOOM_STEP;
    } else if (event.key === '0') {
      next = 1;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    const center = { x: 0, y: 0 };
    this.animating.set(true);
    this.zoom.set(zoomAround(this.zoom(), next, center, center, this.frame()));
  }

  /** Double tap zooms in on the tapped spot, or back out when already zoomed. */
  private handleTap(at: number, point: Point): void {
    const press = this.pressStart;
    this.pressStart = null;
    if (!press || at - press.at > TAP_MS || distance(press.point, point) > TAP_SLOP_PX) {
      this.lastTap = null;
      return;
    }
    const previous = this.lastTap;
    if (!previous || at - previous.at > DOUBLE_TAP_MS || distance(previous.point, point) > TAP_SLOP_PX * 3) {
      this.lastTap = { at, point };
      return;
    }
    this.lastTap = null;
    this.animating.set(true);
    const center = { x: 0, y: 0 };
    this.zoom.set(
      this.zoom().scale > 1 ? NO_ZOOM : zoomAround(this.zoom(), DOUBLE_TAP_ZOOM, point, center, this.frame()),
    );
  }

  private restartGesture(): void {
    if (this.pointers.size === 0) {
      this.gesture = null;
      // A pinch that ends just above 1x snaps back to the fitted photo.
      if (this.zoom().scale < 1.05) {
        this.zoom.set(NO_ZOOM);
      }
      return;
    }
    // Rebase on every finger change so adding or lifting one does not make the photo jump.
    this.gesture = { zoom: this.zoom(), points: [...this.pointers.values()] };
  }

  /** Point relative to the centre of the photo's box (the whole viewer unless details sit below it). */
  private toViewer(event: PointerEvent): Point {
    const stage = this.stage();
    return { x: event.clientX - stage.left - stage.width / 2, y: event.clientY - stage.top - stage.height / 2 };
  }

  private frame(): Frame {
    const stage = this.stage();
    const viewer = { width: stage.width, height: stage.height };
    const image = this.image()?.nativeElement;
    const natural = { width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 };
    return { viewer, content: containedSize(natural, viewer) };
  }

  /** The image's layout box, which zooming (a transform) does not change. */
  private stage(): { left: number; top: number; width: number; height: number } {
    const rect = this.host.nativeElement.getBoundingClientRect();
    const image = this.image()?.nativeElement;
    if (!image || !image.offsetWidth || !image.offsetHeight) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return {
      left: rect.left + image.offsetLeft,
      top: rect.top + image.offsetTop,
      width: image.offsetWidth,
      height: image.offsetHeight,
    };
  }
}
