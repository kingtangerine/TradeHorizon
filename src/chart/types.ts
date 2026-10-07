import type { Candle, MarketInterval } from '../market'

export type ChartConnectionState =
  | 'loading'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error'

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

export type DominanceStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ChartType = 'candles' | 'line'

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
