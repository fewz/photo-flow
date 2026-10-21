import { DatabaseError } from '../errors/app-error';
import {
  CloudCounts,
  CloudFilter,
  CloudFolder,
  CloudMatch,
  CloudPhoto,
  CloudPhotoQuery,
  CloudSection,
} from '../models/cloud-photo.model';
import { NextcloudSettings } from '../models/nextcloud.model';
import { Photo, PhotoCounts, PhotoQuery, ScannedPhoto } from '../models/photo.model';
import { ReviewAction } from '../models/review-action.model';
import { UploadJob } from '../models/upload-job.model';
import { createId } from '../utils/id';
import { PhotoStore } from '../database/photo.store';

export class PhotoRepository {
  constructor(private readonly store: PhotoStore) {}

  async upsertFromScan(scanned: ScannedPhoto): Promise<'inserted' | 'updated'> {
    const existing = await this.store.findByMediaStoreId(scanned.mediaStoreId);
    const now = Date.now();
    if (!existing) {
      await this.store.insert({
        id: createId(),
        mediaStoreId: scanned.mediaStoreId,
        uri: scanned.uri,
        fileName: scanned.fileName,
        mimeType: scanned.mimeType,
        sizeBytes: scanned.sizeBytes,
        width: scanned.width,
        height: scanned.height,
        dateTaken: scanned.dateTaken,
        dateModified: scanned.dateModified,
        relativePath: scanned.relativePath,
        reviewStatus: 'pending',
        uploadStatus: 'not_required',
        uploadProgress: 0,
        mediaMissing: false,
        createdAt: now,
        updatedAt: now,
      });
      return 'inserted';
    }

    await this.store.update({
      ...existing,
      uri: scanned.uri,
      fileName: scanned.fileName,
      mimeType: scanned.mimeType,
      sizeBytes: scanned.sizeBytes,
      width: scanned.width,
      height: scanned.height,
      dateTaken: scanned.dateTaken,
      dateModified: scanned.dateModified,
      relativePath: scanned.relativePath,
      mediaMissing: false,
      updatedAt: now,
    });
    return 'updated';
  }

  update(photo: Photo): Promise<void> {
    return this.store.update(photo);
  }

  getById(id: string): Promise<Photo | null> {
    return this.store.findById(id);
  }

  findByMediaStoreId(mediaStoreId: string): Promise<Photo | null> {
    return this.store.findByMediaStoreId(mediaStoreId);
  }

  list(query: PhotoQuery): Promise<Photo[]> {
    return this.store.list(query);
  }

  listIds(query: Omit<PhotoQuery, 'limit' | 'offset'>): Promise<string[]> {
    return this.store.listIds(query);
  }

  counts(): Promise<PhotoCounts> {
    return this.store.counts();
  }

  refreshDuplicateGroups(): Promise<void> {
    return this.store.refreshDuplicateGroups();
  }

  markMissingExcept(mediaStoreIds: readonly string[]): Promise<void> {
    return this.store.markMissingExcept(mediaStoreIds);
  }

  async saveDecision(photo: Photo, action: ReviewAction): Promise<void> {
    await this.store.update(photo);
    await this.store.pushReviewAction(action);
  }

  async undoLastDecision(): Promise<Photo | null> {
    const action = await this.store.popReviewAction();
    if (!action) {
      return null;
    }
    const photo = await this.store.findById(action.photoId);
    if (!photo) {
      return null;
    }
    const restored: Photo = {
      ...photo,
      reviewStatus: action.previousReviewStatus,
      uploadStatus: action.previousUploadStatus,
      updatedAt: Date.now(),
    };
    await this.store.update(restored);
    return restored;
  }

  hasUndo(): Promise<boolean> {
    return this.store.hasReviewAction();
  }

  getSetting(key: string): Promise<string | null> {
    return this.store.getSetting(key);
  }

  setSetting(key: string, value: string): Promise<void> {
    return this.store.setSetting(key, value);
  }

  getNextcloudSettings(): Promise<NextcloudSettings | null> {
    return this.store.getNextcloudSettings();
  }

  saveNextcloudSettings(settings: NextcloudSettings): Promise<void> {
    return this.store.saveNextcloudSettings(settings);
  }

  insertJob(job: UploadJob): Promise<void> {
    return this.store.insertJob(job);
  }

  updateJob(job: UploadJob): Promise<void> {
    return this.store.updateJob(job);
  }

  findJobForPhoto(photoId: string): Promise<UploadJob | null> {
    return this.store.findJobForPhoto(photoId);
  }

  claimNextPendingJob(): Promise<UploadJob | null> {
    return this.store.claimNextPendingJob();
  }

  listJobs(): Promise<UploadJob[]> {
    return this.store.listJobs();
  }

  deleteJobsByStatus(status: UploadJob['status']): Promise<void> {
    return this.store.deleteJobsByStatus(status);
  }

  resetUploadingJobs(): Promise<void> {
    return this.store.resetUploadingJobs();
  }

  listCloudFolders(): Promise<CloudFolder[]> {
    return this.store.listCloudFolders();
  }

  replaceCloudFolder(folder: CloudFolder, photos: readonly Omit<CloudPhoto, 'onPhone'>[]): Promise<void> {
    return this.store.replaceCloudFolder(folder, photos);
  }

  deleteCloudFoldersExcept(paths: readonly string[]): Promise<void> {
    return this.store.deleteCloudFoldersExcept(paths);
  }

  clearCloudLibrary(): Promise<void> {
    return this.store.clearCloudLibrary();
  }

  listCloudPhotos(query: CloudPhotoQuery): Promise<CloudPhoto[]> {
    return this.store.listCloudPhotos(query);
  }

  cloudSections(filter: CloudFilter): Promise<CloudSection[]> {
    return this.store.cloudSections(filter);
  }

  cloudCounts(): Promise<CloudCounts> {
    return this.store.cloudCounts();
  }

  listCloudMatches(): Promise<CloudMatch[]> {
    return this.store.listCloudMatches();
  }

  /**
   * Records a photo saved from Nextcloud onto this phone as kept and backed up, so the gallery
   * shows it on the phone and the upload queue does not send it again. The next scan fills in
   * the metadata MediaStore reads from the file.
   */
  async addRestoredPhoto(
    saved: ScannedPhoto,
    remotePath: string,
    remoteETag: string | undefined,
    sha256: string | undefined,
  ): Promise<void> {
    if (await this.store.findByMediaStoreId(saved.mediaStoreId)) {
      return;
    }
    const now = Date.now();
    await this.store.insert({
      id: createId(),
      mediaStoreId: saved.mediaStoreId,
      uri: saved.uri,
      fileName: saved.fileName,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      width: saved.width,
      height: saved.height,
      dateTaken: saved.dateTaken,
      dateModified: saved.dateModified,
      relativePath: saved.relativePath,
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      uploadProgress: 1,
      remotePath,
      remoteETag,
      sha256,
      mediaMissing: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  async databaseVersion(): Promise<number> {
    const version = await this.store.databaseVersion();
    if (!Number.isFinite(version)) {
      throw new DatabaseError('The local library version could not be read.');
    }
    return version;
  }
}
