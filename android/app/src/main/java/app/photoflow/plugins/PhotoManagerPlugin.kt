package app.photoflow.plugins

import android.app.Activity
import android.app.RecoverableSecurityException
import android.content.IntentSender
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "PhotoManager")
class PhotoManagerPlugin : Plugin() {
    private var deleteLauncher: ActivityResultLauncher<IntentSenderRequest>? = null
    private var pendingCallId: String? = null
    private var pendingIds: List<String> = emptyList()
    private var pendingSingle = false

    override fun load() {
        deleteLauncher = bridge.registerForActivityResult(
            ActivityResultContracts.StartIntentSenderForResult(),
        ) { result ->
            val call = pendingCallId?.let { bridge.getSavedCall(it) } ?: return@registerForActivityResult
            val confirmed = result.resultCode == Activity.RESULT_OK
            call.resolve(resultsPayload(pendingIds, confirmed, if (confirmed) null else "Deletion was not confirmed.", pendingSingle))
            bridge.releaseCall(call)
            pendingCallId = null
        }
    }

    @PluginMethod
    fun deletePhoto(call: PluginCall) {
        val mediaStoreId = call.getString("mediaStoreId")
        val uri = call.getString("uri")
        if (mediaStoreId.isNullOrBlank() || uri.isNullOrBlank()) {
            call.reject("A photo id and URI are required.")
            return
        }
        deleteAll(call, listOf(PhotoRef(mediaStoreId, Uri.parse(uri))), true)
    }

    @PluginMethod
    fun deletePhotos(call: PluginCall) {
        val photos = call.getArray("photos")
        if (photos == null) {
            call.reject("No photos were provided.")
            return
        }
        val parsed = mutableListOf<PhotoRef>()
        for (index in 0 until photos.length()) {
            val item = photos.get(index)
            if (item !is JSONObject) {
                continue
            }
            val mediaStoreId = item.optString("mediaStoreId")
            val uri = item.optString("uri")
            if (mediaStoreId.isNotBlank() && uri.isNotBlank()) {
                parsed.add(PhotoRef(mediaStoreId, Uri.parse(uri)))
            }
        }
        if (parsed.isEmpty()) {
            call.reject("No photos were provided.")
            return
        }
        deleteAll(call, parsed, false)
    }

    private fun deleteAll(call: PluginCall, photos: List<PhotoRef>, single: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val pending = MediaStore.createDeleteRequest(
                context.contentResolver,
                photos.map { it.uri },
            )
            launchConfirmation(call, photos.map { it.mediaStoreId }, pending.intentSender, single)
            return
        }

        val results = mutableListOf<JSObject>()
        for (photo in photos) {
            try {
                val deleted = context.contentResolver.delete(photo.uri, null, null) > 0
                results.add(resultItem(photo.mediaStoreId, deleted, if (deleted) null else "The photo could not be deleted."))
            } catch (security: SecurityException) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && security is RecoverableSecurityException) {
                    launchConfirmation(
                        call,
                        listOf(photo.mediaStoreId),
                        security.userAction.actionIntent.intentSender,
                        single,
                    )
                    return
                }
                results.add(resultItem(photo.mediaStoreId, false, "Photo access was denied."))
            }
        }
        call.resolve(payload(results, single))
    }

    private fun launchConfirmation(
        call: PluginCall,
        ids: List<String>,
        intentSender: IntentSender,
        single: Boolean,
    ) {
        val launcher = deleteLauncher
        if (launcher == null) {
            call.reject("This Android version could not ask to delete the photo.")
            return
        }
        pendingIds = ids
        pendingSingle = single
        pendingCallId = call.callbackId
        bridge.saveCall(call)
        launcher.launch(IntentSenderRequest.Builder(intentSender).build())
    }

    private fun resultsPayload(ids: List<String>, success: Boolean, error: String?, single: Boolean): JSObject {
        return payload(ids.map { resultItem(it, success, error) }, single)
    }

    private fun payload(results: List<JSObject>, single: Boolean): JSObject {
        if (single) {
            return results.first()
        }
        val array = JSArray()
        results.forEach { array.put(it) }
        return JSObject().put("results", array)
    }

    private fun resultItem(mediaStoreId: String, success: Boolean, error: String?): JSObject {
        val item = JSObject()
        item.put("mediaStoreId", mediaStoreId)
        item.put("success", success)
        if (error != null) {
            item.put("error", error)
        }
        return item
    }

    private data class PhotoRef(val mediaStoreId: String, val uri: Uri)
}
