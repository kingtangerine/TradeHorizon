// Sends unexpected browser errors to the server log, so problems show up without users having to report them.
// Capped at a few reports per page load, and the server rate-limits as well.

import { apiUrl, isCrossOriginApi } from '../platform/api'

const MAX_REPORTS = 5
let sent = 0

function report(message: string, source: string, stack?: string): void {
  if (sent >= MAX_REPORTS) return
  sent += 1
  try {
    const body = JSON.stringify({ message, source, stack, version: __APP_VERSION__ })
    const url = apiUrl('/api/client-error')
    if (isCrossOriginApi) {
      // A JSON beacon to another origin needs a CORS preflight, which sendBeacon cannot do; keepalive fetch can.
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined)
    } else {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    }
  } catch {
    // Reporting must never cause a second error.
  }
}

/** Reports a failure the app recovered from but should not hide: logged in the console and sent to the server log. */
export function reportProblem(message: string, source: string): void {
  console.warn(`[${source}] ${message}`)
  report(message, source)
}

/** Listens for uncaught errors and unhandled promise rejections and reports them to the server. Call once at startup. */
export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    report(
      event.message || 'Script error',
      `${event.filename}:${event.lineno}`,
      event.error instanceof Error ? event.error.stack : undefined,
    )
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown
    report(
      reason instanceof Error ? reason.message : String(reason),
      'unhandledrejection',
      reason instanceof Error ? reason.stack : undefined,
    )
  })
}
