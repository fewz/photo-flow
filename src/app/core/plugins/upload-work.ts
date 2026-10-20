import { registerPlugin } from '@capacitor/core';

import { BackgroundUploader } from '../services/upload-queue.service';

interface UploadWorkPlugin {
  enqueue(): Promise<void>;
  cancel(): Promise<void>;
}

const native = registerPlugin<UploadWorkPlugin>('UploadWork');

export class CapacitorBackgroundUploader implements BackgroundUploader {
  schedule(): Promise<void> {
    return native.enqueue();
  }

  cancel(): Promise<void> {
    return native.cancel();
  }
}
