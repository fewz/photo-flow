import { registerPlugin } from '@capacitor/core';

import { ThumbnailRequest, ThumbnailResult } from './media-library';
import type { PhotoThumbnailNative } from './photo-thumbnail.web';

const native = registerPlugin<PhotoThumbnailNative>('PhotoThumbnail', {
  web: () => import('./photo-thumbnail.web').then((module) => new module.PhotoThumbnailWeb()),
});

export const PhotoThumbnail = {
  getPhotoThumbnail: (options: ThumbnailRequest): Promise<ThumbnailResult> => native.getPhotoThumbnail(options),
  clearThumbnailCache: (): Promise<void> => native.clearThumbnailCache(),
};
