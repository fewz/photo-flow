import { WebPlugin } from '@capacitor/core';

import { DeletePhotoRequest, DeletePhotoResult } from './media-library';
import { deleteWebPhoto } from './web-photo-library';

export interface PhotoManagerNative {
  deletePhoto(options: DeletePhotoRequest): Promise<DeletePhotoResult>;
  deletePhotos(options: { photos: DeletePhotoRequest[] }): Promise<{ results: DeletePhotoResult[] }>;
}

export class PhotoManagerWeb extends WebPlugin implements PhotoManagerNative {
  deletePhoto(options: DeletePhotoRequest): Promise<DeletePhotoResult> {
    return deleteWebPhoto(options.mediaStoreId, options.uri);
  }

  async deletePhotos(options: { photos: DeletePhotoRequest[] }): Promise<{ results: DeletePhotoResult[] }> {
    const results = await Promise.all(options.photos.map((photo) => this.deletePhoto(photo)));
    return { results };
  }
}
