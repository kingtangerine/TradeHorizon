/**
 * Pure drawing geometry in market space (time in ms, price as a number).
 * Nothing here knows about pixels except through the converters passed in.
 */
export interface ChartPoint {
  readonly timestamp: number
  readonly value: number
}

export interface CandleLevels {
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
}

export type PositionDirection = 'long' | 'short'

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618] as const

/** Eight handles clockwise from the top-left corner. */
export function rectanglePoints(a: ChartPoint, b: ChartPoint): ChartPoint[] {
  const left = Math.min(a.timestamp, b.timestamp)
  const right = Math.max(a.timestamp, b.timestamp)
  const middle = Math.round((left + right) / 2)
  const top = Math.max(a.value, b.value)
  const bottom = Math.min(a.value, b.value)
  const center = (top + bottom) / 2

  return [
    { timestamp: left, value: top },
    { timestamp: middle, value: top },
    { timestamp: right, value: top },
    { timestamp: right, value: center },
    { timestamp: right, value: bottom },
    { timestamp: middle, value: bottom },
    { timestamp: left, value: bottom },
    { timestamp: left, value: center },
  ]
}

/** Moves a whole drawing without re-snapping its anchors, so its shape survives any timeframe. */
export function translatePoints(
  points: readonly ChartPoint[],
  deltaTimeMs: number,
  deltaValue: number,
): ChartPoint[] {
  return points.map((point) => ({
    timestamp: Math.max(0, Math.round(point.timestamp + deltaTimeMs)),
    value: point.value + deltaValue,
  }))
}

/** Shift-constrained placement: keep the dominant screen axis and flatten the other. */
export function lockToAxis(
  start: ChartPoint,
  current: ChartPoint,
  screenDelta: { readonly dx: number; readonly dy: number },
): ChartPoint {
  return Math.abs(screenDelta.dx) >= Math.abs(screenDelta.dy)
    ? { timestamp: current.timestamp, value: start.value }
    : { timestamp: start.timestamp, value: current.value }
}

/**
 * Magnet: pull a price onto the candle's open, high, low or close when the
 * pointer is within `tolerancePx` of one of them on screen.
 */
export function magnetPrice(
  value: number,
  candle: CandleLevels | null | undefined,
  toPixel: (price: number) => number,
  tolerancePx: number,
): number {
  if (!candle) return value
  const y = toPixel(value)
  let best = value
  let bestDistance = tolerancePx
  for (const level of [candle.open, candle.high, candle.low, candle.close]) {
    const distance = Math.abs(toPixel(level) - y)
    if (distance <= bestDistance) {
      best = level
      bestDistance = distance
    }
  }
  return best
}

export interface PositionDefaults {
  /** Distance from entry to target used for a plain click. */
  readonly priceSpan: number
  /** Width of the position box used for a plain click. */
  readonly timeSpanMs: number
}

/**
 * Entry, target, stop for a long or short position.
 * A plain click (no pointer) gives a 2:1 box of default size. A drag makes the
 * release point the target when it is on the profit side, otherwise the stop,
 * and derives the other level at 2:1.
 */
export function positionPoints(
  direction: PositionDirection,
  entry: ChartPoint,
  pointer: ChartPoint | null,
  defaults: PositionDefaults,
): [ChartPoint, ChartPoint, ChartPoint] {
  const sign = direction === 'long' ? 1 : -1
  const delta = pointer ? pointer.value - entry.value : 0
  let targetValue = entry.value + sign * defaults.priceSpan
  let stopValue = entry.value - sign * (defaults.priceSpan / 2)

  if (pointer && delta !== 0) {
    if (delta * sign > 0) {
      targetValue = pointer.value
      stopValue = entry.value - delta / 2
    } else {
      stopValue = pointer.value
      targetValue = entry.value - delta * 2
    }
  }

  const farTime = pointer && pointer.timestamp !== entry.timestamp
    ? pointer.timestamp
    : entry.timestamp + defaults.timeSpanMs

  return [
    entry,
    { timestamp: farTime, value: Math.max(0, targetValue) },
    { timestamp: farTime, value: Math.max(0, stopValue) },
  ]
}

/** Keeps the target on the profit side of entry and the stop on the loss side. */
export function clampPositionLevels(
  direction: PositionDirection,
  entry: number,
  target: number,
  stop: number,
): { target: number; stop: number } {
  return direction === 'long'
    ? { target: Math.max(entry, target), stop: Math.min(entry, stop) }
    : { target: Math.min(entry, target), stop: Math.max(entry, stop) }
}

/** Price of a retracement level: 0 sits on the second point, 1 on the first. */
export function fibLevelPrice(first: number, second: number, level: number): number {
  return second + (first - second) * level
}
