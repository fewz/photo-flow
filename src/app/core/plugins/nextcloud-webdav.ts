import { registerPlugin } from '@capacitor/core';

import {
  PreviewRequest,
  PreviewResult,
  SaveRequest,
  SaveResult,
  WebDavCall,
  WebDavResult,
  WebDavUpload,
} from '../nextcloud/webdav-transport';

export interface UploadProgressEvent {
  jobId: string;
  progress: number;
}

interface NextcloudWebDavPlugin {
  request(call: WebDavCall): Promise<WebDavResult>;
  upload(call: WebDavUpload): Promise<WebDavResult>;
  /** Downloads a server preview into the preview cache, or returns the cached copy. */
  preview(request: PreviewRequest): Promise<PreviewResult>;
  /** Downloads an original into Pictures/PhotoFlow through MediaStore. */
  save(request: SaveRequest): Promise<SaveResult>;
  addListener(
    eventName: 'progress',
    listener: (event: UploadProgressEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const native = registerPlugin<NextcloudWebDavPlugin>('NextcloudWebDav', {
  web: () => import('./nextcloud-webdav.web').then((module) => new module.NextcloudWebDavWeb()),
});

export const NextcloudWebDav = native;
