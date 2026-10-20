import { PhotoScannerWeb } from './photo-scanner.web';
import { resetWebPhotoLibraryForTests, scanWebPhotos, useWebPhotoFiles, webPhotoUri } from './web-photo-library';

describe('web photo library', () => {
  beforeEach(() => {
    resetWebPhotoLibraryForTests();
  });

  it('scans real files instead of fixtures, newest first', async () => {
    useWebPhotoFiles([
      image('older.jpg', 1_000, 'DCIM/older.jpg'),
      image('newer.jpg', 5_000, 'DCIM/newer.jpg'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ]);

    const scanner = new PhotoScannerWeb();
    const first = await scanner.scanPhotos({ limit: 1, offset: 0 });
    const second = await scanWebPhotos({ limit: 1, offset: 1 });

    expect(first.photos).toHaveLength(1);
    expect(first.photos[0]?.fileName).toBe('newer.jpg');
    expect(first.photos[0]?.uri).toBe(webPhotoUri('DCIM/newer.jpg'));
    expect(first.photos[0]?.mimeType).toBe('image/jpeg');
    expect(first.photos[0]?.sizeBytes).toBe(4);
    expect(second[0]?.fileName).toBe('older.jpg');
    expect(await scanner.listPhotoIds()).toEqual({ ids: expect.arrayContaining(['DCIM/newer.jpg', 'DCIM/older.jpg']) });
    expect((await scanner.listPhotoIds()).ids).toHaveLength(2);
  });

  it('keeps photos modified after the requested time', async () => {
    useWebPhotoFiles([image('old.jpg', 10, 'old.jpg'), image('new.jpg', 50, 'new.jpg')]);

    const photos = await scanWebPhotos({ since: 20 });

    expect(photos.map((photo) => photo.fileName)).toEqual(['new.jpg']);
  });
});

function image(name: string, lastModified: number, relativePath: string): File {
  const file = new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/jpeg', lastModified });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}
