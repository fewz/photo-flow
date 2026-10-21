import { NextcloudAuthenticationError, NextcloudUploadError } from '../errors/app-error';
import { MemoryPhotoStore } from '../database/memory-photo.store';
import { UploadResult } from '../models/nextcloud.model';
import { CloudStorageProvider } from '../nextcloud/cloud-storage';
import { PhotoRepository } from '../repositories/photo.repository';
import { Logger } from './logger.service';
import { NextcloudService } from './nextcloud.service';
import { ReviewService } from './review.service';
import { CredentialStore } from './secure-credential.store';
import { UploadQueueService } from './upload-queue.service';

describe('UploadQueueService', () => {
  let repository: PhotoRepository;
  let cloud: FakeCloud;
  let credentials: MemoryCredentials;
  let online: boolean;
  let queue: UploadQueueService;
  let review: ReviewService;
  let logger: Logger;

  beforeEach(async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    repository = new PhotoRepository(store);
    cloud = new FakeCloud();
    credentials = new MemoryCredentials();
    online = true;
    logger = new Logger();
    const nextcloud = new NextcloudService(repository, cloud, credentials, logger);
    queue = new UploadQueueService(repository, nextcloud, cloud, { isOnline: () => online }, logger);
    review = new ReviewService(repository, logger, queue);
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
      sizeBytes: 10,
      width: 10,
      height: 10,
      dateTaken: Date.UTC(2026, 9, 8),
      dateModified: Date.UTC(2026, 9, 8),
    });
  });

  it('does not enqueue a photo that is already uploaded', async () => {
    const photo = await repository.findByMediaStoreId('1');
    await repository.update({
      ...photo!,
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      remotePath: 'PhotoFlow/2026/10/Fixture_001.jpg',
      updatedAt: Date.now(),
    });

    await queue.noteKept((await repository.findByMediaStoreId('1'))!);

    expect(await repository.listJobs()).toHaveLength(0);
    expect(cloud.uploads).toHaveLength(0);
  });

  it('retries a failed upload', async () => {
    cloud.failUpload = true;
    const photo = await repository.findByMediaStoreId('1');
    await review.decide(photo!.id, 'keep');
    await queue.process();

    expect((await repository.findByMediaStoreId('1'))?.uploadStatus).toBe('failed');
    const failed = await repository.listJobs();
    expect(failed[0]?.status).toBe('failed');

    cloud.failUpload = false;
    await queue.retry(failed[0]!.id);

    expect((await repository.findByMediaStoreId('1'))?.uploadStatus).toBe('uploaded');
    expect((await repository.findByMediaStoreId('1'))?.remoteETag).toBe('etag-1');
    expect(cloud.uploads).toEqual(['PhotoFlow/2026/October/Fixture_001.jpg']);
  });

  it('keeps the pending job and does not upload while offline', async () => {
    online = false;
    const photo = await repository.findByMediaStoreId('1');
    await review.decide(photo!.id, 'keep');
    await queue.process();

    expect(await repository.listJobs()).toMatchObject([{ status: 'pending' }]);
    expect((await repository.findByMediaStoreId('1'))?.uploadStatus).toBe('pending');
    expect(cloud.uploads).toHaveLength(0);
  });

  it('uploads a pending job once the network returns', async () => {
    online = false;
    const photo = await repository.findByMediaStoreId('1');
    await review.decide(photo!.id, 'keep');
    await queue.process();
    expect(cloud.uploads).toHaveLength(0);

    online = true;
    await queue.process();

    expect((await repository.findByMediaStoreId('1'))?.uploadStatus).toBe('uploaded');
    expect(cloud.uploads).toHaveLength(1);
  });

  it('asks the background uploader to run and does not upload in the page', async () => {
    const calls: string[] = [];
    const background = {
      async schedule(): Promise<void> {
        calls.push('schedule');
      },
      async cancel(): Promise<void> {
        calls.push('cancel');
      },
    };
    const nextcloud = new NextcloudService(repository, cloud, credentials, logger);
    const local = new UploadQueueService(
      repository,
      nextcloud,
      cloud,
      { isOnline: () => true },
      logger,
      background,
    );
    const photo = await repository.findByMediaStoreId('1');
    await local.noteKept({ ...photo!, reviewStatus: 'keep', uploadStatus: 'pending' });

    expect(calls).toEqual(['schedule']);
    expect(cloud.uploads).toHaveLength(0);
    expect(await repository.listJobs()).toMatchObject([{ status: 'pending' }]);

    await local.pause();
    expect(calls).toEqual(['schedule', 'cancel']);
  });

  it('plans a manual backup and marks unreviewed photos Keep before queueing them', async () => {
    for (const id of ['2', '3', '4']) {
      await repository.upsertFromScan({
        mediaStoreId: id,
        uri: `content://media/${id}`,
        fileName: `Fixture_00${id}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        width: 10,
        height: 10,
        dateTaken: Date.UTC(2026, 9, 8),
        dateModified: Date.UTC(2026, 9, 8),
      });
    }
    const pending = (await repository.findByMediaStoreId('1'))!;
    const kept = (await repository.findByMediaStoreId('2'))!;
    const uploaded = (await repository.findByMediaStoreId('3'))!;
    const marked = (await repository.findByMediaStoreId('4'))!;
    await repository.update({ ...kept, reviewStatus: 'keep', uploadStatus: 'failed' });
    await repository.update({
      ...uploaded,
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      remotePath: 'PhotoFlow/2026/10/Fixture_003.jpg',
    });
    await repository.update({ ...marked, reviewStatus: 'delete' });
    online = false;

    const plan = await queue.planBackup([pending.id, kept.id, uploaded.id, marked.id]);
    const queued = await queue.startBackup(plan);

    expect(plan).toEqual({
      toUpload: [pending.id, kept.id],
      markKeep: 1,
      alreadyBackedUp: 1,
      markedForDeletion: 1,
    });
    expect(queued).toBe(2);
    expect((await repository.getById(pending.id))).toMatchObject({ reviewStatus: 'keep', uploadStatus: 'pending' });
    expect((await repository.getById(marked.id))?.reviewStatus).toBe('delete');
    expect((await repository.listJobs()).map((job) => job.photoId).sort()).toEqual([pending.id, kept.id].sort());
    expect(await review.canUndo()).toBe(false);
  });

  it('cancels a waiting upload and keeps the photo kept but unqueued', async () => {
    online = false;
    const photo = (await repository.findByMediaStoreId('1'))!;
    await review.decide(photo.id, 'keep');
    const job = (await repository.listJobs())[0]!;

    expect(await queue.cancelUpload(job.id)).toBe(true);

    expect(await repository.listJobs()).toHaveLength(0);
    expect(await repository.getById(photo.id)).toMatchObject({ reviewStatus: 'keep', uploadStatus: 'not_required' });
    expect(await queue.cancelUpload(job.id)).toBe(false);
  });

  it('defaults to one upload at a time and keeps the setting between 1 and 2', async () => {
    expect(await queue.concurrency()).toBe(1);

    expect(await queue.setConcurrency(2)).toBe(2);
    expect(await queue.concurrency()).toBe(2);
    expect(await repository.getSetting('upload_concurrency')).toBe('2');

    expect(await queue.setConcurrency(8)).toBe(2);
    expect(await queue.setConcurrency(0)).toBe(1);
    expect(await queue.concurrency()).toBe(1);
  });

  it('reports authentication failure without logging the app password', async () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    cloud.failAuth = true;
    const nextcloud = new NextcloudService(repository, cloud, credentials, logger);

    try {
      await expect(nextcloud.testConnection()).rejects.toBeInstanceOf(NextcloudAuthenticationError);
      expect(JSON.stringify(warnings)).not.toContain('secret-value');
      expect(JSON.stringify(warnings)).toContain('nextcloud_auth');
    } finally {
      console.warn = original;
    }
  });

  it('uploads into month-name folders and moves queued jobs off the old numeric layout', async () => {
    online = false;
    const photo = await repository.findByMediaStoreId('1');
    await review.decide(photo!.id, 'keep');
    const [job] = await repository.listJobs();
    expect(job?.remotePath).toBe('PhotoFlow/2026/October/Fixture_001.jpg');
    // A job queued by a version that still used `YYYY/MM`.
    await repository.updateJob({ ...job!, remotePath: 'PhotoFlow/2026/10/Fixture_001.jpg' });

    online = true;
    await queue.recoverAndResume();

    expect(cloud.uploads).toEqual(['PhotoFlow/2026/October/Fixture_001.jpg']);
  });
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

class FakeCloud implements CloudStorageProvider {
  uploads: string[] = [];
  failUpload = false;
  failAuth = false;

  async testConnection(): Promise<void> {
    if (this.failAuth) {
      throw new NextcloudAuthenticationError();
    }
  }

  async createDirectory(): Promise<void> {
    return undefined;
  }

  async upload(session: { appPassword: string }, request: { remotePath: string }): Promise<UploadResult> {
    if (session.appPassword) {
      // Touch the secret so a careless log of the session would fail the redaction test.
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
