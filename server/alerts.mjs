// Price alerts evaluated on the server, so they fire with the browser closed.
//
// A user's alerts are stored with the rest of their synced data (the `alerts:v1` item), so the
// server simply reads that. Every few seconds it fetches the latest price for each symbol that
// has an active alert, and when a price crosses a target it marks the alert as triggered in the
// stored data and sends a web-push notification to the user's devices.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'

export const ALERTS_KEY = 'alerts:v1'
const POLL_MS = 10_000
const FETCH_TIMEOUT_MS = 8_000
const BINANCE_BATCH = 100
const MAX_SUBSCRIPTIONS_PER_USER = 10
/** Browsers' push services. Subscriptions pointing anywhere else are rejected so the server cannot be aimed at other hosts. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/

export function alertReached(alert, price) {
  return alert.direction === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice
}

/** Alerts that can still fire. Anything malformed is ignored rather than trusted. */
export function parseActiveAlerts(value) {
  let list
  try { list = JSON.parse(value) } catch { return [] }
  if (!Array.isArray(list)) return []
  return list.filter((alert) => (
    alert && typeof alert.id === 'string' && typeof alert.symbol === 'string' &&
    typeof alert.targetPrice === 'number' && Number.isFinite(alert.targetPrice) &&
    (alert.direction === 'above' || alert.direction === 'below') &&
    alert.enabled === true && !alert.triggeredAtMs
  ))
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`)
  return response.json()
}

/** Latest prices for { exchange: symbols[] }. One failing exchange only drops its own symbols. */
export async function fetchLastPrices(groups, fetchImpl = (url, init) => fetch(url, init)) {
  const prices = new Map()
  const jobs = []
  const binance = groups.binance ?? []
  for (let index = 0; index < binance.length; index += BINANCE_BATCH) {
    const chunk = binance.slice(index, index + BINANCE_BATCH)
    jobs.push(getJson(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(chunk))}`, fetchImpl)
      .then((rows) => { for (const row of rows) prices.set(row.symbol, Number(row.price)) }))
  }
  for (const symbol of groups['binance-futures'] ?? []) {
    jobs.push(getJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`, fetchImpl)
      .then((row) => { prices.set(symbol, Number(row.price)) }))
  }
  for (const symbol of groups.bybit ?? []) {
    jobs.push(getJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`, fetchImpl)
      .then((payload) => { prices.set(symbol, Number(payload.result?.list?.[0]?.lastPrice)) }))
  }
  await Promise.allSettled(jobs)
  for (const [symbol, price] of prices) if (!Number.isFinite(price) || price <= 0) prices.delete(symbol)
  return prices
}

/**
 * @param store      { listUserIds(), getAlertsValue(userId), setAlertsValue(userId, value) }
 * @param exchangeOf symbol -> 'binance' | 'bybit' | 'binance-futures' | undefined (undefined = not evaluated here)
 * @param notify     async (userId, payload) => void
 */
export function createAlertService({ store, exchangeOf, fetchPrices = fetchLastPrices, notify = async () => {}, now = () => Date.now(), log = console }) {
  /** userId -> alerts that can still fire */
  const active = new Map()
  /** symbol -> last price seen; a crossing needs a previous price to compare with */
  const lastPrice = new Map()
  let running = false
  let timer

  function updateUserAlerts(userId, value) {
    const alerts = parseActiveAlerts(value)
    if (alerts.length === 0) active.delete(userId)
    else active.set(userId, alerts)
  }

  function loadAll() {
    for (const userId of store.listUserIds()) {
      const value = store.getAlertsValue(userId)
      if (value) updateUserAlerts(userId, value)
    }
  }

  function fire(userId, alert, price) {
    const value = store.getAlertsValue(userId)
    if (value) {
      try {
        const list = JSON.parse(value)
        const updated = list.map((item) => (
          item?.id === alert.id ? { ...item, enabled: false, triggeredAtMs: now(), triggeredPrice: price } : item
        ))
        store.setAlertsValue(userId, JSON.stringify(updated))
      } catch { /* leave the stored data alone if it cannot be read */ }
    }
    updateUserAlerts(userId, store.getAlertsValue(userId) ?? '[]')
    void notify(userId, {
      title: `${alert.symbol} price alert`,
      body: `Price reached ${price} (target ${alert.targetPrice}).`,
      symbol: alert.symbol,
      alertId: alert.id,
      price,
    }).catch((error) => log.warn?.(`[alerts] notification failed: ${error.message}`))
  }

  async function tick() {
    if (running) return
    running = true
    try {
      const bySymbol = new Map()
      const groups = {}
      for (const [userId, alerts] of active) {
        for (const alert of alerts) {
          const exchange = exchangeOf(alert.symbol)
          if (!exchange) continue
          const entries = bySymbol.get(alert.symbol) ?? []
          if (entries.length === 0) (groups[exchange] ??= []).push(alert.symbol)
          entries.push({ userId, alert })
          bySymbol.set(alert.symbol, entries)
        }
      }
      for (const symbol of lastPrice.keys()) if (!bySymbol.has(symbol)) lastPrice.delete(symbol)
      if (bySymbol.size === 0) return

      const prices = await fetchPrices(groups)
      for (const [symbol, price] of prices) {
        const previous = lastPrice.get(symbol)
        lastPrice.set(symbol, price)
        if (previous === undefined) continue
        for (const { userId, alert } of bySymbol.get(symbol) ?? []) {
          if (!alertReached(alert, previous) && alertReached(alert, price)) fire(userId, alert, price)
        }
      }
    } catch (error) {
      log.warn?.(`[alerts] price check failed: ${error.message}`)
    } finally {
      running = false
    }
  }

  /** Alerts that fired after `sinceMs`, read from the stored data so nothing extra has to be kept. */
  function eventsSince(userId, sinceMs) {
    const value = store.getAlertsValue(userId)
    if (!value) return []
    try {
      return JSON.parse(value)
        .filter((alert) => typeof alert?.triggeredAtMs === 'number' && alert.triggeredAtMs > sinceMs)
        .map(({ id, symbol, targetPrice, direction, triggeredAtMs, triggeredPrice }) => ({ id, symbol, targetPrice, direction, triggeredAtMs, triggeredPrice }))
    } catch {
      return []
    }
  }

  return {
    start() {
      loadAll()
      timer = setInterval(() => void tick(), POLL_MS)
      timer.unref()
    },
    stop() { clearInterval(timer) },
    updateUserAlerts,
    eventsSince,
    tick,
    /** Test and diagnostics helper. */
    activeCount: () => [...active.values()].reduce((sum, alerts) => sum + alerts.length, 0),
  }
}

/** Web-push: VAPID keys, each user's browser subscriptions, and delivery. */
export function createPushService({ dataDir, subject, log = console, sender = webpush }) {
  const vapidFile = join(dataDir, 'vapid.json')
  const subsFile = join(dataDir, 'push.json')

  let vapid
  if (existsSync(vapidFile)) {
    try { vapid = JSON.parse(readFileSync(vapidFile, 'utf8')) } catch { /* regenerated below */ }
  }
  if (!vapid?.publicKey || !vapid?.privateKey) {
    vapid = webpush.generateVAPIDKeys()
    writeFileSync(vapidFile, JSON.stringify(vapid))
    log.log?.('[push] generated new VAPID keys (keep server/data/vapid.json in your backups)')
  }
  sender.setVapidDetails(subject, vapid.publicKey, vapid.privateKey)

  /** userId -> [{ endpoint, keys: { p256dh, auth }, createdAtMs }] */
  let subscriptions = {}
  if (existsSync(subsFile)) {
    try { subscriptions = JSON.parse(readFileSync(subsFile, 'utf8')) } catch { /* start empty */ }
  }

  function persist() {
    writeFileSync(`${subsFile}.tmp`, JSON.stringify(subscriptions))
    renameSync(`${subsFile}.tmp`, subsFile)
  }

  return {
    publicKey: vapid.publicKey,

    /** Returns an error message, or undefined on success. */
    subscribe(userId, subscription) {
      const endpoint = subscription?.endpoint
      const keys = subscription?.keys
      if (typeof endpoint !== 'string' || endpoint.length > 2048 || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
        return 'Invalid subscription.'
      }
      let url
      try { url = new URL(endpoint) } catch { return 'Invalid subscription.' }
      if (url.protocol !== 'https:' || !PUSH_HOSTS.test(url.hostname)) return 'Unsupported push service.'
      const others = (subscriptions[userId] ?? []).filter((item) => item.endpoint !== endpoint)
      subscriptions[userId] = [...others, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, createdAtMs: Date.now() }]
        .slice(-MAX_SUBSCRIPTIONS_PER_USER)
      persist()
      return undefined
    },

    unsubscribe(userId, endpoint) {
      const before = subscriptions[userId] ?? []
      const after = before.filter((item) => item.endpoint !== endpoint)
      if (after.length === before.length) return
      if (after.length === 0) delete subscriptions[userId]
      else subscriptions[userId] = after
      persist()
    },

    count: (userId) => (subscriptions[userId] ?? []).length,

    async send(userId, payload) {
      const list = subscriptions[userId] ?? []
      const gone = []
      await Promise.all(list.map(async (subscription) => {
        try {
          await sender.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, JSON.stringify(payload), { TTL: 3600 })
        } catch (error) {
          // 404/410: the browser dropped the subscription; forget it.
          if (error?.statusCode === 404 || error?.statusCode === 410) gone.push(subscription.endpoint)
          else log.warn?.(`[push] delivery failed (${error?.statusCode ?? error?.message})`)
        }
      }))
      if (gone.length > 0) {
        subscriptions[userId] = list.filter((item) => !gone.includes(item.endpoint))
        if (subscriptions[userId].length === 0) delete subscriptions[userId]
        persist()
      }
    },
  }
}
