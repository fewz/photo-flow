/** Which Nextcloud photos the gallery shows. */
export type CloudFilter = 'all' | 'cloud_only' | 'on_phone';

/** A `<base>/<year>/<month>` backup folder, remembered so an unchanged folder is not listed again. */
export interface CloudFolder {
  path: string;
  etag?: string;
  year: number;
  /** 0 = January. */
  month: number;
}

/** A photo file in a Nextcloud backup folder, cached in SQLite so the gallery works offline. */
export interface CloudPhoto {
  /** Path under the user's WebDAV root, the same form as `Photo.remotePath`. */
  remotePath: string;
  folder: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Last modified time on the server in ms (when the backup was written). */
  lastModified: number;
  etag?: string;
  fileId?: string;
  /** SHA-256 Nextcloud stored for the file, if the upload sent one. */
  sha256?: string;
  year: number;
  month: number;
  /** A photo on this phone (not missing) is this file; see `ON_PHONE` in sqlite-photo.store.ts. Computed when read. */
  onPhone: boolean;
}

export interface CloudPhotoQuery {
  filter: CloudFilter;
  limit: number;
  offset: number;
}

export interface CloudCounts {
  total: number;
  cloudOnly: number;
  onPhone: number;
}

/** A photo on this phone that is already in Nextcloud but not yet recorded as backed up. */
export interface CloudMatch {
  photoId: string;
  remotePath: string;
  etag?: string;
  sha256?: string;
}

/** One month section of the Nextcloud gallery. */
export interface CloudSection {
  folder: string;
  year: number;
  month: number;
  count: number;
}
