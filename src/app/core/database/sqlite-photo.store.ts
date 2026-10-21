import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

import { DB_NAME, NEXTCLOUD_CONFIG_ID } from '../constants/app.constants';
import { DatabaseError } from '../errors/app-error';
import {
  CloudCounts,
  CloudFilter,
  CloudFolder,
  CloudMatch,
  CloudPhoto,
  CloudPhotoQuery,
  CloudSection,
} from '../models/cloud-photo.model';
import { NextcloudSettings } from '../models/nextcloud.model';
import { Photo, PhotoCounts, PhotoQuery, ReviewStatus, UploadStatus } from '../models/photo.model';
import { ReviewAction } from '../models/review-action.model';
import { UploadJob, UploadJobStatus } from '../models/upload-job.model';
import { Logger } from '../services/logger.service';
import { MIGRATIONS } from './migrations';
import { PhotoStore } from './photo.store';

type SqlRow = Record<string, unknown>;

interface SqlStep {
  statement: string;
  values?: unknown[];
}

/**
 * 1 when a photo still on this phone is this Nextcloud file. When both sides have a SHA-256 only
 * the checksums decide; otherwise the photo was backed up to this path, or has the same file name
 * and size. Keep in sync with `isSameFile` in memory-photo.store.ts.
 */
const SAME_FILE = `(
  (c.sha256 IS NOT NULL AND p.sha256 IS NOT NULL AND lower(p.sha256) = c.sha256)
  OR ((c.sha256 IS NULL OR p.sha256 IS NULL) AND (
    p.remote_path = c.remote_path OR (p.file_name = c.file_name AND p.size_bytes = c.size_bytes)
  ))
)`;

const ON_PHONE = `EXISTS (SELECT 1 FROM photos p WHERE p.media_missing = 0 AND ${SAME_FILE})`;

/** Kept in sync with `needsBackupRecord` in memory-photo.store.ts. */
const NEEDS_BACKUP_RECORD = `(
  p.review_status = 'pending'
  OR (p.review_status = 'keep' AND p.upload_status NOT IN ('uploaded', 'uploading'))
  OR (p.review_status = 'delete' AND (p.remote_path IS NULL OR p.remote_etag IS NULL))
)`;

@Injectable({ providedIn: 'root' })
export class SqlitePhotoStore implements PhotoStore {
  private readonly logger = inject(Logger);
  private db: SQLiteDBConnection | null = null;
  private sqlite: SQLiteConnection | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    if (this.ready && this.db) {
      return;
    }
    try {
      if (Capacitor.getPlatform() === 'web') {
        await this.prepareWebStore();
      }
      this.sqlite = new SQLiteConnection(CapacitorSQLite);
      const existing = await this.sqlite.isConnection(DB_NAME, false);
      if (existing.result) {
        this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
      } else {
        this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      }
      await this.db.open();
      await this.migrate();
      this.ready = true;
      this.logger.info('Database', 'Library database is ready');
    } catch (cause) {
      this.logger.error('Database', 'Failed to open the library database', { cause: String(cause) });
      throw new DatabaseError('The local library could not be opened. Try again.', { cause });
    }
  }

  async findById(id: string): Promise<Photo | null> {
    const rows = await this.query('SELECT * FROM photos WHERE id = ?', [id]);
    return rows[0] ? mapPhoto(rows[0]) : null;
  }

  async findByMediaStoreId(mediaStoreId: string): Promise<Photo | null> {
    const rows = await this.query('SELECT * FROM photos WHERE media_store_id = ?', [mediaStoreId]);
    return rows[0] ? mapPhoto(rows[0]) : null;
  }

  async insert(photo: Photo): Promise<void> {
    await this.run(
      `INSERT INTO photos (
        id, media_store_id, uri, file_name, mime_type, size_bytes, width, height,
        date_taken, date_modified, relative_path, review_status, upload_status,
        upload_progress, remote_path, remote_etag, sha256, upload_error, delete_error, media_missing,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      photoValues(photo),
    );
  }

  async update(photo: Photo): Promise<void> {
    await this.run(
      `UPDATE photos SET
        uri = ?, file_name = ?, mime_type = ?, size_bytes = ?, width = ?, height = ?,
        date_taken = ?, date_modified = ?, relative_path = ?, review_status = ?,
        upload_status = ?, upload_progress = ?, remote_path = ?, remote_etag = ?,
        sha256 = ?, upload_error = ?, delete_error = ?, media_missing = ?, updated_at = ?
      WHERE id = ?`,
      [
        photo.uri,
        photo.fileName,
        photo.mimeType,
        photo.sizeBytes,
        photo.width,
        photo.height,
        photo.dateTaken,
        photo.dateModified,
        photo.relativePath ?? null,
        photo.reviewStatus,
        photo.uploadStatus,
        photo.uploadProgress,
        photo.remotePath ?? null,
        photo.remoteETag ?? null,
        photo.sha256 ?? null,
        photo.uploadError ?? null,
        photo.deleteError ?? null,
        photo.mediaMissing ? 1 : 0,
        photo.updatedAt,
        photo.id,
      ],
    );
  }

  async list(query: PhotoQuery): Promise<Photo[]> {
    const { where, values } = photoFilter(query);
    const rows = await this.query(
      `SELECT * FROM photos ${where} ORDER BY date_taken DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, query.limit, query.offset],
    );
    return rows.map(mapPhoto);
  }

  async listIds(query: Omit<PhotoQuery, 'limit' | 'offset'>): Promise<string[]> {
    const { where, values } = photoFilter(query);
    const rows = await this.query(`SELECT id FROM photos ${where} ORDER BY date_taken DESC, id DESC`, values);
    return rows.map((row) => String(row['id']));
  }

  async counts(): Promise<PhotoCounts> {
    const rows = await this.query(
      `SELECT
        SUM(CASE WHEN media_missing = 0 THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN media_missing = 0 AND review_status != 'pending' THEN 1 ELSE 0 END) AS reviewed,
        SUM(CASE WHEN media_missing = 0 AND review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN media_missing = 0 AND review_status = 'delete' THEN 1 ELSE 0 END) AS marked_for_deletion,
        SUM(CASE WHEN media_missing = 0 AND review_status = 'keep' THEN 1 ELSE 0 END) AS kept,
        SUM(CASE WHEN media_missing = 0 AND review_status = 'keep' AND upload_status = 'uploaded' THEN 1 ELSE 0 END) AS backed_up,
        SUM(CASE WHEN media_missing = 0 AND review_status = 'delete' THEN size_bytes ELSE 0 END) AS recoverable_bytes,
        SUM(CASE WHEN media_missing = 0 AND duplicate_group IS NOT NULL THEN 1 ELSE 0 END) AS duplicate_photos
      FROM photos`,
    );
    const row = rows[0] ?? {};
    return {
      total: numberValue(row['total']),
      reviewed: numberValue(row['reviewed']),
      pending: numberValue(row['pending']),
      markedForDeletion: numberValue(row['marked_for_deletion']),
      kept: numberValue(row['kept']),
      backedUp: numberValue(row['backed_up']),
      recoverableBytes: numberValue(row['recoverable_bytes']),
      duplicatePhotos: numberValue(row['duplicate_photos']),
    };
  }

  async refreshDuplicateGroups(): Promise<void> {
    await this.run('UPDATE photos SET duplicate_group = NULL');
    await this.run(
      `UPDATE photos
       SET duplicate_group = printf('%d:%d', size_bytes, date_modified)
       WHERE id IN (
         SELECT p.id FROM photos p
         JOIN (
           SELECT size_bytes, date_modified
           FROM photos
           WHERE media_missing = 0 AND size_bytes > 0
           GROUP BY size_bytes, date_modified
           HAVING COUNT(*) > 1
         ) grouped
           ON p.size_bytes = grouped.size_bytes AND p.date_modified = grouped.date_modified
         WHERE p.media_missing = 0 AND p.size_bytes > 0
       )`,
    );
  }

  async markMissingExcept(mediaStoreIds: readonly string[]): Promise<void> {
    const now = Date.now();
    await this.run('UPDATE photos SET media_missing = 1, updated_at = ?', [now]);
    const chunkSize = 400;
    for (let index = 0; index < mediaStoreIds.length; index += chunkSize) {
      const chunk = mediaStoreIds.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      await this.run(
        `UPDATE photos SET media_missing = 0, updated_at = ? WHERE media_store_id IN (${placeholders})`,
        [now, ...chunk],
      );
    }
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.query('SELECT value FROM app_settings WHERE key = ?', [key]);
    const value = rows[0]?.['value'];
    return value == null ? null : String(value);
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async pushReviewAction(action: ReviewAction): Promise<void> {
    await this.run(
      `INSERT INTO review_actions (
        id, photo_id, previous_review_status, previous_upload_status, next_review_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        action.id,
        action.photoId,
        action.previousReviewStatus,
        action.previousUploadStatus,
        action.nextReviewStatus,
        action.createdAt,
      ],
    );
    await this.run(
      `DELETE FROM review_actions
       WHERE id NOT IN (
         SELECT id FROM review_actions ORDER BY created_at DESC, id DESC LIMIT 20
       )`,
    );
  }

  async popReviewAction(): Promise<ReviewAction | null> {
    const rows = await this.query(
      'SELECT * FROM review_actions ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    const action = mapReviewAction(row);
    await this.run('DELETE FROM review_actions WHERE id = ?', [action.id]);
    return action;
  }

  async hasReviewAction(): Promise<boolean> {
    const rows = await this.query('SELECT id FROM review_actions LIMIT 1');
    return rows.length > 0;
  }

  async getNextcloudSettings(): Promise<NextcloudSettings | null> {
    const rows = await this.query(
      `SELECT server_url, username, base_remote_path, enabled
       FROM nextcloud_config WHERE id = ?`,
      [NEXTCLOUD_CONFIG_ID],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      serverUrl: String(row['server_url']),
      username: String(row['username']),
      baseRemotePath: String(row['base_remote_path']),
      enabled: numberValue(row['enabled']) === 1,
    };
  }

  async saveNextcloudSettings(settings: NextcloudSettings): Promise<void> {
    const now = Date.now();
    await this.run(
      `INSERT INTO nextcloud_config (
        id, server_url, username, app_password, base_remote_path, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, '', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        server_url = excluded.server_url,
        username = excluded.username,
        app_password = '',
        base_remote_path = excluded.base_remote_path,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`,
      [
        NEXTCLOUD_CONFIG_ID,
        settings.serverUrl,
        settings.username,
        settings.baseRemotePath,
        settings.enabled ? 1 : 0,
        now,
        now,
      ],
    );
  }

  async insertJob(job: UploadJob): Promise<void> {
    await this.run(
      `INSERT INTO upload_jobs (
        id, photo_id, local_uri, remote_path, status, progress, retry_count, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.photoId,
        job.localUri,
        job.remotePath,
        job.status,
        job.progress,
        job.retryCount,
        job.error ?? null,
        job.createdAt,
        job.updatedAt,
      ],
    );
  }

  async updateJob(job: UploadJob): Promise<void> {
    await this.run(
      `UPDATE upload_jobs SET
        local_uri = ?, remote_path = ?, status = ?, progress = ?, retry_count = ?, error = ?, updated_at = ?
      WHERE id = ?`,
      [
        job.localUri,
        job.remotePath,
        job.status,
        job.progress,
        job.retryCount,
        job.error ?? null,
        job.updatedAt,
        job.id,
      ],
    );
  }

  async findJobForPhoto(photoId: string): Promise<UploadJob | null> {
    const rows = await this.query(
      `SELECT * FROM upload_jobs
       WHERE photo_id = ? AND status != 'cancelled'
       ORDER BY created_at DESC LIMIT 1`,
      [photoId],
    );
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async claimNextPendingJob(): Promise<UploadJob | null> {
    const rows = await this.query(
      `SELECT * FROM upload_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
    );
    const job = rows[0] ? mapJob(rows[0]) : null;
    if (!job) {
      return null;
    }
    const claimed: UploadJob = { ...job, status: 'uploading', updatedAt: Date.now() };
    await this.updateJob(claimed);
    return claimed;
  }

  async listJobs(): Promise<UploadJob[]> {
    const rows = await this.query(
      `SELECT * FROM upload_jobs WHERE status != 'cancelled' ORDER BY updated_at DESC LIMIT 200`,
    );
    return rows.map(mapJob);
  }

  async deleteJobsByStatus(status: UploadJob['status']): Promise<void> {
    await this.run('DELETE FROM upload_jobs WHERE status = ?', [status]);
  }

  async resetUploadingJobs(): Promise<void> {
    await this.run(
      `UPDATE upload_jobs SET status = 'pending', updated_at = ? WHERE status = 'uploading'`,
      [Date.now()],
    );
  }

  async listCloudFolders(): Promise<CloudFolder[]> {
    const rows = await this.query('SELECT path, etag, year, month FROM cloud_folders');
    return rows.map((row) => ({
      path: String(row['path']),
      etag: optionalString(row['etag']),
      year: numberValue(row['year']),
      month: numberValue(row['month']),
    }));
  }

  async replaceCloudFolder(folder: CloudFolder, photos: readonly Omit<CloudPhoto, 'onPhone'>[]): Promise<void> {
    const set: SqlStep[] = [
      { statement: 'DELETE FROM cloud_photos WHERE folder = ?', values: [folder.path] },
      {
        statement: `INSERT INTO cloud_folders (path, etag, year, month, synced_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET etag = excluded.etag, year = excluded.year, month = excluded.month,
            synced_at = excluded.synced_at`,
        values: [folder.path, folder.etag ?? null, folder.year, folder.month, Date.now()],
      },
    ];
    // 11 values per row keeps each statement well under SQLite's 999 parameter limit.
    const chunkSize = 50;
    for (let index = 0; index < photos.length; index += chunkSize) {
      const chunk = photos.slice(index, index + chunkSize);
      set.push({
        statement: `INSERT OR REPLACE INTO cloud_photos (
            remote_path, folder, file_name, mime_type, size_bytes, last_modified, etag, file_id, sha256, year, month
          ) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        values: chunk.flatMap((photo) => [
          photo.remotePath,
          folder.path,
          photo.fileName,
          photo.mimeType,
          photo.sizeBytes,
          photo.lastModified,
          photo.etag ?? null,
          photo.fileId ?? null,
          photo.sha256 ?? null,
          photo.year,
          photo.month,
        ]),
      });
    }
    await this.runSet(set);
  }

  async deleteCloudFoldersExcept(paths: readonly string[]): Promise<void> {
    const known = await this.listCloudFolders();
    const keep = new Set(paths);
    const gone = known.filter((folder) => !keep.has(folder.path)).map((folder) => folder.path);
    if (gone.length === 0) {
      return;
    }
    await this.runSet(
      gone.flatMap((path) => [
        { statement: 'DELETE FROM cloud_photos WHERE folder = ?', values: [path] },
        { statement: 'DELETE FROM cloud_folders WHERE path = ?', values: [path] },
      ]),
    );
  }

  async clearCloudLibrary(): Promise<void> {
    await this.runSet([{ statement: 'DELETE FROM cloud_photos' }, { statement: 'DELETE FROM cloud_folders' }]);
  }

  async listCloudPhotos(query: CloudPhotoQuery): Promise<CloudPhoto[]> {
    const rows = await this.query(
      `SELECT c.*, ${ON_PHONE} AS on_phone FROM cloud_photos c ${cloudFilter(query.filter)}
       ORDER BY c.year DESC, c.month DESC, c.last_modified DESC, c.remote_path DESC LIMIT ? OFFSET ?`,
      [query.limit, query.offset],
    );
    return rows.map(mapCloudPhoto);
  }

  async cloudSections(filter: CloudFilter): Promise<CloudSection[]> {
    const rows = await this.query(
      `SELECT c.folder, c.year, c.month, COUNT(*) AS count FROM cloud_photos c ${cloudFilter(filter)}
       GROUP BY c.folder, c.year, c.month ORDER BY c.year DESC, c.month DESC`,
    );
    return rows.map((row) => ({
      folder: String(row['folder']),
      year: numberValue(row['year']),
      month: numberValue(row['month']),
      count: numberValue(row['count']),
    }));
  }

  async cloudCounts(): Promise<CloudCounts> {
    const rows = await this.query(
      `SELECT COUNT(*) AS total, SUM(${ON_PHONE}) AS on_phone FROM cloud_photos c`,
    );
    const total = numberValue(rows[0]?.['total']);
    const onPhone = numberValue(rows[0]?.['on_phone']);
    return { total, cloudOnly: total - onPhone, onPhone };
  }

  async listCloudMatches(): Promise<CloudMatch[]> {
    const rows = await this.query(
      `SELECT p.id AS photo_id, c.remote_path, c.etag, c.sha256
       FROM photos p JOIN cloud_photos c ON ${SAME_FILE}
       WHERE p.media_missing = 0 AND ${NEEDS_BACKUP_RECORD}
       ORDER BY p.id, CASE WHEN p.remote_path = c.remote_path THEN 0 ELSE 1 END, c.remote_path`,
    );
    const seen = new Set<string>();
    const matches: CloudMatch[] = [];
    for (const row of rows) {
      const photoId = String(row['photo_id']);
      if (seen.has(photoId)) {
        continue;
      }
      seen.add(photoId);
      matches.push({
        photoId,
        remotePath: String(row['remote_path']),
        etag: optionalString(row['etag']),
        sha256: optionalString(row['sha256']),
      });
    }
    return matches;
  }

  async databaseVersion(): Promise<number> {
    const rows = await this.query('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations');
    return numberValue(rows[0]?.['version']);
  }

  private async prepareWebStore(): Promise<void> {
    const jeep = document.querySelector('jeep-sqlite') ?? document.createElement('jeep-sqlite');
    if (!jeep.isConnected) {
      document.body.appendChild(jeep);
    }
    await customElements.whenDefined('jeep-sqlite');
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    await sqlite.initWebStore();
  }

  private async migrate(): Promise<void> {
    await this.database().execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
    );
    const applied = await this.databaseVersion();
    for (const migration of MIGRATIONS) {
      if (migration.version <= applied) {
        continue;
      }
      for (const statement of migration.statements) {
        await this.database().execute(statement);
      }
      await this.database().run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        migration.version,
        Date.now(),
      ]);
      this.logger.info('Database', `Applied migration ${migration.version}`);
    }
  }

  private async query(statement: string, values: unknown[] = []): Promise<SqlRow[]> {
    try {
      const result = await this.database().query(statement, values);
      return (result.values ?? []) as SqlRow[];
    } catch (cause) {
      this.logger.error('Database', 'Query failed', { statement, cause: String(cause) });
      throw new DatabaseError('The local library could not be read. Try again.', { cause });
    }
  }

  private async run(statement: string, values: unknown[] = []): Promise<void> {
    try {
      await this.database().run(statement, values);
      await this.persistWeb();
    } catch (cause) {
      this.logger.error('Database', 'Update failed', { statement, cause: String(cause) });
      throw new DatabaseError(undefined, { cause });
    }
  }

  /** Runs every step in one transaction, so a half-written folder never shows. */
  private async runSet(set: SqlStep[]): Promise<void> {
    try {
      await this.database().executeSet(
        set.map((step) => ({ statement: step.statement, values: step.values ?? [] })),
        true,
      );
      await this.persistWeb();
    } catch (cause) {
      this.logger.error('Database', 'Update failed', { statement: set[0]?.statement, cause: String(cause) });
      throw new DatabaseError(undefined, { cause });
    }
  }

  private async persistWeb(): Promise<void> {
    if (Capacitor.getPlatform() === 'web' && this.sqlite) {
      await this.sqlite.saveToStore(DB_NAME);
    }
  }

  private database(): SQLiteDBConnection {
    if (!this.db) {
      throw new DatabaseError('The local library is not open yet.');
    }
    return this.db;
  }
}

function photoValues(photo: Photo): unknown[] {
  return [
    photo.id,
    photo.mediaStoreId,
    photo.uri,
    photo.fileName,
    photo.mimeType,
    photo.sizeBytes,
    photo.width,
    photo.height,
    photo.dateTaken,
    photo.dateModified,
    photo.relativePath ?? null,
    photo.reviewStatus,
    photo.uploadStatus,
    photo.uploadProgress,
    photo.remotePath ?? null,
    photo.remoteETag ?? null,
    photo.sha256 ?? null,
    photo.uploadError ?? null,
    photo.deleteError ?? null,
    photo.mediaMissing ? 1 : 0,
    photo.createdAt,
    photo.updatedAt,
  ];
}

function photoFilter(query: Omit<PhotoQuery, 'limit' | 'offset'>): { where: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (!query.includeMissing) {
    clauses.push('media_missing = 0');
  }
  if (query.reviewStatus) {
    clauses.push('review_status = ?');
    values.push(query.reviewStatus);
  }
  if (query.duplicatesOnly) {
    clauses.push('duplicate_group IS NOT NULL');
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function mapPhoto(row: SqlRow): Photo {
  return {
    id: String(row['id']),
    mediaStoreId: String(row['media_store_id']),
    uri: String(row['uri']),
    fileName: String(row['file_name']),
    mimeType: String(row['mime_type']),
    sizeBytes: numberValue(row['size_bytes']),
    width: numberValue(row['width']),
    height: numberValue(row['height']),
    dateTaken: numberValue(row['date_taken']),
    dateModified: numberValue(row['date_modified']),
    relativePath: optionalString(row['relative_path']),
    reviewStatus: String(row['review_status']) as ReviewStatus,
    uploadStatus: String(row['upload_status']) as UploadStatus,
    uploadProgress: numberValue(row['upload_progress']),
    remotePath: optionalString(row['remote_path']),
    remoteETag: optionalString(row['remote_etag']),
    sha256: optionalString(row['sha256']),
    uploadError: optionalString(row['upload_error']),
    deleteError: optionalString(row['delete_error']),
    mediaMissing: numberValue(row['media_missing']) === 1,
    duplicateGroup: optionalString(row['duplicate_group']),
    perceptualHash: optionalString(row['perceptual_hash']),
    isScreenshot: optionalFlag(row['is_screenshot']),
    blurFlag: optionalFlag(row['blur_flag']),
    createdAt: numberValue(row['created_at']),
    updatedAt: numberValue(row['updated_at']),
  };
}

function cloudFilter(filter: CloudFilter): string {
  switch (filter) {
    case 'cloud_only':
      return `WHERE NOT ${ON_PHONE}`;
    case 'on_phone':
      return `WHERE ${ON_PHONE}`;
    default:
      return '';
  }
}

function mapCloudPhoto(row: SqlRow): CloudPhoto {
  return {
    remotePath: String(row['remote_path']),
    folder: String(row['folder']),
    fileName: String(row['file_name']),
    mimeType: String(row['mime_type']),
    sizeBytes: numberValue(row['size_bytes']),
    lastModified: numberValue(row['last_modified']),
    etag: optionalString(row['etag']),
    fileId: optionalString(row['file_id']),
    sha256: optionalString(row['sha256']),
    year: numberValue(row['year']),
    month: numberValue(row['month']),
    onPhone: numberValue(row['on_phone']) === 1,
  };
}

function mapJob(row: SqlRow): UploadJob {
  return {
    id: String(row['id']),
    photoId: String(row['photo_id']),
    localUri: String(row['local_uri']),
    remotePath: String(row['remote_path']),
    status: String(row['status']) as UploadJobStatus,
    progress: numberValue(row['progress']),
    retryCount: numberValue(row['retry_count']),
    error: optionalString(row['error']),
    createdAt: numberValue(row['created_at']),
    updatedAt: numberValue(row['updated_at']),
  };
}

function mapReviewAction(row: SqlRow): ReviewAction {
  return {
    id: String(row['id']),
    photoId: String(row['photo_id']),
    previousReviewStatus: String(row['previous_review_status']) as ReviewStatus,
    previousUploadStatus: String(row['previous_upload_status']) as UploadStatus,
    nextReviewStatus: String(row['next_review_status']) as ReviewStatus,
    createdAt: numberValue(row['created_at']),
  };
}

function optionalString(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value);
}

function optionalFlag(value: unknown): boolean | null {
  if (value == null) {
    return null;
  }
  return numberValue(value) === 1;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
