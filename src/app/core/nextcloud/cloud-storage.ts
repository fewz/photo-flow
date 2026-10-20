import { NextcloudSession, RemoteFileMetadata, UploadRequest, UploadResult } from '../models/nextcloud.model';

export interface CloudStorageProvider {
  testConnection(session: NextcloudSession): Promise<void>;
  createDirectory(session: NextcloudSession, remotePath: string): Promise<void>;
  upload(session: NextcloudSession, request: UploadRequest, onProgress?: (progress: number) => void): Promise<UploadResult>;
  fileExists(session: NextcloudSession, remotePath: string): Promise<boolean>;
  getFileMetadata(session: NextcloudSession, remotePath: string): Promise<RemoteFileMetadata | null>;
}
