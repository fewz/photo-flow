import {
  NetworkError,
  NextcloudAuthenticationError,
  NextcloudConnectionError,
  NextcloudUploadError,
} from '../errors/app-error';
import { NextcloudSession, RemoteFileMetadata, UploadRequest, UploadResult } from '../models/nextcloud.model';
import { CloudLibraryProvider, CloudStorageProvider } from './cloud-storage';
import { parseListing, RemoteEntry } from './remote-listing';
import { parentFolders, previewUrl, remoteFileUrl, webDavRoot } from './remote-path';
import { PreviewResult, SaveResult, WebDavResult, WebDavTransport } from './webdav-transport';

export class NextcloudWebDavProvider implements CloudStorageProvider, CloudLibraryProvider {
  constructor(private readonly transport: WebDavTransport) {}

  async testConnection(session: NextcloudSession): Promise<void> {
    const result = await this.transport.request({
      method: 'PROPFIND',
      url: webDavRoot(session.serverUrl, session.username),
      username: session.username,
      appPassword: session.appPassword,
      depth: '0',
    });
    this.assertOk(result, 'connection');
  }

  async createDirectory(session: NextcloudSession, remotePath: string): Promise<void> {
    const result = await this.transport.request({
      method: 'MKCOL',
      url: remoteFileUrl(session.serverUrl, session.username, remotePath),
      username: session.username,
      appPassword: session.appPassword,
    });
    if (result.status === 201 || result.status === 204 || result.status === 301 || result.status === 405) {
      return;
    }
    this.assertOk(result, 'directory');
  }

  async upload(
    session: NextcloudSession,
    request: UploadRequest,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResult> {
    for (const folder of parentFolders(request.remotePath)) {
      await this.createDirectory(session, folder);
    }
    const result = await this.transport.upload(
      {
        method: 'PUT',
        url: remoteFileUrl(session.serverUrl, session.username, request.remotePath),
        username: session.username,
        appPassword: session.appPassword,
        localUri: request.localUri,
        mimeType: request.mimeType,
        jobId: request.jobId,
      },
      onProgress,
    );
    this.assertOk(result, 'upload');
    const metadata = await this.getFileMetadata(session, request.remotePath);
    if (!metadata) {
      throw new NextcloudUploadError('The backup could not be confirmed.');
    }
    return {
      remotePath: request.remotePath,
      etag: metadata.etag ?? result.etag,
      sha256: result.sha256,
    };
  }

  async fileExists(session: NextcloudSession, remotePath: string): Promise<boolean> {
    const metadata = await this.getFileMetadata(session, remotePath);
    return metadata != null;
  }

  async getFileMetadata(session: NextcloudSession, remotePath: string): Promise<RemoteFileMetadata | null> {
    const result = await this.transport.request({
      method: 'PROPFIND',
      url: remoteFileUrl(session.serverUrl, session.username, remotePath),
      username: session.username,
      appPassword: session.appPassword,
      depth: '0',
    });
    if (result.status === 404) {
      return null;
    }
    this.assertOk(result, 'connection');
    return {
      path: remotePath,
      etag: result.etag,
    };
  }

  async listFolder(session: NextcloudSession, remotePath: string): Promise<RemoteEntry[] | null> {
    const result = await this.transport.request({
      method: 'PROPFIND',
      url: `${remoteFileUrl(session.serverUrl, session.username, remotePath)}/`,
      username: session.username,
      appPassword: session.appPassword,
      depth: '1',
      listing: true,
    });
    if (result.status === 404) {
      return null;
    }
    this.assertOk(result, 'connection');
    try {
      return parseListing(result.body ?? '', remotePath);
    } catch {
      throw new NextcloudConnectionError('Nextcloud sent a folder listing PhotoFlow could not read.');
    }
  }

  preview(
    session: NextcloudSession,
    file: { remotePath: string; fileId?: string; etag?: string },
    size: number,
  ): Promise<PreviewResult> {
    return this.transport.preview({
      url: previewUrl(session.serverUrl, file, size),
      username: session.username,
      appPassword: session.appPassword,
      cacheKey: `${session.serverUrl}|${file.remotePath}|${file.etag ?? ''}|${size}`,
    });
  }

  saveToDevice(
    session: NextcloudSession,
    file: { remotePath: string; fileName: string; mimeType: string },
  ): Promise<SaveResult> {
    return this.transport.save({
      url: remoteFileUrl(session.serverUrl, session.username, file.remotePath),
      username: session.username,
      appPassword: session.appPassword,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
  }

  private assertOk(result: WebDavResult, kind: 'connection' | 'upload' | 'directory'): void {
    if (result.status === 0) {
      throw new NetworkError(result.error?.trim() || 'Server unreachable.');
    }
    if (result.status === 401 || result.status === 403) {
      throw new NextcloudAuthenticationError();
    }
    if (result.status === 404) {
      throw new NextcloudConnectionError('WebDAV unavailable.');
    }
    if (result.status >= 200 && result.status < 300) {
      return;
    }
    if (kind === 'upload') {
      throw new NextcloudUploadError();
    }
    throw new NextcloudConnectionError(kind === 'directory' ? 'The backup folder could not be created.' : 'WebDAV unavailable.');
  }
}
