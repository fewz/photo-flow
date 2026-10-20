package app.photoflow.plugins

import app.photoflow.security.SecretStore
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SecureStore")
class SecureStorePlugin : Plugin() {
    @PluginMethod
    fun set(call: PluginCall) {
        val key = call.getString("key")
        val value = call.getString("value")
        if (key.isNullOrBlank() || value.isNullOrEmpty()) {
            call.reject("A secret could not be saved.")
            return
        }
        try {
            SecretStore.preferences(context).edit().putString(key, value).apply()
            call.resolve()
        } catch (_: Exception) {
            call.reject("A secret could not be saved.")
        }
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrBlank()) {
            call.reject("A secret could not be read.")
            return
        }
        try {
            val result = JSObject()
            val value = SecretStore.get(context, key)
            if (!value.isNullOrEmpty()) {
                result.put("value", value)
            }
            call.resolve(result)
        } catch (_: Exception) {
            call.reject("A secret could not be read.")
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrBlank()) {
            call.resolve()
            return
        }
        try {
            SecretStore.preferences(context).edit().remove(key).apply()
            call.resolve()
        } catch (_: Exception) {
            call.reject("A secret could not be removed.")
        }
    }

}
