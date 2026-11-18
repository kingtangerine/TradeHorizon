import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Local development against a server on this computer (`npm run android:dev`): the emulator reaches it over plain
 * HTTP at 10.0.2.2, and an HTTPS page may not call an HTTP server, so the app's own pages are served over HTTP too.
 * Release builds never set this: they use HTTPS for both.
 */
const localDev = process.env.TH_ANDROID_DEV === '1'

const config: CapacitorConfig = {
  appId: 'com.kollshai.tradehorizon',
  appName: 'TradeHorizon',
  // The built web app (`npm run build:android`), copied into the APK by `cap sync`.
  webDir: 'dist',
  backgroundColor: '#080b10',
  server: {
    androidScheme: localDev ? 'http' : 'https',
    cleartext: localDev,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 600,
      backgroundColor: '#080b10',
    },
    Keyboard: {
      // The page resizes with the keyboard, so inputs in bottom sheets stay visible.
      resize: 'native',
    },
  },
}

export default config
