export interface NextcloudSettings {
  serverUrl: string;
  username: string;
  baseRemotePath: string;
  enabled: boolean;
}

export interface NextcloudSession extends NextcloudSettings {
  appPassword: string;
}

export interface RemoteFileMetadata {
  path: string;
  etag?: string;
  size?: number;
}

export interface UploadRequest {
  jobId: string;
  localUri: string;
  remotePath: string;
  mimeType: string;
  fileName: string;
}

export interface UploadResult {
  remotePath: string;
  etag?: string;
  sha256?: string;
}
