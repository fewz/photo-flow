package app.photoflow.upload

import android.database.sqlite.SQLiteDatabase
import java.io.File

class UploadDatabase private constructor(private val db: SQLiteDatabase) {
    fun close() {
        db.close()
    }

    fun resetUploading() {
        val now = System.currentTimeMillis()
        synchronized(db) {
            db.execSQL(
                "UPDATE upload_jobs SET status = 'pending', updated_at = ? WHERE status = 'uploading'",
                arrayOf(now),
            )
            db.execSQL(
                "UPDATE photos SET upload_status = 'pending', upload_progress = 0, updated_at = ? WHERE upload_status = 'uploading'",
                arrayOf(now),
            )
        }
    }

    fun isPaused(): Boolean {
        return setting("upload_paused") == "1"
    }

    fun concurrency(): Int {
        val raw = setting("upload_concurrency")?.toIntOrNull() ?: 1
        return raw.coerceIn(1, 2)
    }

    fun hasPending(): Boolean {
        synchronized(db) {
            db.rawQuery("SELECT id FROM upload_jobs WHERE status = 'pending' LIMIT 1", null).use { cursor ->
                return cursor.moveToFirst()
            }
        }
    }

    fun claimPending(limit: Int): List<UploadJobRow> {
        val cap = limit.coerceIn(1, 2)
        val now = System.currentTimeMillis()
        val claimed = mutableListOf<UploadJobRow>()
        synchronized(db) {
            val pending = mutableListOf<UploadJobRow>()
            db.rawQuery(
                """
                SELECT id, photo_id, local_uri, remote_path, retry_count
                FROM upload_jobs
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT $cap
                """.trimIndent(),
                null,
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    pending.add(
                        UploadJobRow(
                            id = cursor.getString(0),
                            photoId = cursor.getString(1),
                            localUri = cursor.getString(2),
                            remotePath = cursor.getString(3),
                            retryCount = cursor.getInt(4),
                        ),
                    )
                }
            }
            db.beginTransaction()
            try {
                for (job in pending) {
                    db.execSQL(
                        "UPDATE upload_jobs SET status = 'uploading', progress = 0, updated_at = ? WHERE id = ? AND status = 'pending'",
                        arrayOf(now, job.id),
                    )
                    if (changed()) {
                        claimed.add(job)
                    }
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        }
        return claimed
    }

    fun photo(id: String): UploadPhotoRow? {
        synchronized(db) {
            db.rawQuery(
                "SELECT uri, file_name, mime_type, review_status, media_missing FROM photos WHERE id = ?",
                arrayOf(id),
            ).use { cursor ->
                if (!cursor.moveToFirst()) {
                    return null
                }
                return UploadPhotoRow(
                    id = id,
                    uri = cursor.getString(0),
                    fileName = cursor.getString(1),
                    mimeType = cursor.getString(2),
                    reviewStatus = cursor.getString(3),
                    mediaMissing = cursor.getInt(4) == 1,
                )
            }
        }
    }

    fun cloudConfig(): CloudConfig? {
        synchronized(db) {
            db.rawQuery(
                "SELECT server_url, username FROM nextcloud_config WHERE id = 'default' AND enabled = 1",
                null,
            ).use { cursor ->
                if (!cursor.moveToFirst()) {
                    return null
                }
                val serverUrl = cursor.getString(0)?.trim().orEmpty()
                val username = cursor.getString(1)?.trim().orEmpty()
                if (serverUrl.isEmpty() || username.isEmpty()) {
                    return null
                }
                return CloudConfig(serverUrl, username)
            }
        }
    }

    fun markUploading(photoId: String) {
        val now = System.currentTimeMillis()
        synchronized(db) {
            db.execSQL(
                """
                UPDATE photos
                SET upload_status = 'uploading', upload_progress = 0, upload_error = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                arrayOf(now, photoId),
            )
        }
    }

    fun progress(jobId: String, photoId: String, progress: Double) {
        val now = System.currentTimeMillis()
        synchronized(db) {
            db.execSQL(
                "UPDATE upload_jobs SET progress = ?, updated_at = ? WHERE id = ? AND status = 'uploading'",
                arrayOf(progress, now, jobId),
            )
            db.execSQL(
                "UPDATE photos SET upload_progress = ?, updated_at = ? WHERE id = ? AND upload_status = 'uploading'",
                arrayOf(progress, now, photoId),
            )
        }
    }

    fun jobStatus(jobId: String): String? {
        synchronized(db) {
            db.rawQuery("SELECT status FROM upload_jobs WHERE id = ?", arrayOf(jobId)).use { cursor ->
                return if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }
    }

    fun cancel(jobId: String) {
        synchronized(db) {
            db.execSQL(
                "UPDATE upload_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?",
                arrayOf(System.currentTimeMillis(), jobId),
            )
        }
    }

    fun releaseToPending(jobId: String, photoId: String) {
        val now = System.currentTimeMillis()
        synchronized(db) {
            db.execSQL(
                """
                UPDATE upload_jobs
                SET status = 'pending', progress = 0, error = NULL, updated_at = ?
                WHERE id = ? AND status != 'cancelled'
                """.trimIndent(),
                arrayOf(now, jobId),
            )
            db.execSQL(
                """
                UPDATE photos
                SET upload_status = 'pending', upload_progress = 0, upload_error = NULL, updated_at = ?
                WHERE id = ? AND upload_status = 'uploading'
                """.trimIndent(),
                arrayOf(now, photoId),
            )
        }
    }

    fun fail(jobId: String, photoId: String, message: String) {
        val now = System.currentTimeMillis()
        synchronized(db) {
            if (jobStatusLocked(jobId) == "cancelled") {
                return
            }
            db.execSQL(
                """
                UPDATE upload_jobs
                SET status = 'failed', error = ?, retry_count = retry_count + 1, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                arrayOf(message, now, jobId),
            )
            db.execSQL(
                """
                UPDATE photos
                SET upload_status = 'failed', upload_error = ?, updated_at = ?
                WHERE id = ? AND review_status IN ('keep', 'delete')
                """.trimIndent(),
                arrayOf(message, now, photoId),
            )
        }
    }

    fun succeed(jobId: String, photoId: String, remotePath: String, etag: String?, sha256: String?) {
        val now = System.currentTimeMillis()
        synchronized(db) {
            if (jobStatusLocked(jobId) == "cancelled") {
                return
            }
            db.execSQL(
                """
                UPDATE photos
                SET upload_status = 'uploaded', upload_progress = 1, remote_path = ?, remote_etag = ?,
                    sha256 = COALESCE(?, sha256), upload_error = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                arrayOf(remotePath, etag, sha256, now, photoId),
            )
            db.execSQL(
                """
                UPDATE upload_jobs
                SET status = 'uploaded', progress = 1, remote_path = ?, error = NULL, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                arrayOf(remotePath, now, jobId),
            )
        }
    }

    private fun jobStatusLocked(jobId: String): String? {
        db.rawQuery("SELECT status FROM upload_jobs WHERE id = ?", arrayOf(jobId)).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    private fun changed(): Boolean {
        db.rawQuery("SELECT changes()", null).use { cursor ->
            return cursor.moveToFirst() && cursor.getLong(0) > 0
        }
    }

    private fun setting(key: String): String? {
        synchronized(db) {
            db.rawQuery("SELECT value FROM app_settings WHERE key = ?", arrayOf(key)).use { cursor ->
                return if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }
    }

    companion object {
        fun open(file: File): UploadDatabase {
            val database = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
            try {
                database.enableWriteAheadLogging()
            } catch (_: Exception) {
                // The open library connection may already own the journal mode.
            }
            database.rawQuery("PRAGMA busy_timeout = 5000", null).close()
            return UploadDatabase(database)
        }
    }
}

data class UploadJobRow(
    val id: String,
    val photoId: String,
    val localUri: String,
    val remotePath: String,
    val retryCount: Int,
)

data class UploadPhotoRow(
    val id: String,
    val uri: String,
    val fileName: String,
    val mimeType: String,
    val reviewStatus: String,
    val mediaMissing: Boolean,
)

data class CloudConfig(
    val serverUrl: String,
    val username: String,
)
