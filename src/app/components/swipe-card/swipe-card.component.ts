import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { Photo } from '../../core/models/photo.model';
import { formatBytes } from '../../core/utils/bytes';
import { IconComponent } from '../icon/icon.component';

const DECIDE_AT = 96;
const LEAN_AT = 40;
const TAP_SLOP = 8;

/**
 * The review card. Drag left past DECIDE_AT px to mark for deletion, right to keep.
 * Nothing is deleted here; the page decides what a choice does.
 */
@Component({
  selector: 'app-swipe-card',
  template: `
    <div class="pf-swipe">
      <div class="pf-swipe__back pf-swipe__back--far" aria-hidden="true"></div>
      <div class="pf-swipe__back" aria-hidden="true"></div>
      <article
        class="pf-swipe__card"
        aria-label="Current photo"
        [class.settling]="settling()"
        [class.leaning-delete]="lean() === 'delete'"
        [class.leaning-keep]="lean() === 'keep'"
        [style.transform]="transform()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
      >
        <div class="pf-swipe__photo">
          @if (previewUrl()) {
            <img [src]="previewUrl()" [alt]="'Preview of ' + photo().fileName" draggable="false" />
          } @else {
            <span class="pf-swipe__fallback" role="img" [attr.aria-label]="'Preview of ' + photo().fileName">
              <app-icon name="image" [size]="36" />
            </span>
          }
          @if (lean() === 'delete') {
            <span class="pf-stamp pf-stamp--delete" aria-hidden="true"><app-icon name="close" [size]="20" [stroke]="2.4" />Delete</span>
          } @else if (lean() === 'keep') {
            <span class="pf-stamp pf-stamp--keep" aria-hidden="true"><app-icon name="check" [size]="20" [stroke]="2.6" />Keep</span>
          }
        </div>
        <div class="pf-swipe__info">
          <div class="pf-swipe__text">
            <span class="pf-swipe__name">{{ photo().fileName }}</span>
            <span class="pf-caption">{{ meta() }}</span>
          </div>
          @if (photo().duplicateGroup) {
            <span class="pf-pill"><app-icon name="copy" [size]="13" [stroke]="2.2" />Has a copy</span>
          }
          <button type="button" class="pf-swipe__expand" aria-label="View photo full screen" (click)="opened.emit()">
            <app-icon name="expand" [size]="20" [stroke]="2" />
          </button>
        </div>
      </article>
    </div>
  `,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwipeCardComponent {
  readonly photo = input.required<Photo>();
  readonly previewUrl = input<string | null>(null);
  readonly decision = output<'keep' | 'delete'>();
  /** A tap on the photo (no drag) asks for the full-screen preview. */
  readonly opened = output<void>();

  readonly offset = signal(0);
  readonly settling = signal(false);
  readonly lean = computed(() => {
    const offset = this.offset();
    if (offset <= -LEAN_AT) {
      return 'delete';
    }
    return offset >= LEAN_AT ? 'keep' : null;
  });
  readonly transform = computed(() => {
    const shift = this.offset();
    const tilt = Math.max(-9, Math.min(9, shift / 30));
    return shift === 0 ? 'none' : `translateX(${shift}px) rotate(${tilt}deg)`;
  });
  readonly meta = computed(() => {
    const photo = this.photo();
    const parts: string[] = [];
    if (photo.dateTaken > 0) {
      parts.push(
        new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(photo.dateTaken),
      );
    }
    parts.push(formatBytes(photo.sizeBytes));
    if (photo.width > 0 && photo.height > 0) {
      parts.push(`${photo.width} × ${photo.height}`);
    }
    return parts.join(' · ');
  });

  private startX = 0;
  private dragging = false;
  private startedOnPhoto = false;

  onPointerDown(event: PointerEvent): void {
    // Buttons inside the card handle their own clicks; capturing the pointer would swallow them.
    if (this.settling() || (event.target as Element).closest('button')) {
      return;
    }
    this.dragging = true;
    this.startedOnPhoto = Boolean((event.target as Element).closest('.pf-swipe__photo'));
    this.startX = event.clientX;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.dragging) {
      this.offset.set(event.clientX - this.startX);
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    const delta = event.clientX - this.startX;
    if (Math.abs(delta) < TAP_SLOP) {
      this.offset.set(0);
      if (this.startedOnPhoto && event.type === 'pointerup') {
        this.opened.emit();
      }
      return;
    }
    if (delta <= -DECIDE_AT) {
      this.finish('delete');
      return;
    }
    if (delta >= DECIDE_AT) {
      this.finish('keep');
      return;
    }
    this.settling.set(true);
    this.offset.set(0);
    window.setTimeout(() => this.settling.set(false), 180);
  }

  private finish(choice: 'keep' | 'delete'): void {
    this.settling.set(true);
    this.offset.set(choice === 'keep' ? 560 : -560);
    window.setTimeout(() => {
      this.decision.emit(choice);
      this.offset.set(0);
      this.settling.set(false);
    }, 180);
  }
}
