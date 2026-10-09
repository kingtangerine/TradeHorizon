// Sends unexpected browser errors to the server log, so problems show up without users having to report them.
// Capped at a few reports per page load, and the server rate-limits as well.

const MAX_REPORTS = 5
let sent = 0

function report(message: string, source: string, stack?: string): void {
  if (sent >= MAX_REPORTS) return
  sent += 1
  try {
    const body = JSON.stringify({ message, source, stack, version: __APP_VERSION__ })
    navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }))
  } catch {
    // Reporting must never cause a second error.
  }
}

export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    report(event.message || 'Script error', `${event.filename}:${event.lineno}`, event.error instanceof Error ? event.error.stack : undefined)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown
    report(reason instanceof Error ? reason.message : String(reason), 'unhandledrejection', reason instanceof Error ? reason.stack : undefined)
  })
}
