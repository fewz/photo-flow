import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import { THUMBNAIL_SIZE } from '../../core/constants/app.constants';
import { CloudPhoto } from '../../core/models/cloud-photo.model';
import { CloudPreviewService } from '../../core/services/cloud-preview.service';
import { IconComponent } from '../icon/icon.component';

/** Square Nextcloud preview that fills its box, like `app-photo-thumb` for device photos. */
@Component({
  selector: 'app-cloud-thumb',
  template: `
    @if (src()) {
      <img [src]="src()" alt="" loading="lazy" decoding="async" />
    } @else {
      <span class="pf-thumb__fallback"><app-icon name="image" [size]="22" /></span>
    }
  `,
  host: { class: 'pf-thumb' },
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloudThumbComponent {
  readonly photo = input.required<CloudPhoto>();
  readonly src = signal<string | null>(null);

  private request = 0;
  private readonly previews = inject(CloudPreviewService);

  constructor() {
    effect(() => {
      void this.load(this.photo());
    });
  }

  private async load(photo: CloudPhoto): Promise<void> {
    const request = ++this.request;
    this.src.set(null);
    try {
      const src = await this.previews.preview(photo, THUMBNAIL_SIZE);
      if (request === this.request) {
        this.src.set(src);
      }
    } catch {
      // Offline without a cached preview, or the server has none: the fallback icon stays.
    }
  }
}
