// Server-side copies of public market data, so each browser asks us (fast, small, cached)
// instead of downloading Binance's 6 MB coin list or hitting CoinGecko's strict rate limit.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BINANCE_EXCHANGE_INFO = 'https://data-api.binance.vision/api/v3/exchangeInfo?showPermissionSets=false'
const BYBIT_INSTRUMENTS = 'https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000'
const COINGECKO = {
  global: 'https://api.coingecko.com/api/v3/global',
  markets: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
}

const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000
const COINGECKO_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000
const SYMBOL = /^[A-Z0-9]{2,30}$/

/** Pairs that trade on Binance Futures; the app lists them itself, but alerts need to know where they trade. */
const FUTURES_SYMBOLS = new Set(['BTCDOMUSDT'])

export function precisionFromStep(step, fallback) {
  if (typeof step !== 'string') return fallback
  const value = Number(step)
  if (!Number.isFinite(value) || value <= 0) return fallback
  if (value >= 1) return 0
  const decimals = step.split('.')[1] ?? ''
  const lastSignificant = decimals.search(/[1-9]0*$/)
  return lastSignificant === -1 ? fallback : lastSignificant + 1
}

function filterValue(filters, type, key) {
  return Array.isArray(filters) ? filters.find((item) => item?.filterType === type)?.[key] : undefined
}

/** USDT and BTC pairs that are trading on Binance spot. */
export function parseBinanceListings(payload) {
  if (!Array.isArray(payload?.symbols)) throw new TypeError('Binance exchangeInfo has no symbols')
  const listings = []
  for (const entry of payload.symbols) {
    if (
      entry?.status !== 'TRADING' || entry.isSpotTradingAllowed === false ||
      (entry.quoteAsset !== 'USDT' && entry.quoteAsset !== 'BTC') ||
      typeof entry.symbol !== 'string' || typeof entry.baseAsset !== 'string' || !SYMBOL.test(entry.symbol)
    ) continue
    listings.push({
      ...(entry.quoteAsset === 'BTC' ? { quoteAsset: 'BTC' } : {}),
      symbol: entry.symbol,
      baseAsset: entry.baseAsset,
      pricePrecision: precisionFromStep(filterValue(entry.filters, 'PRICE_FILTER', 'tickSize'), 2),
      volumePrecision: precisionFromStep(filterValue(entry.filters, 'LOT_SIZE', 'stepSize'), 4),
    })
  }
  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset))
}

/** USDT pairs that are trading on Bybit spot. */
export function parseBybitListings(payload) {
  const list = payload?.result?.list
  if (!Array.isArray(list)) throw new TypeError('Bybit instruments have no list')
  const listings = []
  for (const entry of list) {
    if (
      entry?.status !== 'Trading' || entry.quoteCoin !== 'USDT' ||
      typeof entry.symbol !== 'string' || typeof entry.baseCoin !== 'string' || !SYMBOL.test(entry.symbol)
    ) continue
    listings.push({
      exchange: 'bybit',
      symbol: entry.symbol,
      baseAsset: entry.baseCoin,
      pricePrecision: precisionFromStep(entry.priceFilter?.tickSize, 4),
      volumePrecision: precisionFromStep(entry.lotSizeFilter?.basePrecision, 4),
    })
  }
  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset))
}

/** Binance first; Bybit only adds pairs Binance does not list. */
export function mergeListings(binance, bybit) {
  const seen = new Set(binance.map((item) => item.symbol))
  return [...binance, ...bybit.filter((item) => !seen.has(item.symbol))]
}

export function createMarketService({ dataDir, fetchImpl = (url, init) => fetch(url, init), log = console }) {
  const catalogFile = join(dataDir, 'catalog.json')
  let catalog = { fetchedAtMs: 0, listings: [] }
  let bySymbol = new Map()
  let refreshing

  function setCatalog(next) {
    catalog = next
    bySymbol = new Map(next.listings.map((item) => [item.symbol, item.exchange ?? 'binance']))
  }

  if (existsSync(catalogFile)) {
    try { setCatalog(JSON.parse(readFileSync(catalogFile, 'utf8'))) } catch { /* refetched below */ }
  }

  async function getJson(url) {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`)
    return response.json()
  }

  async function refreshCatalog() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      const binance = parseBinanceListings(await getJson(BINANCE_EXCHANGE_INFO))
      // Bybit is optional: without it the catalog is Binance only.
      const bybit = await getJson(BYBIT_INSTRUMENTS).then(parseBybitListings).catch((error) => {
        log.warn?.(`[markets] Bybit list unavailable: ${error.message}`)
        return []
      })
      const next = { fetchedAtMs: Date.now(), listings: mergeListings(binance, bybit) }
      setCatalog(next)
      try {
        writeFileSync(`${catalogFile}.tmp`, JSON.stringify(next))
        renameSync(`${catalogFile}.tmp`, catalogFile)
      } catch (error) {
        log.warn?.(`[markets] could not save the catalog: ${error.message}`)
      }
      log.log?.(`[markets] catalog refreshed: ${next.listings.length} pairs`)
    })().catch((error) => {
      log.warn?.(`[markets] catalog refresh failed: ${error.message}`)
    }).finally(() => { refreshing = undefined })
    return refreshing
  }

  // CoinGecko: one shared copy for all users, with the last good copy served if CoinGecko is down.
  const gecko = { global: { at: 0, data: undefined, inflight: undefined }, markets: { at: 0, data: undefined, inflight: undefined } }
  async function coingecko(name) {
    const slot = gecko[name]
    if (!COINGECKO[name]) throw new Error('unknown dataset')
    if (slot.data && Date.now() - slot.at < COINGECKO_TTL_MS) return slot.data
    slot.inflight ??= getJson(COINGECKO[name])
      .then((data) => { slot.data = data; slot.at = Date.now(); return data })
      .catch((error) => {
        if (slot.data) return slot.data
        throw error
      })
      .finally(() => { slot.inflight = undefined })
    return slot.inflight
  }

  let timer
  return {
    start() {
      void refreshCatalog()
      timer = setInterval(() => void refreshCatalog(), CATALOG_REFRESH_MS)
      timer.unref()
    },
    stop() { clearInterval(timer) },
    refreshCatalog,
    getCatalog: () => catalog,
    /** Where a symbol trades, or undefined when it is not a listed pair (for example an index like BTC.D). */
    exchangeOf(symbol) {
      if (FUTURES_SYMBOLS.has(symbol)) return 'binance-futures'
      return bySymbol.get(symbol)
    },
    coingecko,
  }
}
