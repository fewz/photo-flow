import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { toUserMessage } from '../../core/errors/app-error';
import { CloudPhoto } from '../../core/models/cloud-photo.model';
import { CloudLibraryService } from '../../core/services/cloud-library.service';
import { CloudPreviewService } from '../../core/services/cloud-preview.service';
import { NetworkMonitor } from '../../core/services/network-monitor';
import { formatBytes } from '../../core/utils/bytes';
import { fullScreenPreviewSize } from '../../core/utils/preview-size';
import { IconComponent } from '../icon/icon.component';
import { PhotoViewerComponent } from '../photo-viewer/photo-viewer.component';

/** Full-screen Nextcloud preview with where the backup lives, Open in Nextcloud and Save to phone. */
@Component({
  selector: 'app-cloud-photo-viewer',
  template: `
    <app-photo-viewer [src]="src()" [loadFailed]="failed()" [fileName]="photo().fileName" (closed)="closed.emit()">
      <section class="pf-cloud-info" aria-labelledby="cloud-info-title">
        <div class="pf-cloud-info__head">
          <span class="pf-icon-tile" [class.pf-icon-tile--dark]="!onPhone()">
            <app-icon [name]="onPhone() ? 'phone' : 'cloud'" [stroke]="2" />
          </span>
          <div>
            <h2 id="cloud-info-title" class="pf-title">{{ onPhone() ? 'Also on this phone' : 'Only in Nextcloud' }}</h2>
            <p class="pf-caption">{{ onPhone() ? 'Backed up from this phone' : 'Not on this phone' }}</p>
          </div>
        </div>
        <dl class="pf-cloud-info__facts">
          <dt>Folder</dt>
          <dd>{{ folder() }}</dd>
          <dt>Size</dt>
          <dd>{{ size() }}</dd>
          <dt>Backed up</dt>
          <dd>{{ backedUp() }}</dd>
        </dl>
        @if (message(); as note) {
          <p class="pf-notice" role="status" [class.pf-notice--error]="note.error">{{ note.text }}</p>
        }
        <div class="pf-cloud-info__actions" [class.pf-cloud-info__actions--single]="onPhone()">
          <button type="button" class="pf-button pf-button--secondary" [disabled]="!online()" (click)="openInNextcloud()">
            <app-icon name="external" [size]="18" [stroke]="2" />
            Open in Nextcloud
          </button>
          @if (!onPhone()) {
            <button type="button" class="pf-button pf-button--primary" [disabled]="saving() || !online()" (click)="save()">
              <app-icon [name]="saving() ? 'spinner' : 'download'" [size]="18" [stroke]="2" [class.pf-spin]="saving()" />
              {{ saving() ? 'Saving…' : 'Save to phone' }}
            </button>
          }
        </div>
        @if (!onPhone()) {
          <p class="pf-caption pf-cloud-info__hint">
            {{ online() ? 'Saving downloads the original into Pictures/PhotoFlow.' : 'Connect to the internet to save or open this photo.' }}
          </p>
        }
      </section>
    </app-photo-viewer>
  `,
  imports: [PhotoViewerComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloudPhotoViewerComponent {
  readonly photo = input.required<CloudPhoto>();
  readonly closed = output<void>();
  /** A photo was saved onto this phone, so the gallery should reload. */
  readonly saved = output<void>();

  readonly src = signal<string | null>(null);
  readonly failed = signal(false);
  readonly saving = signal(false);
  readonly savedHere = signal(false);
  readonly message = signal<{ text: string; error: boolean } | null>(null);
  readonly online = inject(NetworkMonitor).online;

  readonly onPhone = computed(() => this.photo().onPhone || this.savedHere());
  readonly folder = computed(() => this.photo().folder);
  readonly size = computed(() => formatBytes(this.photo().sizeBytes));
  readonly backedUp = computed(() => {
    const at = this.photo().lastModified;
    return at > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(at) : 'Unknown';
  });

  private readonly previews = inject(CloudPreviewService);
  private readonly library = inject(CloudLibraryService);

  constructor() {
    effect(() => {
      const photo = this.photo();
      this.src.set(null);
      this.failed.set(false);
      this.previews.preview(photo, fullScreenPreviewSize()).then(
        (src) => this.src.set(src),
        () => this.failed.set(true),
      );
    });
  }

  async openInNextcloud(): Promise<void> {
    try {
      window.open(await this.library.webUrl(this.photo()), '_blank', 'noopener');
    } catch (error) {
      this.message.set({ text: toUserMessage(error, 'Nextcloud could not be opened.'), error: true });
    }
  }

  async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.message.set(null);
    try {
      const onDevice = await this.library.saveToPhone(this.photo());
      if (onDevice) {
        this.savedHere.set(true);
        this.message.set({ text: 'Saved to Pictures/PhotoFlow on this phone.', error: false });
        this.saved.emit();
      } else {
        this.message.set({ text: 'The photo was downloaded by the browser.', error: false });
      }
    } catch (error) {
      this.message.set({ text: toUserMessage(error, 'The photo could not be saved. Try again.'), error: true });
    } finally {
      this.saving.set(false);
    }
  }
}
