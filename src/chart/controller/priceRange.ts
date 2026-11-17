import { scaledCompare } from '../compare'
import type { CompareSeries } from '../compareOverlay'
import type { ScaleMode } from './types'

/** A price-axis range the way klinecharts' createRange hook takes and returns it. */
export interface PriceAxisRange {
  from: number
  to: number
  range: number
  realFrom: number
  realTo: number
  realRange: number
  displayFrom: number
  displayTo: number
  displayRange: number
}

/**
 * The price range shown for a zoom `scale` (1 is the automatic fit, above 1 zooms out) and vertical `offset` (a fraction of
 * the automatic range), expressed the way the axis of `scaleMode` expects. `percentBase` is only read on the percent scale.
 */
export function priceViewRange(
  defaultRange: PriceAxisRange,
  scale: number,
  offset: number,
  scaleMode: ScaleMode,
  percentBase: () => number | undefined,
): PriceAxisRange {
  const k = scale
  const shift = offset
  const grow = (from: number, to: number): [number, number] => {
    if (k === 1 && shift === 0) return [from, to]
    const middle = (from + to) / 2 + shift * (to - from)
    const half = ((to - from) / 2) * k
    return [middle - half, middle + half]
  }
  if (scaleMode !== 'normal') {
    // Log and percent scales (bottom bar): zoom in price, then express the range the way that axis expects.
    const [rawFrom, to] = grow(defaultRange.from, defaultRange.to)
    let from = rawFrom
    if (scaleMode === 'log') {
      from = Math.max(from, to * 1e-4, Number.MIN_VALUE)
      const realFrom = Math.log10(from)
      const realTo = Math.log10(Math.max(to, from * 1.0001))
      return {
        from,
        to,
        range: to - from,
        realFrom,
        realTo,
        realRange: realTo - realFrom,
        displayFrom: from,
        displayTo: to,
        displayRange: to - from,
      }
    }
    const base = percentBase()
    if (!base) return defaultRange
    const realFrom = ((from - base) / base) * 100
    const realTo = ((to - base) / base) * 100
    return {
      from,
      to,
      range: to - from,
      realFrom,
      realTo,
      realRange: realTo - realFrom,
      displayFrom: realFrom,
      displayTo: realTo,
      displayRange: realTo - realFrom,
    }
  }
  if (k === 1 && shift === 0) return defaultRange
  const [from, to] = grow(defaultRange.from, defaultRange.to)
  const [realFrom, realTo] = grow(defaultRange.realFrom, defaultRange.realTo)
  const [displayFrom, displayTo] = grow(defaultRange.displayFrom, defaultRange.displayTo)
  return {
    from,
    to,
    range: to - from,
    realFrom,
    realTo,
    realRange: realTo - realFrom,
    displayFrom,
    displayTo,
    displayRange: displayTo - displayFrom,
  }
}

/** `range` widened (with 4% padding) to fit the compare lines over the candles `from` to `to`; the same object when they already fit. */
export function rangeWithCompareLines<T extends PriceAxisRange>(
  range: T,
  series: readonly CompareSeries[],
  data: ReadonlyArray<{ readonly timestamp: number; readonly close: number }>,
  from: number,
  to: number,
): T {
  let low = range.from
  let high = range.to
  for (const item of series) {
    for (const value of scaledCompare(data, item.bars, from, to)) {
      if (value === undefined) continue
      if (value < low) low = value
      if (value > high) high = value
    }
  }
  if (low === range.from && high === range.to) return range
  const pad = (high - low) * 0.04
  low = Math.min(range.from, low - pad)
  high = Math.max(range.to, high + pad)
  return {
    ...range,
    from: low,
    to: high,
    range: high - low,
    realFrom: low,
    realTo: high,
    realRange: high - low,
    displayFrom: low,
    displayTo: high,
    displayRange: high - low,
  }
}
