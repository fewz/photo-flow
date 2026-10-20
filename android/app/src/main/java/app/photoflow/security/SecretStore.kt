package app.photoflow.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

object SecretStore {
    private const val FILE_NAME = "photoflow_secrets"

    fun preferences(context: Context): SharedPreferences {
        val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedSharedPreferences.create(
            FILE_NAME,
            alias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun get(context: Context, key: String): String? {
        val value = preferences(context).getString(key, null)
        return if (value.isNullOrEmpty()) null else value
    }
}
