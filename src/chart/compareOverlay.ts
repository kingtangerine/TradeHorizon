// Draws the compare symbols (compare.ts) over the candles. The bars arrive in `extendData`; the lines are rescaled on
// every draw, so they always start at the first visible candle. The price range is widened by the controller.
import { getSupportedIndicators, registerIndicator } from 'klinecharts'
import { scaledCompare, type CompareBar } from './compare'

export const COMPARE_INDICATOR_NAME = 'tradeHorizonCompare'

export interface CompareSeries {
  readonly symbol: string
  readonly color: string
  readonly bars: readonly CompareBar[]
}

export function registerCompareOverlay(): void {
  if (getSupportedIndicators().includes(COMPARE_INDICATOR_NAME)) return
  registerIndicator({
    name: COMPARE_INDICATOR_NAME,
    shortName: 'Compare',
    figures: [],
    calc: (dataList) => dataList.map(() => ({})),
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const series = (indicator.extendData as { series?: readonly CompareSeries[] } | undefined)?.series ?? []
      const data = chart.getDataList()
      const range = chart.getVisibleRange()
      const from = Math.max(0, Math.floor(range.from))
      const to = Math.min(data.length, Math.ceil(range.to))
      ctx.setLineDash([])
      ctx.lineWidth = 1.5
      for (const item of series) {
        const values = scaledCompare(data, item.bars, from, to)
        ctx.strokeStyle = item.color
        ctx.beginPath()
        let drawing = false
        values.forEach((value, offset) => {
          if (value === undefined) { drawing = false; return }
          const x = xAxis.convertToPixel(from + offset)
          const y = yAxis.convertToPixel(value)
          if (drawing) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
          drawing = true
        })
        ctx.stroke()
      }
      return true
    },
  })
}
