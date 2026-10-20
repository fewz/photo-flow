import { NextcloudSettings } from '../models/nextcloud.model';
import { Photo, PhotoCounts, PhotoQuery } from '../models/photo.model';
import { ReviewAction } from '../models/review-action.model';
import { UploadJob } from '../models/upload-job.model';

export interface PhotoStore {
  initialize(): Promise<void>;
  findById(id: string): Promise<Photo | null>;
  findByMediaStoreId(mediaStoreId: string): Promise<Photo | null>;
  insert(photo: Photo): Promise<void>;
  update(photo: Photo): Promise<void>;
  list(query: PhotoQuery): Promise<Photo[]>;
  /** Ids of every photo that matches, in list order. Ids only, so a large library stays cheap. */
  listIds(query: Omit<PhotoQuery, 'limit' | 'offset'>): Promise<string[]>;
  counts(): Promise<PhotoCounts>;
  refreshDuplicateGroups(): Promise<void>;
  markMissingExcept(mediaStoreIds: readonly string[]): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  pushReviewAction(action: ReviewAction): Promise<void>;
  popReviewAction(): Promise<ReviewAction | null>;
  hasReviewAction(): Promise<boolean>;
  databaseVersion(): Promise<number>;
  getNextcloudSettings(): Promise<NextcloudSettings | null>;
  saveNextcloudSettings(settings: NextcloudSettings): Promise<void>;
  insertJob(job: UploadJob): Promise<void>;
  updateJob(job: UploadJob): Promise<void>;
  findJobForPhoto(photoId: string): Promise<UploadJob | null>;
  claimNextPendingJob(): Promise<UploadJob | null>;
  listJobs(): Promise<UploadJob[]>;
  deleteJobsByStatus(status: UploadJob['status']): Promise<void>;
  resetUploadingJobs(): Promise<void>;
}
