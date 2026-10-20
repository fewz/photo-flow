import { PhotoAccess, ScannedPhoto } from '../models/photo.model';

export interface PhotoPermissionStatus {
  photos: PhotoAccess;
}

export interface ScanPhotosOptions {
  limit?: number;
  offset?: number;
  since?: number;
}

export interface ThumbnailRequest {
  uri: string;
  width: number;
  height: number;
}

export interface ThumbnailResult {
  path?: string;
  dataUrl?: string;
}

export interface DeletePhotoRequest {
  mediaStoreId: string;
  uri: string;
}

export interface DeletePhotoResult {
  mediaStoreId: string;
  success: boolean;
  error?: string;
}

export interface MediaLibrary {
  checkPermissions(): Promise<PhotoPermissionStatus>;
  requestPermissions(options?: { pick?: boolean }): Promise<PhotoPermissionStatus>;
  scanPhotos(options: ScanPhotosOptions): Promise<{ photos: ScannedPhoto[] }>;
  listPhotoIds(): Promise<{ ids: string[] }>;
  getPhotoThumbnail(options: ThumbnailRequest): Promise<ThumbnailResult>;
  clearThumbnailCache(): Promise<void>;
  openAppSettings(): Promise<void>;
}
