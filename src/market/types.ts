import type { MarketInterval } from './intervals'

/** Symbol used when no market is specified. */
export const DEFAULT_BINANCE_SPOT_SYMBOL = 'BTCUSDT' as const

/** The exchanges a MarketId can name. */
export type MarketExchange = 'binance' | 'bybit'
/** Market key such as "binance:spot:BTCUSDT"; drawings and candle caches are keyed by it. */
export type MarketId = `${MarketExchange}:spot:${string}`

/**
 * Prices and quantities stay as strings at the market-data boundary so that
 * JavaScript does not silently round exchange values before the chart needs
 * them as numbers.
 */
export interface Candle {
  marketId: MarketId
  symbol: string
  interval: MarketInterval
  openTimeMs: number
  closeTimeMs: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  quoteVolume: string
  tradeCount: number
  takerBuyBaseVolume: string
  takerBuyQuoteVolume: string
  isFinal: boolean
  eventTimeMs?: number
}

/** Trims and uppercases a symbol ("btcusdt" -> "BTCUSDT"); throws TypeError unless it is 2-30 letters or digits. */
export function normalizeBinanceSpotSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase()

  if (!/^[A-Z0-9]{2,30}$/.test(normalized)) {
    throw new TypeError(`Invalid Binance spot symbol: ${symbol}`)
  }

  return normalized
}

/** Builds the MarketId of a symbol on an exchange; throws TypeError for an invalid symbol. */
export function marketIdFor(symbol: string, exchange: MarketExchange = 'binance'): MarketId {
  return `${exchange}:spot:${normalizeBinanceSpotSymbol(symbol)}`
}

/** Unique cache key of a candle: market id, interval and open time. */
export function candleKey(candle: Pick<Candle, 'marketId' | 'interval' | 'openTimeMs'>): string {
  return `${candle.marketId}:${candle.interval}:${candle.openTimeMs}`
}
