// TradeHorizon service worker: receives price-alert push messages while the app is closed.
// It deliberately caches nothing, so a new deployment is always picked up immediately.
// Built to /sw.js by the service-worker plugin in vite.config.ts.

declare const self: ServiceWorkerGlobalScope

/** What the server sends with an alert push (see server/alerts.ts). Every field is optional. */
interface AlertPush {
  readonly title?: string
  readonly body?: string
  readonly alertId?: string
}

function readPush(event: PushEvent): AlertPush {
  try {
    const value: unknown = event.data ? event.data.json() : {}
    return typeof value === 'object' && value !== null ? (value as AlertPush) : {}
  } catch {
    return {} // Not JSON: a generic alert is shown below rather than nothing.
  }
}

self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const data = readPush(event)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // An open, visible TradeHorizon window announces the alert itself (sound and notification).
      if (windows.some((client) => client.visibilityState === 'visible')) return
      await self.registration.showNotification(data.title || 'TradeHorizon alert', {
        body: data.body || 'A price alert was triggered.',
        tag: data.alertId || 'tradehorizon-alert',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows[0]
      if (existing) {
        await existing.focus()
        return
      }
      const target: unknown = event.notification.data
      const url =
        typeof target === 'object' && target !== null && typeof (target as { url?: unknown }).url === 'string'
          ? (target as { url: string }).url
          : '/'
      await self.clients.openWindow(url)
    })(),
  )
})

export {}
