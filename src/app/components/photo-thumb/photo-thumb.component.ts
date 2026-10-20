import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import { THUMBNAIL_SIZE } from '../../core/constants/app.constants';
import { ThumbnailService } from '../../core/services/thumbnail.service';
import { IconComponent } from '../icon/icon.component';

/** Square cached thumbnail that fills its box. Never loads the original file. */
@Component({
  selector: 'app-photo-thumb',
  template: `
    @if (src()) {
      <img [src]="src()" [alt]="alt()" loading="lazy" decoding="async" />
    } @else {
      <span class="pf-thumb__fallback"><app-icon name="image" [size]="22" /></span>
    }
  `,
  host: { class: 'pf-thumb', '[class.pf-thumb--contain]': "fit() === 'contain'" },
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoThumbComponent {
  readonly uri = input.required<string>();
  readonly alt = input('');
  readonly size = input(THUMBNAIL_SIZE);
  /** 'cover' crops to fill a tile; 'contain' shows the whole photo. */
  readonly fit = input<'cover' | 'contain'>('cover');
  readonly src = signal<string | null>(null);

  private request = 0;
  private readonly thumbnails = inject(ThumbnailService);

  constructor() {
    effect(() => {
      void this.load(this.uri(), this.size());
    });
  }

  private async load(uri: string, size: number): Promise<void> {
    const request = ++this.request;
    this.src.set(null);
    try {
      const src = await this.thumbnails.preview(uri, size);
      if (request === this.request) {
        this.src.set(src);
      }
    } catch {
      // The fallback icon stays.
    }
  }
}
