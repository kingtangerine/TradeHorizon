// One entry point for a market's candles, whatever exchange it trades on (the chart, compare and backfills use it).
import { BINANCE_FUTURES_REST_ENDPOINT, fetchBinanceKlines } from './binance/rest'
import { BINANCE_FUTURES_WS_ENDPOINT, BinanceKlineSubscription, type KlineStreamStatus } from './binance/stream'
import { exchangeSymbol } from './binance/futures'
import { BybitKlineSubscription, fetchBybitKlines } from './bybit/bybit'
import type { MarketInterval } from './intervals'
import type { Candle } from './types'
import { PollingKlineSubscription, fetchVenueKlines, isPolledVenue, type PolledVenue } from './venues'

/** Every exchange a market can come from; the "-futures" variants are USDT perpetuals. */
export type ExchangeId = 'binance' | 'binance-futures' | 'bybit' | 'bybit-futures' | PolledVenue

/** All ExchangeId values. */
export const EXCHANGE_IDS: readonly ExchangeId[] = [
  'binance',
  'binance-futures',
  'bybit',
  'bybit-futures',
  'okx',
  'okx-futures',
  'bitget',
  'bitget-futures',
  'gate',
  'gate-futures',
]

/** What a data source needs to know about a market. */
export interface MarketSource {
  readonly symbol: string
  readonly exchange: ExchangeId
  readonly marketId: string
  /** The exchange's own symbol when it differs from ours (BTC-USDT, BTC_USDT); otherwise derived from `symbol`. */
  readonly apiSymbol?: string
}

/** A historical candle request: timeframe, count, and optional time bounds in ms epoch. */
export interface KlineRequest {
  readonly interval: MarketInterval
  readonly limit?: number
  readonly startTimeMs?: number
  readonly endTimeMs?: number
  readonly signal?: AbortSignal
}

/** Handle to a live candle feed: `stop()` ends it, `nudge(force)` replaces a dead (or, with force, any) connection. */
export interface KlineStream {
  stop(): void
  nudge(force?: boolean): void
}

/** "BYBIT:BTCUSDT.P" -> "BTCUSDT": our prefixes and the perpetual suffix are not part of the exchange's symbol. */
export function plainSymbol(market: MarketSource): string {
  return market.apiSymbol ?? exchangeSymbol(market.symbol.replace(/^[A-Z]+:/, ''))
}

/** Fetches historical candles, ascending, from whichever exchange the market trades on. Rejects with that venue's HTTP or parse errors. */
export function fetchMarketKlines(market: MarketSource, request: KlineRequest): Promise<Candle[]> {
  const symbol = plainSymbol(market)
  const options = {
    symbol,
    interval: request.interval,
    limit: request.limit,
    startTimeMs: request.startTimeMs,
    endTimeMs: request.endTimeMs,
    signal: request.signal,
  }
  switch (market.exchange) {
    case 'bybit':
      return fetchBybitKlines(options)
    case 'bybit-futures':
      return fetchBybitKlines({ ...options, category: 'linear' })
    case 'binance-futures':
      return fetchBinanceKlines({ ...options, endpoint: BINANCE_FUTURES_REST_ENDPOINT })
    case 'binance':
      return fetchBinanceKlines(options)
    default:
      if (!isPolledVenue(market.exchange)) return fetchBinanceKlines(options)
      return fetchVenueKlines({ venue: market.exchange, apiSymbol: symbol, symbol: market.symbol, marketId: market.marketId, ...request })
  }
}

/** Timeframe and callbacks for a live candle feed. */
export interface StreamOptions {
  readonly interval: MarketInterval
  onCandle(candle: Candle): void
  onStatus?(status: KlineStreamStatus): void
  onError?(error: Error): void
}

/** Starts a live candle feed on the market's exchange: WebSocket for Binance and Bybit, REST polling for the other venues. */
export function subscribeMarketKlines(market: MarketSource, options: StreamOptions): KlineStream {
  const symbol = plainSymbol(market)
  const base = { symbol, interval: options.interval, onCandle: options.onCandle, onStatus: options.onStatus, onError: options.onError }
  switch (market.exchange) {
    case 'bybit':
      return new BybitKlineSubscription(base)
    case 'bybit-futures':
      return new BybitKlineSubscription({ ...base, category: 'linear' })
    case 'binance-futures':
      return new BinanceKlineSubscription({ ...base, endpoint: BINANCE_FUTURES_WS_ENDPOINT })
    case 'binance':
      return new BinanceKlineSubscription(base)
    default:
      if (!isPolledVenue(market.exchange)) return new BinanceKlineSubscription(base)
      return new PollingKlineSubscription({
        venue: market.exchange,
        apiSymbol: symbol,
        symbol: market.symbol,
        marketId: market.marketId,
        ...options,
      })
  }
}
