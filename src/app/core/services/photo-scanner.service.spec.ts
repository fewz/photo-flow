import { MemoryPhotoStore } from '../database/memory-photo.store';
import { PhotoAccess, ScannedPhoto } from '../models/photo.model';
import { MediaLibrary, ScanPhotosOptions } from '../plugins/media-library';
import { PhotoRepository } from '../repositories/photo.repository';
import { MediaPermissionError } from '../errors/app-error';
import { Logger } from './logger.service';
import { PhotoScannerService } from './photo-scanner.service';

class FakeMediaLibrary implements MediaLibrary {
  access: PhotoAccess = 'granted';
  photos: ScannedPhoto[] = [];

  checkPermissions() {
    return Promise.resolve({ photos: this.access });
  }

  requestPermissions() {
    return Promise.resolve({ photos: this.access });
  }

  scanPhotos(options: ScanPhotosOptions) {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? this.photos.length;
    return Promise.resolve({ photos: this.photos.slice(offset, offset + limit) });
  }

  listPhotoIds() {
    return Promise.resolve({ ids: this.photos.map((photo) => photo.mediaStoreId) });
  }

  getPhotoThumbnail() {
    return Promise.resolve({ dataUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' });
  }

  clearThumbnailCache() {
    return Promise.resolve();
  }

  openAppSettings() {
    return Promise.resolve();
  }
}

function photo(id: string, taken: number): ScannedPhoto {
  return {
    mediaStoreId: id,
    uri: `content://media/${id}`,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 20,
    width: 20,
    height: 20,
    dateTaken: taken,
    dateModified: taken,
  };
}

describe('PhotoScannerService', () => {
  it('handles permission denial without writing photos', async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    const repository = new PhotoRepository(store);
    const media = new FakeMediaLibrary();
    media.access = 'denied';
    media.photos = [photo('1', 3), photo('2', 2)];
    const scanner = new PhotoScannerService(media, repository, new Logger(), 2);

    await expect(scanner.scan()).rejects.toBeInstanceOf(MediaPermissionError);
    expect(await repository.counts()).toMatchObject({ total: 0 });
  });

  it('pages through MediaStore results and does not duplicate them on a second scan', async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    const repository = new PhotoRepository(store);
    const media = new FakeMediaLibrary();
    media.photos = [photo('a', 30), photo('b', 20), photo('c', 10)];
    const scanner = new PhotoScannerService(media, repository, new Logger(), 2);

    const first = await scanner.scan();
    const second = await scanner.scan();

    expect(first).toMatchObject({ inserted: 3, updated: 0, access: 'granted' });
    expect(second).toMatchObject({ inserted: 0, updated: 3 });
    expect(await repository.counts()).toMatchObject({ total: 3, pending: 3 });
  });

  it('groups different photos that share size and modified time without hashing them', async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    const repository = new PhotoRepository(store);
    const media = new FakeMediaLibrary();
    const shared = { sizeBytes: 4096, dateModified: 50 };
    media.photos = [
      { ...photo('a', 30), ...shared },
      { ...photo('b', 20), ...shared },
      { ...photo('c', 10), sizeBytes: 10, dateModified: 10 },
    ];
    const scanner = new PhotoScannerService(media, repository, new Logger(), 10);

    await scanner.scan();
    await scanner.scan();

    const first = await repository.findByMediaStoreId('a');
    const second = await repository.findByMediaStoreId('b');
    const third = await repository.findByMediaStoreId('c');
    expect(first?.duplicateGroup).toBe('4096:50');
    expect(second?.duplicateGroup).toBe(first?.duplicateGroup);
    expect(first?.id).not.toBe(second?.id);
    expect(third?.duplicateGroup).toBeUndefined();
    expect(first?.sha256).toBeUndefined();
    expect(second?.sha256).toBeUndefined();
    expect(await repository.list({ limit: 10, offset: 0 })).toHaveLength(3);
    expect(await repository.counts()).toMatchObject({ total: 3, duplicatePhotos: 2 });
  });

  it('does not mark unseen photos missing when access is limited', async () => {
    const store = new MemoryPhotoStore();
    await store.initialize();
    const repository = new PhotoRepository(store);
    await repository.upsertFromScan(photo('hidden', 1));
    const media = new FakeMediaLibrary();
    media.access = 'limited';
    media.photos = [photo('visible', 2)];
    const scanner = new PhotoScannerService(media, repository, new Logger(), 10);

    await scanner.scan();

    expect((await repository.findByMediaStoreId('hidden'))?.mediaMissing).toBe(false);
    expect(await repository.counts()).toMatchObject({ total: 2 });
  });
});
