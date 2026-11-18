// Whether this build is running inside the Android app (a Capacitor WebView) rather than in a browser.
import { Capacitor } from '@capacitor/core'

/** True inside the Android app. Browser-only features (service worker, web push, install prompt) are skipped there. */
export const isNative: boolean = Capacitor.isNativePlatform()
