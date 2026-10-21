import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PhotoScannerService } from '../../core/services/photo-scanner.service';
import { IconComponent } from '../icon/icon.component';

const DONE_VISIBLE_MS = 8000;

/** Popup at the top of the tabs while a scan runs, then a short "Scan complete" note. */
@Component({
  selector: 'app-scan-status',
  template: `
    <div class="pf-scan-status" role="status" aria-live="polite">
      @if (status().state === 'scanning' && !status().hidden) {
        <div class="pf-scan-popup">
          <div class="pf-scan-popup__row">
            <span class="pf-icon-tile pf-icon-tile--small pf-icon-tile--keep">
              <app-icon class="pf-spin" name="spinner" [stroke]="2.4" />
            </span>
            <span class="pf-scan-popup__text">
              <strong>Scanning photos…</strong>
              <span class="pf-caption">{{ foundLabel() }} · you can keep using the app</span>
            </span>
            <button type="button" class="pf-scan-popup__close" aria-label="Hide scan progress" (click)="dismiss()">
              <app-icon name="close" [size]="18" [stroke]="2" />
            </button>
          </div>
          <div class="pf-progress pf-progress--thin" role="progressbar" aria-label="Scanning photos">
            <div class="pf-progress__fill pf-indeterminate"></div>
          </div>
        </div>
      } @else if (status().state === 'done') {
        <div class="pf-scan-popup pf-scan-popup__row">
          <span class="pf-icon-tile pf-icon-tile--small pf-icon-tile--success">
            <app-icon name="check" [stroke]="2.4" />
          </span>
          <span class="pf-scan-popup__text">
            <strong>Scan complete</strong>
            <span class="pf-caption">{{ doneLabel() }}</span>
          </span>
          @if (status().inserted > 0) {
            <button type="button" class="pf-link pf-scan-popup__action" (click)="review()">Review</button>
          } @else {
            <button type="button" class="pf-scan-popup__close" aria-label="Close" (click)="dismiss()">
              <app-icon name="close" [size]="18" [stroke]="2" />
            </button>
          }
        </div>
      }
    </div>
  `,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScanStatusComponent {
  private readonly scanner = inject(PhotoScannerService);
  private readonly router = inject(Router);

  readonly status = this.scanner.status;
  readonly foundLabel = computed(() => {
    const found = this.status().found;
    return found ? `${format(found)} found so far` : 'Reading your gallery';
  });
  readonly doneLabel = computed(() => {
    const inserted = this.status().inserted;
    if (inserted === 0) {
      return 'No new photos';
    }
    return `${format(inserted)} new ${inserted === 1 ? 'photo' : 'photos'} ready to review`;
  });

  constructor() {
    effect((onCleanup) => {
      if (this.status().state !== 'done') {
        return;
      }
      const timer = window.setTimeout(() => this.scanner.dismissStatus(), DONE_VISIBLE_MS);
      onCleanup(() => window.clearTimeout(timer));
    });
  }

  dismiss(): void {
    this.scanner.dismissStatus();
  }

  review(): void {
    this.scanner.dismissStatus();
    void this.router.navigateByUrl('/review');
  }
}

function format(value: number): string {
  return new Intl.NumberFormat().format(value);
}
