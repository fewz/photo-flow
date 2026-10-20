import { Capacitor } from '@capacitor/core';

import { SCAN_PAGE_SIZE, SETTING_LAST_SCAN_ACCESS } from '../constants/app.constants';
import { MediaPermissionError, MediaStoreError } from '../errors/app-error';
import { PhotoAccess } from '../models/photo.model';
import { MediaLibrary } from '../plugins/media-library';
import { PhotoRepository } from '../repositories/photo.repository';
import { Logger } from './logger.service';

export interface ScanSummary {
  inserted: number;
  updated: number;
  access: PhotoAccess;
}

export class PhotoScannerService {
  constructor(
    private readonly media: MediaLibrary,
    private readonly photos: PhotoRepository,
    private readonly logger: Logger,
    private readonly pageSize = SCAN_PAGE_SIZE,
  ) {}

  async scan(): Promise<ScanSummary> {
    const permission = await this.media.requestPermissions();
    await this.photos.setSetting(SETTING_LAST_SCAN_ACCESS, permission.photos);
    if (permission.photos === 'denied') {
      this.logger.warn('PhotoScanner', 'Photo permission denied');
      throw new MediaPermissionError(
        Capacitor.getPlatform() === 'web'
          ? 'Choose a photo folder to scan. PhotoFlow only reads the folder you pick.'
          : 'Photo access is required to scan this device. You can allow it in system settings.',
      );
    }

    let offset = 0;
    let inserted = 0;
    let updated = 0;
    try {
      for (;;) {
        const page = await this.media.scanPhotos({ limit: this.pageSize, offset });
        if (page.photos.length === 0) {
          break;
        }
        for (const photo of page.photos) {
          const result = await this.photos.upsertFromScan(photo);
          if (result === 'inserted') {
            inserted += 1;
          } else {
            updated += 1;
          }
        }
        offset += page.photos.length;
        if (page.photos.length < this.pageSize) {
          break;
        }
      }

      if (permission.photos === 'granted') {
        const ids = await this.media.listPhotoIds();
        await this.photos.markMissingExcept(ids.ids);
      }
      await this.photos.refreshDuplicateGroups();
    } catch (error) {
      if (error instanceof MediaPermissionError) {
        throw error;
      }
      this.logger.error('PhotoScanner', 'Scan failed', { cause: String(error) });
      throw new MediaStoreError('The photo library could not be read. Try again.', { cause: error });
    }

    this.logger.info('PhotoScanner', 'Scan finished', { inserted, updated, access: permission.photos });
    return { inserted, updated, access: permission.photos };
  }
}
