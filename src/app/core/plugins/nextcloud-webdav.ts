import { registerPlugin } from '@capacitor/core';

import { WebDavCall, WebDavResult, WebDavUpload } from '../nextcloud/webdav-transport';

export interface UploadProgressEvent {
  jobId: string;
  progress: number;
}

interface NextcloudWebDavPlugin {
  request(call: WebDavCall): Promise<WebDavResult>;
  upload(call: WebDavUpload): Promise<WebDavResult>;
  addListener(
    eventName: 'progress',
    listener: (event: UploadProgressEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const native = registerPlugin<NextcloudWebDavPlugin>('NextcloudWebDav', {
  web: () => import('./nextcloud-webdav.web').then((module) => new module.NextcloudWebDavWeb()),
});

export const NextcloudWebDav = native;
