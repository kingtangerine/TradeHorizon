// Chart styles offered in the toolbar, as in TradingView. Bars, candles, hollow candles, line and area are drawn by
// klinecharts itself; Heikin Ashi and baseline are drawn by our own series indicator (seriesOverlay.ts) over hidden candles.

export const CHART_TYPES = ['bars', 'candles', 'hollow', 'heikinAshi', 'line', 'area', 'baseline'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const CHART_TYPE_LABELS: Readonly<Record<ChartType, string>> = {
  bars: 'Bars',
  candles: 'Candles',
  hollow: 'Hollow candles',
  heikinAshi: 'Heikin Ashi',
  line: 'Line',
  area: 'Area',
  baseline: 'Baseline',
}

export function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value)
}

export interface OhlcBar {
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
}

/**
 * Heikin Ashi candles: close = average of OHLC, open = midpoint of the previous HA candle's body (the first one starts
 * at the midpoint of its own open and close), high/low include the HA open and close.
 */
export function heikinAshi(bars: readonly OhlcBar[]): OhlcBar[] {
  const result: OhlcBar[] = []
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]
    const close = (bar.open + bar.high + bar.low + bar.close) / 4
    const previous = result[index - 1]
    const open = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2
    result.push({ open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) })
  }
  return result
}

/** TradingView's baseline sits at the middle of the visible price range unless moved; we use the middle of the closes. */
export function baselineLevel(closes: readonly number[]): number | undefined {
  if (closes.length === 0) return undefined
  let low = Infinity
  let high = -Infinity
  for (const close of closes) {
    if (close < low) low = close
    if (close > high) high = close
  }
  return (low + high) / 2
}
