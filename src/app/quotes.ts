import { dominanceCandles, fetchDominancePage, loadDominanceWeights } from '../chart/dominance'
import type { CryptoMarket } from '../chart/markets'
import type { WatchQuote } from './watchlists'

// Latest price and 24h change for the watchlist. One request per exchange (or per symbol where
// the exchange has no batch call); every request is a plain public GET with no keys.

const BINANCE_TICKER = 'https://data-api.binance.vision/api/v3/ticker/24hr'
const FUTURES_TICKER = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
const BYBIT_TICKERS = 'https://api.bybit.com/v5/market/tickers'

type Quotes = Record<string, WatchQuote>

function num(value: unknown): number | undefined {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`Quote request failed (${response.status})`)
  return response.json()
}

async function binanceSpot(symbols: readonly string[], signal?: AbortSignal): Promise<Quotes> {
  if (symbols.length === 0) return {}
  const rows = await getJson(`${BINANCE_TICKER}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, signal)
  const quotes: Quotes = {}
  for (const row of Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []) {
    const last = num(row.lastPrice)
    const change = num(row.priceChange)
    const changePercent = num(row.priceChangePercent)
    if (typeof row.symbol === 'string' && last !== undefined && change !== undefined && changePercent !== undefined) {
      quotes[row.symbol] = { last, change, changePercent }
    }
  }
  return quotes
}

async function binanceFutures(symbols: readonly string[], signal?: AbortSignal): Promise<Quotes> {
  const quotes: Quotes = {}
  await Promise.all(symbols.map(async (symbol) => {
    const row = await getJson(`${FUTURES_TICKER}?symbol=${encodeURIComponent(symbol)}`, signal) as Record<string, unknown>
    const last = num(row.lastPrice)
    const change = num(row.priceChange)
    const changePercent = num(row.priceChangePercent)
    if (last !== undefined && change !== undefined && changePercent !== undefined) quotes[symbol] = { last, change, changePercent }
  }))
  return quotes
}

async function bybitSpot(symbols: readonly string[], signal?: AbortSignal): Promise<Quotes> {
  const quotes: Quotes = {}
  await Promise.all(symbols.map(async (symbol) => {
    const payload = await getJson(`${BYBIT_TICKERS}?category=spot&symbol=${encodeURIComponent(symbol)}`, signal) as {
      result?: { list?: Array<Record<string, unknown>> }
    }
    const row = payload.result?.list?.[0]
    const last = num(row?.lastPrice)
    const previous = num(row?.prevPrice24h)
    if (last !== undefined && previous !== undefined && previous > 0) {
      quotes[symbol] = { last, change: last - previous, changePercent: ((last - previous) / previous) * 100 }
    }
  }))
  return quotes
}

/** Live quotes for exchange-traded symbols. A failing exchange only leaves its own symbols without a quote. */
export async function fetchExchangeQuotes(markets: readonly CryptoMarket[], signal?: AbortSignal): Promise<Quotes> {
  const symbolsOn = (exchange: CryptoMarket['exchange']) => markets
    .filter((market) => market.kind !== 'dominance' && market.exchange === exchange)
    .map((market) => market.symbol)
  const settled = await Promise.allSettled([
    binanceSpot(symbolsOn('binance'), signal),
    binanceFutures(symbolsOn('binance-futures'), signal),
    bybitSpot(symbolsOn('bybit'), signal),
  ])
  return Object.assign({}, ...settled.map((result) => (result.status === 'fulfilled' ? result.value : {}))) as Quotes
}

/** Dominance and market-cap indices: latest daily value against the previous daily close. */
export async function fetchIndexQuotes(markets: readonly CryptoMarket[]): Promise<Quotes> {
  const indices = markets.filter((market) => market.kind === 'dominance' && market.dominanceKey)
  if (indices.length === 0) return {}
  const weights = await loadDominanceWeights()
  const page = await fetchDominancePage(weights, '1d', { limit: 3 })
  const quotes: Quotes = {}
  for (const market of indices) {
    const bars = dominanceCandles(page.rows, market.dominanceKey!)
    const latest = bars.at(-1)
    const previous = bars.at(-2)
    if (!latest) continue
    const base = previous?.close ?? latest.open
    quotes[market.symbol] = { last: latest.close, change: latest.close - base, changePercent: base === 0 ? 0 : ((latest.close - base) / base) * 100 }
  }
  return quotes
}
