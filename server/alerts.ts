// Price alerts evaluated on the server, so they fire with the browser closed.
//
// A user's alerts are stored with the rest of their synced data (the `alerts:v1` item), so the
// server simply reads that. Prices for the symbols with active alerts arrive live from the exchanges
// (priceFeed.ts, about once a second); symbols without a fresh live price are fetched every 10 seconds
// instead. When a price crosses a target the alert is marked as triggered in the stored data and the
// user is notified (web push and Telegram).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import { createSendQueue } from './sendQueue.ts'
import type { SendQueueStatus, SendResult, ServiceLog } from './sendQueue.ts'
import { alertMessage, conditionMet, conditionOf, evaluateAlert, isExpired, isValidAlert } from './alertRules.ts'
import type { AlertRuleFields, AlertState } from './alertRules.ts'
import type { SymbolGroups } from './priceFeed.ts'
import { VENUE_TICKERS } from './venues.ts'

export const ALERTS_KEY = 'alerts:v1'
const POLL_MS = 10_000
/** A live price older than this no longer counts: the symbol is fetched by polling until the feed catches up. */
const LIVE_STALE_MS = 20_000
const FETCH_TIMEOUT_MS = 8_000
const BINANCE_BATCH = 100
const MAX_SUBSCRIPTIONS_PER_USER = 10
/** Browsers' push services. Subscriptions pointing anywhere else are rejected so the server cannot be aimed at other hosts. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/

/** An alert as stored in the user's synced `alerts:v1` data (the app's PriceAlert). */
export interface StoredAlert extends AlertRuleFields {
  readonly enabled?: boolean
  readonly createdAtMs?: number
  readonly triggeredAtMs?: number
  readonly triggeredPrice?: number
  readonly lastTriggeredPrice?: number
  readonly triggerCount?: number
}

/** An alert a device saw trigger (see newlyTriggered). */
export interface TriggeredAlert extends StoredAlert { readonly triggeredAtMs: number }

/** What a notification says, for web push and Telegram. */
export interface AlertPayload {
  readonly title: string
  readonly body: string
  readonly symbol: string
  readonly alertId: string
  readonly price: number
}

/** One fired alert, as eventsSince reports it (read from stored data, so any field can be missing). */
export interface AlertEvent {
  readonly id?: string
  readonly symbol?: string
  readonly targetPrice?: number
  readonly direction?: AlertRuleFields['direction']
  readonly triggeredAtMs?: number
  readonly triggeredPrice?: number
  readonly everyTime?: true
}

/** [time, price] */
export type PriceSample = [time: number, price: number]

/** The part of a fetch Response that price fetching reads. */
export interface FetchResponse {
  readonly ok: boolean
  readonly status?: number
  json(): Promise<unknown>
}
export type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponse>

/** A JSON object from an exchange before its fields are checked. */
type JsonFields = { readonly [field: string]: unknown }

/** Where the alert service reads and writes the users' synced `alerts:v1` values. */
export interface AlertStore {
  listUserIds(): Iterable<string>
  getAlertsValue(userId: string): string | null | undefined
  setAlertsValue(userId: string, value: string): void
}

/** A live price feed (see priceFeed.ts). */
export interface AlertFeed { setSymbols(groups: SymbolGroups): void }

export interface AlertServiceOptions {
  readonly store: AlertStore
  readonly exchangeOf: (symbol: string) => string | undefined
  readonly apiSymbolOf?: (symbol: string) => string
  readonly fetchPrices?: (groups: SymbolGroups) => Promise<ReadonlyMap<string, number>>
  readonly notify?: (userId: string, payload: AlertPayload) => Promise<unknown>
  readonly feed?: AlertFeed
  readonly now?: () => number
  readonly log?: ServiceLog
}

export interface AlertWatchStatus { readonly symbols: number, readonly live: number, readonly polled: number }

export interface AlertService {
  start(): void
  stop(): void
  updateUserAlerts(userId: string, value: string): void
  relayTriggered(userId: string, previousValue: string | null | undefined, nextValue: string | null | undefined): void
  eventsSince(userId: string, sinceMs: number): AlertEvent[]
  tick(): Promise<void>
  onLivePrice(symbol: string, price: number): void
  watchStatus(): AlertWatchStatus
  activeCount(): number
}

/** A browser's push subscription, as stored and as handed to the sender. */
export interface WebPushSubscription {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string, readonly auth: string }
}

interface StoredSubscription extends WebPushSubscription { readonly createdAtMs: number }

interface VapidKeys { readonly publicKey: string, readonly privateKey: string }

/** What createPushService needs from the web-push package (tests pass a stand-in). */
export interface PushSender {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  sendNotification(subscription: WebPushSubscription, payload: string, options: { TTL: number }): Promise<unknown>
}

/** What a failed web-push send may carry; the queue reads `permanent` and `retryAfterMs` (see sendQueue.ts). */
interface PushFailure {
  message?: string
  statusCode?: number
  headers?: { readonly [name: string]: string | undefined }
  permanent?: boolean
  retryAfterMs?: number
}

export interface PushServiceOptions {
  readonly dataDir: string
  readonly subject: string
  readonly log?: ServiceLog
  readonly sender?: PushSender
}

export interface PushService {
  readonly publicKey: string
  /** Returns an error message, or undefined on success. */
  subscribe(userId: string, subscription: unknown): string | undefined
  unsubscribe(userId: string, endpoint: string): void
  count(userId: string): number
  totalDevices(): number
  removeUser(userId: string): void
  queueStatus(): SendQueueStatus
  stop(): void
  send(userId: string, payload: AlertPayload): Promise<SendResult[]>
}

/** Kept for older callers: a plain level alert's "reached" test. Conditions live in alertRules.ts. */
export function alertReached(alert: AlertRuleFields, price: number): boolean {
  return conditionMet(alert, price, Date.now())
}

/** How far back prices are kept for "moving N% in a window" alerts (the longest window plus a margin). */
const SAMPLE_KEEP_MS = 24 * 3_600_000 + 10 * 60_000
const SAMPLE_EVERY_MS = 10_000

/** The price `windowMs` ago from a symbol's samples, or undefined while there is not that much history yet. */
export function priceAgo(samples: readonly PriceSample[] | undefined, windowMs: number, nowMs: number): number | undefined {
  if (!samples || samples.length === 0) return undefined
  const start = nowMs - windowMs
  if (samples[0][0] > start + 60_000) return undefined
  for (const [time, price] of samples) if (time >= start) return price
  return samples[samples.length - 1][1]
}

/** Alerts that can still fire. Anything malformed is ignored rather than trusted. */
export function parseActiveAlerts(value: string): StoredAlert[] {
  let list: unknown
  try { list = JSON.parse(value) } catch { return [] }
  if (!Array.isArray(list)) return []
  const nowMs = Date.now()
  return list.filter(isValidAlert).filter((alert: StoredAlert) => alert.enabled === true && !alert.triggeredAtMs && !isExpired(alert, nowMs))
}

/** How long after triggering a device-reported alert is still worth a notification (old uploads are not re-sent). */
const RELAY_WINDOW_MS = 30 * 60_000

/**
 * Alerts that are triggered in `nextValue` but were not (or not at that moment) in `previousValue`:
 * a device with the app open saw them trigger first and uploaded them. Only recent triggers count.
 */
export function newlyTriggered(previousValue: string | null | undefined, nextValue: string | null | undefined, nowMs: number, maxAgeMs = RELAY_WINDOW_MS): TriggeredAlert[] {
  // Uploaded data: the fields that matter are checked below.
  const parse = (value: string | null | undefined): Array<Partial<StoredAlert> | null | undefined> => { try { const list: unknown = JSON.parse(value ?? '[]'); return Array.isArray(list) ? list : [] } catch { return [] } }
  // "Every time" alerts stay active and record each trigger in lastTriggeredAtMs instead.
  const at = (alert: Partial<StoredAlert> | null | undefined) => (typeof alert?.triggeredAtMs === 'number' ? alert.triggeredAtMs : alert?.lastTriggeredAtMs)
  const before = new Map(parse(previousValue).filter((alert) => alert && typeof alert.id === 'string').map((alert): [unknown, number | undefined] => [alert?.id, at(alert)]))
  return parse(nextValue).filter((alert) => (
    alert && typeof alert.id === 'string' && typeof alert.symbol === 'string' &&
    typeof alert.targetPrice === 'number' && typeof at(alert) === 'number' &&
    before.get(alert.id) !== at(alert) &&
    Math.abs(nowMs - Number(at(alert))) <= maxAgeMs
  )).map((alert) => ({ ...alert, triggeredAtMs: at(alert) }) as TriggeredAlert)
}

export function alertPayload(alert: AlertRuleFields, price: number): AlertPayload {
  return {
    title: `${alert.symbol} alert`,
    body: alertMessage(alert, price),
    symbol: alert.symbol,
    alertId: alert.id,
    price,
  }
}

async function getJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`)
  return response.json()
}

/** Latest prices for { exchange: symbols[] }. One failing exchange only drops its own symbols. */
/** Our symbol -> the exchange's own one when nothing better is known ("BYBIT:BTCUSDT.P" -> "BTCUSDT"). */
const plainApiSymbol = (symbol: string) => String(symbol).replace(/^[A-Z]+:/, '').replace(/\.P$/, '')

export async function fetchLastPrices(groups: SymbolGroups, fetchImpl: FetchLike = (url, init) => fetch(url, init), apiSymbolOf: (symbol: string) => string = plainApiSymbol): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  const jobs: Array<Promise<void>> = []
  const binance = groups.binance ?? []
  for (let index = 0; index < binance.length; index += BINANCE_BATCH) {
    const chunk = binance.slice(index, index + BINANCE_BATCH)
    jobs.push(getJson(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(chunk))}`, fetchImpl)
      .then((rows) => { for (const row of rows as Iterable<{ readonly symbol: string, readonly price: unknown }>) prices.set(row.symbol, Number(row.price)) }))
  }
  // The other exchanges: one ticker request per exchange covers every symbol watched there.
  for (const [exchange, ticker] of Object.entries(VENUE_TICKERS)) {
    const symbols = groups[exchange] ?? []
    if (symbols.length === 0) continue
    const wanted = new Map(symbols.map((symbol): [unknown, string] => [apiSymbolOf(symbol), symbol]))
    jobs.push(getJson(ticker.url, fetchImpl).then((payload) => {
      for (const row of (ticker.rows(payload) ?? []) as Iterable<JsonFields | null | undefined>) {
        const symbol = wanted.get(row?.[ticker.symbol])
        if (symbol) prices.set(symbol, Number(row?.[ticker.price]))
      }
    }))
  }
  for (const symbol of groups['binance-futures'] ?? []) {
    // Perpetuals are stored as "XXXUSDT.P"; Binance knows them without the suffix.
    jobs.push(getJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(apiSymbolOf(symbol))}`, fetchImpl)
      .then((row) => { prices.set(symbol, Number((row as JsonFields).price)) }))
  }
  for (const symbol of groups.bybit ?? []) {
    jobs.push(getJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(apiSymbolOf(symbol))}`, fetchImpl)
      .then((payload) => { prices.set(symbol, Number((payload as { readonly result?: { readonly list?: readonly JsonFields[] } }).result?.list?.[0]?.lastPrice)) }))
  }
  await Promise.allSettled(jobs)
  for (const [symbol, price] of prices) if (!Number.isFinite(price) || price <= 0) prices.delete(symbol)
  return prices
}

/**
 * @param store      { listUserIds(), getAlertsValue(userId), setAlertsValue(userId, value) }
 * @param exchangeOf symbol -> 'binance' | 'bybit' | 'binance-futures' | undefined (undefined = not evaluated here)
 * @param notify     async (userId, payload) => void
 * @param feed       optional live price feed: { setSymbols({ exchange: symbols[] }) } (see priceFeed.ts)
 */
export function createAlertService({ store, exchangeOf, apiSymbolOf, fetchPrices = (groups) => fetchLastPrices(groups, undefined, apiSymbolOf), notify = async () => {}, feed, now = () => Date.now(), log = console }: AlertServiceOptions): AlertService {
  /** userId -> alerts that can still fire */
  const active = new Map<string, StoredAlert[]>()
  /** symbol -> last price seen */
  const lastPrice = new Map<string, number>()
  /** alertId -> { met, armed } from the previous check (see evaluateAlert) */
  const alertState = new Map<string, AlertState>()
  /** symbol -> [[time, price], ...] over the last day, for "moving N%" alerts */
  const samples = new Map<string, PriceSample[]>()
  /** symbol -> when the live feed last delivered a price for it */
  const liveAt = new Map<string, number>()
  /** symbol -> [{ userId, alert }]: what to check when a price for that symbol arrives */
  let bySymbol = new Map<string, Array<{ userId: string, alert: StoredAlert }>>()
  /** exchange -> symbols, for the live feed and for polling */
  let groups: Record<string, string[]> = {}
  let watchedKey = ''
  let polledSymbols = 0
  let running = false
  let timer: ReturnType<typeof setInterval> | undefined
  /** `alertId:triggeredAtMs` already notified, so a trigger seen by both the server and a device is sent once. */
  const notified = new Set<string>()

  /** Rebuilds the per-symbol index and, when the set of symbols changed, tells the live feed. */
  function reindex() {
    const nextBySymbol = new Map<string, Array<{ userId: string, alert: StoredAlert }>>()
    const nextGroups: Record<string, string[]> = {}
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
      // The live feed reports plain symbols, so prefixed ones ("BYBIT:BTCUSDT") are left to polling.
      feed?.setSymbols(Object.fromEntries(Object.entries(groups).map(([exchange, symbols]) => [exchange, symbols.filter((symbol) => !symbol.includes(':'))])))
    }
  }

  function updateUserAlerts(userId: string, value: string) {
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

  /** A new price for a symbol: checks each of its alerts (alertRules.ts decides crossings, levels, channels, moves). */
  function checkPrice(symbol: string, price: number) {
    lastPrice.set(symbol, price)
    const nowMs = now()
    const history = samples.get(symbol) ?? []
    if (history.length === 0 || nowMs - history[history.length - 1][0] >= SAMPLE_EVERY_MS) {
      history.push([nowMs, price])
      while (history.length > 0 && nowMs - history[0][0] > SAMPLE_KEEP_MS) history.shift()
      samples.set(symbol, history)
    }
    for (const { userId, alert } of bySymbol.get(symbol) ?? []) {
      const reference = conditionOf(alert) === 'movePercent' ? priceAgo(history, alert.windowMs ?? NaN, nowMs) : undefined
      const step = evaluateAlert(alert, price, nowMs, alertState.get(alert.id), reference)
      alertState.set(alert.id, step.state)
      if (step.fire) fire(userId, alert, price)
    }
  }

  /** From the live feed: only symbols with active alerts matter. */
  function onLivePrice(symbol: string, price: number) {
    if (!bySymbol.has(symbol)) return
    liveAt.set(symbol, now())
    checkPrice(symbol, price)
  }

  function send(userId: string, payload: AlertPayload) {
    void notify(userId, payload).catch((error: Error) => log.warn?.(`[alerts] notification failed: ${error.message}`))
  }

  function fire(userId: string, alert: StoredAlert, price: number) {
    const triggeredAtMs = now()
    notified.add(`${alert.id}:${triggeredAtMs}`)
    const value = store.getAlertsValue(userId)
    if (value) {
      try {
        // Stored data: anything but an array throws at .map and is left alone below.
        const list = JSON.parse(value) as Array<StoredAlert | null | undefined>
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
  function relayTriggered(userId: string, previousValue: string | null | undefined, nextValue: string | null | undefined) {
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
      const stale: Record<string, string[]> = {}
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
      log.warn?.(`[alerts] price check failed: ${(error as Error).message}`)
    } finally {
      running = false
    }
  }

  /** Alerts that fired after `sinceMs`, read from the stored data so nothing extra has to be kept. */
  function eventsSince(userId: string, sinceMs: number): AlertEvent[] {
    const value = store.getAlertsValue(userId)
    if (!value) return []
    try {
      const at = (alert: Partial<StoredAlert> | null | undefined) => (typeof alert?.triggeredAtMs === 'number' ? alert.triggeredAtMs : alert?.lastTriggeredAtMs)
      // Stored data: anything but an array throws and counts as no events.
      return (JSON.parse(value) as Array<Partial<StoredAlert> | null | undefined>)
        .filter((alert): alert is Partial<StoredAlert> => typeof at(alert) === 'number' && Number(at(alert)) > sinceMs)
        .map((alert): AlertEvent => ({
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
export function createPushService({ dataDir, subject, log = console, sender = webpush }: PushServiceOptions): PushService {
  const queue = createSendQueue({ name: 'push', perSecond: 50, log })
  const vapidFile = join(dataDir, 'vapid.json')
  const subsFile = join(dataDir, 'push.json')

  let vapid: VapidKeys | undefined
  if (existsSync(vapidFile)) {
    // Both keys are checked below.
    try { vapid = JSON.parse(readFileSync(vapidFile, 'utf8')) as VapidKeys } catch { /* regenerated below */ }
  }
  if (!vapid?.publicKey || !vapid?.privateKey) {
    vapid = webpush.generateVAPIDKeys()
    writeFileSync(vapidFile, JSON.stringify(vapid))
    log.log?.('[push] generated new VAPID keys (keep server/data/vapid.json in your backups)')
  }
  sender.setVapidDetails(subject, vapid.publicKey, vapid.privateKey)

  /** userId -> [{ endpoint, keys: { p256dh, auth }, createdAtMs }] */
  let subscriptions: Record<string, StoredSubscription[]> = {}
  if (existsSync(subsFile)) {
    // Written only by persist() below.
    try { subscriptions = JSON.parse(readFileSync(subsFile, 'utf8')) as Record<string, StoredSubscription[]> } catch { /* start empty */ }
  }

  function persist() {
    writeFileSync(`${subsFile}.tmp`, JSON.stringify(subscriptions))
    renameSync(`${subsFile}.tmp`, subsFile)
  }

  return {
    publicKey: vapid.publicKey,

    /** Returns an error message, or undefined on success. */
    subscribe(userId, input) {
      // Request JSON: endpoint and keys are checked below.
      const subscription = input as { readonly endpoint?: unknown, readonly keys?: { readonly p256dh?: unknown, readonly auth?: unknown } } | null | undefined
      const endpoint = subscription?.endpoint
      const keys = subscription?.keys
      if (typeof endpoint !== 'string' || endpoint.length > 2048 || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
        return 'Invalid subscription.'
      }
      let url: URL
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
        } catch (caught) {
          // web-push rejects with a WebPushError (statusCode, headers); anything else is reported the same way.
          const error = caught as PushFailure
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
          else if (status !== undefined && status >= 400 && status < 500 && status !== 429) error.permanent = true
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), { message: `push service answered ${status ?? error?.message}` })
        }
      })))
    },
  }
}
