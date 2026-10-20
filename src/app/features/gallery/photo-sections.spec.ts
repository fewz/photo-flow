import { Photo } from '../../core/models/photo.model';
import { groupByDay } from './photo-sections';

function photo(id: string, dateTaken: number): Photo {
  return {
    id,
    mediaStoreId: id,
    uri: `content://media/${id}`,
    fileName: `Fixture_${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    width: 10,
    height: 10,
    dateTaken,
    dateModified: dateTaken,
    reviewStatus: 'pending',
    uploadStatus: 'not_required',
    uploadProgress: 0,
    mediaMissing: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('groupByDay', () => {
  const now = new Date(2026, 9, 20, 15, 0);

  it('labels today and yesterday and keeps photos of one day together', () => {
    const sections = groupByDay(
      [
        photo('1', new Date(2026, 9, 20, 9, 0).getTime()),
        photo('2', new Date(2026, 9, 20, 8, 0).getTime()),
        photo('3', new Date(2026, 9, 19, 23, 0).getTime()),
        photo('4', new Date(2026, 9, 18, 12, 0).getTime()),
      ],
      now,
    );

    expect(sections.map((section) => section.label.length > 0)).toEqual([true, true, true]);
    expect(sections[0]).toMatchObject({ label: 'Today' });
    expect(sections[0]?.photos.map((item) => item.id)).toEqual(['1', '2']);
    expect(sections[1]).toMatchObject({ label: 'Yesterday' });
    expect(sections[2]?.photos.map((item) => item.id)).toEqual(['4']);
  });

  it('puts photos without a date in their own section', () => {
    const sections = groupByDay([photo('1', 0)], now);

    expect(sections).toEqual([expect.objectContaining({ key: 'unknown', label: 'Unknown date' })]);
  });
});
