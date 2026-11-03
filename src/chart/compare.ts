// Compare (TradingView's "Compare symbol"): other symbols drawn over the chart, starting from the same point at the
// first candle on screen, so on the percent scale every line reads as its own % change over the visible period.

export const MAX_COMPARE = 3
export const COMPARE_COLORS = ['#ff9800', '#e91e63', '#00bcd4'] as const

export interface CompareBar { readonly timestamp: number, readonly close: number }

/** Close of the compare candle that contains `timestamp` (the last one opening at or before it). */
export function closeAt(bars: readonly CompareBar[], timestamp: number): number | undefined {
  if (bars.length === 0 || bars[0].timestamp > timestamp) return undefined
  let low = 0
  let high = bars.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (bars[middle].timestamp <= timestamp) low = middle
    else high = middle - 1
  }
  return bars[low].close
}

/**
 * The compare closes for main candles `from`..`to` (exclusive), scaled so the first one with a value equals the main
 * close there. Undefined where the compare symbol has no data yet.
 */
export function scaledCompare(
  mainBars: ReadonlyArray<{ readonly timestamp: number, readonly close: number }>,
  compare: readonly CompareBar[],
  from: number,
  to: number,
): Array<number | undefined> {
  const raw: Array<number | undefined> = []
  for (let index = from; index < to; index += 1) raw.push(mainBars[index] ? closeAt(compare, mainBars[index].timestamp) : undefined)
  const baseOffset = raw.findIndex((value) => value !== undefined && value > 0)
  if (baseOffset < 0) return raw.map(() => undefined)
  const factor = mainBars[from + baseOffset].close / raw[baseOffset]!
  return raw.map((value) => (value === undefined ? undefined : value * factor))
}

/** % change of the compare symbol from the first visible candle to the last. */
export function compareChange(
  mainBars: ReadonlyArray<{ readonly timestamp: number }>,
  compare: readonly CompareBar[],
  from: number,
  to: number,
): number | undefined {
  let first: number | undefined
  let last: number | undefined
  for (let index = from; index < to; index += 1) {
    const value = mainBars[index] ? closeAt(compare, mainBars[index].timestamp) : undefined
    if (value === undefined) continue
    first ??= value
    last = value
  }
  return first && last !== undefined ? ((last - first) / first) * 100 : undefined
}

export function normalizeCompare(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && /^[A-Z0-9.]{2,32}$/.test(item)))].slice(0, MAX_COMPARE)
}
