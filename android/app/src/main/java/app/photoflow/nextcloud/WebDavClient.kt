package app.photoflow.nextcloud

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import okhttp3.Credentials
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object WebDavClient {
    private const val TAG = "WebDav"

    data class Result(
        val status: Int,
        val etag: String?,
        val sha256: String?,
        val error: String? = null,
    )

    // HttpURLConnection rejects WebDAV methods such as PROPFIND and MKCOL.
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val propfindBody = """
        <?xml version="1.0" encoding="UTF-8"?>
        <d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>
    """.trimIndent().toRequestBody("application/xml; charset=utf-8".toMediaType())

    fun request(method: String, url: String, username: String, password: String, depth: String?): Result {
        val body = if (method == "PROPFIND") propfindBody else null
        return execute(method, url, username, password, depth, body, 30)
    }

    fun upload(
        context: Context,
        url: String,
        username: String,
        password: String,
        localUri: String,
        mimeType: String,
        onProgress: (Double) -> Unit,
    ): Result {
        val source = Uri.parse(localUri)
        val length = contentLength(context, source)
        val mediaType = mimeType.ifBlank { "application/octet-stream" }.toMediaType()
        val sha256 = AtomicReference<String>()
        val body = object : RequestBody() {
            override fun contentType(): MediaType = mediaType

            override fun contentLength(): Long = if (length > 0) length else -1L

            override fun writeTo(sink: BufferedSink) {
                val digest = MessageDigest.getInstance("SHA-256")
                val input = context.contentResolver.openInputStream(source)
                    ?: throw IOException("The photo could not be read.")
                input.use { stream ->
                    copy(stream, sink, length, digest, onProgress)
                }
                sha256.set(hex(digest.digest()))
            }
        }
        val result = execute("PUT", url, username, password, null, body, 0)
        return if (result.status == 0) result else result.copy(sha256 = sha256.get())
    }

    private fun execute(
        method: String,
        url: String,
        username: String,
        password: String,
        depth: String?,
        body: RequestBody?,
        timeoutSeconds: Long,
    ): Result {
        return try {
            val builder = Request.Builder()
                .url(url)
                .header("Authorization", Credentials.basic(username, password, Charsets.UTF_8))
            if (depth != null) {
                builder.header("Depth", depth)
            }
            builder.method(method, body)
            val http = client.newBuilder().callTimeout(timeoutSeconds, TimeUnit.SECONDS).build()
            http.newCall(builder.build()).execute().use { response ->
                val result = Result(response.code, etag(response), null)
                Log.i(TAG, "WebDAV $method finished with status ${result.status}")
                result
            }
        } catch (error: Exception) {
            Log.w(TAG, "WebDAV $method failed", error)
            Result(0, null, null, error.message ?: "Server unreachable.")
        }
    }

    private fun copy(
        input: InputStream,
        output: BufferedSink,
        length: Long,
        digest: MessageDigest,
        onProgress: (Double) -> Unit,
    ) {
        val buffer = ByteArray(64 * 1024)
        var sent = 0L
        var last = 0.0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) {
                break
            }
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
            sent += read
            if (length > 0) {
                val progress = sent.toDouble() / length.toDouble()
                if (progress - last >= 0.05 || progress >= 1.0) {
                    last = progress
                    onProgress(progress)
                }
            }
        }
        output.flush()
    }

    private fun contentLength(context: Context, uri: Uri): Long {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (index >= 0 && !cursor.isNull(index)) {
                    return cursor.getLong(index)
                }
            }
        }
        return -1
    }

    private fun etag(response: okhttp3.Response): String? {
        return response.header("ETag")?.trim()?.trim('"')
    }

    private fun hex(bytes: ByteArray): String {
        return bytes.joinToString("") { byte -> "%02x".format(byte) }
    }
}
