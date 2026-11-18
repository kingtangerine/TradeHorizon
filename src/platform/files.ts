// Handing a file to the person: a download in a browser, Android's share sheet in the app. A WebView has no
// downloads, so there the bytes go to our Kotlin plugin (FileSharePlugin.kt), which writes them to the app's cache
// and opens the share sheet ("Save to device", messaging apps and so on).
import { registerPlugin } from '@capacitor/core'
import { isNative } from './native'

/** The Kotlin plugin in android/app/src/main/kotlin/com/kollshai/tradehorizon/FileSharePlugin.kt. */
interface FileSharePlugin {
  share(options: { fileName: string; base64: string; mimeType: string; title: string }): Promise<void>
}

const FileShare = registerPlugin<FileSharePlugin>('FileShare')

/** What happened to the file: saved by the browser, or handed to Android's share sheet. */
export type SaveResult = 'downloaded' | 'shared'

/** A blob's bytes as base64, which is how files cross from the page to the Android side. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // In chunks: spreading a large image into one call would overflow the argument limit.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/** Saves a blob through a temporary link, the way browsers download a file made on the page. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Gives the person a file made in the app (a chart image, a data backup). `title` names it in the share sheet.
 * Rejects when the file cannot be written or the share sheet cannot be opened.
 */
export async function saveFile(blob: Blob, fileName: string, title: string): Promise<SaveResult> {
  if (!isNative) {
    downloadBlob(blob, fileName)
    return 'downloaded'
  }
  await FileShare.share({ fileName, base64: await blobToBase64(blob), mimeType: blob.type || 'application/octet-stream', title })
  return 'shared'
}
