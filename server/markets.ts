// Server-side copies of public market data, so each browser asks us (fast, small, cached)
// instead of downloading Binance's 6 MB coin list or hitting CoinGecko's strict rate limit.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BINANCE_EXCHANGE_INFO = 'https://data-api.binance.vision/api/v3/exchangeInfo?showPermissionSets=false'
const BYBIT_INSTRUMENTS = 'https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000'
const BINANCE_FUTURES_INFO = 'https://fapi.binance.com/fapi/v1/exchangeInfo'
import { fetchVenueListings } from './venues.ts'
const COINGECKO = {
  global: 'https://api.coingecko.com/api/v3/global',
  markets: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
}

/** Where log lines go: console, or a quiet stand-in in tests. */
export interface Logger {
  log?: (message: string) => void
  warn?: (message: string) => void
}

/** The parts of fetch() the services use, so tests can pass a small fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

/** One coin for the chart's market-cap badge: symbol, name, market cap, rank, 24h volume. */
export interface MarketCap {
  s: string
  n: string
  c: number
  r: number
  v: number
}

/** One tradable pair in the catalog. `exchange` is missing for Binance spot. */
export interface Listing {
  exchange?: string
  symbol: string
  baseAsset: string
  apiSymbol?: string
  quoteAsset?: string
  pricePrecision?: number
  volumePrecision?: number
}

export interface Catalog {
  fetchedAtMs: number
  listings: Listing[]
}

export interface MarketServiceOptions {
  dataDir: string
  fetchImpl?: FetchLike
  log?: Logger
}

/** Fields read from a CoinGecko coins/markets row; anything may be missing or of another type. */
interface CoinGeckoMarketRow {
  symbol?: unknown
  name?: unknown
  market_cap?: unknown
  market_cap_rank?: unknown
  total_volume?: unknown
}

/** A raw exchange record: whatever the exchange sent, checked field by field before use. */
export type RawRecord = Record<string, unknown>

/** The value as a list of raw records, or undefined when it is not an array. */
export const records = (value: unknown): (RawRecord | null | undefined)[] | undefined => (Array.isArray(value) ? value : undefined)

/** Caught values are usually Errors; this reads their message without assuming so. */
export const messageOf = (error: unknown): unknown => (typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined)

/** Top 500 coins by market cap, for the market-cap badge on the chart (separate from the top-100 dominance data). */
const COINGECKO_CAP_PAGES = [1, 2].map((page) => `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`)
const CAPS_TTL_MS = 30 * 60 * 1000

/** Keeps what the chart needs from CoinGecko's market rows: symbol, name, market cap, rank, 24h volume. */
export function compactMarketCaps(pages: unknown[]): MarketCap[] {
  return (pages.flat() as (CoinGeckoMarketRow | null | undefined)[]).filter((coin): coin is CoinGeckoMarketRow & { symbol: string; market_cap: number } => Boolean(
    coin && typeof coin.symbol === 'string' && typeof coin.market_cap === 'number' && coin.market_cap > 0
  )).map((coin) => ({
    s: coin.symbol.toUpperCase(),
    n: String(coin.name ?? coin.symbol),
    c: coin.market_cap,
    r: Number(coin.market_cap_rank) || 0,
    v: Number(coin.total_volume) || 0,
  }))
}

const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000
const COINGECKO_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000
const SYMBOL = /^[A-Z0-9]{2,30}$/

/** Pairs that trade on Binance Futures; the app lists them itself, but alerts need to know where they trade. */
const FUTURES_SYMBOLS = new Set(['BTCDOMUSDT'])

export function precisionFromStep(step: unknown, fallback: number): number {
  if (typeof step !== 'string') return fallback
  const value = Number(step)
  if (!Number.isFinite(value) || value <= 0) return fallback
  if (value >= 1) return 0
  const decimals = step.split('.')[1] ?? ''
  const lastSignificant = decimals.search(/[1-9]0*$/)
  return lastSignificant === -1 ? fallback : lastSignificant + 1
}

function filterValue(filters: unknown, type: string, key: string): unknown {
  return records(filters)?.find((item) => item?.filterType === type)?.[key]
}

/** USDT and BTC pairs that are trading on Binance spot. */
export function parseBinanceListings(payload: unknown): Listing[] {
  const symbols = records((payload as RawRecord | null | undefined)?.symbols)
  if (!symbols) throw new TypeError('Binance exchangeInfo has no symbols')
  const listings: Listing[] = []
  for (const entry of symbols) {
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
export function parseBybitListings(payload: unknown): Listing[] {
  const list = records(((payload as RawRecord | null | undefined)?.result as RawRecord | null | undefined)?.list)
  if (!list) throw new TypeError('Bybit instruments have no list')
  const listings: Listing[] = []
  for (const entry of list) {
    if (
      entry?.status !== 'Trading' || entry.quoteCoin !== 'USDT' ||
      typeof entry.symbol !== 'string' || typeof entry.baseCoin !== 'string' || !SYMBOL.test(entry.symbol)
    ) continue
    listings.push({
      exchange: 'bybit',
      symbol: entry.symbol,
      baseAsset: entry.baseCoin,
      pricePrecision: precisionFromStep((entry.priceFilter as RawRecord | null | undefined)?.tickSize, 4),
      volumePrecision: precisionFromStep((entry.lotSizeFilter as RawRecord | null | undefined)?.basePrecision, 4),
    })
  }
  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset))
}

/** Trading USDT-M perpetuals as "XXXUSDT.P" (TradingView's naming), apart from BTCDOMUSDT which is listed on its own. */
export function parseBinanceFuturesListings(payload: unknown): Listing[] {
  const symbols = records((payload as RawRecord | null | undefined)?.symbols)
  if (!symbols) throw new TypeError('Binance futures exchangeInfo has no symbols')
  const listings: Listing[] = []
  for (const entry of symbols) {
    if (
      entry?.status !== 'TRADING' || entry.contractType !== 'PERPETUAL' || entry.quoteAsset !== 'USDT' ||
      typeof entry.symbol !== 'string' || typeof entry.baseAsset !== 'string' || !SYMBOL.test(entry.symbol) || entry.symbol === 'BTCDOMUSDT'
    ) continue
    listings.push({
      exchange: 'binance-futures',
      symbol: `${entry.symbol}.P`,
      baseAsset: entry.baseAsset,
      pricePrecision: precisionFromStep(filterValue(entry.filters, 'PRICE_FILTER', 'tickSize'), 2),
      volumePrecision: precisionFromStep(filterValue(entry.filters, 'LOT_SIZE', 'stepSize'), 3),
    })
  }
  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset))
}

/**
 * The whole catalog, as TradingView lists a pair once per exchange: Binance first (plain symbols), then Binance
 * perpetuals, Bybit (pairs Binance lacks keep their plain symbol, the others get "BYBIT:"), and the other exchanges.
 */
export function mergeAllListings(binance: Listing[], bybit: Listing[], binanceFutures: Listing[], others: Listing[]): Listing[] {
  const seen = new Set(binance.map((item) => item.symbol))
  const bybitSpot = bybit.map((item) => (seen.has(item.symbol) ? { ...item, symbol: `BYBIT:${item.symbol}`, apiSymbol: item.symbol } : item))
  const all = [...binance, ...binanceFutures, ...bybitSpot, ...others]
  const unique = new Set<string>()
  return all.filter((item) => (unique.has(item.symbol) ? false : (unique.add(item.symbol), true)))
}

/** Binance first; Bybit only adds pairs Binance does not list. */
export function mergeListings(binance: Listing[], bybit: Listing[]): Listing[] {
  const seen = new Set(binance.map((item) => item.symbol))
  return [...binance, ...bybit.filter((item) => !seen.has(item.symbol))]
}

/** A shared cached copy of one remote dataset, with the request in flight (if any). */
interface CacheSlot<T> {
  at: number
  data: T | undefined
  inflight: Promise<T> | undefined
}

export function createMarketService({ dataDir, fetchImpl = (url, init) => fetch(url, init), log = console }: MarketServiceOptions) {
  const catalogFile = join(dataDir, 'catalog.json')
  let catalog: Catalog = { fetchedAtMs: 0, listings: [] }
  let bySymbol = new Map<string, Listing>()
  let refreshing: Promise<void> | undefined

  function setCatalog(next: Catalog) {
    catalog = next
    bySymbol = new Map(next.listings.map((item) => [item.symbol, item]))
  }

  if (existsSync(catalogFile)) {
    try { setCatalog(JSON.parse(readFileSync(catalogFile, 'utf8')) as Catalog) } catch { /* refetched below */ }
  }

  async function getJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`)
    return response.json()
  }

  async function refreshCatalog() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      const binance = parseBinanceListings(await getJson(BINANCE_EXCHANGE_INFO))
      // Bybit is optional: without it the catalog is Binance only.
      const bybit = await getJson(BYBIT_INSTRUMENTS).then(parseBybitListings).catch((error: unknown): Listing[] => {
        log.warn?.(`[markets] Bybit list unavailable: ${messageOf(error)}`)
        return []
      })
      const futures = await getJson(BINANCE_FUTURES_INFO).then(parseBinanceFuturesListings).catch((error: unknown): Listing[] => {
        log.warn?.(`[markets] Binance futures list unavailable: ${messageOf(error)}`)
        return []
      })
      const others = await fetchVenueListings(getJson, log)
      const next: Catalog = { fetchedAtMs: Date.now(), listings: mergeAllListings(binance, bybit, futures, others) }
      setCatalog(next)
      try {
        writeFileSync(`${catalogFile}.tmp`, JSON.stringify(next))
        renameSync(`${catalogFile}.tmp`, catalogFile)
      } catch (error) {
        log.warn?.(`[markets] could not save the catalog: ${messageOf(error)}`)
      }
      log.log?.(`[markets] catalog refreshed: ${next.listings.length} pairs`)
    })().catch((error: unknown) => {
      log.warn?.(`[markets] catalog refresh failed: ${messageOf(error)}`)
    }).finally(() => { refreshing = undefined })
    return refreshing
  }

  // CoinGecko: one shared copy for all users, with the last good copy served if CoinGecko is down.
  const gecko: Record<string, CacheSlot<unknown>> = { global: { at: 0, data: undefined, inflight: undefined }, markets: { at: 0, data: undefined, inflight: undefined } }
  async function coingecko(name: string): Promise<unknown> {
    const slot = gecko[name]
    const url = (COINGECKO as Record<string, string | undefined>)[name]
    if (!url) throw new Error('unknown dataset')
    if (slot.data && Date.now() - slot.at < COINGECKO_TTL_MS) return slot.data
    slot.inflight ??= getJson(url)
      .then((data) => { slot.data = data; slot.at = Date.now(); return data })
      .catch((error) => {
        if (slot.data) return slot.data
        throw error
      })
      .finally(() => { slot.inflight = undefined })
    return slot.inflight
  }

  // Market caps: two CoinGecko pages every 30 minutes at most, shared by everyone; a missing page keeps the rest.
  const caps: CacheSlot<MarketCap[]> = { at: 0, data: undefined, inflight: undefined }
  async function marketCaps(): Promise<MarketCap[]> {
    if (caps.data && Date.now() - caps.at < CAPS_TTL_MS) return caps.data
    caps.inflight ??= (async () => {
      const pages: unknown[] = []
      for (const url of COINGECKO_CAP_PAGES) {
        try { pages.push(await getJson(url)) } catch (error) { if (pages.length === 0) throw error }
      }
      caps.data = compactMarketCaps(pages)
      caps.at = Date.now()
      return caps.data
    })()
      .catch((error) => {
        if (caps.data) return caps.data
        throw error
      })
      .finally(() => { caps.inflight = undefined })
    return caps.inflight
  }

  let timer: NodeJS.Timeout | undefined
  return {
    marketCaps,
    start() {
      void refreshCatalog()
      timer = setInterval(() => void refreshCatalog(), CATALOG_REFRESH_MS)
      timer.unref()
    },
    stop() { clearInterval(timer) },
    refreshCatalog,
    getCatalog: () => catalog,
    /** Where a symbol trades, or undefined when it is not a listed pair (for example an index like BTC.D). */
    exchangeOf(symbol: string): string | undefined {
      if (FUTURES_SYMBOLS.has(symbol)) return 'binance-futures'
      const listed = bySymbol.get(symbol)
      if (listed) return listed.exchange ?? 'binance'
      // Plain perpetuals ("XXXUSDT.P") trade on Binance Futures even before the catalog has loaded.
      if (typeof symbol === 'string' && symbol.endsWith('.P') && SYMBOL.test(symbol.slice(0, -2))) return 'binance-futures'
      return undefined
    },
    /** The exchange's own symbol for one of ours ("OKX:BTCUSDT" -> "BTC-USDT", "BYBIT:SOLUSDT.P" -> "SOLUSDT"). */
    apiSymbolOf(symbol: string): string {
      return bySymbol.get(symbol)?.apiSymbol ?? String(symbol).replace(/^[A-Z]+:/, '').replace(/\.P$/, '')
    },
    coingecko,
  }
}

export type MarketService = ReturnType<typeof createMarketService>
