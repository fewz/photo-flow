package app.photoflow.mediastore

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject

object MediaStoreImages {
    data class Page(val photos: JSArray)

    fun scan(context: Context, limit: Int, offset: Int, sinceMillis: Long?): Page {
        val resolver = context.contentResolver
        val projection = projection()
        val selection = if (sinceMillis != null && sinceMillis > 0) {
            "${MediaStore.Images.Media.DATE_MODIFIED} > ?"
        } else {
            null
        }
        val selectionArgs = if (selection != null) {
            arrayOf((sinceMillis!! / 1000L).toString())
        } else {
            null
        }
        val cursor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val args = Bundle().apply {
                putStringArray(
                    ContentResolver.QUERY_ARG_SORT_COLUMNS,
                    arrayOf(MediaStore.Images.Media.DATE_TAKEN),
                )
                putInt(
                    ContentResolver.QUERY_ARG_SORT_DIRECTION,
                    ContentResolver.QUERY_SORT_DIRECTION_DESCENDING,
                )
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
                putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
                if (selection != null && selectionArgs != null) {
                    putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
                    putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, selectionArgs)
                }
            }
            resolver.query(collection(), projection, args, null)
        } else {
            resolver.query(
                collection(),
                projection,
                selection,
                selectionArgs,
                "${MediaStore.Images.Media.DATE_TAKEN} DESC LIMIT $limit OFFSET $offset",
            )
        } ?: return Page(JSArray())

        val photos = JSArray()
        cursor.use {
            val idColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val mimeColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
            val sizeColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            val widthColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
            val heightColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
            val takenColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val modifiedColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED)
            val relativeColumn = it.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH)
            while (it.moveToNext()) {
                val id = it.getLong(idColumn)
                val modifiedMillis = it.getLong(modifiedColumn) * 1000L
                val taken = it.getLong(takenColumn)
                val item = JSObject()
                item.put("mediaStoreId", id.toString())
                item.put(
                    "uri",
                    ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString(),
                )
                item.put("fileName", it.getString(nameColumn) ?: "photo.jpg")
                item.put("mimeType", it.getString(mimeColumn) ?: "application/octet-stream")
                item.put("sizeBytes", if (it.isNull(sizeColumn)) 0 else it.getLong(sizeColumn))
                item.put("width", if (it.isNull(widthColumn)) 0 else it.getInt(widthColumn))
                item.put("height", if (it.isNull(heightColumn)) 0 else it.getInt(heightColumn))
                item.put("dateTaken", if (taken > 0) taken else modifiedMillis)
                item.put("dateModified", modifiedMillis)
                if (relativeColumn >= 0 && !it.isNull(relativeColumn)) {
                    item.put("relativePath", it.getString(relativeColumn))
                }
                photos.put(item)
            }
        }
        return Page(photos)
    }

    fun listIds(context: Context): JSArray {
        val ids = JSArray()
        val cursor = context.contentResolver.query(
            collection(),
            arrayOf(MediaStore.Images.Media._ID),
            null,
            null,
            null,
        ) ?: return ids
        cursor.use {
            val idColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            while (it.moveToNext()) {
                ids.put(it.getLong(idColumn).toString())
            }
        }
        return ids
    }

    private fun collection() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
    } else {
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    }

    private fun projection(): Array<String> {
        val columns = mutableListOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_MODIFIED,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            columns.add(MediaStore.Images.Media.RELATIVE_PATH)
        }
        return columns.toTypedArray()
    }
}
