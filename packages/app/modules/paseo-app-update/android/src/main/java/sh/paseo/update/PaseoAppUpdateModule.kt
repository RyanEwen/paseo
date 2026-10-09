package sh.paseo.update

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Download verified fork APKs off the UI thread, then hand installation to Android. */
class PaseoAppUpdateModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val updateFile get() = File(context.cacheDir, "app-updates/preview.apk")

  override fun definition() = ModuleDefinition {
    Name("PaseoAppUpdate")

    Function("getVersionCode") { installedPackage().longVersionCode.toDouble() }

    AsyncFunction("download") { url: String, sha256: String, versionCode: Double ->
      requirePreviewPermission()
      require(Regex("https://github\\.com/RyanEwen/paseo/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+-preview\\.[0-9]+/[A-Za-z0-9._-]+\\.apk").matches(url)) {
        "Unexpected update download URL."
      }
      require(Regex("[a-f0-9]{64}").matches(sha256)) { "Invalid update checksum." }
      updateFile.parentFile!!.mkdirs()
      val partial = File(updateFile.parentFile, "preview.partial")
      updateFile.delete()
      try {
        downloadApk(url, partial)
        val digest = MessageDigest.getInstance("SHA-256")
        partial.inputStream().use { input ->
          val buffer = ByteArray(65536)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
          }
        }
        val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
        require(actualHash == sha256) { "Update checksum mismatch. Try downloading again." }
        validateApk(partial, versionCode)
        check(partial.renameTo(updateFile)) { "Unable to save the downloaded update." }
      } finally {
        partial.delete()
      }
    }.runOnQueue(appContext.backgroundCoroutineScope)

    AsyncFunction("install") { versionCode: Double ->
      requirePreviewPermission()
      // Revalidate on every retry, including after returning from Android's permission screen.
      validateApk(updateFile, versionCode)
      if (!context.packageManager.canRequestPackageInstalls()) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context.packageName}"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        "permission_required"
      } else {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.app-update", updateFile)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(intent)
        "installer_opened"
      }
    }.runOnQueue(appContext.backgroundCoroutineScope)
  }

  /** The install permission is injected only into fork previews, not store or F-Droid builds. */
  private fun requirePreviewPermission() {
    // This is an app-op permission. A runtime grant check would reject third-party installers.
    check(context.packageName == "sh.paseo.debug" &&
      installedPackage().requestedPermissions?.contains("android.permission.REQUEST_INSTALL_PACKAGES") == true) {
      "App updates are available only in fork preview builds."
    }
  }

  @Suppress("DEPRECATION")
  private fun installedPackage(): PackageInfo = context.packageManager.getPackageInfo(
    context.packageName, PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_PERMISSIONS)

  /** Refuse downgrades, different app identities, and APKs signed with a different key. */
  @Suppress("DEPRECATION")
  private fun validateApk(file: File, versionCode: Double) {
    val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath,
      PackageManager.GET_SIGNING_CERTIFICATES) ?: error("The downloaded APK is invalid. Download it again.")
    val installed = installedPackage()
    require(archive.packageName == installed.packageName) { "The update belongs to another app." }
    require(archive.longVersionCode.toDouble() == versionCode && archive.longVersionCode > installed.longVersionCode) {
      "The update version does not match or is no longer newer."
    }
    val currentSigners = installed.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.sorted()
    val updateSigners = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.sorted()
    require(!currentSigners.isNullOrEmpty() && currentSigners == updateSigners) {
      "The update signing key does not match this installation."
    }
  }

  /** Follow GitHub's HTTPS asset redirects with bounded time, size, and disk use. */
  private fun downloadApk(url: String, output: File) {
    var target = URL(url)
    val deadline = System.nanoTime() + 10L * 60 * 1_000_000_000
    repeat(6) {
      require(target.protocol == "https") { "Insecure update download redirect." }
      val connection = target.openConnection() as HttpURLConnection
      connection.connectTimeout = 30_000
      connection.readTimeout = 30_000
      connection.instanceFollowRedirects = false
      try {
        val status = connection.responseCode
        if (status in listOf(301, 302, 303, 307, 308)) {
          target = URL(target, connection.getHeaderField("Location") ?: error("Invalid download redirect."))
        } else {
          check(status == 200) { "Update download failed (HTTP $status)." }
          var total = 0L
          connection.inputStream.use { input ->
            output.outputStream().use { destination ->
              val buffer = ByteArray(65536)
              while (true) {
                check(System.nanoTime() < deadline) { "Update download timed out. Try again." }
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                check(total <= 512L * 1024 * 1024) { "Update APK exceeds the download limit." }
                destination.write(buffer, 0, count)
              }
            }
          }
          return
        }
      } finally {
        connection.disconnect()
      }
    }
    error("Too many update download redirects.")
  }
}
