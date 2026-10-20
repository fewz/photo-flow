package app.photoflow.mediastore

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject

object PhotoAccess {
    fun current(context: Context): String {
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> when {
                isGranted(context, Manifest.permission.READ_MEDIA_IMAGES) -> "granted"
                isGranted(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> "limited"
                else -> "denied"
            }
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                if (isGranted(context, Manifest.permission.READ_MEDIA_IMAGES)) "granted" else "denied"
            else ->
                if (isGranted(context, Manifest.permission.READ_EXTERNAL_STORAGE)) "granted" else "denied"
        }
    }

    fun payload(context: Context): JSObject {
        return JSObject().put("photos", current(context))
    }

    fun aliases(): Array<String> {
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> arrayOf("images", "selected")
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf("images")
            else -> arrayOf("storage")
        }
    }

    private fun isGranted(context: Context, permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
}
