// Where the TradeHorizon server is. On the web the app is served by that server, so API paths stay relative. The
// Android app is bundled into the APK and runs at its own origin, so its build sets VITE_API_BASE to the server's
// address (e.g. "https://app.example.com") and every request goes there.

/** Joins a server address and an API path. An empty base returns the path unchanged; trailing slashes on the base are ignored. */
export function resolveApiUrl(base: string | undefined, path: string): string {
  if (!path.startsWith('/')) throw new TypeError(`API paths must start with "/": ${path}`)
  const origin = (base ?? '').trim().replace(/\/+$/, '')
  return origin ? `${origin}${path}` : path
}

/** The server address this build talks to; empty on the web, where requests are same-origin. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '')

/** True when the server is on another origin (the Android app), which rules out same-origin-only browser features. */
export const isCrossOriginApi: boolean = API_BASE !== ''

/** The URL for a server path such as "/api/data": relative on the web, absolute when VITE_API_BASE is set. */
export function apiUrl(path: string): string {
  return resolveApiUrl(API_BASE, path)
}
