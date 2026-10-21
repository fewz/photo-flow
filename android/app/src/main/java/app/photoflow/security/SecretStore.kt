package app.photoflow.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

object SecretStore {
    private const val TAG = "SecretStore"
    private const val FILE_NAME = "photoflow_secrets"

    fun preferences(context: Context): SharedPreferences {
        return try {
            open(context)
        } catch (error: Exception) {
            // The file cannot be decrypted, typically a copy restored from a backup whose Keystore key
            // stayed on the old install. Start over with an empty store; the user enters the app
            // password again. Only the exception type is logged, never the content.
            Log.w(TAG, "Secret store unreadable (${error.javaClass.simpleName}); resetting it")
            context.deleteSharedPreferences(FILE_NAME)
            open(context)
        }
    }

    fun get(context: Context, key: String): String? {
        val value = preferences(context).getString(key, null)
        return if (value.isNullOrEmpty()) null else value
    }

    private fun open(context: Context): SharedPreferences {
        val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedSharedPreferences.create(
            FILE_NAME,
            alias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}
