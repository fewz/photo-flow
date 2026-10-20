package app.photoflow.plugins

import android.provider.Settings
import android.content.Intent
import android.net.Uri
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import app.photoflow.mediastore.MediaStoreImages
import app.photoflow.mediastore.PhotoAccess

@CapacitorPlugin(
    name = "PhotoScanner",
    permissions = [
        Permission(strings = [android.Manifest.permission.READ_MEDIA_IMAGES], alias = "images"),
        Permission(
            strings = [android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED],
            alias = "selected",
        ),
        Permission(strings = [android.Manifest.permission.READ_EXTERNAL_STORAGE], alias = "storage"),
    ],
)
class PhotoScannerPlugin : Plugin() {
    @PluginMethod
    fun checkPhotoAccess(call: PluginCall) {
        call.resolve(PhotoAccess.payload(context))
    }

    @PluginMethod
    fun requestPhotoAccess(call: PluginCall) {
        if (PhotoAccess.current(context) != "denied") {
            call.resolve(PhotoAccess.payload(context))
            return
        }
        requestPermissionForAliases(PhotoAccess.aliases(), call, "permissionsCallback")
    }

    @PermissionCallback
    private fun permissionsCallback(call: PluginCall?) {
        call?.resolve(PhotoAccess.payload(context))
    }

    @PluginMethod
    fun scanPhotos(call: PluginCall) {
        if (PhotoAccess.current(context) == "denied") {
            call.reject("Photo access is required to scan this device.")
            return
        }
        val limit = (call.getInt("limit", 50) ?: 50).coerceIn(1, 500)
        val offset = (call.getInt("offset", 0) ?: 0).coerceAtLeast(0)
        val since = call.getLong("since")
        Thread {
            try {
                val page = MediaStoreImages.scan(context, limit, offset, since)
                val result = JSObject()
                result.put("photos", page.photos)
                call.resolve(result)
            } catch (security: SecurityException) {
                call.reject("Photo access is required to scan this device.")
            } catch (_: Exception) {
                call.reject("The photo library could not be read. Try again.")
            }
        }.start()
    }

    @PluginMethod
    fun listPhotoIds(call: PluginCall) {
        if (PhotoAccess.current(context) == "denied") {
            call.reject("Photo access is required to scan this device.")
            return
        }
        Thread {
            try {
                val result = JSObject()
                result.put("ids", MediaStoreImages.listIds(context))
                call.resolve(result)
            } catch (security: SecurityException) {
                call.reject("Photo access is required to scan this device.")
            } catch (_: Exception) {
                call.reject("The photo library could not be read. Try again.")
            }
        }.start()
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }
}
