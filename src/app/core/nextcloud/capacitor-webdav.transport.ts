import { NextcloudConnectionError } from '../errors/app-error';
import { NextcloudWebDav } from '../plugins/nextcloud-webdav';
import { WebDavCall, WebDavResult, WebDavTransport, WebDavUpload } from './webdav-transport';

export class CapacitorWebDavTransport implements WebDavTransport {
  request(call: WebDavCall): Promise<WebDavResult> {
    return withTimeout(NextcloudWebDav.request(call), 35_000).catch((error: unknown) => {
      throw toConnectionError(error);
    });
  }

  async upload(call: WebDavUpload, onProgress?: (progress: number) => void): Promise<WebDavResult> {
    const handle = await NextcloudWebDav.addListener('progress', (event) => {
      if (event.jobId === call.jobId) {
        onProgress?.(event.progress);
      }
    });
    try {
      return await NextcloudWebDav.upload(call);
    } finally {
      await handle.remove();
    }
  }
}

function withTimeout(work: Promise<WebDavResult>, ms: number): Promise<WebDavResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new NextcloudConnectionError('The Nextcloud server did not respond.'));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function toConnectionError(error: unknown): NextcloudConnectionError {
  if (error instanceof NextcloudConnectionError) {
    return error;
  }
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'The Nextcloud server could not be reached.';
  return new NextcloudConnectionError(message);
}
