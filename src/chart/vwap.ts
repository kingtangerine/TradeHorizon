// Volume-weighted average price. The running average restarts at the start of each anchor period (UTC),
// so "VWAP" shows each day's average price paid, and "QVWAP" the average price paid since the start of the quarter.

export const VWAP_ANCHORS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type VwapAnchor = (typeof VWAP_ANCHORS)[number]

export const VWAP_ANCHOR_LABELS: Readonly<Record<VwapAnchor, string>> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
}

export interface VwapBar {
  readonly timestamp: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume?: number
}

const DAY_MS = 86_400_000

/** The start (UTC) of the anchor period that contains `timestamp`. Weeks start on Monday. */
export function anchorStart(timestamp: number, anchor: VwapAnchor): number {
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  switch (anchor) {
    case 'day':
      return Math.floor(timestamp / DAY_MS) * DAY_MS
    case 'week': {
      const dayStart = Math.floor(timestamp / DAY_MS) * DAY_MS
      const sinceMonday = (date.getUTCDay() + 6) % 7
      return dayStart - sinceMonday * DAY_MS
    }
    case 'month':
      return Date.UTC(year, month, 1)
    case 'quarter':
      return Date.UTC(year, month - (month % 3), 1)
    case 'year':
      return Date.UTC(year, 0, 1)
  }
}

/**
 * VWAP for every bar: the sum of (typical price x volume) divided by the sum of volume since the period began.
 * A bar with no volume so far in the period has no value.
 */
export function computeVwap(bars: readonly VwapBar[], anchor: VwapAnchor): Array<number | undefined> {
  let period = Number.NaN
  let priceVolume = 0
  let volume = 0
  return bars.map((bar) => {
    const start = anchorStart(bar.timestamp, anchor)
    if (start !== period) {
      period = start
      priceVolume = 0
      volume = 0
    }
    const traded = bar.volume ?? 0
    if (traded > 0) {
      priceVolume += ((bar.high + bar.low + bar.close) / 3) * traded
      volume += traded
    }
    return volume > 0 ? priceVolume / volume : undefined
  })
}
