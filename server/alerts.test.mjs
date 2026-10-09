import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALERTS_KEY, alertReached, createAlertService, createPushService, fetchLastPrices, parseActiveAlerts } from './alerts.mjs'
import { mergeListings, parseBinanceListings, parseBybitListings, precisionFromStep } from './markets.mjs'

const alert = (overrides = {}) => ({ id: 'a1', symbol: 'BTCUSDT', targetPrice: 100, direction: 'above', enabled: true, createdAtMs: 1, ...overrides })

/** In-memory stand-in for the server's per-user data. */
function fakeStore(initial) {
  const values = { ...initial }
  return {
    values,
    listUserIds: () => Object.keys(values),
    getAlertsValue: (userId) => values[userId],
    setAlertsValue: (userId, value) => { values[userId] = value },
  }
}

function service({ store, prices, exchangeOf = () => 'binance' }) {
  const notifications = []
  const queue = [...prices]
  const instance = createAlertService({
    store,
    exchangeOf,
    fetchPrices: async () => new Map(Object.entries(queue.shift() ?? {})),
    notify: async (userId, payload) => { notifications.push({ userId, ...payload }) },
    now: () => 5000,
    log: { warn() {} },
  })
  instance.start()
  return { instance, notifications }
}

describe('alert rules', () => {
  it('reaches a target in the alert direction', () => {
    expect(alertReached(alert(), 100)).toBe(true)
    expect(alertReached(alert(), 99.9)).toBe(false)
    expect(alertReached(alert({ direction: 'below' }), 100)).toBe(true)
    expect(alertReached(alert({ direction: 'below' }), 100.1)).toBe(false)
  })

  it('only treats enabled, untriggered, well-formed alerts as active', () => {
    const value = JSON.stringify([
      alert(),
      alert({ id: 'off', enabled: false }),
      alert({ id: 'done', triggeredAtMs: 9 }),
      alert({ id: 'bad', targetPrice: 'x' }),
      { nope: true },
    ])
    expect(parseActiveAlerts(value).map((item) => item.id)).toEqual(['a1'])
    expect(parseActiveAlerts('not json')).toEqual([])
  })
})

describe('server-side alerts', () => {
  it('fires when the price crosses the target and marks the stored alert as triggered', async () => {
    const store = fakeStore({ u1: JSON.stringify([alert(), alert({ id: 'a2', symbol: 'ETHUSDT', targetPrice: 5000 })]) })
    const { instance, notifications } = service({ store, prices: [{ BTCUSDT: 90, ETHUSDT: 3000 }, { BTCUSDT: 101, ETHUSDT: 3100 }] })
    await instance.tick() // baseline prices
    expect(notifications).toHaveLength(0)
    await instance.tick() // BTC crosses 100
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ userId: 'u1', symbol: 'BTCUSDT', alertId: 'a1', price: 101 })
    const stored = JSON.parse(store.values.u1)
    expect(stored[0]).toMatchObject({ id: 'a1', enabled: false, triggeredAtMs: 5000, triggeredPrice: 101 })
    expect(stored[1]).toMatchObject({ id: 'a2', enabled: true })
    expect(instance.eventsSince('u1', 0).map((event) => event.id)).toEqual(['a1'])
    expect(instance.eventsSince('u1', 5000)).toEqual([])
    expect(instance.activeCount()).toBe(1)
  })

  it('fires only once and never for a price that was already past the target', async () => {
    const store = fakeStore({ u1: JSON.stringify([alert()]) })
    const { instance, notifications } = service({ store, prices: [{ BTCUSDT: 120 }, { BTCUSDT: 125 }, { BTCUSDT: 90 }, { BTCUSDT: 110 }] })
    await instance.tick()
    await instance.tick()
    expect(notifications).toHaveLength(0) // already above when the alert was created: no crossing
    await instance.tick() // falls below
    await instance.tick() // crosses up
    expect(notifications).toHaveLength(1)
    await instance.tick()
    expect(notifications).toHaveLength(1)
  })

  it('handles below alerts and several users on the same symbol', async () => {
    const store = fakeStore({
      u1: JSON.stringify([alert({ direction: 'below', targetPrice: 50 })]),
      u2: JSON.stringify([alert({ id: 'b', direction: 'below', targetPrice: 40 })]),
    })
    const { instance, notifications } = service({ store, prices: [{ BTCUSDT: 60 }, { BTCUSDT: 45 }, { BTCUSDT: 30 }] })
    await instance.tick()
    await instance.tick()
    expect(notifications.map((item) => item.userId)).toEqual(['u1'])
    await instance.tick()
    expect(notifications.map((item) => item.userId)).toEqual(['u1', 'u2'])
  })

  it('ignores symbols the server cannot price (indices) and picks up edits', async () => {
    const store = fakeStore({ u1: JSON.stringify([alert({ symbol: 'BTC.D' })]) })
    const { instance, notifications } = service({ store, prices: [{}, {}], exchangeOf: (symbol) => (symbol === 'BTC.D' ? undefined : 'binance') })
    await instance.tick()
    expect(notifications).toHaveLength(0)
    instance.updateUserAlerts('u1', JSON.stringify([]))
    expect(instance.activeCount()).toBe(0)
  })
})

describe('price fetching', () => {
  it('batches Binance symbols and tolerates a failing exchange', async () => {
    const urls = []
    const fetchImpl = async (url) => {
      urls.push(String(url))
      if (String(url).includes('bybit')) throw new Error('down')
      return { ok: true, json: async () => [{ symbol: 'BTCUSDT', price: '100.5' }, { symbol: 'ETHUSDT', price: 'bad' }] }
    }
    const prices = await fetchLastPrices({ binance: ['BTCUSDT', 'ETHUSDT'], bybit: ['ZETAUSDT'] }, fetchImpl)
    expect([...prices]).toEqual([['BTCUSDT', 100.5]])
    expect(urls.some((url) => url.includes('ticker/price?symbols='))).toBe(true)
  })
})

describe('push subscriptions', () => {
  const dirs = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  function push(sender = { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => {}), generateVAPIDKeys: undefined }) {
    const dir = mkdtempSync(join(tmpdir(), 'th-push-'))
    dirs.push(dir)
    return { dir, sender, service: createPushService({ dataDir: dir, subject: 'https://example.com', log: { log() {}, warn() {} }, sender }) }
  }
  const sub = (endpoint) => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } })

  it('accepts browser push services only', () => {
    const { service } = push({ setVapidDetails() {}, sendNotification: async () => {}, generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }) })
    expect(service.subscribe('u1', sub('https://fcm.googleapis.com/fcm/send/abc'))).toBeUndefined()
    expect(service.subscribe('u1', sub('https://updates.push.services.mozilla.com/wpush/v2/x'))).toBeUndefined()
    expect(service.subscribe('u1', sub('https://internal.example.com/hook'))).toBe('Unsupported push service.')
    expect(service.subscribe('u1', sub('http://fcm.googleapis.com/x'))).toBe('Unsupported push service.')
    expect(service.subscribe('u1', { endpoint: 'https://fcm.googleapis.com/x' })).toBe('Invalid subscription.')
    expect(service.count('u1')).toBe(2)
  })

  it('replaces a repeated subscription, delivers to every device, and forgets expired ones', async () => {
    const sendNotification = vi.fn(async (subscription) => {
      if (subscription.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { statusCode: 410 })
    })
    const { service } = push({ setVapidDetails() {}, sendNotification, generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }) })
    service.subscribe('u1', sub('https://fcm.googleapis.com/fcm/send/one'))
    service.subscribe('u1', sub('https://fcm.googleapis.com/fcm/send/one'))
    service.subscribe('u1', sub('https://fcm.googleapis.com/fcm/send/gone'))
    expect(service.count('u1')).toBe(2)
    await service.send('u1', { title: 'x' })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(service.count('u1')).toBe(1)
    service.unsubscribe('u1', 'https://fcm.googleapis.com/fcm/send/one')
    expect(service.count('u1')).toBe(0)
  })
})

describe('market catalog parsing', () => {
  it('reads precision from tick and step sizes', () => {
    expect(precisionFromStep('0.00100000', 2)).toBe(3)
    expect(precisionFromStep('1.00000000', 2)).toBe(0)
    expect(precisionFromStep(undefined, 4)).toBe(4)
  })

  it('keeps trading USDT and BTC pairs, and lets Bybit add only what Binance lacks', () => {
    const binance = parseBinanceListings({
      symbols: [
        { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] },
        { symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC', status: 'TRADING', filters: [] },
        { symbol: 'ETHEUR', baseAsset: 'ETH', quoteAsset: 'EUR', status: 'TRADING', filters: [] },
        { symbol: 'OLDUSDT', baseAsset: 'OLD', quoteAsset: 'USDT', status: 'BREAK', filters: [] },
      ],
    })
    expect(binance.map((item) => item.symbol)).toEqual(['ETHUSDT', 'ETHBTC'])
    expect(binance.find((item) => item.symbol === 'ETHBTC').quoteAsset).toBe('BTC')
    const bybit = parseBybitListings({
      result: { list: [
        { symbol: 'ETHUSDT', baseCoin: 'ETH', quoteCoin: 'USDT', status: 'Trading' },
        { symbol: 'ZETAUSDT', baseCoin: 'ZETA', quoteCoin: 'USDT', status: 'Trading', priceFilter: { tickSize: '0.00001' } },
      ] },
    })
    const merged = mergeListings(binance, bybit)
    expect(merged.map((item) => item.symbol)).toEqual(['ETHUSDT', 'ETHBTC', 'ZETAUSDT'])
    expect(merged.at(-1)).toMatchObject({ exchange: 'bybit', pricePrecision: 5 })
  })
})

describe('alerts key', () => {
  it('matches the key the app syncs alerts under', () => {
    expect(ALERTS_KEY).toBe('alerts:v1')
  })
})
