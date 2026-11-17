// Cross-origin access to the API for the Android app, whose bundled pages run at https://localhost (Capacitor).
// The API authenticates with a Bearer token and never with cookies, so allowing an origin lets its pages call the API
// but gives them no ambient credentials; Access-Control-Allow-Credentials is deliberately never sent.
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Origins of the Android app's WebView, allowed when TH_ALLOWED_ORIGINS is not set. */
export const DEFAULT_ALLOWED_ORIGINS = 'https://localhost,capacitor://localhost'

const ALLOWED_METHODS = 'GET, POST, PUT, OPTIONS'
const ALLOWED_HEADERS = 'Authorization, Content-Type'
/** How long a browser may reuse a preflight answer. */
const PREFLIGHT_MAX_AGE_SEC = 600

/** TH_ALLOWED_ORIGINS="https://a.example, https://b.example" -> Set of origins. An empty value allows none. */
export function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? DEFAULT_ALLOWED_ORIGINS)
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
}

/** Adds `value` to the response's Vary header without dropping what is already there. */
export function addVary(res: ServerResponse, value: string): void {
  const current = res.getHeader('Vary')
  const names = (Array.isArray(current) ? current.join(',') : String(current ?? ''))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (!names.some((name) => name.toLowerCase() === value.toLowerCase())) names.push(value)
  res.setHeader('Vary', names.join(', '))
}

/**
 * Applies CORS to an API request. Requests from an allowed origin get the Access-Control headers; a preflight
 * (OPTIONS with Access-Control-Request-Method) from one is answered here with 204. Returns true when the response was
 * finished. Other origins get no CORS headers, so browsers refuse to hand them the response.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowed: ReadonlySet<string>): boolean {
  // The answer depends on who asks, so shared caches must not reuse it for another origin.
  addVary(res, 'Origin')
  const origin = req.headers.origin
  if (!origin || !allowed.has(origin)) return false

  res.setHeader('Access-Control-Allow-Origin', origin)
  if (req.method !== 'OPTIONS' || !req.headers['access-control-request-method']) return false

  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  res.setHeader('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SEC))
  res.writeHead(204)
  res.end()
  return true
}
