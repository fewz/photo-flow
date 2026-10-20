import { registerPlugin } from '@capacitor/core';

import { DeletePhotoRequest, DeletePhotoResult } from './media-library';
import type { PhotoManagerNative } from './photo-manager.web';

const native = registerPlugin<PhotoManagerNative>('PhotoManager', {
  web: () => import('./photo-manager.web').then((module) => new module.PhotoManagerWeb()),
});

export const PhotoManager = {
  deletePhoto: (options: DeletePhotoRequest): Promise<DeletePhotoResult> => native.deletePhoto(options),
  deletePhotos: (options: { photos: DeletePhotoRequest[] }): Promise<{ results: DeletePhotoResult[] }> =>
    native.deletePhotos(options),
};
