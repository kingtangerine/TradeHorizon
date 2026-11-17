import type { Period } from 'klinecharts'
import type { MarketInterval } from '../market'

/** Timeframes shown as buttons in the toolbar. */
export const DISPLAY_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const satisfies readonly MarketInterval[]

const PERIODS: Readonly<Record<MarketInterval, Period>> = {
  '1m': { type: 'minute', span: 1 },
  '3m': { type: 'minute', span: 3 },
  '5m': { type: 'minute', span: 5 },
  '15m': { type: 'minute', span: 15 },
  '30m': { type: 'minute', span: 30 },
  '1h': { type: 'hour', span: 1 },
  '2h': { type: 'hour', span: 2 },
  '4h': { type: 'hour', span: 4 },
  '6h': { type: 'hour', span: 6 },
  '8h': { type: 'hour', span: 8 },
  '12h': { type: 'hour', span: 12 },
  '1d': { type: 'day', span: 1 },
  '3d': { type: 'day', span: 3 },
  '1w': { type: 'week', span: 1 },
  '1M': { type: 'month', span: 1 },
}

/** The klinecharts period for a market interval. */
export function intervalToPeriod(interval: MarketInterval): Period {
  return { ...PERIODS[interval] }
}

/** The market interval for a klinecharts period, or null when there is none. */
export function periodToInterval(period: Period): MarketInterval | null {
  for (const [interval, candidate] of Object.entries(PERIODS) as Array<[MarketInterval, Period]>) {
    if (candidate.type === period.type && candidate.span === period.span) {
      return interval
    }
  }

  return null
}
