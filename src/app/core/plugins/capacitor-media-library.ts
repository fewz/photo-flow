import { Injectable } from '@angular/core';

import { MediaLibrary } from './media-library';
import { PhotoManager } from './photo-manager';
import { PhotoScanner } from './photo-scanner';
import { PhotoThumbnail } from './photo-thumbnail';

@Injectable({ providedIn: 'root' })
export class CapacitorMediaLibrary implements MediaLibrary {
  checkPermissions() {
    return PhotoScanner.checkPermissions();
  }

  requestPermissions(options?: { pick?: boolean }) {
    return PhotoScanner.requestPermissions(options);
  }

  scanPhotos(options: Parameters<MediaLibrary['scanPhotos']>[0]) {
    return PhotoScanner.scanPhotos(options);
  }

  listPhotoIds() {
    return PhotoScanner.listPhotoIds();
  }

  getPhotoThumbnail(options: Parameters<MediaLibrary['getPhotoThumbnail']>[0]) {
    return PhotoThumbnail.getPhotoThumbnail(options);
  }

  clearThumbnailCache() {
    return PhotoThumbnail.clearThumbnailCache();
  }

  openAppSettings() {
    return PhotoScanner.openAppSettings();
  }

  deletePhoto(options: Parameters<typeof PhotoManager.deletePhoto>[0]) {
    return PhotoManager.deletePhoto(options);
  }

  deletePhotos(options: Parameters<typeof PhotoManager.deletePhotos>[0]) {
    return PhotoManager.deletePhotos(options);
  }
}
