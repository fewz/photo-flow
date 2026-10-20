import { WebPlugin } from '@capacitor/core';

import { PhotoPermissionStatus, ScanPhotosOptions } from './media-library';
import { ScannedPhoto } from '../models/photo.model';
import { listWebPhotoIds, requestWebPhotoAccess, scanWebPhotos, webPhotoAccess } from './web-photo-library';

export interface PhotoScannerNative {
  checkPhotoAccess(): Promise<PhotoPermissionStatus>;
  requestPhotoAccess(options?: { pick?: boolean }): Promise<PhotoPermissionStatus>;
  scanPhotos(options: ScanPhotosOptions): Promise<{ photos: ScannedPhoto[] }>;
  listPhotoIds(): Promise<{ ids: string[] }>;
  openAppSettings(): Promise<void>;
}

export class PhotoScannerWeb extends WebPlugin implements PhotoScannerNative {
  async checkPhotoAccess(): Promise<PhotoPermissionStatus> {
    return { photos: await webPhotoAccess() };
  }

  async requestPhotoAccess(options?: { pick?: boolean }): Promise<PhotoPermissionStatus> {
    return { photos: await requestWebPhotoAccess(options?.pick === true) };
  }

  async scanPhotos(options: ScanPhotosOptions): Promise<{ photos: ScannedPhoto[] }> {
    return { photos: await scanWebPhotos(options) };
  }

  async listPhotoIds(): Promise<{ ids: string[] }> {
    return { ids: await listWebPhotoIds() };
  }

  async openAppSettings(): Promise<void> {
    return;
  }
}
