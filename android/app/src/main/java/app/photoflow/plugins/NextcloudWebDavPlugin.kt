package app.photoflow.plugins

import android.util.Log
import app.photoflow.nextcloud.CloudDownloads
import app.photoflow.nextcloud.WebDavClient
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NextcloudWebDav")
class NextcloudWebDavPlugin : Plugin() {
    @PluginMethod
    fun request(call: PluginCall) {
        val method = call.getString("method")
        val url = call.getString("url")
        val username = call.getString("username")
        val appPassword = call.getString("appPassword")
        if (method.isNullOrBlank() || url.isNullOrBlank() || username.isNullOrBlank() || appPassword.isNullOrEmpty()) {
            call.reject("Nextcloud is not configured.", "connection")
            return
        }
        Thread {
            try {
                val depth = call.getString("depth")
                val result = if (method == "PROPFIND" && call.getBoolean("listing", false) == true) {
                    WebDavClient.listing(url, username, appPassword, depth)
                } else {
                    WebDavClient.request(method, url, username, appPassword, depth)
                }
                deliver(call) { call.resolve(payload(result)) }
            } catch (error: Exception) {
                Log.e(TAG, "WebDAV $method failed", error)
                deliver(call) {
                    call.reject(error.message ?: "The Nextcloud server could not be reached.", "connection", error)
                }
            }
        }.start()
    }

    @PluginMethod
    fun upload(call: PluginCall) {
        val url = call.getString("url")
        val username = call.getString("username")
        val appPassword = call.getString("appPassword")
        val localUri = call.getString("localUri")
        val jobId = call.getString("jobId") ?: ""
        val mimeType = call.getString("mimeType") ?: "application/octet-stream"
        if (url.isNullOrBlank() || username.isNullOrBlank() || appPassword.isNullOrEmpty() || localUri.isNullOrBlank()) {
            call.reject("The photo could not be uploaded. Try again.", "upload")
            return
        }
        Thread {
            try {
                val result = WebDavClient.upload(context, url, username, appPassword, localUri, mimeType) { progress ->
                    val event = JSObject()
                    event.put("jobId", jobId)
                    event.put("progress", progress)
                    notifyListeners("progress", event)
                }
                deliver(call) { call.resolve(payload(result)) }
            } catch (error: Exception) {
                Log.e(TAG, "WebDAV upload failed", error)
                deliver(call) {
                    call.reject(error.message ?: "The photo could not be uploaded. Try again.", "upload", error)
                }
            }
        }.start()
    }

    @PluginMethod
    fun preview(call: PluginCall) {
        val url = call.getString("url")
        val username = call.getString("username")
        val appPassword = call.getString("appPassword")
        val cacheKey = call.getString("cacheKey")
        if (url.isNullOrBlank() || username.isNullOrBlank() || appPassword.isNullOrEmpty() || cacheKey.isNullOrBlank()) {
            call.reject("Preview unavailable")
            return
        }
        Thread {
            try {
                val file = CloudDownloads.preview(context, url, username, appPassword, cacheKey)
                val result = JSObject()
                result.put("path", file.absolutePath)
                deliver(call) { call.resolve(result) }
            } catch (error: Exception) {
                deliver(call) { call.reject(error.message ?: "Preview unavailable") }
            }
        }.start()
    }

    @PluginMethod
    fun save(call: PluginCall) {
        val url = call.getString("url")
        val username = call.getString("username")
        val appPassword = call.getString("appPassword")
        val fileName = call.getString("fileName")
        if (url.isNullOrBlank() || username.isNullOrBlank() || appPassword.isNullOrEmpty() || fileName.isNullOrBlank()) {
            call.reject("The photo could not be saved.")
            return
        }
        val mimeType = call.getString("mimeType") ?: "image/jpeg"
        Thread {
            try {
                val saved = CloudDownloads.saveToDevice(context, url, username, appPassword, fileName, mimeType)
                val result = JSObject()
                result.put("saved", saved)
                deliver(call) { call.resolve(result) }
            } catch (error: Exception) {
                Log.w(TAG, "Saving a photo from Nextcloud failed", error)
                deliver(call) { call.reject(error.message ?: "The photo could not be saved.") }
            }
        }.start()
    }

    private fun deliver(call: PluginCall, action: () -> Unit) {
        val host = activity
        if (host == null) {
            action()
        } else {
            host.runOnUiThread(action)
        }
    }

    private fun payload(result: WebDavClient.Result): JSObject {
        val body = JSObject()
        body.put("status", result.status)
        if (result.etag != null) {
            body.put("etag", result.etag)
        }
        if (result.sha256 != null) {
            body.put("sha256", result.sha256)
        }
        if (!result.error.isNullOrBlank()) {
            body.put("error", result.error)
        }
        if (result.body != null) {
            body.put("body", result.body)
        }
        return body
    }

    companion object {
        private const val TAG = "NextcloudWebDav"
    }
}
