import { MemoryPhotoStore } from '../database/memory-photo.store';
import { NetworkError } from '../errors/app-error';
import { NextcloudSession, RemoteFileMetadata, UploadRequest, UploadResult } from '../models/nextcloud.model';
import { Photo } from '../models/photo.model';
import { CloudLibraryProvider, CloudStorageProvider } from '../nextcloud/cloud-storage';
import { RemoteEntry } from '../nextcloud/remote-listing';
import { PreviewResult, SaveResult } from '../nextcloud/webdav-transport';
import { PhotoRepository } from '../repositories/photo.repository';
import { CloudLibraryService } from './cloud-library.service';
import { Logger } from './logger.service';
import { NextcloudService } from './nextcloud.service';
import { CredentialStore } from './secure-credential.store';

describe('CloudLibraryService', () => {
  let repository: PhotoRepository;
  let server: FakeServer;
  let online: boolean;
  let library: CloudLibraryService;

  beforeEach(async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    repository = new PhotoRepository(store);
    server = new FakeServer();
    online = true;
    const credentials = new MemoryCredentials();
    const logger = new Logger();
    const nextcloud = new NextcloudService(repository, new UnusedStorage(), credentials, logger);
    library = new CloudLibraryService(repository, nextcloud, server, credentials, { isOnline: () => online }, logger);
    await repository.saveNextcloudSettings({
      serverUrl: 'https://cloud.example.test',
      username: 'william',
      baseRemotePath: 'PhotoFlow',
      enabled: true,
    });
    await credentials.setAppPassword('secret-value');
    server.folder('PhotoFlow', [folder('PhotoFlow/2025'), folder('PhotoFlow/2026'), file('PhotoFlow/readme.md', 9, 'text/markdown')]);
    server.folder('PhotoFlow/2025', [folder('PhotoFlow/2025/December', 'dec-1')]);
    server.folder('PhotoFlow/2026', [folder('PhotoFlow/2026/March', 'mar-1'), folder('PhotoFlow/2026/October', 'oct-1')]);
    server.folder('PhotoFlow/2025/December', [file('PhotoFlow/2025/December/Fixture_001.jpg', 1)]);
    server.folder('PhotoFlow/2026/March', [file('PhotoFlow/2026/March/Fixture_002.jpg', 2)]);
    server.folder('PhotoFlow/2026/October', [
      file('PhotoFlow/2026/October/Fixture_003.jpg', 3),
      file('PhotoFlow/2026/October/Fixture_004.jpg', 4),
      file('PhotoFlow/2026/October/notes.txt', 5, 'text/plain'),
    ]);
  });

  it('lists the backup folders newest month first', async () => {
    await library.sync();

    const photos = await library.list({ filter: 'all', limit: 10, offset: 0 });
    expect(photos.map((photo) => photo.fileName)).toEqual([
      'Fixture_004.jpg',
      'Fixture_003.jpg',
      'Fixture_002.jpg',
      'Fixture_001.jpg',
    ]);
    expect(await library.sections('all')).toEqual([
      { folder: 'PhotoFlow/2026/October', year: 2026, month: 9, count: 2 },
      { folder: 'PhotoFlow/2026/March', year: 2026, month: 2, count: 1 },
      { folder: 'PhotoFlow/2025/December', year: 2025, month: 11, count: 1 },
    ]);
    expect(await library.needsSync()).toBe(false);
  });

  it('does not list a month folder again while its etag is unchanged', async () => {
    await library.sync();
    server.listed = [];

    server.folder('PhotoFlow/2026', [folder('PhotoFlow/2026/March', 'mar-1'), folder('PhotoFlow/2026/October', 'oct-2')]);
    server.folder('PhotoFlow/2026/October', [file('PhotoFlow/2026/October/Fixture_005.jpg', 6)]);
    await library.sync();

    expect(server.listed).not.toContain('PhotoFlow/2026/March');
    expect(server.listed).toContain('PhotoFlow/2026/October');
    const names = (await library.list({ filter: 'all', limit: 10, offset: 0 })).map((photo) => photo.fileName);
    expect(names).toEqual(['Fixture_005.jpg', 'Fixture_002.jpg', 'Fixture_001.jpg']);
  });

  it('forgets folders that were removed from the server', async () => {
    await library.sync();
    server.folder('PhotoFlow', [folder('PhotoFlow/2026')]);

    await library.sync();

    expect((await library.counts()).total).toBe(3);
  });

  it('tells photos still on this phone from photos only in Nextcloud', async () => {
    await repository.upsertFromScan(scanned('1', 'Fixture_003.jpg'));
    const photo = (await repository.findByMediaStoreId('1'))!;
    await repository.update({
      ...photo,
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      remotePath: 'PhotoFlow/2026/October/Fixture_003.jpg',
    });
    await library.sync();

    expect(await library.counts()).toEqual({ total: 4, cloudOnly: 3, onPhone: 1 });
    const onPhone = await library.list({ filter: 'on_phone', limit: 10, offset: 0 });
    expect(onPhone.map((item) => item.fileName)).toEqual(['Fixture_003.jpg']);

    await repository.update({ ...(await repository.findByMediaStoreId('1'))!, mediaMissing: true });
    expect((await library.counts()).onPhone).toBe(0);
  });

  it('matches by checksum when both sides have one, whatever the name or path', async () => {
    const digest = 'a'.repeat(64);
    server.folder('PhotoFlow/2026/October', [{ ...file('PhotoFlow/2026/October/Fixture_003.jpg', 3), sha256: digest }]);
    await localPhoto('1', { fileName: 'Renamed.jpg', sha256: digest.toUpperCase() });
    await library.sync();

    const onPhone = await library.list({ filter: 'on_phone', limit: 10, offset: 0 });
    expect(onPhone.map((item) => item.fileName)).toEqual(['Fixture_003.jpg']);
  });

  it('does not fall back to name and size when the checksums differ', async () => {
    server.folder('PhotoFlow/2026/October', [
      { ...file('PhotoFlow/2026/October/Fixture_003.jpg', 3), sha256: 'b'.repeat(64) },
    ]);
    await localPhoto('1', {
      fileName: 'Fixture_003.jpg',
      sizeBytes: 1003,
      sha256: 'c'.repeat(64),
      remotePath: 'PhotoFlow/2026/October/Fixture_003.jpg',
    });
    await library.sync();

    expect((await library.counts()).onPhone).toBe(0);
  });

  it('matches by file name and size when there is no checksum', async () => {
    await localPhoto('1', { fileName: 'Fixture_002.jpg', sizeBytes: 1002, sha256: 'd'.repeat(64) });
    await localPhoto('2', { fileName: 'Fixture_004.jpg', sizeBytes: 999 });
    await library.sync();

    const onPhone = await library.list({ filter: 'on_phone', limit: 10, offset: 0 });
    expect(onPhone.map((item) => item.fileName)).toEqual(['Fixture_002.jpg']);
  });

  it('marks photos still to review that are already in Nextcloud as kept and backed up', async () => {
    await localPhoto('1', { fileName: 'Fixture_002.jpg', sizeBytes: 1002 });
    await localPhoto('2', { fileName: 'Not_backed_up.jpg', sizeBytes: 1002 });

    const report = await library.sync();

    expect(report).toEqual({ kept: 1, markedForDeletion: 0 });
    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      remotePath: 'PhotoFlow/2026/March/Fixture_002.jpg',
      remoteETag: 'etag-2',
    });
    expect((await repository.findByMediaStoreId('2'))?.reviewStatus).toBe('pending');
    expect(await library.recordBackups()).toEqual({ kept: 0, markedForDeletion: 0 });
  });

  it('takes a kept photo that is already in Nextcloud out of the upload queue', async () => {
    await localPhoto('1', { fileName: 'Fixture_003.jpg', sizeBytes: 1003, reviewStatus: 'keep', uploadStatus: 'pending' });
    const photo = (await repository.findByMediaStoreId('1'))!;
    await repository.insertJob({
      id: 'job-1',
      photoId: photo.id,
      localUri: photo.uri,
      remotePath: 'PhotoFlow/2026/October/Fixture_003.jpg',
      status: 'pending',
      progress: 0,
      retryCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });

    await library.sync();

    expect((await repository.findByMediaStoreId('1'))?.uploadStatus).toBe('uploaded');
    expect(await repository.listJobs()).toEqual([]);
  });

  it('keeps the deletion mark but records the backup', async () => {
    await localPhoto('1', { fileName: 'Fixture_004.jpg', sizeBytes: 1004, reviewStatus: 'delete' });

    expect(await library.sync()).toEqual({ kept: 0, markedForDeletion: 1 });

    expect(await repository.findByMediaStoreId('1')).toMatchObject({
      reviewStatus: 'delete',
      uploadStatus: 'not_required',
      remotePath: 'PhotoFlow/2026/October/Fixture_004.jpg',
      remoteETag: 'etag-4',
    });
  });

  it('records photos from the cached listing while offline', async () => {
    await library.sync();
    await localPhoto('1', { fileName: 'Fixture_001.jpg', sizeBytes: 1001 });
    online = false;

    expect(await library.recordBackups()).toEqual({ kept: 1, markedForDeletion: 0 });
    expect((await repository.findByMediaStoreId('1'))?.reviewStatus).toBe('keep');
  });

  it('starts over when the Nextcloud settings change', async () => {
    await library.sync();
    await repository.saveNextcloudSettings({
      serverUrl: 'https://cloud.example.test',
      username: 'william',
      baseRemotePath: 'Backups',
      enabled: true,
    });

    expect(await library.needsSync()).toBe(true);
    await library.sync();
    expect((await library.counts()).total).toBe(0);
  });

  it('does not reach out while offline', async () => {
    online = false;
    await expect(library.sync()).rejects.toBeInstanceOf(NetworkError);
    expect(server.listed).toEqual([]);
  });

  it('records a photo saved to the phone as kept and backed up', async () => {
    await library.sync();
    const [photo] = await library.list({ filter: 'cloud_only', limit: 1, offset: 0 });

    expect(await library.saveToPhone(photo!)).toBe(true);

    const restored = await repository.findByMediaStoreId('77');
    expect(restored).toMatchObject({
      reviewStatus: 'keep',
      uploadStatus: 'uploaded',
      remotePath: photo!.remotePath,
      remoteETag: photo!.etag,
    });
    expect((await library.counts()).onPhone).toBe(1);
  });

  async function localPhoto(mediaStoreId: string, changes: Partial<Photo> & { fileName: string }): Promise<void> {
    await repository.upsertFromScan(scanned(mediaStoreId, changes.fileName));
    const photo = (await repository.findByMediaStoreId(mediaStoreId))!;
    await repository.update({ ...photo, ...changes });
  }
});

class FakeServer implements CloudLibraryProvider {
  listed: string[] = [];
  private readonly folders = new Map<string, RemoteEntry[]>();

  folder(path: string, entries: RemoteEntry[]): void {
    this.folders.set(path, entries);
  }

  async listFolder(_session: NextcloudSession, remotePath: string): Promise<RemoteEntry[] | null> {
    this.listed.push(remotePath);
    return this.folders.get(remotePath) ?? null;
  }

  async preview(): Promise<PreviewResult> {
    return { dataUrl: 'data:image/jpeg;base64,' };
  }

  async saveToDevice(_session: NextcloudSession, file: { fileName: string; mimeType: string }): Promise<SaveResult> {
    return { saved: { ...scanned('77', file.fileName), relativePath: 'Pictures/PhotoFlow/' } };
  }
}

class UnusedStorage implements CloudStorageProvider {
  async testConnection(): Promise<void> {}
  async createDirectory(): Promise<void> {}
  async upload(_session: NextcloudSession, request: UploadRequest): Promise<UploadResult> {
    return { remotePath: request.remotePath };
  }
  async fileExists(): Promise<boolean> {
    return false;
  }
  async getFileMetadata(): Promise<RemoteFileMetadata | null> {
    return null;
  }
}

class MemoryCredentials implements CredentialStore {
  private value: string | null = null;
  async getAppPassword(): Promise<string | null> {
    return this.value;
  }
  async setAppPassword(value: string): Promise<void> {
    this.value = value;
  }
  async hasAppPassword(): Promise<boolean> {
    return this.value != null;
  }
}

function folder(path: string, etag?: string): RemoteEntry {
  return { path, name: path.split('/').pop()!, isFolder: true, etag, sizeBytes: 0, mimeType: '', lastModified: 0 };
}

function file(path: string, day: number, mimeType = 'image/jpeg'): RemoteEntry {
  return {
    path,
    name: path.split('/').pop()!,
    isFolder: false,
    etag: `etag-${day}`,
    sizeBytes: 1000 + day,
    mimeType,
    lastModified: Date.UTC(2026, 9, day),
    fileId: String(day),
  };
}

function scanned(mediaStoreId: string, fileName: string) {
  return {
    mediaStoreId,
    uri: `content://media/external/images/media/${mediaStoreId}`,
    fileName,
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    width: 10,
    height: 10,
    dateTaken: Date.UTC(2026, 9, 8),
    dateModified: Date.UTC(2026, 9, 8),
  };
}
