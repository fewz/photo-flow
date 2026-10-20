import { MemoryPhotoStore } from '../database/memory-photo.store';
import { ScannedPhoto } from '../models/photo.model';
import { PhotoRepository } from './photo.repository';

function scanned(id: string, taken = 1_700_000_000_000): ScannedPhoto {
  return {
    mediaStoreId: id,
    uri: `content://media/external/images/media/${id}`,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    width: 100,
    height: 80,
    dateTaken: taken,
    dateModified: taken,
  };
}

describe('PhotoRepository', () => {
  let store: MemoryPhotoStore;
  let repository: PhotoRepository;

  beforeEach(async () => {
    store = new MemoryPhotoStore();
    await store.initialize();
    repository = new PhotoRepository(store);
  });

  it('inserts a new photo', async () => {
    const result = await repository.upsertFromScan(scanned('10'));
    const saved = await repository.findByMediaStoreId('10');

    expect(result).toBe('inserted');
    expect(saved?.reviewStatus).toBe('pending');
    expect(saved?.uploadStatus).toBe('not_required');
    expect(await repository.counts()).toMatchObject({ total: 1, pending: 1 });
  });

  it('does not duplicate an existing photo or reset its review status', async () => {
    await repository.upsertFromScan(scanned('10', 100));
    const created = await repository.findByMediaStoreId('10');
    await repository.saveDecision(
      { ...created!, reviewStatus: 'keep', updatedAt: 200 },
      {
        id: 'action-1',
        photoId: created!.id,
        previousReviewStatus: 'pending',
        previousUploadStatus: 'not_required',
        nextReviewStatus: 'keep',
        createdAt: 200,
      },
    );

    const result = await repository.upsertFromScan({ ...scanned('10', 300), fileName: 'renamed.jpg', sizeBytes: 50 });
    const photos = await repository.list({ limit: 10, offset: 0, includeMissing: true });

    expect(result).toBe('updated');
    expect(photos).toHaveLength(1);
    expect(photos[0]?.fileName).toBe('renamed.jpg');
    expect(photos[0]?.reviewStatus).toBe('keep');
    expect(photos[0]?.id).toBe(created?.id);
  });

  it('marks photos missing when MediaStore no longer returns them', async () => {
    await repository.upsertFromScan(scanned('kept-id'));
    await repository.upsertFromScan(scanned('gone-id'));
    await repository.markMissingExcept(['kept-id']);

    expect((await repository.findByMediaStoreId('gone-id'))?.mediaMissing).toBe(true);
    expect(await repository.counts()).toMatchObject({ total: 1 });
  });

  it('lists only duplicates when asked', async () => {
    await repository.upsertFromScan(scanned('a', 100));
    await repository.upsertFromScan(scanned('b', 100));
    await repository.upsertFromScan({ ...scanned('c', 200), sizeBytes: 5 });
    await repository.refreshDuplicateGroups();

    const duplicates = await repository.list({ duplicatesOnly: true, limit: 10, offset: 0 });

    expect(duplicates.map((photo) => photo.mediaStoreId).sort()).toEqual(['a', 'b']);
    expect(await repository.listIds({ duplicatesOnly: true })).toEqual(duplicates.map((photo) => photo.id));
    expect(await repository.list({ limit: 10, offset: 0 })).toHaveLength(3);
  });
});
