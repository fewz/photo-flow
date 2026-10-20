import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { CapacitorMediaLibrary } from '../plugins/capacitor-media-library';
import { ThumbnailRequest } from '../plugins/media-library';

@Injectable({ providedIn: 'root' })
export class ThumbnailService {
  private readonly cache = new Map<string, string>();
  private readonly media = inject(CapacitorMediaLibrary);

  async preview(uri: string, size: number): Promise<string> {
    const key = `${uri}:${size}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const request: ThumbnailRequest = { uri, width: size, height: size };
    const result = await this.media.getPhotoThumbnail(request);
    const src = result.dataUrl ?? (result.path ? Capacitor.convertFileSrc(result.path) : '');
    if (!src) {
      throw new Error('Preview unavailable');
    }
    this.remember(key, src);
    return src;
  }

  async clearCache(): Promise<void> {
    this.cache.clear();
    await this.media.clearThumbnailCache();
  }

  private remember(key: string, src: string): void {
    this.cache.set(key, src);
    if (this.cache.size <= 40) {
      return;
    }
    const oldest = this.cache.keys().next().value;
    if (oldest) {
      this.cache.delete(oldest);
    }
  }
}
