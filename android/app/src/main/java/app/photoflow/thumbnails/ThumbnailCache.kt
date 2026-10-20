package app.photoflow.thumbnails

import java.io.File

object ThumbnailCache {
    const val MAX_BYTES = 48L * 1024L * 1024L

    fun evictOldest(directory: File, keep: File, maxBytes: Long = MAX_BYTES) {
        if (!directory.isDirectory) {
            return
        }
        val files = directory.listFiles()?.filter { file -> file.isFile }?.sortedBy { file -> file.lastModified() }
            ?: return
        var total = files.sumOf { file -> file.length() }
        for (file in files) {
            if (total <= maxBytes) {
                return
            }
            if (file.absolutePath == keep.absolutePath) {
                continue
            }
            val length = file.length()
            if (file.delete()) {
                total -= length
            }
        }
    }
}
