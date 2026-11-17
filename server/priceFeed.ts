// Live prices for the coins that have active alerts, pushed by the exchanges over WebSockets (about once a second)
// instead of asking every 10 seconds. One connection per exchange, subscribed only to the symbols that are watched,
// reconnecting by itself. Anything the feed does not cover, or a symbol that goes quiet, is still checked by the
// alert service's polling, so a dropped connection delays alerts but never loses them.

const BINANCE_URL = 'wss://data-stream.binance.vision/ws'
const BYBIT_URL = 'wss://stream.bybit.com/v5/public/spot'
const SILENT_MS = 60_000 // no message for this long while subscribed: the connection is treated as dead
const RECONNECT_MAX_MS = 30_000

/** Where the feed reports connection problems (console fits). */
export type FeedLog = Partial<Pick<Console, 'warn'>>

/** Symbols per exchange ({ binance: [...], bybit: [...] }). */
export type SymbolGroups = { readonly [exchange: string]: readonly string[] | undefined }

/** The parts of a WebSocket the feed uses: Node's global WebSocket, or a stand-in in tests. */
export type FeedSocket = Pick<WebSocket, 'readyState' | 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>
export type FeedSocketConstructor = new (url: string) => FeedSocket

/** A [symbol, price] pair read from a message; the symbol is checked to be a string before it is used. */
export type PricePair = [symbol: unknown, price: number]

interface ProtocolBase {
  readonly name: string
  readonly url: string
  /** Most symbols per subscribe / unsubscribe request. */
  readonly batch: number
  readonly subscribe: (symbols: readonly string[], id: number) => unknown
  readonly unsubscribe: (symbols: readonly string[], id: number) => unknown
  parse(message: unknown): PricePair[]
}

/** How to talk to one exchange's stream. Exchanges that need a keep-alive message set both `pingMs` and `ping`. */
export type PriceProtocol = ProtocolBase & (
  | { readonly pingMs?: undefined, readonly ping?: undefined }
  | { readonly pingMs: number, readonly ping: () => unknown }
)

/** A parsed JSON message before its fields are checked. */
type JsonFields = { readonly [field: string]: unknown }

export interface StreamStatus {
  readonly connected: boolean
  readonly symbols: number
  readonly lastMessageAgoSec: number | null
  readonly connectedSinceMs: number | null
}

interface PriceStream {
  setSymbols(symbols: Iterable<string>): void
  stop(): void
  status(): StreamStatus
}

interface StreamOptions {
  readonly WebSocketImpl: FeedSocketConstructor | undefined
  readonly onPrice: (symbol: string, price: number) => void
  readonly log: FeedLog
  readonly now: () => number
}

export interface PriceFeedOptions {
  readonly onPrice: (symbol: string, price: number) => void
  readonly WebSocketImpl?: FeedSocketConstructor
  readonly log?: FeedLog
  readonly now?: () => number
}

export interface PriceFeedStatus { readonly binance: StreamStatus, readonly bybit: StreamStatus }

export interface PriceFeed {
  /** Symbols per exchange that should be live; other exchanges are ignored. */
  setSymbols(groups: SymbolGroups): void
  stop(): void
  status(): PriceFeedStatus
}

/** Binance: SUBSCRIBE/UNSUBSCRIBE in batches, "<symbol>@miniTicker" sends the last price every second. */
export const binanceProtocol: PriceProtocol = {
  name: 'binance',
  url: BINANCE_URL,
  batch: 200,
  subscribe: (symbols, id) => ({ method: 'SUBSCRIBE', params: symbols.map((symbol) => `${symbol.toLowerCase()}@miniTicker`), id }),
  unsubscribe: (symbols, id) => ({ method: 'UNSUBSCRIBE', params: symbols.map((symbol) => `${symbol.toLowerCase()}@miniTicker`), id }),
  /** Returns [symbol, price] pairs found in a message. */
  parse(message) {
    // Network JSON: each field read below is checked or converted.
    const events = (Array.isArray(message) ? message : [message]) as Array<JsonFields | null | undefined>
    return events.filter((event): event is JsonFields => event?.e === '24hrMiniTicker').map((event): PricePair => [event.s, Number(event.c)])
  },
}

/** Bybit spot: subscribe/unsubscribe "tickers.<SYMBOL>" (at most 10 per request), and a ping every 20 seconds. */
export const bybitProtocol: PriceProtocol = {
  name: 'bybit',
  url: BYBIT_URL,
  batch: 10,
  pingMs: 20_000,
  ping: () => ({ op: 'ping' }),
  subscribe: (symbols) => ({ op: 'subscribe', args: symbols.map((symbol) => `tickers.${symbol}`) }),
  unsubscribe: (symbols) => ({ op: 'unsubscribe', args: symbols.map((symbol) => `tickers.${symbol}`) }),
  parse(json) {
    // Network JSON: `topic` is checked below, the data fields are checked by the caller or converted.
    const message = json as { readonly topic?: unknown, readonly data?: JsonFields } | null | undefined
    if (typeof message?.topic !== 'string' || !message.topic.startsWith('tickers.') || !message.data) return []
    return [[message.data.symbol ?? message.topic.slice(8), Number(message.data.lastPrice)]]
  },
}

/** One exchange connection that keeps itself subscribed to `wanted` symbols. */
function createStream(protocol: PriceProtocol, { WebSocketImpl, onPrice, log, now }: StreamOptions): PriceStream {
  let socket: FeedSocket | undefined
  let wanted = new Set<string>()
  let subscribed = new Set<string>()
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  let lastMessageAtMs = 0
  let connectedAtMs = 0
  let messageId = 1
  let stopped = false
  let reportedBadMessage = false

  const sendJson = (payload: unknown) => { try { socket?.send(JSON.stringify(payload)) } catch { /* reconnect handles it */ } }

  function syncSubscriptions() {
    if (!socket || socket.readyState !== 1) return
    const add = [...wanted].filter((symbol) => !subscribed.has(symbol))
    const remove = [...subscribed].filter((symbol) => !wanted.has(symbol))
    for (let index = 0; index < add.length; index += protocol.batch) sendJson(protocol.subscribe(add.slice(index, index + protocol.batch), messageId++))
    for (let index = 0; index < remove.length; index += protocol.batch) sendJson(protocol.unsubscribe(remove.slice(index, index + protocol.batch), messageId++))
    subscribed = new Set(wanted)
  }

  function cleanup() {
    clearInterval(pingTimer)
    clearInterval(watchdog)
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      try { socket.close() } catch { /* already closed */ }
    }
    socket = undefined
    subscribed = new Set<string>()
    connectedAtMs = 0
  }

  function scheduleReconnect() {
    cleanup()
    if (stopped || wanted.size === 0) return
    const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** attempt)
    attempt += 1
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, delay)
    reconnectTimer.unref?.()
  }

  function connect() {
    if (stopped || socket || wanted.size === 0 || !WebSocketImpl) return
    try {
      socket = new WebSocketImpl(protocol.url)
    } catch (error) {
      log.warn?.(`[prices] ${protocol.name}: cannot open the live price connection (${(error as Error).message})`)
      scheduleReconnect()
      return
    }
    socket.onopen = () => {
      attempt = 0
      connectedAtMs = now()
      lastMessageAtMs = now()
      subscribed = new Set<string>()
      syncSubscriptions()
      if (protocol.pingMs) {
        pingTimer = setInterval(() => sendJson(protocol.ping()), protocol.pingMs)
        pingTimer.unref?.()
      }
      watchdog = setInterval(() => {
        if (now() - lastMessageAtMs > SILENT_MS) {
          log.warn?.(`[prices] ${protocol.name}: no data for ${Math.round(SILENT_MS / 1000)} s, reconnecting`)
          scheduleReconnect()
        }
      }, 10_000)
      watchdog.unref?.()
    }
    socket.onmessage = (event: { readonly data: unknown }) => {
      lastMessageAtMs = now()
      let message: unknown
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch (error) {
        // One bad frame should not stop the feed; warn once per connection so a broken stream is still visible.
        if (!reportedBadMessage) log.warn?.(`[prices] ${protocol.name}: ignoring a message that is not JSON (${(error as Error).message})`)
        reportedBadMessage = true
        return
      }
      for (const [symbol, price] of protocol.parse(message)) {
        if (typeof symbol === 'string' && Number.isFinite(price) && price > 0) onPrice(symbol, price)
      }
    }
    socket.onclose = () => { if (!stopped) scheduleReconnect() }
    socket.onerror = () => { /* onclose follows and reconnects */ }
  }

  return {
    setSymbols(symbols) {
      wanted = new Set<string>(symbols)
      if (wanted.size === 0) { cleanup(); return }
      if (!socket) connect()
      else syncSubscriptions()
    },
    stop() {
      stopped = true
      clearTimeout(reconnectTimer)
      cleanup()
    },
    status: () => ({
      connected: Boolean(socket && socket.readyState === 1),
      symbols: wanted.size,
      lastMessageAgoSec: lastMessageAtMs ? Math.round((now() - lastMessageAtMs) / 1000) : null,
      connectedSinceMs: connectedAtMs || null,
    }),
  }
}

/**
 * @param onPrice (symbol, price) for every live price received
 * @param WebSocketImpl injectable for tests; without one (very old Node) the feed stays off and polling does the work
 */
export function createPriceFeed({ onPrice, WebSocketImpl = globalThis.WebSocket, log = console, now = () => Date.now() }: PriceFeedOptions): PriceFeed {
  if (!WebSocketImpl) log.warn?.('[prices] this Node.js has no WebSocket support: alerts are checked by polling only')
  const streams = {
    binance: createStream(binanceProtocol, { WebSocketImpl, onPrice, log, now }),
    bybit: createStream(bybitProtocol, { WebSocketImpl, onPrice, log, now }),
  }
  return {
    /** Symbols per exchange that should be live ({ binance: [...], bybit: [...] }); other exchanges are ignored. */
    setSymbols(groups) {
      streams.binance.setSymbols(groups.binance ?? [])
      streams.bybit.setSymbols(groups.bybit ?? [])
    },
    stop() { for (const stream of Object.values(streams)) stream.stop() },
    status: () => ({ binance: streams.binance.status(), bybit: streams.bybit.status() }),
  }
}
