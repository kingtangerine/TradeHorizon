// Heikin Ashi and baseline series, drawn in the price pane over hidden candles. The figures (high/low) only feed the
// price scale; `draw` returns true so klinecharts never paints them itself.
import { getSupportedIndicators, registerIndicator, type KLineData } from 'klinecharts'
import { baselineLevel, heikinAshi } from './chartTypes'

/** klinecharts indicator name of the Heikin Ashi series. */
export const HEIKIN_ASHI_NAME = 'tradeHorizonHeikinAshi'
/** klinecharts indicator name of the baseline series. */
export const BASELINE_NAME = 'tradeHorizonBaseline'

const UP = '#089981'
const DOWN = '#f23645'

interface SeriesRow {
  open?: number
  high?: number
  low?: number
  close?: number
}

function visibleSpan(chart: { getVisibleRange(): { from: number; to: number } }, length: number): [number, number] {
  const range = chart.getVisibleRange()
  return [Math.max(0, Math.floor(range.from)), Math.min(length, Math.ceil(range.to))]
}

/** Registers the Heikin Ashi and baseline series indicators with klinecharts once each. */
export function registerSeriesOverlays(): void {
  const supported = getSupportedIndicators()
  if (!supported.includes(HEIKIN_ASHI_NAME)) {
    registerIndicator<SeriesRow>({
      name: HEIKIN_ASHI_NAME,
      shortName: 'Heikin Ashi',
      figures: [
        { key: 'high', type: 'line' },
        { key: 'low', type: 'line' },
      ],
      calc: (dataList: KLineData[]) => heikinAshi(dataList),
      draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
        const rows = indicator.result
        const [from, to] = visibleSpan(chart, rows.length)
        const { gapBar } = chart.getBarSpace()
        const body = Math.max(1, Math.round(gapBar))
        const colors = chart.getStyles().candle.bar
        for (let index = from; index < to; index += 1) {
          const row = rows[index]
          if (row?.open === undefined || row.close === undefined || row.high === undefined || row.low === undefined) continue
          const x = Math.round(xAxis.convertToPixel(index))
          const top = yAxis.convertToPixel(Math.max(row.open, row.close))
          const bottom = yAxis.convertToPixel(Math.min(row.open, row.close))
          ctx.fillStyle = row.close >= row.open ? colors.upColor : colors.downColor
          ctx.fillRect(x, yAxis.convertToPixel(row.high), 1, Math.max(1, yAxis.convertToPixel(row.low) - yAxis.convertToPixel(row.high)))
          ctx.fillRect(Math.round(x - body / 2), Math.round(top), body, Math.max(1, Math.round(bottom - top)))
        }
        return true
      },
    })
  }
  if (!supported.includes(BASELINE_NAME)) {
    registerIndicator<SeriesRow>({
      name: BASELINE_NAME,
      shortName: 'Baseline',
      figures: [],
      calc: (dataList: KLineData[]) => dataList.map(() => ({})),
      draw: ({ ctx, chart, bounding, xAxis, yAxis }) => {
        const data = chart.getDataList()
        const [from, to] = visibleSpan(chart, data.length)
        const level = baselineLevel(data.slice(from, to).map((bar) => bar.close))
        if (level === undefined || to - from < 2) return true
        ctx.setLineDash([])
        const baseY = yAxis.convertToPixel(level)
        const points = data
          .slice(from, to)
          .map((bar, offset) => ({ x: xAxis.convertToPixel(from + offset), y: yAxis.convertToPixel(bar.close) }))
        const path = new Path2D()
        path.moveTo(points[0].x, baseY)
        for (const point of points) path.lineTo(point.x, point.y)
        path.lineTo(points[points.length - 1].x, baseY)
        path.closePath()
        // Above the baseline green, below red: the same path clipped to each side.
        for (const [color, y, height] of [
          [UP, 0, baseY],
          [DOWN, baseY, bounding.height - baseY],
        ] as const) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, y, bounding.width, height)
          ctx.clip()
          ctx.fillStyle = color === UP ? 'rgba(8, 153, 129, 0.18)' : 'rgba(242, 54, 69, 0.18)'
          ctx.fill(path)
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.beginPath()
          points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)))
          ctx.stroke()
          ctx.restore()
        }
        ctx.strokeStyle = 'rgba(120, 123, 134, 0.6)'
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, Math.round(baseY) + 0.5)
        ctx.lineTo(bounding.width, Math.round(baseY) + 0.5)
        ctx.stroke()
        return true
      },
    })
  }
}
