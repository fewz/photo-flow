import { DATABASE_VERSION } from '../constants/app.constants';
import { Photo, PhotoCounts, PhotoQuery } from '../models/photo.model';
import { NextcloudSettings } from '../models/nextcloud.model';
import { ReviewAction } from '../models/review-action.model';
import { UploadJob } from '../models/upload-job.model';
import { DatabaseError } from '../errors/app-error';
import { PhotoStore } from './photo.store';

export class MemoryPhotoStore implements PhotoStore {
  private readonly photos = new Map<string, Photo>();
  private readonly mediaIndex = new Map<string, string>();
  private readonly settings = new Map<string, string>();
  private actions: ReviewAction[] = [];
  private jobs: UploadJob[] = [];
  private nextcloud: NextcloudSettings | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    this.ready = true;
  }

  async findById(id: string): Promise<Photo | null> {
    this.assertReady();
    const photo = this.photos.get(id);
    return photo ? { ...photo } : null;
  }

  async findByMediaStoreId(mediaStoreId: string): Promise<Photo | null> {
    const id = this.mediaIndex.get(mediaStoreId);
    return id ? this.findById(id) : null;
  }

  async insert(photo: Photo): Promise<void> {
    this.assertReady();
    if (this.mediaIndex.has(photo.mediaStoreId) || this.photos.has(photo.id)) {
      throw new DatabaseError('That photo is already in the library.');
    }
    this.photos.set(photo.id, { ...photo });
    this.mediaIndex.set(photo.mediaStoreId, photo.id);
  }

  async update(photo: Photo): Promise<void> {
    this.assertReady();
    const current = this.photos.get(photo.id);
    if (!current) {
      throw new DatabaseError('That photo is no longer in the library.');
    }
    if (current.mediaStoreId !== photo.mediaStoreId) {
      this.mediaIndex.delete(current.mediaStoreId);
      this.mediaIndex.set(photo.mediaStoreId, photo.id);
    }
    this.photos.set(photo.id, { ...photo });
  }

  async list(query: PhotoQuery): Promise<Photo[]> {
    this.assertReady();
    return this.matching(query)
      .slice(query.offset, query.offset + query.limit)
      .map((photo) => ({ ...photo }));
  }

  async listIds(query: Omit<PhotoQuery, 'limit' | 'offset'>): Promise<string[]> {
    this.assertReady();
    return this.matching(query).map((photo) => photo.id);
  }

  private matching(query: Omit<PhotoQuery, 'limit' | 'offset'>): Photo[] {
    return [...this.photos.values()]
      .filter((photo) => query.includeMissing || !photo.mediaMissing)
      .filter((photo) => !query.reviewStatus || photo.reviewStatus === query.reviewStatus)
      .filter((photo) => !query.duplicatesOnly || photo.duplicateGroup)
      .sort((left, right) => right.dateTaken - left.dateTaken || right.id.localeCompare(left.id));
  }

  async counts(): Promise<PhotoCounts> {
    const visible = [...this.photos.values()].filter((photo) => !photo.mediaMissing);
    return {
      total: visible.length,
      reviewed: visible.filter((photo) => photo.reviewStatus !== 'pending').length,
      pending: visible.filter((photo) => photo.reviewStatus === 'pending').length,
      markedForDeletion: visible.filter((photo) => photo.reviewStatus === 'delete').length,
      kept: visible.filter((photo) => photo.reviewStatus === 'keep').length,
      backedUp: visible.filter((photo) => photo.reviewStatus === 'keep' && photo.uploadStatus === 'uploaded').length,
      recoverableBytes: visible
        .filter((photo) => photo.reviewStatus === 'delete')
        .reduce((total, photo) => total + photo.sizeBytes, 0),
      duplicatePhotos: visible.filter((photo) => photo.duplicateGroup).length,
    };
  }

  async refreshDuplicateGroups(): Promise<void> {
    this.assertReady();
    const groups = new Map<string, Photo[]>();
    for (const photo of this.photos.values()) {
      photo.duplicateGroup = undefined;
      if (photo.mediaMissing || photo.sizeBytes <= 0) {
        continue;
      }
      const key = `${photo.sizeBytes}:${photo.dateModified}`;
      const list = groups.get(key) ?? [];
      list.push(photo);
      groups.set(key, list);
    }
    for (const [key, photos] of groups) {
      if (photos.length < 2) {
        continue;
      }
      for (const photo of photos) {
        photo.duplicateGroup = key;
      }
    }
  }

  async markMissingExcept(mediaStoreIds: readonly string[]): Promise<void> {
    this.assertReady();
    const present = new Set(mediaStoreIds);
    const now = Date.now();
    for (const photo of this.photos.values()) {
      const missing = !present.has(photo.mediaStoreId);
      if (photo.mediaMissing !== missing) {
        photo.mediaMissing = missing;
        photo.updatedAt = now;
      }
    }
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }

  async pushReviewAction(action: ReviewAction): Promise<void> {
    this.actions.push({ ...action });
    this.actions.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    if (this.actions.length > 20) {
      this.actions = this.actions.slice(this.actions.length - 20);
    }
  }

  async popReviewAction(): Promise<ReviewAction | null> {
    const action = this.actions.pop();
    return action ? { ...action } : null;
  }

  async hasReviewAction(): Promise<boolean> {
    return this.actions.length > 0;
  }

  async databaseVersion(): Promise<number> {
    return this.ready ? DATABASE_VERSION : 0;
  }

  async getNextcloudSettings(): Promise<NextcloudSettings | null> {
    this.assertReady();
    return this.nextcloud ? { ...this.nextcloud } : null;
  }

  async saveNextcloudSettings(settings: NextcloudSettings): Promise<void> {
    this.assertReady();
    this.nextcloud = { ...settings };
  }

  async insertJob(job: UploadJob): Promise<void> {
    this.assertReady();
    this.jobs.push({ ...job });
  }

  async updateJob(job: UploadJob): Promise<void> {
    this.assertReady();
    const index = this.jobs.findIndex((item) => item.id === job.id);
    if (index < 0) {
      throw new DatabaseError('That upload is no longer in the queue.');
    }
    this.jobs[index] = { ...job };
  }

  async findJobForPhoto(photoId: string): Promise<UploadJob | null> {
    this.assertReady();
    const matches = this.jobs
      .filter((job) => job.photoId === photoId && job.status !== 'cancelled')
      .sort((left, right) => right.createdAt - left.createdAt);
    return matches[0] ? { ...matches[0] } : null;
  }

  async claimNextPendingJob(): Promise<UploadJob | null> {
    this.assertReady();
    const next = this.jobs
      .filter((job) => job.status === 'pending')
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (!next) {
      return null;
    }
    next.status = 'uploading';
    next.updatedAt = Date.now();
    return { ...next };
  }

  async listJobs(): Promise<UploadJob[]> {
    this.assertReady();
    return this.jobs
      .filter((job) => job.status !== 'cancelled')
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((job) => ({ ...job }));
  }

  async deleteJobsByStatus(status: UploadJob['status']): Promise<void> {
    this.assertReady();
    this.jobs = this.jobs.filter((job) => job.status !== status);
  }

  async resetUploadingJobs(): Promise<void> {
    this.assertReady();
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.status === 'uploading') {
        job.status = 'pending';
        job.updatedAt = now;
      }
    }
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new DatabaseError('The local library is not open yet.');
    }
  }
}
