import { AppError, NextcloudConnectionError } from '../errors/app-error';
import { NextcloudSession } from '../models/nextcloud.model';
import { CloudStorageProvider } from '../nextcloud/cloud-storage';
import { normalizeServerUrl, sanitizeRemoteFolder } from '../nextcloud/remote-path';
import { PhotoRepository } from '../repositories/photo.repository';
import { CredentialStore } from './secure-credential.store';
import { Logger } from './logger.service';

export class NextcloudService {
  constructor(
    private readonly photos: PhotoRepository,
    private readonly cloud: CloudStorageProvider,
    private readonly credentials: CredentialStore,
    private readonly logger: Logger,
  ) {}

  async save(input: {
    serverUrl: string;
    username: string;
    baseRemotePath: string;
    appPassword?: string;
  }): Promise<void> {
    const serverUrl = normalizeServerUrl(input.serverUrl);
    const username = input.username.trim();
    if (!username) {
      throw new NextcloudConnectionError('A Nextcloud username is required.');
    }
    await this.photos.saveNextcloudSettings({
      serverUrl,
      username,
      baseRemotePath: sanitizeRemoteFolder(input.baseRemotePath),
      enabled: true,
    });
    if (input.appPassword?.trim()) {
      await this.credentials.setAppPassword(input.appPassword);
    }
    this.logger.info('Nextcloud', 'Nextcloud settings saved', { serverUrl, username });
  }

  async testConnection(): Promise<string> {
    const session = await this.session();
    try {
      await this.cloud.testConnection(session);
      this.logger.info('Nextcloud', 'Connection test succeeded', { serverUrl: session.serverUrl });
      return 'Connected successfully';
    } catch (error) {
      this.logger.warn('Nextcloud', 'Connection test failed', {
        code: error instanceof AppError ? error.code : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });
      throw error;
    }
  }

  async session(): Promise<NextcloudSession> {
    const settings = await this.photos.getNextcloudSettings();
    const appPassword = await this.credentials.getAppPassword();
    if (!settings?.serverUrl || !settings.username || !appPassword) {
      throw new NextcloudConnectionError('Add the server, username, and app password first.');
    }
    return { ...settings, appPassword };
  }
}
