export type ReviewStatus = 'pending' | 'keep' | 'delete';

export type UploadStatus = 'not_required' | 'pending' | 'uploading' | 'uploaded' | 'failed';

export type PhotoAccess = 'granted' | 'limited' | 'denied';

export interface Photo {
  id: string;
  mediaStoreId: string;
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  dateTaken: number;
  dateModified: number;
  relativePath?: string;
  reviewStatus: ReviewStatus;
  uploadStatus: UploadStatus;
  uploadProgress: number;
  remotePath?: string;
  remoteETag?: string;
  sha256?: string;
  uploadError?: string;
  deleteError?: string;
  mediaMissing: boolean;
  duplicateGroup?: string;
  perceptualHash?: string;
  isScreenshot?: boolean | null;
  blurFlag?: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScannedPhoto {
  mediaStoreId: string;
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  dateTaken: number;
  dateModified: number;
  relativePath?: string;
}

export interface PhotoCounts {
  total: number;
  reviewed: number;
  pending: number;
  markedForDeletion: number;
  kept: number;
  backedUp: number;
  recoverableBytes: number;
  duplicatePhotos: number;
}

export function hasVerifiedBackup(photo: Pick<Photo, 'remotePath' | 'remoteETag' | 'uploadStatus'>): boolean {
  return Boolean(photo.remotePath && (photo.remoteETag || photo.uploadStatus === 'uploaded'));
}

export interface PhotoQuery {
  reviewStatus?: ReviewStatus;
  /** Only photos that share size and modified time with another photo. */
  duplicatesOnly?: boolean;
  includeMissing?: boolean;
  limit: number;
  offset: number;
}
