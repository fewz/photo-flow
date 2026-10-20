import { MemoryPhotoStore } from '../database/memory-photo.store';
import { PhotoRepository } from '../repositories/photo.repository';
import { Logger } from './logger.service';
import { ReviewService } from './review.service';
import { UploadQueueService } from './upload-queue.service';
import { NextcloudService } from './nextcloud.service';
import { CloudStorageProvider } from '../nextcloud/cloud-storage';

describe('ReviewService', () => {
  let repository: PhotoRepository;
  let review: ReviewService;

  beforeEach(async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    repository = new PhotoRepository(store);
    const cloud: CloudStorageProvider = {
      testConnection: async () => undefined,
      createDirectory: async () => undefined,
      upload: async () => ({ remotePath: 'PhotoFlow/photo.jpg', etag: 'etag' }),
      fileExists: async () => true,
      getFileMetadata: async () => ({ path: 'PhotoFlow/photo.jpg', etag: 'etag' }),
    };
    const nextcloud = new NextcloudService(repository, cloud, memoryCredentials(), new Logger());
    const queue = new UploadQueueService(repository, nextcloud, cloud, { isOnline: () => false }, new Logger());
    review = new ReviewService(repository, new Logger(), queue);
    await repository.upsertFromScan({
      mediaStoreId: '1',
      uri: 'content://media/1',
      fileName: 'Fixture_001.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      width: 10,
      height: 10,
      dateTaken: 10,
      dateModified: 10,
    });
  });

  it('swipe left sets reviewStatus to delete and keeps the photo', async () => {
    const photo = await repository.findByMediaStoreId('1');
    const updated = await review.decide(photo!.id, 'delete');

    expect(updated.reviewStatus).toBe('delete');
    expect(updated.uploadStatus).toBe('not_required');
    expect(await repository.findByMediaStoreId('1')).toMatchObject({ reviewStatus: 'delete' });
    expect(await repository.listJobs()).toHaveLength(0);
  });

  it('swipe right keeps the photo and creates an upload job', async () => {
    const photo = await repository.findByMediaStoreId('1');
    const updated = await review.decide(photo!.id, 'keep');
    const jobs = await repository.listJobs();

    expect(updated.reviewStatus).toBe('keep');
    expect(updated.uploadStatus).toBe('pending');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('pending');
    expect(jobs[0]?.photoId).toBe(photo!.id);
  });

  it('undo restores the previous review status and drops the upload job', async () => {
    const photo = await repository.findByMediaStoreId('1');
    await review.decide(photo!.id, 'keep');
    const restored = await review.undo();

    expect(restored?.reviewStatus).toBe('pending');
    expect(restored?.uploadStatus).toBe('not_required');
    expect(await review.canUndo()).toBe(false);
    expect(await repository.listJobs()).toHaveLength(0);
  });
});

function memoryCredentials() {
  let secret: string | null = null;
  return {
    getAppPassword: async () => secret,
    setAppPassword: async (value: string) => {
      secret = value;
    },
    hasAppPassword: async () => secret != null,
  };
}
