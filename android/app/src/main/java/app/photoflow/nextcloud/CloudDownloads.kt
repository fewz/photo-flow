package app.photoflow.nextcloud

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import app.photoflow.thumbnails.ThumbnailCache
import com.getcapacitor.JSObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest

/** Downloads for the Nextcloud gallery: cached server previews and originals saved to the phone. */
object CloudDownloads {
    private const val PREVIEW_DIRECTORY = "cloud-previews"
    private const val SAVE_FOLDER = "Pictures/PhotoFlow"

    class DownloadException(message: String) : IOException(message)

    /**
     * Returns the cached preview for [cacheKey], downloading it first when it is not cached.
     * Cached previews are what the gallery shows offline.
     */
    fun preview(context: Context, url: String, username: String, password: String, cacheKey: String): File {
        val directory = File(context.cacheDir, PREVIEW_DIRECTORY)
        directory.mkdirs()
        val file = File(directory, "${sha256(cacheKey)}.img")
        if (file.isFile && file.length() > 0) {
            file.setLastModified(System.currentTimeMillis())
            return file
        }
        val partial = File(directory, "${file.name}.part")
        val result = WebDavClient.download(url, username, password, 30) { FileOutputStream(partial) }
        if (result.status !in 200..299 || !partial.isFile || partial.length() == 0L) {
            partial.delete()
            throw DownloadException(
                if (result.status == 0) "The Nextcloud server could not be reached." else "Preview unavailable",
            )
        }
        if (!partial.renameTo(file)) {
            partial.delete()
            throw DownloadException("Preview unavailable")
        }
        ThumbnailCache.evictOldest(directory, file)
        return file
    }

    fun clearPreviews(context: Context) {
        File(context.cacheDir, PREVIEW_DIRECTORY).listFiles()?.forEach { file -> file.delete() }
    }

    /**
     * Streams the original into a new MediaStore image in Pictures/PhotoFlow and returns its row in
     * the same shape the scanner reports. The row stays pending (hidden) until the download is
     * complete and is removed again when it fails.
     */
    fun saveToDevice(
        context: Context,
        url: String,
        username: String,
        password: String,
        fileName: String,
        mimeType: String,
    ): JSObject {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw DownloadException("Saving photos from Nextcloud needs Android 10 or newer.")
        }
        val resolver = context.contentResolver
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Images.Media.MIME_TYPE, mimeType.ifBlank { "image/jpeg" })
            put(MediaStore.Images.Media.RELATIVE_PATH, SAVE_FOLDER)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val target = resolver.insert(collection, values) ?: throw DownloadException("The photo could not be saved.")
        try {
            val result = WebDavClient.download(url, username, password, 600) {
                resolver.openOutputStream(target) ?: throw IOException("The photo could not be saved.")
            }
            if (result.status !in 200..299) {
                throw DownloadException(
                    when (result.status) {
                        0 -> "The Nextcloud server could not be reached."
                        401, 403 -> "Nextcloud authentication failed. Check your username and App Password."
                        404 -> "This photo is no longer in Nextcloud."
                        else -> "The photo could not be downloaded from Nextcloud."
                    },
                )
            }
            resolver.update(target, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            return describe(context, target) ?: throw DownloadException("The photo could not be saved.")
        } catch (error: Exception) {
            resolver.delete(target, null, null)
            throw if (error is DownloadException) error else DownloadException("The photo could not be saved.")
        }
    }

    private fun describe(context: Context, uri: Uri): JSObject? {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.RELATIVE_PATH,
        )
        context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) {
                return null
            }
            val id = cursor.getLong(0)
            val modifiedMillis = cursor.getLong(7) * 1000L
            val taken = if (cursor.isNull(6)) 0L else cursor.getLong(6)
            val item = JSObject()
            item.put("mediaStoreId", id.toString())
            item.put("uri", ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString())
            item.put("fileName", cursor.getString(1) ?: "photo.jpg")
            item.put("mimeType", cursor.getString(2) ?: "application/octet-stream")
            item.put("sizeBytes", if (cursor.isNull(3)) 0 else cursor.getLong(3))
            item.put("width", if (cursor.isNull(4)) 0 else cursor.getInt(4))
            item.put("height", if (cursor.isNull(5)) 0 else cursor.getInt(5))
            item.put("dateTaken", if (taken > 0) taken else modifiedMillis)
            item.put("dateModified", modifiedMillis)
            if (!cursor.isNull(8)) {
                item.put("relativePath", cursor.getString(8))
            }
            return item
        }
        return null
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }
}
