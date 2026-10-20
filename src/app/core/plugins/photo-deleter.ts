import { DeletePhotoRequest, DeletePhotoResult } from './media-library';
import { PhotoManager } from './photo-manager';

export interface PhotoDeleter {
  deletePhotos(photos: DeletePhotoRequest[]): Promise<DeletePhotoResult[]>;
}

export class CapacitorPhotoDeleter implements PhotoDeleter {
  async deletePhotos(photos: DeletePhotoRequest[]): Promise<DeletePhotoResult[]> {
    if (photos.length === 0) {
      return [];
    }
    if (photos.length === 1) {
      return [await PhotoManager.deletePhoto(photos[0])];
    }
    const batch = await PhotoManager.deletePhotos({ photos });
    return batch.results;
  }
}
