export const APP_VERSION = '0.1.0';
export const DATABASE_VERSION = 6;
export const DB_NAME = 'photoflow';
export const GALLERY_PAGE_SIZE = 20;
export const SCAN_PAGE_SIZE = 100;
export const REVIEW_PREVIEW_SIZE = 1080;
/** Keep in sync with the clamp in PhotoThumbnailPlugin.kt. */
export const MAX_PREVIEW_SIZE = 2560;
export const THUMBNAIL_SIZE = 320;
export const SETTING_LAST_SCAN_ACCESS = 'last_scan_access';
export const SETTING_UPLOAD_PAUSED = 'upload_paused';
export const SETTING_UPLOAD_CONCURRENCY = 'upload_concurrency';
export const SETTING_BACKUP_BEFORE_DELETE = 'backup_before_delete';
export const SETTING_GALLERY_COLUMNS = 'gallery_columns';
export const SETTING_GALLERY_SOURCE = 'gallery_source';
export const SETTING_CLOUD_LAST_SYNC = 'cloud_last_sync';
/** Server, user and folder the cached Nextcloud listing came from. */
export const SETTING_CLOUD_SOURCE = 'cloud_source';
export const CLOUD_PAGE_SIZE = 60;
/** The Nextcloud gallery refreshes on open when its listing is older than this. */
export const CLOUD_SYNC_MAX_AGE_MS = 5 * 60 * 1000;
export const DEFAULT_REMOTE_FOLDER = 'PhotoFlow';
export const NEXTCLOUD_CONFIG_ID = 'default';
export const SECRET_APP_PASSWORD = 'nextcloud_app_password';
