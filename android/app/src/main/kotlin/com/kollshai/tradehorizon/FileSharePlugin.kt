package com.kollshai.tradehorizon

import android.content.ClipData
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.IOException

/**
 * Hands a file made by the web app (a chart image, a data backup) to Android's share sheet.
 *
 * A WebView cannot download files, so the page sends the bytes here. The file is written to the app's private
 * cache folder "shared" and offered through the FileProvider declared in the manifest, which exposes only that
 * folder (res/xml/file_paths.xml). See src/platform/files.ts for the calling side.
 */
@CapacitorPlugin(name = "FileShare")
class FileSharePlugin : Plugin() {
    /** Writes `base64` as `fileName` and opens the share sheet titled `title`. Resolves once the sheet is shown. */
    @PluginMethod
    fun share(call: PluginCall) {
        val requestedName = call.getString("fileName")
        val base64 = call.getString("base64")
        if (requestedName.isNullOrBlank() || base64 == null) {
            call.reject("fileName and base64 are required.")
            return
        }
        // Only the last path part is used, so a name can never point outside the shared folder.
        val fileName = File(requestedName).name
        val mimeType = call.getString("mimeType") ?: "application/octet-stream"
        val title = call.getString("title") ?: fileName
        try {
            val folder = File(context.cacheDir, SHARED_FOLDER)
            if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create the shared folder.")
            removeOldFiles(folder)
            val file = File(folder, fileName)
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, title)
                // The clip data lets the share sheet show a preview and carries the read permission with it.
                clipData = ClipData.newRawUri(title, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, title))
            call.resolve()
        } catch (error: IOException) {
            call.reject("The file could not be saved for sharing: ${error.message}", error)
        } catch (error: IllegalArgumentException) {
            // Raised for base64 that cannot be decoded, or a file outside what the FileProvider may share.
            call.reject("The file could not be shared: ${error.message}", error)
        }
    }

    /**
     * Deletes files shared more than a day ago, so the folder does not grow with every snapshot. Recent files stay:
     * the app that received one may still be reading it.
     */
    private fun removeOldFiles(folder: File) {
        val oldestKept = System.currentTimeMillis() - KEEP_SHARED_FILES_MS
        folder.listFiles()?.filter { it.isFile && it.lastModified() < oldestKept }?.forEach { it.delete() }
    }

    private companion object {
        /** Folder inside the app's cache that the FileProvider is allowed to share. */
        const val SHARED_FOLDER = "shared"

        /** How long a shared file is kept before a later share removes it: one day. */
        const val KEEP_SHARED_FILES_MS = 24L * 60 * 60 * 1000
    }
}
