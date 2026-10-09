import { registerIndicator, type KLineData } from 'klinecharts'
import {
  BITCOIN_PRICE_SYMBOL,
  computeDominanceRows,
  dominancePriceSymbols,
  fetchBinanceKlines,
  fetchDominanceWeights,
  referencePrices,
  type DominanceRow,
  type DominanceWeights,
  type IndexKey,
  type MarketInterval,
  type PriceBar,
} from '../market'
import { DOMINANCE_LABELS, type DominanceKey } from './indicators'
import { allMarkets } from './markets'

const WEIGHTS_CACHE_KEY = 'trade-horizon:dominance-weights:v2'
const WEIGHTS_TTL_MS = 30 * 60 * 1000
const PAGE_SIZE = 1000

export const DOMINANCE_KEYS: readonly DominanceKey[] = ['btc', 'usdt', 'alt']

let inflightWeights: Promise<DominanceWeights> | undefined
let registered = false

export function dominanceIndicatorName(key: DominanceKey): string {
  return DOMINANCE_LABELS[key]
}

export function registerDominanceIndicators(): void {
  if (registered) return
  registered = true
  for (const key of DOMINANCE_KEYS) {
    const label = DOMINANCE_LABELS[key]
    registerIndicator({
      name: label,
      shortName: label,
      precision: 2,
      figures: [{ key: 'value', title: 'Dominance: ', type: 'line' }],
      calc: (dataList: KLineData[]) => dataList.map(() => ({})),
    })
  }
}

/** Indicator values for candles that share the rows' timeframe; other candles stay empty. */
export function dominanceCalc(key: DominanceKey, rows: readonly DominanceRow[]) {
  const byTime = new Map(rows.map((row) => [row.timestamp, row.close[key]]))
  return (dataList: KLineData[]) => dataList.map((item) => {
    const value = byTime.get(item.timestamp)
    return value === undefined ? {} : { value }
  })
}

export function dominanceCandles(rows: readonly DominanceRow[], key: IndexKey): KLineData[] {
  return rows.map((row) => {
    const open = row.open[key]
    const close = row.close[key]
    return {
      timestamp: row.timestamp,
      open,
      high: Math.max(row.high[key], open, close),
      low: Math.min(row.low[key], open, close),
      close,
      volume: 0,
    }
  })
}

function readCachedWeights(): DominanceWeights | null {
  try {
    const value = JSON.parse(localStorage.getItem(WEIGHTS_CACHE_KEY) ?? 'null') as Partial<DominanceWeights> | null
    if (
      !value ||
      typeof value.fetchedAtMs !== 'number' ||
      !(typeof value.totalCap === 'number' && value.totalCap > 0) ||
      !(typeof value.bitcoinCap === 'number' && value.bitcoinCap > 0) ||
      !(typeof value.tetherCap === 'number' && value.tetherCap > 0) ||
      typeof value.stableCap !== 'number' ||
      typeof value.ethereumCap !== 'number' ||
      typeof value.topTen !== 'object' || value.topTen === null ||
      typeof value.tailCap !== 'number' ||
      typeof value.trackedCaps !== 'object' || value.trackedCaps === null
    ) return null
    return value as DominanceWeights
  } catch {
    return null
  }
}

/** Today's market caps, cached for half an hour. Falls back to an older copy when CoinGecko is unreachable. */
export function loadDominanceWeights(): Promise<DominanceWeights> {
  const cached = readCachedWeights()
  if (cached && Date.now() - cached.fetchedAtMs < WEIGHTS_TTL_MS) return Promise.resolve(cached)
  if (inflightWeights) return inflightWeights

  const symbols = new Set(allMarkets().filter((item) => item.kind === 'spot').map((item) => item.symbol))
  inflightWeights = fetchDominanceWeights(symbols, { cachedBase: '/api/cg' })
    .then((weights) => {
      try {
        localStorage.setItem(WEIGHTS_CACHE_KEY, JSON.stringify(weights))
      } catch {
        // Keep working for this session when storage is full.
      }
      return weights
    })
    .catch((error: unknown) => {
      if (cached) return cached
      throw error
    })
    .finally(() => {
      inflightWeights = undefined
    })
  return inflightWeights
}

export interface DominancePage {
  rows: DominanceRow[]
  /** Prices at the moment the weights were captured; reuse it when paging further back. */
  reference: Record<string, number>
  hasMore: boolean
}

export async function fetchDominancePage(
  weights: DominanceWeights,
  interval: MarketInterval,
  options: { limit?: number; endTimeMs?: number; reference?: Record<string, number> } = {},
): Promise<DominancePage> {
  const limit = options.limit ?? PAGE_SIZE
  const entries = await Promise.all(dominancePriceSymbols(weights).map(async (symbol) => {
    try {
      const candles = await fetchBinanceKlines({
        symbol,
        interval,
        limit,
        ...(options.endTimeMs === undefined ? {} : { endTimeMs: options.endTimeMs }),
      })
      const bars: PriceBar[] = candles.map((candle) => ({
        timestamp: candle.openTimeMs,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }))
      return [symbol, bars] as const
    } catch (error) {
      // Bitcoin is the time grid; any other coin that fails just joins the untracked remainder.
      if (symbol === BITCOIN_PRICE_SYMBOL) throw error
      return [symbol, [] as PriceBar[]] as const
    }
  }))

  const bars = Object.fromEntries(entries)
  const reference = options.reference ?? referencePrices(bars, weights.fetchedAtMs)
  return {
    rows: computeDominanceRows(weights, bars, reference),
    reference,
    hasMore: (bars[BITCOIN_PRICE_SYMBOL]?.length ?? 0) === limit,
  }
}
