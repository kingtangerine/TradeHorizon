import type { Candle, MarketInterval } from '../market'

/** State of the chart's data feed. */
export type ChartConnectionState = 'loading' | 'connecting' | 'live' | 'reconnecting' | 'error'

/** The latest candle as shown in the header; changePercent is the candle's own change in percent. */
export interface ChartQuote {
  open: number
  high: number
  low: number
  close: number
  volume: number
  changePercent: number
  isFinal: boolean
  updatedAtMs: number
}

/** Loading state of the dominance data. */
export type DominanceStatus = 'idle' | 'loading' | 'ready' | 'error'

export type { ChartType } from './chartTypes'

/** Bar replay state of a chart. */
export interface ReplayState {
  /** "picking" while the user chooses the bar to start from. */
  status: 'picking' | 'active'
  playing: boolean
  /** Milliseconds between bars while playing. */
  speedMs: number
  /** Open time of the newest bar currently revealed. */
  timeMs: number | null
  atEnd: boolean
}

/** Chart state reported to the app: interval, feed state, latest quote, error and replay. */
export interface ChartRuntimeState {
  interval: MarketInterval
  connection: ChartConnectionState
  quote: ChartQuote | null
  error: string | null
  followingLive: boolean
  dominance?: DominanceStatus
  dominanceError?: string | null
  replay?: ReplayState | null
}

/** The header quote for a candle; changePercent is close versus open in percent (0 when open is 0). */
export function candleToQuote(candle: Candle): ChartQuote {
  const open = Number(candle.open)
  const close = Number(candle.close)

  return {
    open,
    high: Number(candle.high),
    low: Number(candle.low),
    close,
    volume: Number(candle.volume),
    changePercent: open === 0 ? 0 : ((close - open) / open) * 100,
    isFinal: candle.isFinal,
    updatedAtMs: candle.eventTimeMs ?? Date.now(),
  }
}
