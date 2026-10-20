import { DatabaseError } from '../errors/app-error';
import { Photo, ReviewStatus } from '../models/photo.model';
import { PhotoRepository } from '../repositories/photo.repository';
import { createId } from '../utils/id';
import { Logger } from './logger.service';
import { UploadQueueService } from './upload-queue.service';

export class ReviewService {
  constructor(
    private readonly photos: PhotoRepository,
    private readonly logger: Logger,
    private readonly queue: UploadQueueService,
  ) {}

  async decide(photoId: string, reviewStatus: Extract<ReviewStatus, 'keep' | 'delete'>): Promise<Photo> {
    const photo = await this.photos.getById(photoId);
    if (!photo) {
      throw new DatabaseError('That photo is no longer in the library.');
    }
    if (photo.reviewStatus === reviewStatus) {
      return photo;
    }

    const now = Date.now();
    const updated: Photo = {
      ...photo,
      reviewStatus,
      updatedAt: now,
    };
    if (reviewStatus === 'keep' && !(photo.uploadStatus === 'uploaded' && photo.remotePath)) {
      updated.uploadStatus = 'pending';
      updated.uploadProgress = 0;
      updated.uploadError = undefined;
    }
    if (reviewStatus === 'delete') {
      updated.uploadStatus = 'not_required';
      updated.uploadProgress = 0;
      updated.uploadError = undefined;
    }
    await this.photos.saveDecision(updated, {
      id: createId(),
      photoId: photo.id,
      previousReviewStatus: photo.reviewStatus,
      previousUploadStatus: photo.uploadStatus,
      nextReviewStatus: reviewStatus,
      createdAt: now,
    });
    if (reviewStatus === 'keep' && updated.uploadStatus === 'pending') {
      await this.queue.noteKept(updated);
    }
    if (reviewStatus === 'delete') {
      await this.queue.cancelForPhoto(photo.id);
    }
    this.logger.info('PhotoScanner', 'Review decision saved', {
      mediaStoreId: photo.mediaStoreId,
      reviewStatus,
    });
    return updated;
  }

  async undo(): Promise<Photo | null> {
    const restored = await this.photos.undoLastDecision();
    if (restored) {
      await this.queue.reconcile(restored);
    }
    return restored;
  }

  canUndo(): Promise<boolean> {
    return this.photos.hasUndo();
  }
}
