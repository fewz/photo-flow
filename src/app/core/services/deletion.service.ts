import { SETTING_BACKUP_BEFORE_DELETE } from '../constants/app.constants';
import { DatabaseError } from '../errors/app-error';
import { hasVerifiedBackup, Photo } from '../models/photo.model';
import { PhotoDeleter } from '../plugins/photo-deleter';
import { PhotoRepository } from '../repositories/photo.repository';
import { createId } from '../utils/id';
import { Logger } from './logger.service';
import { NetworkStatus } from './network-monitor';
import { UploadQueueService } from './upload-queue.service';

export interface DeletionReport {
  deleted: number;
  blocked: number;
  failed: number;
  message: string;
}

const PAGE_SIZE = 100;

export class DeletionService {
  constructor(
    private readonly photos: PhotoRepository,
    private readonly queue: UploadQueueService,
    private readonly network: NetworkStatus,
    private readonly deleter: PhotoDeleter,
    private readonly logger: Logger,
  ) {}

  async backupBeforeDelete(): Promise<boolean> {
    const value = await this.photos.getSetting(SETTING_BACKUP_BEFORE_DELETE);
    return value !== '0';
  }

  async setBackupBeforeDelete(enabled: boolean): Promise<void> {
    await this.photos.setSetting(SETTING_BACKUP_BEFORE_DELETE, enabled ? '1' : '0');
    this.logger.info('Deletion', enabled ? 'Backup before delete is on' : 'Backup before delete is off');
  }

  confirmMessage(count: number, backup: boolean): string {
    const noun = count === 1 ? 'photo' : 'photos';
    const lead = `Delete ${count} ${noun} from this device?`;
    if (backup) {
      return `${lead} Photos without a backup will be uploaded first.`;
    }
    return `${lead} Local delete will not keep a backup.`;
  }

  async undoMark(photoId: string): Promise<Photo> {
    const photo = await this.photos.getById(photoId);
    if (!photo || photo.mediaMissing || photo.reviewStatus !== 'delete') {
      throw new DatabaseError('That photo is no longer marked for deletion.');
    }
    const now = Date.now();
    const verified = hasVerifiedBackup(photo);
    const updated: Photo = {
      ...photo,
      reviewStatus: 'pending',
      uploadStatus: verified ? 'uploaded' : 'not_required',
      uploadProgress: verified ? photo.uploadProgress : 0,
      uploadError: undefined,
      deleteError: undefined,
      mediaMissing: false,
      updatedAt: now,
    };
    await this.photos.saveDecision(updated, {
      id: createId(),
      photoId: photo.id,
      previousReviewStatus: photo.reviewStatus,
      previousUploadStatus: photo.uploadStatus,
      nextReviewStatus: 'pending',
      createdAt: now,
    });
    if (!verified) {
      await this.queue.cancelForPhoto(photo.id);
    }
    this.logger.info('Deletion', 'Deletion mark undone', { mediaStoreId: photo.mediaStoreId });
    return updated;
  }

  async deleteAllMarked(): Promise<DeletionReport> {
    const ids: string[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.photos.list({ reviewStatus: 'delete', limit: PAGE_SIZE, offset });
      ids.push(...page.map((photo) => photo.id));
      if (page.length < PAGE_SIZE) {
        break;
      }
      offset += page.length;
    }
    return this.deleteMarked(ids);
  }

  async deleteMarked(photoIds: readonly string[]): Promise<DeletionReport> {
    const requireBackup = await this.backupBeforeDelete();
    const ready: Photo[] = [];
    let blocked = 0;

    for (const photoId of photoIds) {
      const photo = await this.photos.getById(photoId);
      if (!photo || photo.mediaMissing || photo.reviewStatus !== 'delete') {
        continue;
      }
      const prepared = await this.prepare(photo, requireBackup);
      if (prepared.ok) {
        ready.push(prepared.photo);
      } else {
        blocked += 1;
      }
    }

    let deleted = 0;
    let failed = 0;
    if (ready.length > 0) {
      const outcome = await this.removeFromDevice(ready);
      deleted = outcome.deleted;
      failed = outcome.failed;
    }

    const report = {
      deleted,
      blocked,
      failed,
      message: summary(deleted, blocked + failed),
    };
    this.logger.info('Deletion', 'Deletion finished', {
      deleted: report.deleted,
      blocked: report.blocked,
      failed: report.failed,
    });
    return report;
  }

  private async prepare(photo: Photo, requireBackup: boolean): Promise<{ ok: true; photo: Photo } | { ok: false }> {
    if (!requireBackup || hasVerifiedBackup(photo)) {
      if (photo.deleteError) {
        await this.photos.update({ ...photo, deleteError: undefined, updatedAt: Date.now() });
      }
      return { ok: true, photo };
    }
    if (!this.network.isOnline()) {
      await this.keep(photo, 'Server unreachable. This photo was not deleted.');
      return { ok: false };
    }
    if (await this.queue.isPaused()) {
      await this.keep(photo, 'Uploads are paused. This photo was not deleted.');
      return { ok: false };
    }
    const backedUp = await this.queue.uploadBackup(photo);
    if (hasVerifiedBackup(backedUp)) {
      return { ok: true, photo: backedUp };
    }
    await this.keep(backedUp, backedUp.uploadError ?? 'The backup failed. This photo was not deleted.');
    return { ok: false };
  }

  private async removeFromDevice(photos: Photo[]): Promise<{ deleted: number; failed: number }> {
    let results;
    try {
      results = await this.deleter.deletePhotos(
        photos.map((photo) => ({ mediaStoreId: photo.mediaStoreId, uri: photo.uri })),
      );
    } catch (error) {
      this.logger.warn('Deletion', 'Device delete failed', {
        count: photos.length,
        message: error instanceof Error ? error.message : 'unknown',
      });
      for (const photo of photos) {
        await this.keep(photo, 'The photo could not be deleted. Try again.');
      }
      return { deleted: 0, failed: photos.length };
    }

    const byId = new Map(results.map((result) => [result.mediaStoreId, result]));
    let deleted = 0;
    let failed = 0;
    const now = Date.now();
    for (const photo of photos) {
      const result = byId.get(photo.mediaStoreId);
      if (result?.success) {
        await this.photos.update({
          ...photo,
          mediaMissing: true,
          deleteError: undefined,
          updatedAt: now,
        });
        deleted += 1;
        continue;
      }
      await this.keep(photo, result?.error || 'The photo could not be deleted. Try again.');
      failed += 1;
    }
    return { deleted, failed };
  }

  private async keep(photo: Photo, message: string): Promise<void> {
    await this.photos.update({
      ...photo,
      reviewStatus: 'delete',
      mediaMissing: false,
      deleteError: message,
      updatedAt: Date.now(),
    });
  }
}

function summary(deleted: number, skipped: number): string {
  if (deleted === 0 && skipped === 0) {
    return 'No photos were deleted.';
  }
  if (deleted === 0) {
    return skipped === 1 ? 'This photo was not deleted.' : `${skipped} photos were not deleted.`;
  }
  const removed = deleted === 1 ? 'Deleted 1 photo.' : `Deleted ${deleted} photos.`;
  if (skipped === 0) {
    return removed;
  }
  const held = skipped === 1 ? '1 photo was not deleted.' : `${skipped} photos were not deleted.`;
  return `${removed} ${held}`;
}
