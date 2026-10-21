export interface WebDavCall {
  method: 'PROPFIND' | 'MKCOL' | 'HEAD';
  url: string;
  username: string;
  appPassword: string;
  depth?: '0' | '1';
  /** PROPFIND only: ask for the listing properties and return the response body. */
  listing?: boolean;
}

export interface WebDavUpload {
  method: 'PUT';
  url: string;
  username: string;
  appPassword: string;
  localUri: string;
  mimeType: string;
  jobId: string;
}

export interface WebDavResult {
  status: number;
  etag?: string;
  sha256?: string;
  error?: string;
  /** The multistatus XML of a `listing` PROPFIND. */
  body?: string;
}

/** An authenticated GET of a file or preview on the Nextcloud server. */
export interface WebDavDownload {
  url: string;
  username: string;
  appPassword: string;
}

export interface PreviewRequest extends WebDavDownload {
  /** Changes when the file changes, so a cached preview is never stale. */
  cacheKey: string;
}

/** A cached preview file on Android (`path`), or the image itself in the browser (`dataUrl`). */
export interface PreviewResult {
  path?: string;
  dataUrl?: string;
}

export interface SaveRequest extends WebDavDownload {
  fileName: string;
  mimeType: string;
}

/**
 * The new MediaStore row on Android. In the browser the file is handed to the browser's own
 * download instead, and nothing comes back.
 */
export interface SaveResult {
  saved?: {
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
  };
}

export interface WebDavTransport {
  request(call: WebDavCall): Promise<WebDavResult>;
  upload(call: WebDavUpload, onProgress?: (progress: number) => void): Promise<WebDavResult>;
  preview(request: PreviewRequest): Promise<PreviewResult>;
  save(request: SaveRequest): Promise<SaveResult>;
}
