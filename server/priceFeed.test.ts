import { afterEach, describe, expect, it, vi } from 'vitest'
import { binanceProtocol, bybitProtocol, createPriceFeed } from './priceFeed.ts'
import type { SymbolGroups } from './priceFeed.ts'
import { createAlertService } from './alerts.ts'

/** A subscribe / unsubscribe / ping message as the fake socket received it. */
interface SentMessage {
  readonly method?: string
  readonly params?: string[]
  readonly id?: number
  readonly op?: string
  readonly args?: string[]
}

/** A stand-in for the exchanges' WebSocket servers: records what is sent, lets the test push messages. */
function fakeSockets() {
  const sockets: FakeSocket[] = []
  class FakeSocket {
    url: string
    readyState: number
    sent: SentMessage[]
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(url: string) {
      this.url = url
      this.readyState = 0
      this.sent = []
      sockets.push(this)
    }
    send(text: string) {
      this.sent.push(JSON.parse(text) as SentMessage)
    }
    close() {
      this.readyState = 3
    }
    open() {
      this.readyState = 1
      this.onopen?.()
    }
    push(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) })
    }
    drop() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  return { FakeSocket, sockets, byUrl: (part: string) => sockets.filter((socket) => socket.url.includes(part)) }
}

const quiet = { log() {}, warn() {} }
afterEach(() => {
  vi.useRealTimers()
})

describe('exchange message formats', () => {
  it('reads Binance mini tickers and Bybit tickers', () => {
    expect(binanceProtocol.parse({ e: '24hrMiniTicker', s: 'BTCUSDT', c: '101.5' })).toEqual([['BTCUSDT', 101.5]])
    expect(binanceProtocol.parse({ result: null, id: 1 })).toEqual([])
    expect(binanceProtocol.subscribe(['BTCUSDT'], 7)).toEqual({ method: 'SUBSCRIBE', params: ['btcusdt@miniTicker'], id: 7 })
    expect(bybitProtocol.parse({ topic: 'tickers.ZETAUSDT', data: { symbol: 'ZETAUSDT', lastPrice: '0.25' } })).toEqual([
      ['ZETAUSDT', 0.25],
    ])
    expect(bybitProtocol.parse({ op: 'pong' })).toEqual([])
  })
})

describe('live price feed', () => {
  it('connects only for exchanges with watched symbols and subscribes in batches', () => {
    const { FakeSocket, byUrl } = fakeSockets()
    const prices: Array<[string, number]> = []
    const feed = createPriceFeed({ WebSocketImpl: FakeSocket, onPrice: (...args) => prices.push(args), log: quiet })
    feed.setSymbols({ binance: ['BTCUSDT', 'ETHUSDT'] })
    expect(byUrl('bybit')).toHaveLength(0)
    const binance = byUrl('binance')[0]
    binance.open()
    expect(binance.sent).toEqual([{ method: 'SUBSCRIBE', params: ['btcusdt@miniTicker', 'ethusdt@miniTicker'], id: 1 }])
    binance.push({ e: '24hrMiniTicker', s: 'BTCUSDT', c: '100' })
    expect(prices).toEqual([['BTCUSDT', 100]])

    feed.setSymbols({ binance: ['ETHUSDT'], bybit: Array.from({ length: 12 }, (_, index) => `C${index}USDT`) })
    expect(binance.sent.at(-1)).toMatchObject({ method: 'UNSUBSCRIBE', params: ['btcusdt@miniTicker'] })
    const bybit = byUrl('bybit')[0]
    bybit.open()
    expect(bybit.sent.map((message) => message.args?.length)).toEqual([10, 2])
    expect(feed.status().bybit).toMatchObject({ connected: true, symbols: 12 })
    feed.stop()
  })

  it('reconnects after a drop and subscribes again', () => {
    vi.useFakeTimers()
    const { FakeSocket, byUrl } = fakeSockets()
    const feed = createPriceFeed({ WebSocketImpl: FakeSocket, onPrice() {}, log: quiet })
    feed.setSymbols({ binance: ['BTCUSDT'] })
    byUrl('binance')[0].open()
    byUrl('binance')[0].drop()
    vi.advanceTimersByTime(1100)
    const second = byUrl('binance')[1]
    expect(second).toBeDefined()
    second.open()
    expect(second.sent[0]).toMatchObject({ method: 'SUBSCRIBE', params: ['btcusdt@miniTicker'] })
    feed.stop()
  })
})

describe('alerts with live prices', () => {
  const alertsValue = JSON.stringify([
    { id: 'a1', symbol: 'BTCUSDT', targetPrice: 100, direction: 'above', enabled: true, createdAtMs: 1 },
    { id: 'a2', symbol: 'FUTUSDT', targetPrice: 5, direction: 'below', enabled: true, createdAtMs: 1 },
  ])

  function setup({ time = 1000 } = {}) {
    const values: Record<string, string> = { u1: alertsValue }
    const store = {
      listUserIds: () => ['u1'],
      getAlertsValue: (id: string) => values[id],
      setAlertsValue: (id: string, value: string) => {
        values[id] = value
      },
    }
    const notifications: string[] = []
    const watched: SymbolGroups[] = []
    const fetched: SymbolGroups[] = []
    let clock = time
    const service = createAlertService({
      store,
      exchangeOf: (symbol) => (symbol === 'FUTUSDT' ? 'binance-futures' : 'binance'),
      fetchPrices: async (groups) => {
        fetched.push(groups)
        return new Map()
      },
      notify: async (userId, payload) => {
        notifications.push(payload.alertId)
      },
      feed: { setSymbols: (groups) => watched.push(groups) },
      now: () => clock,
      log: quiet,
    })
    service.start()
    return {
      service,
      values,
      notifications,
      watched,
      fetched,
      advance: (ms: number) => {
        clock += ms
      },
    }
  }

  it('tells the feed which symbols to watch and fires on the first live price that crosses', () => {
    const { service, values, notifications, watched } = setup()
    expect(watched.at(-1)).toEqual({ binance: ['BTCUSDT'], 'binance-futures': ['FUTUSDT'] })
    service.onLivePrice('BTCUSDT', 99)
    service.onLivePrice('BTCUSDT', 100.5)
    expect(notifications).toEqual(['a1'])
    expect(JSON.parse(values.u1)[0]).toMatchObject({ triggeredPrice: 100.5, enabled: false })
    // Fired alerts stop being watched.
    expect(watched.at(-1)).toEqual({ 'binance-futures': ['FUTUSDT'] })
    service.stop()
  })

  it('polls only what has no fresh live price', async () => {
    const { service, fetched, advance } = setup()
    service.onLivePrice('BTCUSDT', 99)
    await service.tick()
    expect(fetched.at(-1)).toEqual({ 'binance-futures': ['FUTUSDT'] })
    advance(25_000) // the live price went quiet
    await service.tick()
    expect(fetched.at(-1)).toEqual({ binance: ['BTCUSDT'], 'binance-futures': ['FUTUSDT'] })
    expect(service.watchStatus()).toMatchObject({ symbols: 2, live: 0, polled: 2 })
    service.stop()
  })

  it('ignores live prices for symbols nobody watches', () => {
    const { service, notifications } = setup()
    service.onLivePrice('DOGEUSDT', 1)
    service.onLivePrice('DOGEUSDT', 2)
    expect(notifications).toEqual([])
    expect(service.watchStatus().live).toBe(0)
    service.stop()
  })
})
