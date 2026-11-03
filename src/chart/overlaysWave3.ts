// The drawing tools added in Wave 3 (TradingView's most used ones after the basics). Lines without their own
// styles take the drawing's colour, width and dash from `styles.line`; fills use `fillColor` / `fillOpacity`.
import { getSupportedOverlays, registerOverlay } from 'klinecharts'
import { FIB_EXTENSION_LEVELS, ellipsePolygon, extendLine, fibExtensionPrice, formatDuration, parallelOffset, pitchforkMedian } from './geometry'
import {
  ARROW_OVERLAY_NAME,
  BRUSH_OVERLAY_NAME,
  DATE_PRICE_RANGE_OVERLAY_NAME,
  DATE_RANGE_OVERLAY_NAME,
  ELLIPSE_OVERLAY_NAME,
  FIB_EXTENSION_OVERLAY_NAME,
  HORIZONTAL_RAY_OVERLAY_NAME,
  PARALLEL_CHANNEL_OVERLAY_NAME,
  PITCHFORK_OVERLAY_NAME,
  PRICE_LABEL_OVERLAY_NAME,
} from './overlayNames'

type Styles = Record<string, unknown> | undefined
type Point = { x: number, y: number }

const FONT = 'Inter, system-ui, sans-serif'
const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#9c27b0']

function lineColor(styles: Styles): string {
  const line = styles?.line as { color?: unknown } | undefined
  return typeof line?.color === 'string' ? line.color : '#2962ff'
}

function lineSize(styles: Styles): number {
  const line = styles?.line as { size?: unknown } | undefined
  return typeof line?.size === 'number' ? line.size : 2
}

function fill(styles: Styles, fallbackOpacity: number): string {
  const color = typeof styles?.fillColor === 'string' ? styles.fillColor : lineColor(styles)
  const opacity = typeof styles?.fillOpacity === 'number' ? styles.fillOpacity : fallbackOpacity
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(100, opacity)) / 100})`
}

function label(text: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'center', baseline: 'top' | 'middle' | 'bottom' = 'bottom') {
  return {
    type: 'text',
    attrs: { x, y, text, align, baseline },
    styles: { style: 'fill', color: '#ffffff', size: 11, family: FONT, weight: 600, backgroundColor: color, borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3 },
    ignoreEvent: true,
  }
}

const move = (point: Point, dy: number): Point => ({ x: point.x, y: point.y + dy })

const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_629_800_000, year: 31_557_600_000 }

/** Bars between two moments on this chart's timeframe (placed points carry a time, not always a candle index). */
function barsBetween(chart: { getPeriod(): { type: string, span: number } | null }, from: number, to: number): number {
  const period = chart.getPeriod()
  const size = period ? (UNIT_MS[period.type] ?? 60_000) * period.span : 60_000
  return Math.round(Math.abs(to - from) / size)
}

export function registerWave3Overlays(): void {
  const supported = new Set(getSupportedOverlays())
  const add = (name: string, template: Parameters<typeof registerOverlay>[0]) => { if (!supported.has(name)) registerOverlay(template) }

  add(HORIZONTAL_RAY_OVERLAY_NAME, {
    name: HORIZONTAL_RAY_OVERLAY_NAME,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding }) => (coordinates.length < 1 ? [] : [
      { type: 'line', attrs: { coordinates: [coordinates[0], { x: bounding.width, y: coordinates[0].y }] } },
    ]),
  })

  add(ARROW_OVERLAY_NAME, {
    name: ARROW_OVERLAY_NAME,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return []
      const [from, to] = coordinates
      const angle = Math.atan2(to.y - from.y, to.x - from.x)
      const size = 9 + lineSize(overlay.styles as Styles) * 2
      const wing = (side: number) => ({ x: to.x - size * Math.cos(angle + side * 0.45), y: to.y - size * Math.sin(angle + side * 0.45) })
      return [
        { type: 'line', attrs: { coordinates: [from, to] } },
        { type: 'polygon', attrs: { coordinates: [to, wing(1), wing(-1)] }, styles: { style: 'fill', color: lineColor(overlay.styles as Styles) } },
      ]
    },
  })

  add(BRUSH_OVERLAY_NAME, {
    name: BRUSH_OVERLAY_NAME,
    totalStep: 3,
    // A stroke has hundreds of points: no handles, it is moved as a whole.
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates }) => (coordinates.length < 2 ? [] : [{ type: 'line', attrs: { coordinates } }]),
  })

  add(PARALLEL_CHANNEL_OVERLAY_NAME, {
    name: PARALLEL_CHANNEL_OVERLAY_NAME,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return []
      const [first, second] = coordinates
      const third = coordinates[2] ?? second
      const dy = parallelOffset(first, second, third)
      const styles = overlay.styles as Styles
      return [
        { type: 'polygon', attrs: { coordinates: [first, second, move(second, dy), move(first, dy)] }, styles: { style: 'fill', color: fill(styles, 12) } },
        { type: 'line', attrs: { coordinates: [first, second] } },
        { type: 'line', attrs: { coordinates: [move(first, dy), move(second, dy)] } },
        { type: 'line', attrs: { coordinates: [move(first, dy / 2), move(second, dy / 2)] }, styles: { style: 'dashed', dashedValue: [4, 4], size: 1, color: lineColor(styles) }, ignoreEvent: true },
      ]
    },
  })

  add(PITCHFORK_OVERLAY_NAME, {
    name: PITCHFORK_OVERLAY_NAME,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return []
      const [first, second] = coordinates
      const third = coordinates[2] ?? second
      const { from, through } = pitchforkMedian(first, second, third)
      const right = bounding.width
      const end = extendLine(from, through, right)
      const dx = through.x - from.x
      const shift = (point: Point) => extendLine(point, { x: point.x + dx, y: point.y + (through.y - from.y) }, right)
      const styles = overlay.styles as Styles
      return [
        { type: 'polygon', attrs: { coordinates: [second, shift(second), shift(third), third] }, styles: { style: 'fill', color: fill(styles, 10) } },
        { type: 'line', attrs: { coordinates: [from, end] } },
        { type: 'line', attrs: { coordinates: [second, shift(second)] } },
        { type: 'line', attrs: { coordinates: [third, shift(third)] } },
        { type: 'line', attrs: { coordinates: [second, third] }, styles: { style: 'dashed', dashedValue: [4, 4], size: 1, color: lineColor(styles) } },
      ]
    },
  })

  add(FIB_EXTENSION_OVERLAY_NAME, {
    name: FIB_EXTENSION_OVERLAY_NAME,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, yAxis, chart }) => {
      if (coordinates.length < 2 || overlay.points.length < 2 || !yAxis) return []
      const [v1, v2] = [overlay.points[0].value, overlay.points[1].value]
      const v3 = overlay.points[2]?.value ?? v2
      if (v1 === undefined || v2 === undefined || v3 === undefined) return []
      const [first, second] = coordinates
      const third = coordinates[2] ?? second
      const left = third.x
      const right = Math.max(left + 120, left + Math.abs(second.x - first.x))
      const precision = chart.getSymbol()?.pricePrecision ?? 2
      const guide = { style: 'dashed', dashedValue: [4, 4], size: 1, color: '#787b86' }
      const figures: Array<Record<string, unknown>> = [
        { type: 'line', attrs: { coordinates: [first, second] }, styles: guide },
        { type: 'line', attrs: { coordinates: [second, third] }, styles: guide },
      ]
      FIB_EXTENSION_LEVELS.forEach((level, index) => {
        const price = fibExtensionPrice(v1, v2, v3, level)
        const y = yAxis.convertToPixel(price)
        const color = FIB_COLORS[index % FIB_COLORS.length]
        figures.push({ type: 'line', attrs: { coordinates: [{ x: left, y }, { x: right, y }] }, styles: { color, size: 1 } })
        figures.push({ type: 'text', attrs: { x: left + 4, y: y - 2, text: `${level} (${price.toFixed(precision)})`, align: 'left', baseline: 'bottom' }, styles: { color, size: 11, family: FONT, weight: 600, style: 'fill', backgroundColor: 'transparent', paddingLeft: 0, paddingRight: 0 }, ignoreEvent: true })
      })
      return figures as never
    },
  })

  add(ELLIPSE_OVERLAY_NAME, {
    name: ELLIPSE_OVERLAY_NAME,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return []
      const styles = overlay.styles as Styles
      return [{
        type: 'polygon',
        attrs: { coordinates: ellipsePolygon(coordinates[0], coordinates[1]) },
        styles: { style: 'stroke_fill', color: fill(styles, 14), borderColor: lineColor(styles), borderSize: lineSize(styles) },
      }]
    },
  })

  add(DATE_RANGE_OVERLAY_NAME, {
    name: DATE_RANGE_OVERLAY_NAME,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding, overlay, chart }) => {
      if (coordinates.length < 2 || overlay.points.length < 2) return []
      const [a, b] = coordinates
      const left = Math.min(a.x, b.x)
      const right = Math.max(a.x, b.x)
      const middle = (a.y + b.y) / 2
      const styles = overlay.styles as Styles
      const [p1, p2] = overlay.points
      const bars = barsBetween(chart, p1.timestamp ?? 0, p2.timestamp ?? 0)
      const time = (p2.timestamp ?? 0) - (p1.timestamp ?? 0)
      return [
        { type: 'rect', attrs: { x: left, y: 0, width: Math.max(1, right - left), height: bounding.height }, styles: { style: 'fill', color: fill(styles, 14) } },
        { type: 'line', attrs: { coordinates: [{ x: a.x, y: middle }, { x: b.x, y: middle }] } },
        label(`${bars} bar${bars === 1 ? '' : 's'}, ${formatDuration(time)}`, (left + right) / 2, middle - 8, lineColor(styles)),
      ]
    },
  })

  add(DATE_PRICE_RANGE_OVERLAY_NAME, {
    name: DATE_PRICE_RANGE_OVERLAY_NAME,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, chart }) => {
      if (coordinates.length < 2 || overlay.points.length < 2) return []
      const [a, b] = coordinates
      const [p1, p2] = overlay.points
      const v1 = p1.value ?? 0
      const v2 = p2.value ?? 0
      const change = v2 - v1
      const percent = v1 !== 0 ? (change / v1) * 100 : 0
      const bars = barsBetween(chart, p1.timestamp ?? 0, p2.timestamp ?? 0)
      const precision = chart.getSymbol()?.pricePrecision ?? 2
      const color = change >= 0 ? '#2962ff' : '#f23645'
      const sign = change >= 0 ? '+' : '−'
      const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
      return [
        { type: 'rect', attrs: box, styles: { style: 'fill', color: change >= 0 ? 'rgba(41, 98, 255, 0.14)' : 'rgba(242, 54, 69, 0.14)' } },
        { type: 'line', attrs: { coordinates: [{ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }] }, styles: { color, size: 1 } },
        { type: 'line', attrs: { coordinates: [{ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }] }, styles: { color, size: 1 } },
        label(`${sign}${Math.abs(change).toFixed(precision)} (${sign}${Math.abs(percent).toFixed(2)}%) · ${bars} bars, ${formatDuration((p2.timestamp ?? 0) - (p1.timestamp ?? 0))}`,
          (a.x + b.x) / 2, change >= 0 ? box.y - 6 : box.y + box.height + 6, color, 'center', change >= 0 ? 'bottom' : 'top'),
      ]
    },
  })

  add(PRICE_LABEL_OVERLAY_NAME, {
    name: PRICE_LABEL_OVERLAY_NAME,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, chart }) => {
      if (coordinates.length < 1) return []
      const point = coordinates[0]
      const precision = chart.getSymbol()?.pricePrecision ?? 2
      const color = lineColor(overlay.styles as Styles)
      const value = overlay.points[0]?.value
      const custom = typeof (overlay.styles as Styles)?.textValue === 'string' && (overlay.styles as Styles)?.textValue !== 'Text' ? String((overlay.styles as Styles)?.textValue) : ''
      const text = custom || (value !== undefined ? value.toFixed(precision) : '')
      return [
        { type: 'line', attrs: { coordinates: [point, { x: point.x + 12, y: point.y - 14 }] }, styles: { color, size: 1 } },
        { ...label(text, point.x + 12, point.y - 14, color, 'left', 'bottom'), ignoreEvent: false },
      ]
    },
  })
}
