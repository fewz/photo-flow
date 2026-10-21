import { CLOUD_SYNC_MAX_AGE_MS, SETTING_CLOUD_LAST_SYNC, SETTING_CLOUD_SOURCE } from '../constants/app.constants';
import { AppError, NetworkError } from '../errors/app-error';
import { CloudCounts, CloudFilter, CloudFolder, CloudPhoto, CloudPhotoQuery, CloudSection } from '../models/cloud-photo.model';
import { NextcloudSession } from '../models/nextcloud.model';
import { CloudLibraryProvider } from '../nextcloud/cloud-storage';
import { isPhotoEntry, RemoteEntry } from '../nextcloud/remote-listing';
import { monthFolderIndex, webFileUrl } from '../nextcloud/remote-path';
import { PreviewResult } from '../nextcloud/webdav-transport';
import { PhotoRepository } from '../repositories/photo.repository';
import { Logger } from './logger.service';
import { NetworkStatus } from './network-monitor';
import { NextcloudService } from './nextcloud.service';
import { CredentialStore } from './secure-credential.store';

const SESSION_TTL_MS = 60_000;

/** Photos on this phone that were found in Nextcloud and are now recorded as backed up. */
export interface RecordedBackups {
  /** Now Kept and backed up: they were still to review, or kept and waiting to upload. */
  kept: number;
  /** Still marked for deletion, now with a backup, so deleting them uploads nothing. */
  markedForDeletion: number;
}

export type CloudSyncReport = RecordedBackups;

/**
 * The photos PhotoFlow backed up to Nextcloud. The `<base>/<year>/<month>` folders are listed
 * into SQLite, so the gallery pages through them like local photos and still shows them
 * offline. A month folder whose etag has not changed is not listed again.
 */
export class CloudLibraryService {
  private running: Promise<CloudSyncReport> | null = null;
  private cachedSession: { value: NextcloudSession; at: number } | null = null;

  constructor(
    private readonly photos: PhotoRepository,
    private readonly nextcloud: NextcloudService,
    private readonly cloud: CloudLibraryProvider,
    private readonly credentials: CredentialStore,
    private readonly network: NetworkStatus,
    private readonly logger: Logger,
  ) {}

  async isConfigured(): Promise<boolean> {
    const [settings, hasPassword] = await Promise.all([
      this.photos.getNextcloudSettings(),
      this.credentials.hasAppPassword(),
    ]);
    return Boolean(settings?.enabled && settings.serverUrl && settings.username && hasPassword);
  }

  async lastSyncedAt(): Promise<number | null> {
    const value = Number(await this.photos.getSetting(SETTING_CLOUD_LAST_SYNC));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** True when the cached listing is missing, old, or from other Nextcloud settings. */
  async needsSync(now = Date.now()): Promise<boolean> {
    const [last, source, settings] = await Promise.all([
      this.lastSyncedAt(),
      this.photos.getSetting(SETTING_CLOUD_SOURCE),
      this.photos.getNextcloudSettings(),
    ]);
    if (!settings || source !== sourceKey(settings)) {
      return true;
    }
    return last === null || now - last > CLOUD_SYNC_MAX_AGE_MS;
  }

  /**
   * Refreshes the cached listing, then records the phone's photos that turned up in it as backed
   * up. `onFolder` runs after each month folder that changed.
   */
  sync(onFolder?: () => void): Promise<CloudSyncReport> {
    this.running ??= this.walk(onFolder).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  list(query: CloudPhotoQuery): Promise<CloudPhoto[]> {
    return this.photos.listCloudPhotos(query);
  }

  sections(filter: CloudFilter): Promise<CloudSection[]> {
    return this.photos.cloudSections(filter);
  }

  counts(): Promise<CloudCounts> {
    return this.photos.cloudCounts();
  }

  async preview(photo: CloudPhoto, size: number): Promise<PreviewResult> {
    return this.cloud.preview(await this.session(), photo, size);
  }

  async webUrl(photo: CloudPhoto): Promise<string> {
    return webFileUrl((await this.session()).serverUrl, photo);
  }

  /**
   * Downloads the original onto the phone. On Android it lands in Pictures/PhotoFlow and is
   * recorded as kept and backed up, so it is not uploaded again; returns false when the
   * browser handled it as a plain download instead.
   */
  async saveToPhone(photo: CloudPhoto): Promise<boolean> {
    if (!this.network.isOnline()) {
      throw new NetworkError('You are offline. Connect to save this photo.');
    }
    const result = await this.cloud.saveToDevice(await this.session(), photo);
    if (!result.saved) {
      return false;
    }
    await this.photos.addRestoredPhoto(result.saved, photo.remotePath, photo.etag, photo.sha256);
    this.logger.info('Nextcloud', 'Saved a photo from Nextcloud to this phone', { remotePath: photo.remotePath });
    return true;
  }

  /**
   * Photos on this phone that are already in Nextcloud do not need a review or an upload: those
   * still to review become Kept, kept ones waiting to upload are marked backed up and leave the
   * queue, and ones marked for deletion keep that mark but count as backed up, so deleting them
   * uploads nothing. No Undo entry, as with Back up in the gallery. Works offline on the cached
   * listing.
   */
  async recordBackups(): Promise<RecordedBackups> {
    const matches = await this.photos.listCloudMatches();
    const recorded: RecordedBackups = { kept: 0, markedForDeletion: 0 };
    for (const match of matches) {
      const photo = await this.photos.getById(match.photoId);
      if (!photo) {
        continue;
      }
      const now = Date.now();
      const backup = {
        remotePath: match.remotePath,
        remoteETag: match.etag ?? photo.remoteETag,
        sha256: photo.sha256 ?? match.sha256,
        updatedAt: now,
      };
      if (photo.reviewStatus === 'delete') {
        await this.photos.update({ ...photo, ...backup });
        recorded.markedForDeletion += 1;
      } else {
        await this.photos.update({
          ...photo,
          ...backup,
          reviewStatus: 'keep',
          uploadStatus: 'uploaded',
          uploadProgress: 1,
          uploadError: undefined,
        });
        await this.cancelQueuedUpload(photo.id);
        recorded.kept += 1;
      }
    }
    if (recorded.kept + recorded.markedForDeletion > 0) {
      this.logger.info('Nextcloud', 'Photos already in Nextcloud recorded as backed up', recorded);
    }
    return recorded;
  }

  private async cancelQueuedUpload(photoId: string): Promise<void> {
    const job = await this.photos.findJobForPhoto(photoId);
    if (job && (job.status === 'pending' || job.status === 'failed')) {
      await this.photos.updateJob({ ...job, status: 'cancelled', updatedAt: Date.now() });
    }
  }

  private async walk(onFolder?: () => void): Promise<CloudSyncReport> {
    if (!this.network.isOnline()) {
      throw new NetworkError('You are offline.');
    }
    this.cachedSession = null;
    const session = await this.session();
    const source = sourceKey(session);
    if ((await this.photos.getSetting(SETTING_CLOUD_SOURCE)) !== source) {
      await this.photos.clearCloudLibrary();
      await this.photos.setSetting(SETTING_CLOUD_SOURCE, source);
    }
    try {
      const known = new Map((await this.photos.listCloudFolders()).map((folder) => [folder.path, folder]));
      const seen: string[] = [];
      let changed = 0;
      const base = session.baseRemotePath;
      const years = ((await this.cloud.listFolder(session, base)) ?? [])
        .filter((entry) => entry.isFolder && /^\d{4}$/.test(entry.name))
        .sort((left, right) => Number(right.name) - Number(left.name));
      for (const year of years) {
        const months = ((await this.cloud.listFolder(session, year.path)) ?? [])
          .filter((entry) => entry.isFolder && monthFolderIndex(entry.name) >= 0)
          .sort((left, right) => monthFolderIndex(right.name) - monthFolderIndex(left.name));
        for (const month of months) {
          seen.push(month.path);
          const folder: CloudFolder = {
            path: month.path,
            etag: month.etag,
            year: Number(year.name),
            month: monthFolderIndex(month.name),
          };
          const cached = known.get(month.path);
          if (cached && month.etag && cached.etag === month.etag) {
            continue;
          }
          const files = (await this.cloud.listFolder(session, month.path)) ?? [];
          await this.photos.replaceCloudFolder(folder, files.filter(isPhotoEntry).map((file) => toCloudPhoto(file, folder)));
          changed += 1;
          onFolder?.();
        }
      }
      await this.photos.deleteCloudFoldersExcept(seen);
      await this.photos.setSetting(SETTING_CLOUD_LAST_SYNC, String(Date.now()));
      this.logger.info('Nextcloud', 'Nextcloud gallery updated', { folders: seen.length, changed });
      return await this.recordBackups();
    } catch (error) {
      this.logger.warn('Nextcloud', 'Nextcloud gallery update failed', {
        code: error instanceof AppError ? error.code : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });
      throw error;
    }
  }

  private async session(): Promise<NextcloudSession> {
    const now = Date.now();
    if (this.cachedSession && now - this.cachedSession.at < SESSION_TTL_MS) {
      return this.cachedSession.value;
    }
    const value = await this.nextcloud.session();
    this.cachedSession = { value, at: now };
    return value;
  }
}

function sourceKey(settings: { serverUrl: string; username: string; baseRemotePath: string }): string {
  return `${settings.serverUrl}|${settings.username}|${settings.baseRemotePath}`;
}

function toCloudPhoto(entry: RemoteEntry, folder: CloudFolder): Omit<CloudPhoto, 'onPhone'> {
  return {
    remotePath: entry.path,
    folder: folder.path,
    fileName: entry.name,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    lastModified: entry.lastModified,
    etag: entry.etag,
    fileId: entry.fileId,
    sha256: entry.sha256,
    year: folder.year,
    month: folder.month,
  };
}
