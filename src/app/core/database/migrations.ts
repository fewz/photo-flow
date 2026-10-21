export interface Migration {
  version: number;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY NOT NULL,
        media_store_id TEXT NOT NULL UNIQUE,
        uri TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        date_taken INTEGER NOT NULL,
        date_modified INTEGER NOT NULL,
        relative_path TEXT,
        review_status TEXT NOT NULL,
        upload_status TEXT NOT NULL,
        upload_progress REAL NOT NULL DEFAULT 0,
        remote_path TEXT,
        remote_etag TEXT,
        sha256 TEXT,
        upload_error TEXT,
        media_missing INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_photos_review_date ON photos (review_status, date_taken DESC)`,
      `CREATE TABLE IF NOT EXISTS upload_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        photo_id TEXT NOT NULL,
        local_uri TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS nextcloud_config (
        id TEXT PRIMARY KEY NOT NULL,
        server_url TEXT NOT NULL,
        username TEXT NOT NULL,
        app_password TEXT NOT NULL,
        base_remote_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS review_actions (
        id TEXT PRIMARY KEY NOT NULL,
        photo_id TEXT NOT NULL,
        previous_review_status TEXT NOT NULL,
        previous_upload_status TEXT NOT NULL,
        next_review_status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_review_actions_created ON review_actions (created_at DESC)`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON upload_jobs (status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_upload_jobs_photo ON upload_jobs (photo_id, created_at DESC)`,
    ],
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE photos ADD COLUMN delete_error TEXT`,
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backup_before_delete', '1')`,
    ],
  },
  {
    version: 4,
    statements: [
      `ALTER TABLE photos ADD COLUMN duplicate_group TEXT`,
      `ALTER TABLE photos ADD COLUMN perceptual_hash TEXT`,
      `ALTER TABLE photos ADD COLUMN is_screenshot INTEGER`,
      `ALTER TABLE photos ADD COLUMN blur_flag INTEGER`,
      `CREATE INDEX IF NOT EXISTS idx_photos_duplicate ON photos (duplicate_group)`,
      `CREATE INDEX IF NOT EXISTS idx_photos_size_modified ON photos (size_bytes, date_modified)`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS cloud_folders (
        path TEXT PRIMARY KEY NOT NULL,
        etag TEXT,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        synced_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cloud_photos (
        remote_path TEXT PRIMARY KEY NOT NULL,
        folder TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        last_modified INTEGER NOT NULL,
        etag TEXT,
        file_id TEXT,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cloud_photos_order ON cloud_photos (year DESC, month DESC, last_modified DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_cloud_photos_folder ON cloud_photos (folder)`,
      `CREATE INDEX IF NOT EXISTS idx_photos_remote_path ON photos (remote_path)`,
    ],
  },
  {
    version: 6,
    statements: [
      `ALTER TABLE cloud_photos ADD COLUMN sha256 TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_photos_sha256 ON photos (sha256)`,
      `CREATE INDEX IF NOT EXISTS idx_photos_name_size ON photos (file_name, size_bytes)`,
      // Listings cached before checksums were read are listed again on the next refresh.
      `UPDATE cloud_folders SET etag = NULL`,
    ],
  },
];
