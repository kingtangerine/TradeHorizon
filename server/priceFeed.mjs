// Live prices for the coins that have active alerts, pushed by the exchanges over WebSockets (about once a second)
// instead of asking every 10 seconds. One connection per exchange, subscribed only to the symbols that are watched,
// reconnecting by itself. Anything the feed does not cover, or a symbol that goes quiet, is still checked by the
// alert service's polling, so a dropped connection delays alerts but never loses them.

const BINANCE_URL = 'wss://data-stream.binance.vision/ws'
const BYBIT_URL = 'wss://stream.bybit.com/v5/public/spot'
const SILENT_MS = 60_000 // no message for this long while subscribed: the connection is treated as dead
const RECONNECT_MAX_MS = 30_000

/** Binance: SUBSCRIBE/UNSUBSCRIBE in batches, "<symbol>@miniTicker" sends the last price every second. */
export const binanceProtocol = {
  name: 'binance',
  url: BINANCE_URL,
  batch: 200,
  subscribe: (symbols, id) => ({ method: 'SUBSCRIBE', params: symbols.map((symbol) => `${symbol.toLowerCase()}@miniTicker`), id }),
  unsubscribe: (symbols, id) => ({ method: 'UNSUBSCRIBE', params: symbols.map((symbol) => `${symbol.toLowerCase()}@miniTicker`), id }),
  /** Returns [symbol, price] pairs found in a message. */
  parse(message) {
    const events = Array.isArray(message) ? message : [message]
    return events.filter((event) => event?.e === '24hrMiniTicker').map((event) => [event.s, Number(event.c)])
  },
}

/** Bybit spot: subscribe/unsubscribe "tickers.<SYMBOL>" (at most 10 per request), and a ping every 20 seconds. */
export const bybitProtocol = {
  name: 'bybit',
  url: BYBIT_URL,
  batch: 10,
  pingMs: 20_000,
  ping: () => ({ op: 'ping' }),
  subscribe: (symbols) => ({ op: 'subscribe', args: symbols.map((symbol) => `tickers.${symbol}`) }),
  unsubscribe: (symbols) => ({ op: 'unsubscribe', args: symbols.map((symbol) => `tickers.${symbol}`) }),
  parse(message) {
    if (typeof message?.topic !== 'string' || !message.topic.startsWith('tickers.') || !message.data) return []
    return [[message.data.symbol ?? message.topic.slice(8), Number(message.data.lastPrice)]]
  },
}

/** One exchange connection that keeps itself subscribed to `wanted` symbols. */
function createStream(protocol, { WebSocketImpl, onPrice, log, now }) {
  let socket
  let wanted = new Set()
  let subscribed = new Set()
  let attempt = 0
  let reconnectTimer
  let pingTimer
  let watchdog
  let lastMessageAtMs = 0
  let connectedAtMs = 0
  let messageId = 1
  let stopped = false
  let reportedBadMessage = false

  const sendJson = (payload) => { try { socket?.send(JSON.stringify(payload)) } catch { /* reconnect handles it */ } }

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
    subscribed = new Set()
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
      log.warn?.(`[prices] ${protocol.name}: cannot open the live price connection (${error.message})`)
      scheduleReconnect()
      return
    }
    socket.onopen = () => {
      attempt = 0
      connectedAtMs = now()
      lastMessageAtMs = now()
      subscribed = new Set()
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
    socket.onmessage = (event) => {
      lastMessageAtMs = now()
      let message
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch (error) {
        // One bad frame should not stop the feed; warn once per connection so a broken stream is still visible.
        if (!reportedBadMessage) log.warn?.(`[prices] ${protocol.name}: ignoring a message that is not JSON (${error.message})`)
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
      wanted = new Set(symbols)
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
export function createPriceFeed({ onPrice, WebSocketImpl = globalThis.WebSocket, log = console, now = () => Date.now() }) {
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
