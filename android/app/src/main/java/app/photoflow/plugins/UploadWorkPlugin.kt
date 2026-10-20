package app.photoflow.plugins

import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import app.photoflow.upload.UploadWorker
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "UploadWork",
    permissions = [
        Permission(strings = [android.Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class UploadWorkPlugin : Plugin() {
    @PluginMethod
    fun enqueue(call: PluginCall) {
        try {
            if (needsNotificationPrompt()) {
                requestPermissionForAlias("notifications", call, "notificationCallback")
                return
            }
        } catch (_: Exception) {
            // The queue screen still shows backup status when notifications are unavailable.
        }
        schedule()
        call.resolve()
    }

    @PermissionCallback
    private fun notificationCallback(call: PluginCall) {
        schedule()
        call.resolve()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        WorkManager.getInstance(context).cancelUniqueWork(UploadWorker.UNIQUE_NAME)
        call.resolve()
    }

    private fun needsNotificationPrompt(): Boolean {
        return Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT
    }

    private fun schedule() {
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UploadWorker.UNIQUE_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }
}
