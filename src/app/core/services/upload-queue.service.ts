import { SETTING_UPLOAD_CONCURRENCY, SETTING_UPLOAD_PAUSED } from '../constants/app.constants';
import { AppError, toUserMessage } from '../errors/app-error';
import { hasVerifiedBackup, Photo } from '../models/photo.model';
import { UploadJob } from '../models/upload-job.model';
import { CloudStorageProvider } from '../nextcloud/cloud-storage';
import { photoRemotePath } from '../nextcloud/remote-path';
import { PhotoRepository } from '../repositories/photo.repository';
import { createId } from '../utils/id';
import { Logger } from './logger.service';
import { NetworkStatus } from './network-monitor';
import { NextcloudService } from './nextcloud.service';

/** What a manual "back up these photos" request will do, shown to the user before it runs. */
export interface BackupPlan {
  /** Photos that will be queued (kept ones and ones about to be marked Keep). */
  toUpload: string[];
  /** Of those, photos not reviewed yet; they are marked Keep first. */
  markKeep: number;
  alreadyBackedUp: number;
  /** Skipped: backup before delete takes care of them. */
  markedForDeletion: number;
}

export interface BackgroundUploader {
  schedule(): Promise<void>;
  cancel(): Promise<void>;
}

export class UploadQueueService {
  private draining: Promise<void> | null = null;
  private claimChain: Promise<unknown> = Promise.resolve();
  private readonly backupPhotoIds = new Set<string>();

  constructor(
    private readonly photos: PhotoRepository,
    private readonly nextcloud: NextcloudService,
    private readonly cloud: CloudStorageProvider,
    private readonly network: NetworkStatus,
    private readonly logger: Logger,
    private readonly background: BackgroundUploader | null = null,
  ) {}

  async noteKept(photo: Photo): Promise<void> {
    if (photo.uploadStatus === 'uploaded' && photo.remotePath) {
      this.logger.info('UploadQueue', 'Skipped photo that is already backed up', {
        mediaStoreId: photo.mediaStoreId,
      });
      return;
    }
    await this.enqueue(photo);
    void this.process();
  }

  async uploadBackup(photo: Photo): Promise<Photo> {
    if (hasVerifiedBackup(photo) || !this.network.isOnline() || (await this.isPaused())) {
      return (await this.photos.getById(photo.id)) ?? photo;
    }
    this.backupPhotoIds.add(photo.id);
    try {
      await this.enqueue(photo);
      if (this.background) {
        await this.process();
        return (await this.waitForBackup(photo.id)) ?? photo;
      }
      let latest = (await this.photos.getById(photo.id)) ?? photo;
      for (let attempt = 0; attempt < 3 && !hasVerifiedBackup(latest); attempt += 1) {
        const job = await this.photos.findJobForPhoto(photo.id);
        if (!job || (job.status !== 'pending' && job.status !== 'uploading')) {
          break;
        }
        if (!this.network.isOnline() || (await this.isPaused())) {
          break;
        }
        await this.process();
        latest = (await this.photos.getById(photo.id)) ?? latest;
      }
      return latest;
    } finally {
      this.backupPhotoIds.delete(photo.id);
    }
  }

  async planBackup(photoIds: readonly string[]): Promise<BackupPlan> {
    const plan: BackupPlan = { toUpload: [], markKeep: 0, alreadyBackedUp: 0, markedForDeletion: 0 };
    for (const id of photoIds) {
      const photo = await this.photos.getById(id);
      if (!photo || photo.mediaMissing) {
        continue;
      }
      if (photo.reviewStatus === 'delete') {
        plan.markedForDeletion += 1;
      } else if (hasVerifiedBackup(photo)) {
        plan.alreadyBackedUp += 1;
      } else {
        plan.toUpload.push(photo.id);
        if (photo.reviewStatus === 'pending') {
          plan.markKeep += 1;
        }
      }
    }
    return plan;
  }

  /**
   * Queues a manual backup from the gallery. Only kept photos are backed up, so a photo that was
   * not reviewed yet is marked Keep first (not added to the review Undo history).
   */
  async startBackup(plan: BackupPlan): Promise<number> {
    let queued = 0;
    for (const id of plan.toUpload) {
      const photo = await this.photos.getById(id);
      if (!photo || photo.mediaMissing || photo.reviewStatus === 'delete' || hasVerifiedBackup(photo)) {
        continue;
      }
      const kept: Photo = {
        ...photo,
        reviewStatus: 'keep',
        uploadStatus: 'pending',
        uploadProgress: 0,
        uploadError: undefined,
        updatedAt: Date.now(),
      };
      await this.photos.update(kept);
      await this.enqueue(kept);
      queued += 1;
    }
    this.logger.info('UploadQueue', 'Manual backup queued', { queued, markedKeep: plan.markKeep });
    if (queued > 0) {
      void this.process();
    }
    return queued;
  }

  /**
   * Takes one waiting upload out of the queue. The photo stays kept but is no longer queued,
   * so it can be backed up again from the gallery. A job that already started is left alone.
   */
  async cancelUpload(jobId: string): Promise<boolean> {
    const job = (await this.photos.listJobs()).find((item) => item.id === jobId);
    if (!job || (job.status !== 'pending' && job.status !== 'failed')) {
      return false;
    }
    const now = Date.now();
    await this.photos.updateJob({ ...job, status: 'cancelled', updatedAt: now });
    const photo = await this.photos.getById(job.photoId);
    if (photo && !hasVerifiedBackup(photo)) {
      await this.photos.update({
        ...photo,
        uploadStatus: 'not_required',
        uploadProgress: 0,
        uploadError: undefined,
        updatedAt: now,
      });
    }
    this.logger.info('UploadQueue', 'Upload cancelled', { mediaStoreId: photo?.mediaStoreId });
    return true;
  }

  async reconcile(photo: Photo): Promise<void> {
    if (photo.reviewStatus === 'keep' && photo.uploadStatus === 'pending') {
      await this.noteKept(photo);
      return;
    }
    if (photo.uploadStatus === 'not_required' || photo.reviewStatus !== 'keep') {
      await this.cancelForPhoto(photo.id);
    }
  }

  async cancelForPhoto(photoId: string): Promise<void> {
    const job = await this.photos.findJobForPhoto(photoId);
    if (!job || job.status === 'uploaded' || job.status === 'cancelled') {
      return;
    }
    await this.photos.updateJob({
      ...job,
      status: 'cancelled',
      updatedAt: Date.now(),
    });
  }

  async recoverAndResume(): Promise<void> {
    await this.photos.resetUploadingJobs();
    await this.process();
  }

  async pause(): Promise<void> {
    await this.photos.setSetting(SETTING_UPLOAD_PAUSED, '1');
    this.logger.info('UploadQueue', 'Upload queue paused');
    await this.background?.cancel();
  }

  async resume(): Promise<void> {
    await this.photos.setSetting(SETTING_UPLOAD_PAUSED, '0');
    await this.process();
  }

  async retry(jobId: string): Promise<void> {
    const jobs = await this.photos.listJobs();
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      return;
    }
    await this.requeue(job);
    await this.process();
  }

  async retryFailed(): Promise<void> {
    const jobs = await this.photos.listJobs();
    for (const job of jobs.filter((item) => item.status === 'failed')) {
      await this.requeue(job);
    }
    await this.process();
  }

  async clearCompleted(): Promise<void> {
    await this.photos.deleteJobsByStatus('uploaded');
  }

  isPaused(): Promise<boolean> {
    return this.photos.getSetting(SETTING_UPLOAD_PAUSED).then((value) => value === '1');
  }

  process(): Promise<void> {
    if (this.background) {
      return this.background.schedule().catch((error: unknown) => {
        this.logger.warn('UploadQueue', 'Background upload could not be scheduled', {
          cause: error instanceof Error ? error.name : 'unknown',
        });
      });
    }
    if (this.draining) {
      return this.draining;
    }
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    const workers = Array.from({ length: await this.concurrency() }, () => this.worker());
    await Promise.all(workers);
  }

  private async worker(): Promise<void> {
    for (;;) {
      if (!this.network.isOnline()) {
        this.logger.info('UploadQueue', 'Offline. Pending uploads stay in the queue.');
        return;
      }
      if (await this.isPaused()) {
        return;
      }
      const job = await this.claimNext();
      if (!job) {
        return;
      }
      await this.execute(job);
    }
  }

  private async execute(job: UploadJob): Promise<void> {
    const photo = await this.photos.getById(job.photoId);
    if (!photo || !this.acceptsUpload(photo)) {
      await this.photos.updateJob({ ...job, status: 'cancelled', updatedAt: Date.now() });
      return;
    }
    await this.photos.update({
      ...photo,
      uploadStatus: 'uploading',
      uploadProgress: 0,
      uploadError: undefined,
      updatedAt: Date.now(),
    });
    try {
      const session = await this.nextcloud.session();
      let lastProgress = 0;
      let progressWrite: Promise<void> = Promise.resolve();
      let closed = false;
      const result = await this.cloud.upload(session, {
        jobId: job.id,
        localUri: photo.uri,
        remotePath: job.remotePath,
        mimeType: photo.mimeType,
        fileName: photo.fileName,
      }, (progress) => {
        if (progress - lastProgress < 0.1 && progress < 1) {
          return;
        }
        lastProgress = progress;
        progressWrite = progressWrite.then(async () => {
          if (closed) {
            return;
          }
          const now = Date.now();
          await this.photos.update({
            ...photo,
            uploadStatus: 'uploading',
            uploadProgress: progress,
            updatedAt: now,
          });
          await this.photos.updateJob({ ...job, status: 'uploading', progress, updatedAt: now });
        });
      });
      closed = true;
      await progressWrite;
      const finished = await this.photos.getById(photo.id);
      const currentJob = await this.photos.findJobForPhoto(photo.id);
      if (!finished || !this.acceptsUpload(finished) || currentJob?.status === 'cancelled') {
        return;
      }
      const now = Date.now();
      await this.photos.update({
        ...finished,
        uploadStatus: 'uploaded',
        uploadProgress: 1,
        remotePath: result.remotePath,
        remoteETag: result.etag,
        sha256: result.sha256 ?? finished.sha256,
        uploadError: undefined,
        updatedAt: now,
      });
      await this.photos.updateJob({
        ...job,
        status: 'uploaded',
        progress: 1,
        error: undefined,
        remotePath: result.remotePath,
        updatedAt: now,
      });
      this.logger.info('UploadQueue', 'Upload finished', {
        mediaStoreId: photo.mediaStoreId,
        remotePath: result.remotePath,
      });
    } catch (error) {
      const message = toUserMessage(error, 'The photo could not be uploaded. Try again.');
      this.logger.warn('UploadQueue', 'Upload failed', {
        mediaStoreId: photo.mediaStoreId,
        code: error instanceof AppError ? error.code : 'unknown',
      });
      const now = Date.now();
      const latest = await this.photos.getById(photo.id);
      if (latest && this.acceptsUpload(latest)) {
        await this.photos.update({
          ...latest,
          uploadStatus: 'failed',
          uploadError: message,
          updatedAt: now,
        });
      }
      await this.photos.updateJob({
        ...job,
        status: 'failed',
        error: message,
        retryCount: job.retryCount + 1,
        updatedAt: now,
      });
    }
  }

  private async enqueue(photo: Photo): Promise<void> {
    const settings = await this.photos.getNextcloudSettings();
    const remotePath = photoRemotePath(settings?.baseRemotePath ?? 'PhotoFlow', photo);
    const existing = await this.photos.findJobForPhoto(photo.id);
    const now = Date.now();
    if (existing && (existing.status === 'pending' || existing.status === 'uploading')) {
      return;
    }
    if (existing && existing.status === 'failed') {
      await this.photos.updateJob({
        ...existing,
        remotePath,
        localUri: photo.uri,
        status: 'pending',
        progress: 0,
        error: undefined,
        updatedAt: now,
      });
      return;
    }
    if (!existing || existing.status === 'cancelled' || existing.status === 'uploaded') {
      await this.photos.insertJob({
        id: createId(),
        photoId: photo.id,
        localUri: photo.uri,
        remotePath,
        status: 'pending',
        progress: 0,
        retryCount: existing?.retryCount ?? 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private acceptsUpload(photo: Photo): boolean {
    return photo.reviewStatus === 'keep' || this.backupPhotoIds.has(photo.id);
  }

  private async requeue(job: UploadJob): Promise<void> {
    const now = Date.now();
    await this.photos.updateJob({
      ...job,
      status: 'pending',
      progress: 0,
      error: undefined,
      updatedAt: now,
    });
    const photo = await this.photos.getById(job.photoId);
    if (photo && photo.reviewStatus === 'keep' && photo.uploadStatus !== 'uploaded') {
      await this.photos.update({
        ...photo,
        uploadStatus: 'pending',
        uploadProgress: 0,
        uploadError: undefined,
        updatedAt: now,
      });
    }
  }

  private claimNext(): Promise<UploadJob | null> {
    const run = this.claimChain.then(() => this.photos.claimNextPendingJob());
    this.claimChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async waitForBackup(photoId: string): Promise<Photo | null> {
    for (;;) {
      if (!this.network.isOnline() || (await this.isPaused())) {
        return this.photos.getById(photoId);
      }
      const latest = await this.photos.getById(photoId);
      const job = await this.photos.findJobForPhoto(photoId);
      if (
        !latest ||
        hasVerifiedBackup(latest) ||
        latest.uploadStatus === 'failed' ||
        !job ||
        job.status === 'failed' ||
        job.status === 'cancelled' ||
        job.status === 'uploaded'
      ) {
        return latest;
      }
      await delay(400);
    }
  }

  async concurrency(): Promise<number> {
    const raw = Number(await this.photos.getSetting(SETTING_UPLOAD_CONCURRENCY));
    if (!Number.isFinite(raw) || raw < 1) {
      return 1;
    }
    return Math.min(2, Math.floor(raw));
  }

  /** 1 or 2 uploads at a time. The Android UploadWorker reads the same setting. */
  async setConcurrency(value: number): Promise<number> {
    const next = Number.isFinite(value) ? Math.min(2, Math.max(1, Math.floor(value))) : 1;
    await this.photos.setSetting(SETTING_UPLOAD_CONCURRENCY, String(next));
    this.logger.info('UploadQueue', 'Upload concurrency changed', { concurrency: next });
    return next;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
