import { environment } from '../../../environments/environment';
import { WebDavCall, WebDavResult, WebDavUpload } from '../nextcloud/webdav-transport';
import { readWebPhoto } from './web-photo-library';
import type { UploadProgressEvent } from './nextcloud-webdav';

type ProgressListener = (event: UploadProgressEvent) => void;

const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`;

/**
 * Browser WebDAV client. `npm start` forwards these calls through the dev server
 * so a Nextcloud on the local network can be reached. A hosted build calls the
 * server directly, which only works when that server allows this site.
 */
export class NextcloudWebDavWeb {
  private readonly listeners = new Set<ProgressListener>();

  request(call: WebDavCall): Promise<WebDavResult> {
    const propfind = call.method === 'PROPFIND';
    return send({
      method: call.method,
      url: call.url,
      username: call.username,
      appPassword: call.appPassword,
      depth: call.depth,
      body: propfind ? PROPFIND_BODY : null,
      contentType: propfind ? 'application/xml; charset=utf-8' : undefined,
      timeoutMs: 30_000,
    });
  }

  async upload(call: WebDavUpload): Promise<WebDavResult> {
    const file = await readWebPhoto(call.localUri);
    if (!file) {
      return { status: 0, error: 'The photo could not be read. Choose the folder again.' };
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return { status: 0, error: 'The photo could not be read. Choose the folder again.' };
    }
    const sha256 = await sha256Hex(bytes);
    this.emit(call.jobId, 0);
    const result = await send({
      method: 'PUT',
      url: call.url,
      username: call.username,
      appPassword: call.appPassword,
      body: bytes,
      contentType: call.mimeType || 'application/octet-stream',
      timeoutMs: 120_000,
      onProgress: (progress) => this.emit(call.jobId, progress),
    });
    if (result.status === 0 || result.status >= 400) {
      return result;
    }
    this.emit(call.jobId, 1);
    return { ...result, sha256 };
  }

  async addListener(
    eventName: 'progress',
    listener: ProgressListener,
  ): Promise<{ remove: () => Promise<void> }> {
    if (eventName === 'progress') {
      this.listeners.add(listener);
    }
    return {
      remove: async () => {
        this.listeners.delete(listener);
      },
    };
  }

  private emit(jobId: string, progress: number): void {
    for (const listener of this.listeners) {
      listener({ jobId, progress });
    }
  }
}

export function resolveWebDavEndpoint(
  url: string,
  useProxy: boolean,
  pageOrigin: string,
): { requestUrl: string; targetOrigin?: string } {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('Invalid Nextcloud URL.');
  }
  if (!useProxy) {
    return { requestUrl: parsed.toString() };
  }
  return {
    requestUrl: `${pageOrigin}/__webdav${parsed.pathname}${parsed.search}`,
    targetOrigin: parsed.origin,
  };
}

interface SendOptions {
  method: string;
  url: string;
  username: string;
  appPassword: string;
  depth?: string;
  body?: XMLHttpRequestBodyInit | null;
  contentType?: string;
  timeoutMs: number;
  onProgress?: (progress: number) => void;
}

function send(options: SendOptions): Promise<WebDavResult> {
  let endpoint: { requestUrl: string; targetOrigin?: string };
  try {
    endpoint = resolveWebDavEndpoint(options.url, environment.webDavDevProxy, location.origin);
  } catch {
    return Promise.resolve({ status: 400, error: 'Invalid Nextcloud URL.' });
  }
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method, endpoint.requestUrl);
    xhr.timeout = options.timeoutMs;
    xhr.setRequestHeader('Authorization', basicAuthorization(options.username, options.appPassword));
    if (options.depth) {
      xhr.setRequestHeader('Depth', options.depth);
    }
    if (options.contentType) {
      xhr.setRequestHeader('Content-Type', options.contentType);
    }
    if (endpoint.targetOrigin) {
      xhr.setRequestHeader('X-Photoflow-Target', endpoint.targetOrigin);
    }
    if (options.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          options.onProgress?.(event.loaded / event.total);
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status === 0) {
        resolve({ status: 0, error: reachabilityMessage() });
        return;
      }
      resolve({ status: xhr.status, etag: trimEtag(xhr.getResponseHeader('ETag')) });
    };
    xhr.onerror = () => resolve({ status: 0, error: reachabilityMessage() });
    xhr.ontimeout = () => resolve({ status: 0, error: 'The Nextcloud server did not respond.' });
    xhr.send(options.body ?? null);
  });
}

function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}

function trimEtag(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  let etag = value.trim();
  while (etag.startsWith('"')) {
    etag = etag.slice(1);
  }
  while (etag.endsWith('"')) {
    etag = etag.slice(0, -1);
  }
  return etag || undefined;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function reachabilityMessage(): string {
  if (environment.webDavDevProxy) {
    return 'The Nextcloud server could not be reached.';
  }
  return 'The browser could not reach Nextcloud. Run the app from the dev server, or allow this site on the Nextcloud server.';
}
