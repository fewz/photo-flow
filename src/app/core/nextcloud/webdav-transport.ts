export interface WebDavCall {
  method: 'PROPFIND' | 'MKCOL' | 'HEAD';
  url: string;
  username: string;
  appPassword: string;
  depth?: '0';
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
}

export interface WebDavTransport {
  request(call: WebDavCall): Promise<WebDavResult>;
  upload(call: WebDavUpload, onProgress?: (progress: number) => void): Promise<WebDavResult>;
}
