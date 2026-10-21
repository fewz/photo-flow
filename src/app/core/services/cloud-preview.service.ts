import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { CloudPhoto } from '../models/cloud-photo.model';
import { CloudLibraryService } from './cloud-library.service';

/**
 * Image sources for Nextcloud photos: server previews, never the original. On Android each
 * preview is also kept in the app cache, which is what the gallery shows offline.
 */
@Injectable({ providedIn: 'root' })
export class CloudPreviewService {
  private readonly cache = new Map<string, string>();
  private readonly loading = new Map<string, Promise<string>>();
  private readonly library = inject(CloudLibraryService);

  async preview(photo: CloudPhoto, size: number): Promise<string> {
    const key = `${photo.remotePath}:${photo.etag ?? ''}:${size}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    // The grid re-renders while a refresh lists new months; share the download already running.
    let loading = this.loading.get(key);
    if (!loading) {
      loading = this.load(photo, size).finally(() => this.loading.delete(key));
      this.loading.set(key, loading);
    }
    const src = await loading;
    this.remember(key, src);
    return src;
  }

  private async load(photo: CloudPhoto, size: number): Promise<string> {
    const result = await this.library.preview(photo, size);
    const src = result.dataUrl ?? (result.path ? Capacitor.convertFileSrc(result.path) : '');
    if (!src) {
      throw new Error('Preview unavailable');
    }
    return src;
  }

  private remember(key: string, src: string): void {
    this.cache.set(key, src);
    // Browser previews are data URLs, so keep only a screenful or two in memory.
    if (this.cache.size <= 120) {
      return;
    }
    const oldest = this.cache.keys().next().value;
    if (oldest) {
      this.cache.delete(oldest);
    }
  }
}
