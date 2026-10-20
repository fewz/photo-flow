import { Photo } from '../../core/models/photo.model';

export interface PhotoSection {
  key: string;
  label: string;
  photos: Photo[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Groups photos (already sorted newest first) into one section per calendar day. */
export function groupByDay(photos: readonly Photo[], now = new Date()): PhotoSection[] {
  const sections: PhotoSection[] = [];
  for (const photo of photos) {
    const key = dayKey(photo.dateTaken);
    let section = sections[sections.length - 1];
    if (!section || section.key !== key) {
      section = { key, label: dayLabel(photo.dateTaken, now), photos: [] };
      sections.push(section);
    }
    section.photos.push(photo);
  }
  return sections;
}

function dayKey(time: number): string {
  if (!time || time <= 0) {
    return 'unknown';
  }
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(time: number, now: Date): string {
  if (!time || time <= 0) {
    return 'Unknown date';
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= startOfToday && time < startOfToday + DAY_MS) {
    return 'Today';
  }
  if (time >= startOfToday - DAY_MS && time < startOfToday) {
    return 'Yesterday';
  }
  const date = new Date(time);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}
