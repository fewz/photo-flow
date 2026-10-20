import { registerPlugin } from '@capacitor/core';

import { PhotoPermissionStatus, ScanPhotosOptions } from './media-library';
import { ScannedPhoto } from '../models/photo.model';
import type { PhotoScannerNative } from './photo-scanner.web';

const native = registerPlugin<PhotoScannerNative>('PhotoScanner', {
  web: () => import('./photo-scanner.web').then((module) => new module.PhotoScannerWeb()),
});

export const PhotoScanner = {
  checkPermissions: (): Promise<PhotoPermissionStatus> => native.checkPhotoAccess(),
  requestPermissions: (options?: { pick?: boolean }): Promise<PhotoPermissionStatus> =>
    native.requestPhotoAccess(options ?? {}),
  scanPhotos: (options: ScanPhotosOptions = {}): Promise<{ photos: ScannedPhoto[] }> => native.scanPhotos(options),
  listPhotoIds: (): Promise<{ ids: string[] }> => native.listPhotoIds(),
  openAppSettings: (): Promise<void> => native.openAppSettings(),
};
