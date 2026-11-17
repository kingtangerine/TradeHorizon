/**
 * Pure drawing geometry in market space (time in ms, price as a number).
 * Nothing here knows about pixels except through the converters passed in.
 */
export interface ChartPoint {
  readonly timestamp: number
  readonly value: number
}

/** Open, high, low and close of a candle, used when snapping points to a candle. */
export interface CandleLevels {
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
}

/** Side of a position drawing. */
export type PositionDirection = 'long' | 'short'

/** Default Fibonacci retracement levels, as fractions of the move. */
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
export function translatePoints(points: readonly ChartPoint[], deltaTimeMs: number, deltaValue: number): ChartPoint[] {
  return points.map((point) => ({
    timestamp: Math.max(0, Math.round(point.timestamp + deltaTimeMs)),
    value: point.value + deltaValue,
  }))
}

/** Shift-constrained placement: keep the dominant screen axis and flatten the other. */
export function lockToAxis(start: ChartPoint, current: ChartPoint, screenDelta: { readonly dx: number; readonly dy: number }): ChartPoint {
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

/** Size of a position box placed with a plain click. */
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

  const farTime = pointer && pointer.timestamp !== entry.timestamp ? pointer.timestamp : entry.timestamp + defaults.timeSpanMs

  return [entry, { timestamp: farTime, value: Math.max(0, targetValue) }, { timestamp: farTime, value: Math.max(0, stopValue) }]
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

/** A DCA price between entry and stop (the buy region); the midpoint by default. */
export function clampDcaPrice(entry: number, stop: number, dca?: number): number {
  const low = Math.min(entry, stop)
  const high = Math.max(entry, stop)
  return Math.min(high, Math.max(low, dca ?? (entry + stop) / 2))
}

/** Drawings that cover an area: a click anywhere inside them lands on them. */
const AREA_DRAWINGS = new Set([
  'rectangle',
  'fibRetracement',
  'longPosition',
  'shortPosition',
  'priceRange',
  'ellipse',
  'parallelChannel',
  'pitchfork',
  'fibExtension',
  'dateRange',
  'datePriceRange',
])

/** The parts of a drawing stackLevels needs: id, type and anchors (time in ms, price). */
export interface StackableDrawing {
  readonly id: string
  readonly type: string
  readonly anchors: ReadonlyArray<{ readonly timeMs: number; readonly price: string | number }>
}

function marketArea(drawing: StackableDrawing): number {
  const times = drawing.anchors.map((anchor) => anchor.timeMs)
  const prices = drawing.anchors.map((anchor) => Number(anchor.price))
  return (Math.max(...times) - Math.min(...times)) * (Math.max(...prices) - Math.min(...prices))
}

/**
 * Stacking order (klinecharts zLevel, higher = on top and first to receive clicks) for drawings.
 * Bigger areas go below smaller ones, so a box inside another box can always be clicked; lines and text,
 * which are thin, go above every area. Areas are measured in time x price, so zooming never reorders them.
 */
export function stackLevels(drawings: readonly StackableDrawing[]): Map<string, number> {
  const areas = drawings
    .filter((drawing) => AREA_DRAWINGS.has(drawing.type))
    .map((drawing) => ({ id: drawing.id, area: marketArea(drawing) }))
    .sort((a, b) => b.area - a.area)
  const levels = new Map<string, number>()
  areas.forEach((item, index) => levels.set(item.id, index + 1))
  let next = areas.length + 1
  for (const drawing of drawings) if (!levels.has(drawing.id)) levels.set(drawing.id, next++)
  return levels
}

// --- Wave 3 drawing tools ------------------------------------------------------------------------------------------

/** Trend-based Fibonacci extension levels (TradingView's defaults). */
export const FIB_EXTENSION_LEVELS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618] as const

/** Price of an extension level: the move from point 1 to 2, projected from point 3. */
export function fibExtensionPrice(first: number, second: number, third: number, level: number): number {
  return third + (second - first) * level
}

interface Pixel {
  readonly x: number
  readonly y: number
}

/** The point where the line from `from` through `to` reaches x = `toX` (a ray drawn to the chart's right edge). */
export function extendLine(from: Pixel, to: Pixel, toX: number): Pixel {
  if (to.x === from.x) return { x: to.x, y: to.y }
  const slope = (to.y - from.y) / (to.x - from.x)
  return { x: toX, y: from.y + slope * (toX - from.x) }
}

/** Parallel channel: the second line goes through the third point, at the same slope as the first. */
export function parallelOffset(first: Pixel, second: Pixel, third: Pixel): number {
  if (second.x === first.x) return third.y - first.y
  const onLine = first.y + ((second.y - first.y) * (third.x - first.x)) / (second.x - first.x)
  return third.y - onLine
}

/** Andrews' pitchfork: the median runs from point 1 through the middle of points 2 and 3. */
export function pitchforkMedian(first: Pixel, second: Pixel, third: Pixel): { readonly from: Pixel; readonly through: Pixel } {
  return { from: first, through: { x: (second.x + third.x) / 2, y: (second.y + third.y) / 2 } }
}

/** Polygon approximating the ellipse inside the box of two corners. */
export function ellipsePolygon(a: Pixel, b: Pixel, segments = 48): Pixel[] {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const rx = Math.abs(b.x - a.x) / 2
  const ry = Math.abs(b.y - a.y) / 2
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
  })
}

/** "3d 4h", "2h 15m", "45m" */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
  return `${rest}m`
}

/** Bars and time between two moments, for the date range tools. */
export function rangeSummary(startMs: number, endMs: number, intervalMs: number): string {
  const bars = intervalMs > 0 ? Math.round(Math.abs(endMs - startMs) / intervalMs) : 0
  return `${bars} bar${bars === 1 ? '' : 's'}, ${formatDuration(endMs - startMs)}`
}

/** Keeps a freehand stroke light: drops points closer than `minDistance` px to the last kept one, at most `max`. */
export function thinStroke<T extends Pixel>(points: readonly T[], minDistance: number, max = 400): T[] {
  const kept: T[] = []
  for (const point of points) {
    const last = kept[kept.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) kept.push(point)
  }
  if (kept.length <= max) return kept
  const step = kept.length / max
  return Array.from({ length: max }, (_, index) => kept[Math.min(kept.length - 1, Math.round(index * step))])
}
