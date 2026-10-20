import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { Photo } from '../../core/models/photo.model';
import { formatBytes } from '../../core/utils/bytes';
import { IconComponent } from '../icon/icon.component';
import { PhotoThumbComponent } from '../photo-thumb/photo-thumb.component';
import { PhotoViewerComponent } from '../photo-viewer/photo-viewer.component';

const MAX_THUMBS = 12;

export interface DeleteSummary {
  count: number;
  bytes: number;
  backupBeforeDelete: boolean;
  /** Photos that still need an upload first; null when not every photo is loaded. */
  uploadFirst: number | null;
  backedUp: number | null;
}

/** Bottom sheet that states what a delete will do and asks before anything is removed. */
@Component({
  selector: 'app-delete-sheet',
  template: `
    <div class="pf-sheet-backdrop" aria-hidden="true" (click)="cancelled.emit()"></div>
    <section
      class="pf-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-sheet-title"
      (keydown.escape)="cancelled.emit()"
    >
      <div class="pf-sheet__handle" aria-hidden="true"></div>
      <h2 id="delete-sheet-title" class="pf-sheet__title">Delete {{ countLabel() }}?</h2>
      @if (shownPhotos().length) {
        <ul class="pf-sheet__photos" aria-label="Photos to delete">
          @for (photo of shownPhotos(); track photo.id) {
            <li>
              <button
                type="button"
                class="pf-sheet__photo"
                [attr.aria-label]="'View ' + photo.fileName + ' full screen'"
                (click)="viewing.set(photo)"
              >
                <app-photo-thumb [uri]="photo.uri" />
                <span class="pf-sheet__zoom" aria-hidden="true"><app-icon name="expand" [size]="12" [stroke]="2.4" /></span>
              </button>
            </li>
          }
          @if (hiddenCount() > 0) {
            <li class="pf-sheet__more">+{{ hiddenCount() }}</li>
          }
        </ul>
        <p class="pf-caption pf-sheet__hint">Tap a photo to check it full screen.</p>
      }
      <ul class="pf-sheet__facts">
        <li>
          <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--delete"><app-icon name="trash" [size]="17" /></span>
          <span>Frees <strong>{{ bytesLabel() }}</strong> on this device.</span>
        </li>
        @if (summary().backupBeforeDelete) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--keep"><app-icon name="cloud-upload" [size]="17" /></span>
            <span>{{ backupLine() }}</span>
          </li>
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--success"><app-icon name="shield" [size]="17" /></span>
            <span>If an upload fails, that photo stays on this device.</span>
          </li>
        } @else {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--delete"><app-icon name="warning" [size]="17" /></span>
            <span>Backup before delete is off. Local delete will not keep a backup.</span>
          </li>
        }
      </ul>
      <div class="pf-sheet__actions">
        <button type="button" class="pf-button pf-button--danger pf-button--large" [disabled]="busy()" (click)="confirmed.emit()">
          {{ busy() ? 'Deleting…' : 'Delete ' + countLabel() }}
        </button>
        <button #cancelButton type="button" class="pf-button pf-button--secondary" (click)="cancelled.emit()">Cancel</button>
      </div>
      @if (native) {
        <p class="pf-caption pf-sheet__note">Android will ask you to confirm once more.</p>
      }
    </section>
    @if (viewing(); as photo) {
      <app-photo-viewer [uri]="photo.uri" [fileName]="photo.fileName" (closed)="closeViewer()" />
    }
  `,
  host: { class: 'pf-sheet-host' },
  imports: [IconComponent, PhotoThumbComponent, PhotoViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteSheetComponent {
  readonly summary = input.required<DeleteSummary>();
  readonly busy = input(false);
  /** The photos about to be deleted, when they are loaded. Shown as a tappable strip. */
  readonly photos = input<readonly Photo[]>([]);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  readonly viewing = signal<Photo | null>(null);
  readonly shownPhotos = computed(() => this.photos().slice(0, MAX_THUMBS));
  readonly hiddenCount = computed(() => this.summary().count - this.shownPhotos().length);

  readonly native = Capacitor.getPlatform() !== 'web';
  readonly countLabel = computed(() => {
    const count = this.summary().count;
    return `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'photo' : 'photos'}`;
  });
  readonly bytesLabel = computed(() => formatBytes(this.summary().bytes));
  readonly backupLine = computed(() => {
    const { uploadFirst, backedUp } = this.summary();
    if (uploadFirst == null) {
      return 'Photos without a backup upload to Nextcloud first.';
    }
    if (uploadFirst === 0) {
      return 'Already backed up on Nextcloud.';
    }
    const first = `${uploadFirst} upload${uploadFirst === 1 ? 's' : ''} to Nextcloud first.`;
    return backedUp ? `${first} ${backedUp} already backed up.` : first;
  });

  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    // Focus the safe choice when the sheet opens.
    afterNextRender(() => this.cancelButton().nativeElement.focus());
  }

  closeViewer(): void {
    this.viewing.set(null);
    this.cancelButton().nativeElement.focus();
  }
}
