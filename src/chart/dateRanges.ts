// Date-range buttons under the chart (TradingView's 1D 5D 1M … All). Each picks a timeframe whose candles for that
// period fit in one history page (1,000 candles), then the chart is zoomed so the whole period is on screen.
import type { MarketInterval } from '../market'
import { zoneOffsetMinutes } from './timeAxis'

const DAY_MS = 86_400_000

export interface DateRange {
  readonly key: string
  readonly title: string
  readonly interval: MarketInterval
  /** Length in days; undefined for "year to date" and "all". */
  readonly days?: number
}

export const DATE_RANGES: readonly DateRange[] = [
  { key: '1D', title: '1 day in 5 minute intervals', interval: '5m', days: 1 },
  { key: '5D', title: '5 days in 15 minute intervals', interval: '15m', days: 5 },
  { key: '1M', title: '1 month in 1 hour intervals', interval: '1h', days: 30 },
  { key: '3M', title: '3 months in 4 hour intervals', interval: '4h', days: 91 },
  { key: '6M', title: '6 months in 12 hour intervals', interval: '12h', days: 182 },
  { key: 'YTD', title: 'Year to date in 1 day intervals', interval: '1d' },
  { key: '1Y', title: '1 year in 1 day intervals', interval: '1d', days: 365 },
  { key: '5Y', title: '5 years in 1 week intervals', interval: '1w', days: 1826 },
  { key: 'All', title: 'All data in 1 month intervals', interval: '1M' },
]

/** Start of a range ending now. */
export function rangeStart(range: DateRange, now: number): number {
  if (range.days !== undefined) return now - range.days * DAY_MS
  if (range.key === 'YTD') return Date.UTC(new Date(now).getUTCFullYear(), 0, 1)
  return 0
}

/** A wall-clock date and time ("2026-11-02T13:45" from a date input) in `timeZone`, as a timestamp. */
export function zonedInputToTime(value: string, timeZone: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour = '0', minute = '0'] = match
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  if (!Number.isFinite(wall)) return undefined
  // The offset at the wall time itself is close enough to find the real instant; one correction covers DST edges.
  const first = wall - zoneOffsetMinutes(wall, timeZone) * 60_000
  return wall - zoneOffsetMinutes(first, timeZone) * 60_000
}
