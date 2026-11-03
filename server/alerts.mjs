// Price alerts evaluated on the server, so they fire with the browser closed.
//
// A user's alerts are stored with the rest of their synced data (the `alerts:v1` item), so the
// server simply reads that. Prices for the symbols with active alerts arrive live from the exchanges
// (priceFeed.mjs, about once a second); symbols without a fresh live price are fetched every 10 seconds
// instead. When a price crosses a target the alert is marked as triggered in the stored data and the
// user is notified (web push and Telegram).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import { createSendQueue } from './sendQueue.mjs'
import { alertMessage, conditionMet, conditionOf, evaluateAlert, isExpired, isValidAlert } from './alertRules.mjs'

export const ALERTS_KEY = 'alerts:v1'
const POLL_MS = 10_000
/** A live price older than this no longer counts: the symbol is fetched by polling until the feed catches up. */
const LIVE_STALE_MS = 20_000
const FETCH_TIMEOUT_MS = 8_000
const BINANCE_BATCH = 100
const MAX_SUBSCRIPTIONS_PER_USER = 10
/** Browsers' push services. Subscriptions pointing anywhere else are rejected so the server cannot be aimed at other hosts. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/

/** Kept for older callers: a plain level alert's "reached" test. Conditions live in alertRules.mjs. */
export function alertReached(alert, price) {
  return conditionMet(alert, price, Date.now())
}

/** How far back prices are kept for "moving N% in a window" alerts (the longest window plus a margin). */
const SAMPLE_KEEP_MS = 24 * 3_600_000 + 10 * 60_000
const SAMPLE_EVERY_MS = 10_000

/** The price `windowMs` ago from a symbol's samples, or undefined while there is not that much history yet. */
export function priceAgo(samples, windowMs, nowMs) {
  if (!samples || samples.length === 0) return undefined
  const start = nowMs - windowMs
  if (samples[0][0] > start + 60_000) return undefined
  for (const [time, price] of samples) if (time >= start) return price
  return samples[samples.length - 1][1]
}

/** Alerts that can still fire. Anything malformed is ignored rather than trusted. */
export function parseActiveAlerts(value) {
  let list
  try { list = JSON.parse(value) } catch { return [] }
  if (!Array.isArray(list)) return []
  const nowMs = Date.now()
  return list.filter((alert) => isValidAlert(alert) && alert.enabled === true && !alert.triggeredAtMs && !isExpired(alert, nowMs))
}

/** How long after triggering a device-reported alert is still worth a notification (old uploads are not re-sent). */
const RELAY_WINDOW_MS = 30 * 60_000

/**
 * Alerts that are triggered in `nextValue` but were not (or not at that moment) in `previousValue`:
 * a device with the app open saw them trigger first and uploaded them. Only recent triggers count.
 */
export function newlyTriggered(previousValue, nextValue, nowMs, maxAgeMs = RELAY_WINDOW_MS) {
  const parse = (value) => { try { const list = JSON.parse(value ?? '[]'); return Array.isArray(list) ? list : [] } catch { return [] } }
  // "Every time" alerts stay active and record each trigger in lastTriggeredAtMs instead.
  const at = (alert) => (typeof alert?.triggeredAtMs === 'number' ? alert.triggeredAtMs : alert?.lastTriggeredAtMs)
  const before = new Map(parse(previousValue).filter((alert) => alert && typeof alert.id === 'string').map((alert) => [alert.id, at(alert)]))
  return parse(nextValue).filter((alert) => (
    alert && typeof alert.id === 'string' && typeof alert.symbol === 'string' &&
    typeof alert.targetPrice === 'number' && typeof at(alert) === 'number' &&
    before.get(alert.id) !== at(alert) &&
    Math.abs(nowMs - at(alert)) <= maxAgeMs
  )).map((alert) => ({ ...alert, triggeredAtMs: at(alert) }))
}

export function alertPayload(alert, price) {
  return {
    title: `${alert.symbol} alert`,
    body: alertMessage(alert, price),
    symbol: alert.symbol,
    alertId: alert.id,
    price,
  }
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
    // Perpetuals are stored as "XXXUSDT.P"; Binance knows them without the suffix.
    jobs.push(getJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol.replace(/\.P$/, ''))}`, fetchImpl)
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
 * @param feed       optional live price feed: { setSymbols({ exchange: symbols[] }) } (see priceFeed.mjs)
 */
export function createAlertService({ store, exchangeOf, fetchPrices = fetchLastPrices, notify = async () => {}, feed, now = () => Date.now(), log = console }) {
  /** userId -> alerts that can still fire */
  const active = new Map()
  /** symbol -> last price seen */
  const lastPrice = new Map()
  /** alertId -> { met, armed } from the previous check (see evaluateAlert) */
  const alertState = new Map()
  /** symbol -> [[time, price], ...] over the last day, for "moving N%" alerts */
  const samples = new Map()
  /** symbol -> when the live feed last delivered a price for it */
  const liveAt = new Map()
  /** symbol -> [{ userId, alert }]: what to check when a price for that symbol arrives */
  let bySymbol = new Map()
  /** exchange -> symbols, for the live feed and for polling */
  let groups = {}
  let watchedKey = ''
  let polledSymbols = 0
  let running = false
  let timer
  /** `alertId:triggeredAtMs` already notified, so a trigger seen by both the server and a device is sent once. */
  const notified = new Set()

  /** Rebuilds the per-symbol index and, when the set of symbols changed, tells the live feed. */
  function reindex() {
    const nextBySymbol = new Map()
    const nextGroups = {}
    for (const [userId, alerts] of active) {
      for (const alert of alerts) {
        const exchange = exchangeOf(alert.symbol)
        if (!exchange) continue
        const entries = nextBySymbol.get(alert.symbol) ?? []
        if (entries.length === 0) (nextGroups[exchange] ??= []).push(alert.symbol)
        entries.push({ userId, alert })
        nextBySymbol.set(alert.symbol, entries)
      }
    }
    bySymbol = nextBySymbol
    groups = nextGroups
    for (const symbol of [...lastPrice.keys()]) if (!bySymbol.has(symbol)) { lastPrice.delete(symbol); liveAt.delete(symbol); samples.delete(symbol) }
    const ids = new Set([...active.values()].flat().map((alert) => alert.id))
    for (const id of [...alertState.keys()]) if (!ids.has(id)) alertState.delete(id)
    const key = JSON.stringify(Object.entries(groups).map(([exchange, symbols]) => [exchange, [...symbols].sort()]).sort())
    if (key !== watchedKey) {
      watchedKey = key
      feed?.setSymbols(groups)
    }
  }

  function updateUserAlerts(userId, value) {
    const alerts = parseActiveAlerts(value)
    if (alerts.length === 0) active.delete(userId)
    else active.set(userId, alerts)
    reindex()
  }

  function loadAll() {
    for (const userId of store.listUserIds()) {
      const value = store.getAlertsValue(userId)
      const alerts = value ? parseActiveAlerts(value) : []
      if (alerts.length > 0) active.set(userId, alerts)
    }
    reindex()
  }

  /** A new price for a symbol: checks each of its alerts (alertRules.mjs decides crossings, levels, channels, moves). */
  function checkPrice(symbol, price) {
    lastPrice.set(symbol, price)
    const nowMs = now()
    const history = samples.get(symbol) ?? []
    if (history.length === 0 || nowMs - history[history.length - 1][0] >= SAMPLE_EVERY_MS) {
      history.push([nowMs, price])
      while (history.length > 0 && nowMs - history[0][0] > SAMPLE_KEEP_MS) history.shift()
      samples.set(symbol, history)
    }
    for (const { userId, alert } of bySymbol.get(symbol) ?? []) {
      const reference = conditionOf(alert) === 'movePercent' ? priceAgo(history, alert.windowMs, nowMs) : undefined
      const step = evaluateAlert(alert, price, nowMs, alertState.get(alert.id), reference)
      alertState.set(alert.id, step.state)
      if (step.fire) fire(userId, alert, price)
    }
  }

  /** From the live feed: only symbols with active alerts matter. */
  function onLivePrice(symbol, price) {
    if (!bySymbol.has(symbol)) return
    liveAt.set(symbol, now())
    checkPrice(symbol, price)
  }

  function send(userId, payload) {
    void notify(userId, payload).catch((error) => log.warn?.(`[alerts] notification failed: ${error.message}`))
  }

  function fire(userId, alert, price) {
    const triggeredAtMs = now()
    notified.add(`${alert.id}:${triggeredAtMs}`)
    const value = store.getAlertsValue(userId)
    if (value) {
      try {
        const list = JSON.parse(value)
        const updated = list.map((item) => {
          if (item?.id !== alert.id) return item
          // "Every time" alerts stay on; the trigger is recorded for the cooldown and the history.
          return item.frequency === 'everyTime'
            ? { ...item, lastTriggeredAtMs: triggeredAtMs, lastTriggeredPrice: price, triggerCount: (Number(item.triggerCount) || 0) + 1 }
            : { ...item, enabled: false, triggeredAtMs, triggeredPrice: price }
        })
        store.setAlertsValue(userId, JSON.stringify(updated))
      } catch { /* leave the stored data alone if it cannot be read */ }
    }
    updateUserAlerts(userId, store.getAlertsValue(userId) ?? '[]')
    send(userId, alertPayload(alert, price))
  }

  /**
   * A device uploaded its alerts. Ones it saw trigger first (the app was open, so its live price got there before
   * this server's check) get the same notifications the server would send: Telegram and the other devices.
   */
  function relayTriggered(userId, previousValue, nextValue) {
    for (const alert of newlyTriggered(previousValue, nextValue, now())) {
      const id = `${alert.id}:${alert.triggeredAtMs}`
      if (notified.has(id)) continue
      notified.add(id)
      send(userId, alertPayload(alert, alert.triggeredPrice ?? alert.targetPrice))
    }
  }

  /** Every 10 seconds: fetches the symbols the live feed is not covering right now (or does not cover at all). */
  async function tick() {
    if (running) return
    running = true
    try {
      const stale = {}
      let count = 0
      for (const [exchange, symbols] of Object.entries(groups)) {
        const due = symbols.filter((symbol) => !(now() - (liveAt.get(symbol) ?? -Infinity) < LIVE_STALE_MS))
        if (due.length > 0) { stale[exchange] = due; count += due.length }
      }
      polledSymbols = count
      if (count === 0) return
      const prices = await fetchPrices(stale)
      for (const [symbol, price] of prices) {
        // A live price that arrived while this request was under way is newer: keep it.
        if (now() - (liveAt.get(symbol) ?? -Infinity) < LIVE_STALE_MS) continue
        if (bySymbol.has(symbol)) checkPrice(symbol, price)
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
      const at = (alert) => (typeof alert?.triggeredAtMs === 'number' ? alert.triggeredAtMs : alert?.lastTriggeredAtMs)
      return JSON.parse(value)
        .filter((alert) => typeof at(alert) === 'number' && at(alert) > sinceMs)
        .map((alert) => ({
          id: alert.id, symbol: alert.symbol, targetPrice: alert.targetPrice, direction: alert.direction,
          triggeredAtMs: at(alert), triggeredPrice: alert.triggeredPrice ?? alert.lastTriggeredPrice,
          ...(alert.frequency === 'everyTime' ? { everyTime: true } : {}),
        }))
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
    relayTriggered,
    eventsSince,
    tick,
    onLivePrice,
    /** For /healthz and the admin page: how many symbols are watched, live and polled. */
    watchStatus() {
      const watched = bySymbol.size
      const live = [...bySymbol.keys()].filter((symbol) => now() - (liveAt.get(symbol) ?? -Infinity) < LIVE_STALE_MS).length
      return { symbols: watched, live, polled: polledSymbols }
    },
    /** Test and diagnostics helper. */
    activeCount: () => [...active.values()].reduce((sum, alerts) => sum + alerts.length, 0),
  }
}

/** Web-push: VAPID keys, each user's browser subscriptions, and delivery. */
export function createPushService({ dataDir, subject, log = console, sender = webpush }) {
  const queue = createSendQueue({ name: 'push', perSecond: 50, log })
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
    totalDevices: () => Object.values(subscriptions).reduce((sum, list) => sum + list.length, 0),
    /** Forgets every device of a deleted account. */
    removeUser(userId) {
      if (!subscriptions[userId]) return
      delete subscriptions[userId]
      persist()
    },

    queueStatus: () => queue.status(),
    stop: () => queue.stop(),

    /** Queues the notification for every device of the user; settles when each was delivered or given up on. */
    async send(userId, payload) {
      const body = JSON.stringify(payload)
      return Promise.all((subscriptions[userId] ?? []).map((subscription) => queue.enqueue(subscription.endpoint, async () => {
        try {
          await sender.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, body, { TTL: 3600 })
        } catch (error) {
          const status = error?.statusCode
          if (status === 404 || status === 410) {
            // The browser dropped the subscription: forget it, retrying cannot help.
            const rest = (subscriptions[userId] ?? []).filter((item) => item.endpoint !== subscription.endpoint)
            if (rest.length === 0) delete subscriptions[userId]
            else subscriptions[userId] = rest
            persist()
            throw Object.assign(new Error(`subscription gone (${status})`), { permanent: true })
          }
          const retryAfter = Number(error?.headers?.['retry-after'])
          if (status === 429 && retryAfter > 0) error.retryAfterMs = retryAfter * 1000
          else if (status >= 400 && status < 500 && status !== 429) error.permanent = true
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), { message: `push service answered ${status ?? error?.message}` })
        }
      })))
    },
  }
}
