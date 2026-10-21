import { PreviewResult, SaveResult } from './webdav-transport';
import { RemoteEntry } from './remote-listing';
import { NextcloudSession, RemoteFileMetadata, UploadRequest, UploadResult } from '../models/nextcloud.model';

export interface CloudStorageProvider {
  testConnection(session: NextcloudSession): Promise<void>;
  createDirectory(session: NextcloudSession, remotePath: string): Promise<void>;
  upload(session: NextcloudSession, request: UploadRequest, onProgress?: (progress: number) => void): Promise<UploadResult>;
  fileExists(session: NextcloudSession, remotePath: string): Promise<boolean>;
  getFileMetadata(session: NextcloudSession, remotePath: string): Promise<RemoteFileMetadata | null>;
}

/** Read access to the backed-up photos, for the Nextcloud gallery. */
export interface CloudLibraryProvider {
  /** Children of `remotePath`, or `null` when the folder does not exist. */
  listFolder(session: NextcloudSession, remotePath: string): Promise<RemoteEntry[] | null>;
  preview(
    session: NextcloudSession,
    file: { remotePath: string; fileId?: string; etag?: string },
    size: number,
  ): Promise<PreviewResult>;
  saveToDevice(session: NextcloudSession, file: { remotePath: string; fileName: string; mimeType: string }): Promise<SaveResult>;
}
