package app.photoflow.plugins

import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import app.photoflow.nextcloud.CloudDownloads
import app.photoflow.thumbnails.ThumbnailCache
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream

@CapacitorPlugin(name = "PhotoThumbnail")
class PhotoThumbnailPlugin : Plugin() {
    @PluginMethod
    fun getPhotoThumbnail(call: PluginCall) {
        val uriValue = call.getString("uri")
        if (uriValue.isNullOrBlank()) {
            call.reject("A photo URI is required.")
            return
        }
        val width = (call.getInt("width", 1080) ?: 1080).coerceIn(64, MAX_PREVIEW_SIZE)
        val height = (call.getInt("height", 1080) ?: 1080).coerceIn(64, MAX_PREVIEW_SIZE)
        Thread {
            try {
                val bitmap = loadPreview(Uri.parse(uriValue), width, height)
                val directory = File(context.cacheDir, "thumbs")
                directory.mkdirs()
                val safeName = uriValue.replace(Regex("[^A-Za-z0-9]"), "_").takeLast(80)
                val file = File(directory, "${safeName}_${width}.jpg")
                FileOutputStream(file).use { output ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
                }
                if (!bitmap.isRecycled) {
                    bitmap.recycle()
                }
                ThumbnailCache.evictOldest(directory, file)
                val result = JSObject()
                result.put("path", file.absolutePath)
                call.resolve(result)
            } catch (security: SecurityException) {
                call.reject("Photo access is required to show this preview.")
            } catch (_: Exception) {
                call.reject("A preview could not be created for this photo.")
            }
        }.start()
    }

    @PluginMethod
    fun clearThumbnailCache(call: PluginCall) {
        val directory = File(context.cacheDir, "thumbs")
        directory.listFiles()?.forEach { file -> file.delete() }
        CloudDownloads.clearPreviews(context)
        call.resolve()
    }

    private fun loadPreview(uri: Uri, width: Int, height: Int): Bitmap {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return context.contentResolver.loadThumbnail(uri, Size(width, height), null)
        }
        @Suppress("DEPRECATION")
        val thumbnail = MediaStore.Images.Thumbnails.getThumbnail(
            context.contentResolver,
            android.content.ContentUris.parseId(uri),
            MediaStore.Images.Thumbnails.MINI_KIND,
            null,
        )
        return thumbnail ?: throw IllegalStateException("Thumbnail unavailable")
    }

    private companion object {
        // Keep in sync with MAX_PREVIEW_SIZE in app.constants.ts.
        const val MAX_PREVIEW_SIZE = 2560
        const val JPEG_QUALITY = 90
    }
}
