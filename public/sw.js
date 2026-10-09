// TradeHorizon service worker: receives price-alert push messages while the app is closed.
// It deliberately caches nothing, so a new deployment is always picked up immediately.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* show a generic alert below */ }
  event.waitUntil((async () => {
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
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows[0]
    if (existing) { await existing.focus(); return }
    await self.clients.openWindow((event.notification.data && event.notification.data.url) || '/')
  })())
})
