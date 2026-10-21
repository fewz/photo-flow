import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ViewWillEnter } from '@ionic/angular';
import { IonContent, IonHeader, IonToolbar } from '@ionic/angular';

import { IconComponent } from '../../components/icon/icon.component';
import { APP_VERSION, DEFAULT_REMOTE_FOLDER } from '../../core/constants/app.constants';
import { AppError, toUserMessage } from '../../core/errors/app-error';
import { PhotoAccess } from '../../core/models/photo.model';
import { sanitizeRemoteFolder, usesPlainHttp } from '../../core/nextcloud/remote-path';
import { CapacitorMediaLibrary } from '../../core/plugins/capacitor-media-library';
import { primeWebPhotoAccess } from '../../core/plugins/web-photo-library';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { DeletionService } from '../../core/services/deletion.service';
import { NextcloudService } from '../../core/services/nextcloud.service';
import { PhotoScannerService } from '../../core/services/photo-scanner.service';
import { SecureCredentialStore } from '../../core/services/secure-credential.store';
import { ThumbnailService } from '../../core/services/thumbnail.service';
import { UploadQueueService } from '../../core/services/upload-queue.service';

type StatusTone = 'idle' | 'busy' | 'ok' | 'error';

interface ConnectionStatus {
  tone: StatusTone;
  title: string;
  detail: string;
}

interface Feedback {
  text: string;
  error: boolean;
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  imports: [IonHeader, IonToolbar, IonContent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage implements ViewWillEnter {
  readonly web = Capacitor.getPlatform() === 'web';
  readonly appVersion = APP_VERSION;
  readonly concurrencyOptions = [1, 2] as const;

  readonly serverUrl = signal('');
  readonly username = signal('');
  readonly appPassword = signal('');
  readonly remoteFolder = signal(DEFAULT_REMOTE_FOLDER);
  readonly configured = signal(false);
  readonly passwordSaved = signal(false);
  readonly connectionBusy = signal(false);
  readonly authFailed = signal(false);
  /** Result of the last Save or Test connection on this screen. Cleared when a field changes. */
  readonly lastCheck = signal<ConnectionStatus | null>(null);

  readonly backupBeforeDelete = signal(true);
  readonly concurrency = signal(1);

  readonly access = signal<PhotoAccess>('denied');
  readonly accessFeedback = signal<Feedback | null>(null);
  readonly libraryBusy = signal(false);
  readonly libraryFeedback = signal<Feedback | null>(null);
  readonly databaseVersion = signal(0);

  readonly usesHttp = computed(() => usesPlainHttp(this.serverUrl()));
  readonly remotePreview = computed(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${sanitizeRemoteFolder(this.remoteFolder())}/${now.getFullYear()}/${month}/IMG_…jpg`;
  });
  readonly status = computed<ConnectionStatus>(() => {
    const check = this.lastCheck();
    if (check) {
      return check;
    }
    if (!this.configured()) {
      return { tone: 'idle', title: 'Not set up', detail: 'Add your server, username and app password.' };
    }
    if (!this.passwordSaved()) {
      return { tone: 'idle', title: 'App password missing', detail: 'Add an app password to connect.' };
    }
    return { tone: 'idle', title: 'Not checked yet', detail: 'Test the connection to make sure backups reach the server.' };
  });

  private readonly photos = inject(PhotoRepository);
  private readonly scanner = inject(PhotoScannerService);
  private readonly media = inject(CapacitorMediaLibrary);
  private readonly thumbnails = inject(ThumbnailService);
  private readonly nextcloud = inject(NextcloudService);
  private readonly credentials = inject(SecureCredentialStore);
  private readonly deletion = inject(DeletionService);
  private readonly uploads = inject(UploadQueueService);

  ionViewWillEnter(): void {
    void this.refresh();
  }

  edit(field: 'serverUrl' | 'username' | 'appPassword' | 'remoteFolder', event: Event): void {
    this[field].set((event.target as HTMLInputElement).value);
    this.lastCheck.set(null);
    this.authFailed.set(false);
  }

  async save(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.connectionBusy()) {
      return;
    }
    this.connectionBusy.set(true);
    try {
      await this.persistNextcloud();
      this.lastCheck.set({
        tone: 'idle',
        title: 'Saved',
        detail: this.passwordSaved() ? 'Test the connection to check it.' : 'Add an app password to connect.',
      });
    } catch (error) {
      this.lastCheck.set({
        tone: 'error',
        title: 'Not saved',
        detail: toUserMessage(error, 'Nextcloud settings could not be saved.'),
      });
    } finally {
      this.connectionBusy.set(false);
    }
  }

  async testConnection(): Promise<void> {
    if (this.connectionBusy()) {
      return;
    }
    this.connectionBusy.set(true);
    this.authFailed.set(false);
    this.lastCheck.set({ tone: 'busy', title: 'Testing connection…', detail: 'This can take a few seconds.' });
    try {
      await this.persistNextcloud();
      await this.nextcloud.testConnection();
      const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
      this.lastCheck.set({ tone: 'ok', title: 'Connected', detail: `Checked at ${time}` });
    } catch (error) {
      const auth = error instanceof AppError && error.code === 'nextcloud_auth';
      this.authFailed.set(auth);
      this.lastCheck.set({
        tone: 'error',
        title: auth ? 'Authentication failed' : 'Connection failed',
        detail: toUserMessage(error, 'The Nextcloud server could not be reached.'),
      });
    } finally {
      this.connectionBusy.set(false);
    }
  }

  async toggleBackupBeforeDelete(): Promise<void> {
    const enabled = !this.backupBeforeDelete();
    this.backupBeforeDelete.set(enabled);
    await this.deletion.setBackupBeforeDelete(enabled);
  }

  async setConcurrency(value: number): Promise<void> {
    this.concurrency.set(await this.uploads.setConcurrency(value));
  }

  async allowAccess(): Promise<void> {
    primeWebPhotoAccess(this.web);
    this.accessFeedback.set(null);
    try {
      const status = await this.media.requestPermissions(this.web ? { pick: true } : {});
      this.access.set(status.photos);
      if (status.photos === 'granted' && this.web) {
        this.accessFeedback.set({ text: 'Folder ready. Rescan photos to load it.', error: false });
      } else if (status.photos === 'denied') {
        this.accessFeedback.set({
          text: this.web ? 'No folder was chosen.' : 'Photo access is still off. You can allow it in system settings.',
          error: true,
        });
      }
    } catch (error) {
      this.accessFeedback.set({ text: toUserMessage(error, 'Photo access could not be requested.'), error: true });
    }
  }

  async openSystemSettings(): Promise<void> {
    await this.media.openAppSettings();
  }

  async rescan(): Promise<void> {
    primeWebPhotoAccess();
    this.libraryBusy.set(true);
    this.libraryFeedback.set(null);
    try {
      const summary = await this.scanner.scan();
      this.access.set(summary.access);
      this.libraryFeedback.set({
        text: `Scan finished. Added ${summary.inserted}, updated ${summary.updated}.`,
        error: false,
      });
    } catch (error) {
      this.libraryFeedback.set({
        text: toUserMessage(error, 'The photo library could not be read. Try again.'),
        error: true,
      });
    } finally {
      this.libraryBusy.set(false);
    }
  }

  async clearCache(): Promise<void> {
    this.libraryBusy.set(true);
    this.libraryFeedback.set(null);
    try {
      await this.thumbnails.clearCache();
      this.libraryFeedback.set({ text: 'Thumbnail cache cleared.', error: false });
    } catch (error) {
      this.libraryFeedback.set({
        text: toUserMessage(error, 'The thumbnail cache could not be cleared.'),
        error: true,
      });
    } finally {
      this.libraryBusy.set(false);
    }
  }

  accessLabel(): string {
    if (this.web) {
      return this.access() === 'granted' ? 'Folder chosen' : 'No folder chosen';
    }
    switch (this.access()) {
      case 'granted':
        return 'All photos';
      case 'limited':
        return 'Selected photos only';
      default:
        return 'Not allowed';
    }
  }

  accessPill(): string {
    switch (this.access()) {
      case 'granted':
        return 'Allowed';
      case 'limited':
        return 'Limited';
      default:
        return 'Off';
    }
  }

  private async persistNextcloud(): Promise<void> {
    await this.nextcloud.save({
      serverUrl: this.serverUrl(),
      username: this.username(),
      baseRemotePath: this.remoteFolder(),
      appPassword: this.appPassword(),
    });
    this.appPassword.set('');
    this.configured.set(true);
    this.passwordSaved.set(await this.credentials.hasAppPassword());
    if (this.passwordSaved()) {
      // Uploads that failed while the server or password was missing or wrong get another try.
      await this.uploads.retryFailed();
    }
  }

  private async refresh(): Promise<void> {
    const [databaseVersion, permissions, settings, passwordSaved, backupBeforeDelete, concurrency] =
      await Promise.all([
        this.photos.databaseVersion(),
        this.media.checkPermissions(),
        this.photos.getNextcloudSettings(),
        this.credentials.hasAppPassword(),
        this.deletion.backupBeforeDelete(),
        this.uploads.concurrency(),
      ]);
    this.databaseVersion.set(databaseVersion);
    this.access.set(permissions.photos);
    this.serverUrl.set(settings?.serverUrl ?? '');
    this.username.set(settings?.username ?? '');
    this.remoteFolder.set(settings?.baseRemotePath || DEFAULT_REMOTE_FOLDER);
    this.configured.set(Boolean(settings?.serverUrl && settings.username));
    this.passwordSaved.set(passwordSaved);
    this.appPassword.set('');
    this.backupBeforeDelete.set(backupBeforeDelete);
    this.concurrency.set(concurrency);
  }
}
