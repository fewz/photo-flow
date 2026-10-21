import { DATABASE_VERSION } from '../constants/app.constants';
import { Photo, PhotoCounts, PhotoQuery } from '../models/photo.model';
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
  private cloudFolders = new Map<string, CloudFolder>();
  private cloudPhotos = new Map<string, Omit<CloudPhoto, 'onPhone'>>();
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

  async listCloudFolders(): Promise<CloudFolder[]> {
    this.assertReady();
    return [...this.cloudFolders.values()].map((folder) => ({ ...folder }));
  }

  async replaceCloudFolder(folder: CloudFolder, photos: readonly Omit<CloudPhoto, 'onPhone'>[]): Promise<void> {
    this.assertReady();
    this.dropCloudFolder(folder.path);
    this.cloudFolders.set(folder.path, { ...folder });
    for (const photo of photos) {
      this.cloudPhotos.set(photo.remotePath, { ...photo, folder: folder.path });
    }
  }

  async deleteCloudFoldersExcept(paths: readonly string[]): Promise<void> {
    this.assertReady();
    const keep = new Set(paths);
    for (const path of [...this.cloudFolders.keys()]) {
      if (!keep.has(path)) {
        this.dropCloudFolder(path);
      }
    }
  }

  async clearCloudLibrary(): Promise<void> {
    this.assertReady();
    this.cloudFolders.clear();
    this.cloudPhotos.clear();
  }

  async listCloudPhotos(query: CloudPhotoQuery): Promise<CloudPhoto[]> {
    this.assertReady();
    return this.matchingCloud(query.filter).slice(query.offset, query.offset + query.limit);
  }

  async cloudSections(filter: CloudFilter): Promise<CloudSection[]> {
    this.assertReady();
    const sections = new Map<string, CloudSection>();
    for (const photo of this.matchingCloud(filter)) {
      const section = sections.get(photo.folder) ?? { folder: photo.folder, year: photo.year, month: photo.month, count: 0 };
      section.count += 1;
      sections.set(photo.folder, section);
    }
    return [...sections.values()];
  }

  async cloudCounts(): Promise<CloudCounts> {
    this.assertReady();
    const all = this.matchingCloud('all');
    const onPhone = all.filter((photo) => photo.onPhone).length;
    return { total: all.length, cloudOnly: all.length - onPhone, onPhone };
  }

  async listCloudMatches(): Promise<CloudMatch[]> {
    this.assertReady();
    const cloud = [...this.cloudPhotos.values()].sort((left, right) => left.remotePath.localeCompare(right.remotePath));
    const matches: CloudMatch[] = [];
    for (const photo of this.photos.values()) {
      if (photo.mediaMissing || !needsBackupRecord(photo)) {
        continue;
      }
      const same = cloud.filter((file) => isSameFile(photo, file));
      const match = same.find((file) => file.remotePath === photo.remotePath) ?? same[0];
      if (match) {
        matches.push({ photoId: photo.id, remotePath: match.remotePath, etag: match.etag, sha256: match.sha256 });
      }
    }
    return matches;
  }

  private matchingCloud(filter: CloudFilter): CloudPhoto[] {
    const local = [...this.photos.values()].filter((photo) => !photo.mediaMissing);
    return [...this.cloudPhotos.values()]
      .map((photo) => ({ ...photo, onPhone: local.some((candidate) => isSameFile(candidate, photo)) }))
      .filter((photo) => filter === 'all' || (filter === 'on_phone') === photo.onPhone)
      .sort(
        (left, right) =>
          right.year - left.year ||
          right.month - left.month ||
          right.lastModified - left.lastModified ||
          right.remotePath.localeCompare(left.remotePath),
      );
  }

  private dropCloudFolder(path: string): void {
    this.cloudFolders.delete(path);
    for (const [remotePath, photo] of this.cloudPhotos) {
      if (photo.folder === path) {
        this.cloudPhotos.delete(remotePath);
      }
    }
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new DatabaseError('The local library is not open yet.');
    }
  }
}

/** Same rule as `NEEDS_BACKUP_RECORD` in sqlite-photo.store.ts. */
function needsBackupRecord(photo: Photo): boolean {
  switch (photo.reviewStatus) {
    case 'pending':
      return true;
    case 'keep':
      return photo.uploadStatus !== 'uploaded' && photo.uploadStatus !== 'uploading';
    default:
      return !photo.remotePath || !photo.remoteETag;
  }
}

/** Same rule as `SAME_FILE` in sqlite-photo.store.ts. */
function isSameFile(local: Photo, cloud: Omit<CloudPhoto, 'onPhone'>): boolean {
  if (local.sha256 && cloud.sha256) {
    return local.sha256.toLowerCase() === cloud.sha256;
  }
  return (
    local.remotePath === cloud.remotePath ||
    (local.fileName === cloud.fileName && local.sizeBytes === cloud.sizeBytes)
  );
}
