import type { Chart, Coordinate, Point } from 'klinecharts'
import { magnetPrice, type ChartPoint } from '../geometry'
import { buildTimeTicks } from '../timeAxis'
import { MAGNET_TOLERANCE_PX } from './helpers'

/** Screen rectangle of the candle pane's drawing area. */
export function paneRect(chart: Chart): DOMRect | null {
  return chart.getDom('candle_pane', 'main')?.getBoundingClientRect() ?? null
}

/** True when a viewport point lies on the candle pane. */
export function insidePane(chart: Chart, clientX: number, clientY: number): boolean {
  const rect = paneRect(chart)
  return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}

/** True when a viewport point lies on the candle pane's price axis. */
export function onPriceAxis(chart: Chart, clientX: number, clientY: number): boolean {
  const rect = chart.getDom('candle_pane', 'yAxis')?.getBoundingClientRect()
  return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}

/** The pane Y of a price. */
export function priceToPixel(chart: Chart, price: number): number {
  return (chart.convertToPixel({ value: price }, { paneId: 'candle_pane' }) as Partial<Coordinate>).y ?? 0
}

/** Converts a pointer position to a bar-aligned market point, clamped to the price pane (snapped to the candle when `magnet`). */
export function pointAt(chart: Chart, clientX: number, clientY: number, magnet: boolean): ChartPoint | null {
  const rect = paneRect(chart)
  if (!rect) return null
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
  const y = Math.min(rect.height, Math.max(0, clientY - rect.top))
  const [raw] = chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
  if (raw?.timestamp === undefined || raw.value === undefined || !Number.isFinite(raw.value)) return null

  const candle = raw.dataIndex === undefined ? undefined : chart.getDataList()[raw.dataIndex]
  const value = magnet ? magnetPrice(raw.value, candle, (price) => priceToPixel(chart, price), MAGNET_TOLERANCE_PX) : raw.value
  return { timestamp: raw.timestamp, value }
}

/** Default size of a new position drawing (and the offset of a copied drawing): a share of the visible prices and candles. */
export function positionDefaults(chart: Chart, intervalMs: number): { priceSpan: number; timeSpanMs: number } {
  const rect = paneRect(chart)
  const [top, bottom] = chart.convertFromPixel([{ y: 0 }, { y: rect?.height ?? 0 }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
  const visiblePrice = Math.abs((top?.value ?? 0) - (bottom?.value ?? 0))
  const range = chart.getVisibleRange()
  const bars = Math.max(8, Math.round((range.realTo - range.realFrom) * 0.18))
  return { priceSpan: visiblePrice * 0.12, timeSpanMs: bars * intervalMs }
}

/** klinecharts' scrollToTimestamp puts the candle at the right edge; every caller here wants it in the middle. */
export function scrollToCentre(chart: Chart, host: HTMLElement, timestamp: number, animationDuration?: number): void {
  chart.scrollToTimestamp(timestamp)
  const width = chart.getSize('candle_pane', 'main')?.width ?? host.clientWidth
  chart.scrollByDistance(-width / 2, animationDuration)
}

/** Time-axis labels on round times in the user's zone (see timeAxis.ts), also over the empty space to the right. */
export function createTimeTicks(
  chart: Chart,
  timeZone: string,
  intervalMs: number,
  {
    range,
    defaultTicks,
  }: {
    range: { realFrom: number; realTo: number }
    defaultTicks: Array<{ coord: number; value: number | string; text: string }>
  },
) {
  const data = chart.getDataList()
  if (data.length === 0) return defaultTicks
  const last = data[data.length - 1]
  const bars: Array<{ index: number; timestamp: number }> = []
  for (let index = Math.max(0, Math.floor(range.realFrom) - 1); index <= Math.ceil(range.realTo); index += 1) {
    bars.push({ index, timestamp: index < data.length ? data[index].timestamp : last.timestamp + (index - data.length + 1) * intervalMs })
  }
  const ticks = buildTimeTicks(bars, { barSpacePx: chart.getBarSpace().bar, intervalMs, timeZone })
  return ticks.map((tick) => ({
    coord: (chart.convertToPixel({ dataIndex: tick.index }, { paneId: 'candle_pane' }) as Partial<Coordinate>).x ?? 0,
    value: tick.timestamp,
    text: tick.text,
  }))
}
