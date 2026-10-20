package app.photoflow.upload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import app.photoflow.R
import app.photoflow.nextcloud.WebDavClient
import app.photoflow.security.SecretStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import java.util.concurrent.ConcurrentHashMap

class UploadWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    private val lastProgress = ConcurrentHashMap<String, Double>()

    override suspend fun doWork(): Result {
        try {
            setForeground(foregroundInfo())
        } catch (_: Exception) {
            Log.w(TAG, "Backup continues without a notification")
        }
        val file = applicationContext.getDatabasePath(DATABASE_FILE)
        if (!file.exists()) {
            return Result.success()
        }
        val database = UploadDatabase.open(file)
        var retryWhenOnline = false
        try {
            database.resetUploading()
            val password = SecretStore.get(applicationContext, PASSWORD_KEY)
            while (!isStopped) {
                if (database.isPaused()) {
                    return Result.success()
                }
                val jobs = database.claimPending(database.concurrency())
                if (jobs.isEmpty()) {
                    delay(500)
                    if (isStopped || database.isPaused() || !database.hasPending()) {
                        break
                    }
                    continue
                }
                val config = database.cloudConfig()
                if (config == null || password.isNullOrEmpty()) {
                    for (job in jobs) {
                        database.fail(job.id, job.photoId, NOT_CONFIGURED)
                    }
                    continue
                }
                val outcomes = coroutineScope {
                    jobs.map { job ->
                        async(Dispatchers.IO) { uploadOne(database, config, password, job) }
                    }.awaitAll()
                }
                if (outcomes.any { outcome -> outcome == UploadOutcome.OFFLINE }) {
                    retryWhenOnline = true
                    break
                }
            }
        } catch (_: Exception) {
            Log.w(TAG, "Backup stopped")
            return Result.retry()
        } finally {
            database.close()
        }
        return if (retryWhenOnline) Result.retry() else Result.success()
    }

    private fun uploadOne(
        database: UploadDatabase,
        config: CloudConfig,
        password: String,
        job: UploadJobRow,
    ): UploadOutcome {
        val photo = database.photo(job.photoId)
        if (photo == null || photo.mediaMissing || (photo.reviewStatus != "keep" && photo.reviewStatus != "delete")) {
            database.cancel(job.id)
            return UploadOutcome.DONE
        }
        if (database.jobStatus(job.id) == "cancelled") {
            return UploadOutcome.DONE
        }
        database.markUploading(photo.id)
        return try {
            for (folder in parentFolders(job.remotePath)) {
                val created = WebDavClient.request(
                    "MKCOL",
                    fileUrl(config, folder),
                    config.username,
                    password,
                    null,
                )
                if (!directoryOk(created.status)) {
                    return finishFailure(database, job, photo.id, message(created, "directory"))
                }
            }
            val uploaded = WebDavClient.upload(
                applicationContext,
                fileUrl(config, job.remotePath),
                config.username,
                password,
                photo.uri,
                photo.mimeType,
            ) { progress ->
                val previous = lastProgress[job.id] ?: 0.0
                if (progress - previous < 0.1 && progress < 1.0) {
                    return@upload
                }
                lastProgress[job.id] = progress
                database.progress(job.id, photo.id, progress)
            }
            if (uploaded.status == 0) {
                database.releaseToPending(job.id, photo.id)
                return UploadOutcome.OFFLINE
            }
            if (uploaded.status !in 200..299) {
                return finishFailure(database, job, photo.id, message(uploaded, "upload"))
            }
            val confirmed = WebDavClient.request(
                "PROPFIND",
                fileUrl(config, job.remotePath),
                config.username,
                password,
                "0",
            )
            if (confirmed.status == 0) {
                database.releaseToPending(job.id, photo.id)
                return UploadOutcome.OFFLINE
            }
            if (confirmed.status !in 200..299) {
                val text = if (confirmed.status == 404) {
                    "The backup could not be confirmed."
                } else {
                    message(confirmed, "connection")
                }
                return finishFailure(database, job, photo.id, text)
            }
            if (isStopped || database.jobStatus(job.id) == "cancelled") {
                return UploadOutcome.DONE
            }
            database.succeed(job.id, photo.id, job.remotePath, confirmed.etag ?: uploaded.etag, uploaded.sha256)
            Log.i(TAG, "Upload finished")
            UploadOutcome.DONE
        } catch (_: Exception) {
            Log.w(TAG, "Upload failed")
            finishFailure(database, job, photo.id, "The photo could not be uploaded. Try again.")
        }
    }

    private fun finishFailure(
        database: UploadDatabase,
        job: UploadJobRow,
        photoId: String,
        text: String,
    ): UploadOutcome {
        if (text == "Server unreachable.") {
            database.releaseToPending(job.id, photoId)
            return UploadOutcome.OFFLINE
        }
        database.fail(job.id, photoId, text)
        return UploadOutcome.DONE
    }

    private fun foregroundInfo(): ForegroundInfo {
        val notification = notification()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private fun notification(): Notification {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Photo backup", NotificationManager.IMPORTANCE_LOW)
            manager.createNotificationChannel(channel)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(applicationContext, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(applicationContext)
        }
        return builder
            .setContentTitle(applicationContext.getString(R.string.backup_notification))
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val UNIQUE_NAME = "photoflow-upload"
        private const val DATABASE_FILE = "photoflowSQLite.db"
        private const val PASSWORD_KEY = "nextcloud_app_password"
        private const val NOT_CONFIGURED = "Add the server, username, and app password first."
        private const val CHANNEL_ID = "photoflow_backup"
        private const val NOTIFICATION_ID = 41
        private const val TAG = "UploadWorker"
    }
}

private enum class UploadOutcome {
    DONE,
    OFFLINE,
}

private fun directoryOk(status: Int): Boolean {
    return status == 201 || status == 204 || status == 301 || status == 405
}

private fun message(result: WebDavClient.Result, kind: String): String {
    if (result.status == 0) {
        return "Server unreachable."
    }
    if (result.status == 401 || result.status == 403) {
        return "Nextcloud authentication failed. Check your username and App Password."
    }
    if (result.status == 404) {
        return "WebDAV unavailable."
    }
    if (kind == "upload") {
        return "The photo could not be uploaded. Try again."
    }
    if (kind == "directory") {
        return "The backup folder could not be created."
    }
    return "WebDAV unavailable."
}

private fun fileUrl(config: CloudConfig, remotePath: String): String {
    val base = config.serverUrl.trim().trimEnd('/')
    val user = Uri.encode(config.username.trim())
    val encoded = remotePath.split('/').filter { part -> part.isNotEmpty() }.joinToString("/") { part ->
        Uri.encode(part)
    }
    return "$base/remote.php/dav/files/$user/$encoded"
}

private fun parentFolders(remotePath: String): List<String> {
    val parts = remotePath.split('/').filter { part -> part.isNotEmpty() }
    if (parts.size <= 1) {
        return emptyList()
    }
    return (1 until parts.size).map { index -> parts.subList(0, index).joinToString("/") }
}
