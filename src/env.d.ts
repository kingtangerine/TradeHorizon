/** Injected by Vite (see vite.config.ts). */
declare const __APP_VERSION__: string
declare const __APP_BUILD__: string
declare const __APP_BUILT_AT__: string

interface ImportMetaEnv {
  /** The server's address for builds that are not served by it (the Android app); unset on the web. */
  readonly VITE_API_BASE?: string
}
