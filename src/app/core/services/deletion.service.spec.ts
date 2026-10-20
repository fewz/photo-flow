import { MemoryPhotoStore } from '../database/memory-photo.store';
import { NextcloudConnectionError, NextcloudUploadError } from '../errors/app-error';
import { UploadResult } from '../models/nextcloud.model';
import { CloudStorageProvider } from '../nextcloud/cloud-storage';
import { DeletePhotoRequest, DeletePhotoResult } from '../plugins/media-library';
import type { PhotoDeleter } from '../plugins/photo-deleter';
import { PhotoRepository } from '../repositories/photo.repository';
import { DeletionService } from './deletion.service';
import { Logger } from './logger.service';
import { NextcloudService } from './nextcloud.service';
import { CredentialStore } from './secure-credential.store';
import { ReviewService } from './review.service';
import { UploadQueueService } from './upload-queue.service';

describe('DeletionService', () => {
  let repository: PhotoRepository;
  let cloud: FakeCloud;
  let online: boolean;
  let queue: UploadQueueService;
  let review: ReviewService;
  let deleter: FakeDeleter;
  let deletion: DeletionService;
  let logger: Logger;
  let nextcloud: NextcloudService;

  beforeEach(async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    repository = new PhotoRepository(store);
    cloud = new FakeCloud();
    online = true;
    logger = new Logger();
    const credentials = new MemoryCredentials();
    nextcloud = new NextcloudService(repository, cloud, credentials, logger);
    queue = new UploadQueueService(repository, nextcloud, cloud, { isOnline: () => online }, logger);
    review = new ReviewService(repository, logger, queue);
    deleter = new FakeDeleter();
    deletion = new DeletionService(repository, queue, { isOnline: () => online }, deleter, logger);
    await repository.saveNextcloudSettings({
      serverUrl: 'https://cloud.example.test',
      username: 'william',
      baseRemotePath: 'PhotoFlow',
      enabled: true,
    });
    await credentials.setAppPassword('secret-value');
    await repository.upsertFromScan({
      mediaStoreId: '1',
      uri: 'content://media/1',
      fileName: 'Fixture_001.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      width: 10,
      height: 10,
      dateTaken: Date.UTC(2026, 9, 8),
      dateModified: Date.UTC(2026, 9, 8),
    });
  });

  it('blocks deletion when the backup upload fails', async () => {
    cloud.failUpload = true;
    const photo = await markForDeletion();

    const report = await deletion.deleteMarked([photo.id]);

    expect(report.deleted).toBe(0);
    expect(deleter.calls).toHaveLength(0);
    const saved = await repository.findByMediaStoreId('1');
    expect(saved?.mediaMissing).toBe(false);
    expect(saved?.reviewStatus).toBe('delete');
    expect(saved?.deleteError).toBe('The photo could not be uploaded. Try again.');
  });

  it('blocks deletion when the server is unreachable', async () => {
    online = false;
    const photo = await markForDeletion();

    await deletion.deleteMarked([photo.id]);

    expect(deleter.calls).toHaveLength(0);
    expect(cloud.uploads).toHaveLength(0);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      mediaMissing: false,
      reviewStatus: 'delete',
      deleteError: 'Server unreachable. This photo was not deleted.',
    });
  });

  it('blocks deletion when the backup request cannot reach the server', async () => {
    cloud.failReachability = true;
    const photo = await markForDeletion();

    await deletion.deleteMarked([photo.id]);

    expect(deleter.calls).toHaveLength(0);
    expect((await repository.findByMediaStoreId('1'))?.mediaMissing).toBe(false);
    expect((await repository.findByMediaStoreId('1'))?.deleteError).toBe('The Nextcloud server could not be reached.');
  });

  it('deletes a photo that already has a verified upload', async () => {
    online = false;
    const photo = await repository.findByMediaStoreId('1');
    await repository.update({
      ...photo!,
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      remotePath: 'PhotoFlow/2026/10/Fixture_001.jpg',
      remoteETag: 'etag-1',
      updatedAt: Date.now(),
    });
    await review.decide(photo!.id, 'delete');

    const report = await deletion.deleteMarked([photo!.id]);

    expect(report.deleted).toBe(1);
    expect(cloud.uploads).toHaveLength(0);
    expect(deleter.calls).toEqual([[{ mediaStoreId: '1', uri: 'content://media/1' }]]);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      mediaMissing: true,
      reviewStatus: 'delete',
    });
    expect((await repository.counts()).recoverableBytes).toBe(0);
  });

  it('uploads first when backup before delete is on and then removes the file', async () => {
    const photo = await markForDeletion();
    expect((await repository.counts()).recoverableBytes).toBe(2048);

    const report = await deletion.deleteMarked([photo.id]);

    expect(report.message).toBe('Deleted 1 photo.');
    expect(cloud.uploads).toEqual(['PhotoFlow/2026/10/Fixture_001.jpg']);
    expect(deleter.calls).toHaveLength(1);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({ mediaMissing: true });
  });

  it('deletes without a backup when the setting is off', async () => {
    online = false;
    cloud.failUpload = true;
    await deletion.setBackupBeforeDelete(false);
    const photo = await markForDeletion();

    await deletion.deleteMarked([photo.id]);

    expect(cloud.uploads).toHaveLength(0);
    expect(deleter.calls).toHaveLength(1);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({ mediaMissing: true });
  });

  it('keeps a failed device delete so it can be retried', async () => {
    await deletion.setBackupBeforeDelete(false);
    deleter.fail = true;
    const photo = await markForDeletion();

    await deletion.deleteMarked([photo.id]);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      mediaMissing: false,
      deleteError: 'The photo could not be deleted.',
    });

    deleter.fail = false;
    const retried = await deletion.deleteMarked([photo.id]);

    expect(retried.deleted).toBe(1);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({ mediaMissing: true });
  });

  it('undo on the deletion screen returns the photo to pending review and does not remove the file', async () => {
    const photo = await markForDeletion();

    const restored = await deletion.undoMark(photo.id);

    expect(restored.reviewStatus).toBe('pending');
    expect(deleter.calls).toHaveLength(0);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      reviewStatus: 'pending',
      mediaMissing: false,
      uri: 'content://media/1',
    });
  });

  it('keeps queue state after a simulated restart', async () => {
    online = false;
    const photo = await repository.findByMediaStoreId('1');
    await review.decide(photo!.id, 'keep');
    await queue.process();
    const job = (await repository.listJobs())[0];
    await repository.updateJob({ ...job!, status: 'uploading' });

    const restarted = new UploadQueueService(repository, nextcloud, cloud, { isOnline: () => online }, logger);
    await restarted.recoverAndResume();

    expect(await repository.listJobs()).toMatchObject([{ id: job!.id, status: 'pending', photoId: photo!.id }]);
    expect(cloud.uploads).toHaveLength(0);
  });

  it('does not delete while uploads are paused', async () => {
    await queue.pause();
    const photo = await markForDeletion();

    await deletion.deleteMarked([photo.id]);

    expect(deleter.calls).toHaveLength(0);
    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      deleteError: 'Uploads are paused. This photo was not deleted.',
    });
  });

  async function markForDeletion() {
    const photo = await repository.findByMediaStoreId('1');
    return review.decide(photo!.id, 'delete');
  }
});

class MemoryCredentials implements CredentialStore {
  private secret: string | null = null;

  async getAppPassword(): Promise<string | null> {
    return this.secret;
  }

  async setAppPassword(value: string): Promise<void> {
    this.secret = value;
  }

  async hasAppPassword(): Promise<boolean> {
    return this.secret != null;
  }
}

class FakeDeleter implements PhotoDeleter {
  calls: DeletePhotoRequest[][] = [];
  fail = false;

  async deletePhotos(photos: DeletePhotoRequest[]): Promise<DeletePhotoResult[]> {
    this.calls.push(photos);
    return photos.map((photo) => ({
      mediaStoreId: photo.mediaStoreId,
      success: !this.fail,
      error: this.fail ? 'The photo could not be deleted.' : undefined,
    }));
  }
}

class FakeCloud implements CloudStorageProvider {
  uploads: string[] = [];
  failUpload = false;
  failReachability = false;

  async testConnection(): Promise<void> {
    return undefined;
  }

  async createDirectory(): Promise<void> {
    return undefined;
  }

  async upload(_session: unknown, request: { remotePath: string }): Promise<UploadResult> {
    if (this.failReachability) {
      throw new NextcloudConnectionError();
    }
    if (this.failUpload) {
      throw new NextcloudUploadError();
    }
    this.uploads.push(request.remotePath);
    return { remotePath: request.remotePath, etag: 'etag-1', sha256: 'abc' };
  }

  async fileExists(): Promise<boolean> {
    return false;
  }

  async getFileMetadata(): Promise<null> {
    return null;
  }
}
