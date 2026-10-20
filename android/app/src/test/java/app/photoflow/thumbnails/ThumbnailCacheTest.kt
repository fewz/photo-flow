package app.photoflow.thumbnails

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ThumbnailCacheTest {
    @Test
    fun evictsOldestFilesUntilUnderTheLimit() {
        val directory = File.createTempFile("thumbs", "").apply {
            delete()
            mkdirs()
        }
        try {
            val oldest = File(directory, "old.jpg").apply {
                writeBytes(ByteArray(40))
                setLastModified(1_000)
            }
            val newer = File(directory, "new.jpg").apply {
                writeBytes(ByteArray(40))
                setLastModified(2_000)
            }
            val keep = File(directory, "keep.jpg").apply {
                writeBytes(ByteArray(40))
                setLastModified(3_000)
            }

            ThumbnailCache.evictOldest(directory, keep, 50)

            assertFalse(oldest.exists())
            assertFalse(newer.exists())
            assertTrue(keep.exists())
        } finally {
            directory.deleteRecursively()
        }
    }
}
