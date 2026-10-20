import { Capacitor } from '@capacitor/core';
import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';

import { CapacitorWebDavTransport } from './nextcloud/capacitor-webdav.transport';
import { NextcloudWebDavProvider } from './nextcloud/nextcloud-webdav.provider';
import { SqlitePhotoStore } from './database/sqlite-photo.store';
import { CapacitorMediaLibrary } from './plugins/capacitor-media-library';
import { CapacitorPhotoDeleter } from './plugins/photo-deleter';
import { CapacitorBackgroundUploader } from './plugins/upload-work';
import { PhotoRepository } from './repositories/photo.repository';
import { DeletionService } from './services/deletion.service';
import { Logger } from './services/logger.service';
import { NetworkMonitor } from './services/network-monitor';
import { NextcloudService } from './services/nextcloud.service';
import { PhotoScannerService } from './services/photo-scanner.service';
import { ReviewService } from './services/review.service';
import { SecureCredentialStore } from './services/secure-credential.store';
import { UploadQueueService } from './services/upload-queue.service';

export function providePhotoFlow(): EnvironmentProviders {
  return makeEnvironmentProviders([
    SqlitePhotoStore,
    {
      provide: PhotoRepository,
      useFactory: () => new PhotoRepository(inject(SqlitePhotoStore)),
    },
    {
      provide: NextcloudWebDavProvider,
      useFactory: () => new NextcloudWebDavProvider(new CapacitorWebDavTransport()),
    },
    {
      provide: NextcloudService,
      useFactory: () =>
        new NextcloudService(
          inject(PhotoRepository),
          inject(NextcloudWebDavProvider),
          inject(SecureCredentialStore),
          inject(Logger),
        ),
    },
    {
      provide: UploadQueueService,
      useFactory: () =>
        new UploadQueueService(
          inject(PhotoRepository),
          inject(NextcloudService),
          inject(NextcloudWebDavProvider),
          inject(NetworkMonitor),
          inject(Logger),
          Capacitor.getPlatform() === 'android' ? new CapacitorBackgroundUploader() : null,
        ),
    },
    {
      provide: ReviewService,
      useFactory: () => new ReviewService(inject(PhotoRepository), inject(Logger), inject(UploadQueueService)),
    },
    {
      provide: DeletionService,
      useFactory: () =>
        new DeletionService(
          inject(PhotoRepository),
          inject(UploadQueueService),
          inject(NetworkMonitor),
          new CapacitorPhotoDeleter(),
          inject(Logger),
        ),
    },
    {
      provide: PhotoScannerService,
      useFactory: () =>
        new PhotoScannerService(inject(CapacitorMediaLibrary), inject(PhotoRepository), inject(Logger)),
    },
    provideAppInitializer(() => {
      const store = inject(SqlitePhotoStore);
      const queue = inject(UploadQueueService);
      const network = inject(NetworkMonitor);
      return store.initialize().then(async () => {
        network.onReconnect(() => {
          void queue.process();
        });
        await network.start();
        await queue.recoverAndResume();
      });
    }),
  ]);
}
