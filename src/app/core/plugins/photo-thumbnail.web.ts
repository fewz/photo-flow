import { WebPlugin } from '@capacitor/core';

import { ThumbnailRequest, ThumbnailResult } from './media-library';
import { readWebPhoto } from './web-photo-library';

export interface PhotoThumbnailNative {
  getPhotoThumbnail(options: ThumbnailRequest): Promise<ThumbnailResult>;
  clearThumbnailCache(): Promise<void>;
}

export class PhotoThumbnailWeb extends WebPlugin implements PhotoThumbnailNative {
  async getPhotoThumbnail(options: ThumbnailRequest): Promise<ThumbnailResult> {
    const file = await readWebPhoto(options.uri);
    if (!file) {
      throw new Error('Preview unavailable');
    }
    const size = Math.max(options.width, options.height, 1);
    return { dataUrl: await thumbnailDataUrl(file, size) };
  }

  async clearThumbnailCache(): Promise<void> {
    return;
  }
}

async function thumbnailDataUrl(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Preview unavailable');
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}
