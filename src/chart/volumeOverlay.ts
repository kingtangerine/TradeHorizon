// Volume drawn the TradingView way: bars along the bottom of the price chart, behind the candles, scaled to the
// highest volume on screen, with no moving averages. It has no plotted values, so it never changes the price scale.
import { getSupportedIndicators, registerIndicator } from 'klinecharts'
import { VOLUME_HEIGHT_RATIO, volumeBarHeights } from './volumeBars'

export const VOLUME_OVERLAY_NAME = 'tradeHorizonVolume'
const UP_COLOR = 'rgba(8, 153, 129, 0.45)'
const DOWN_COLOR = 'rgba(242, 54, 69, 0.45)'

export function registerVolumeOverlay(): void {
  if (getSupportedIndicators().includes(VOLUME_OVERLAY_NAME)) return
  registerIndicator({
    name: VOLUME_OVERLAY_NAME,
    shortName: 'Volume',
    figures: [],
    calc: (dataList) => dataList.map(() => ({})),
    draw: ({ ctx, chart, bounding, xAxis }) => {
      const data = chart.getDataList()
      const range = chart.getVisibleRange()
      const from = Math.max(0, Math.floor(range.from))
      const to = Math.min(data.length, Math.ceil(range.to))
      if (to <= from) return true
      const visible = data.slice(from, to)
      const heights = volumeBarHeights(visible.map((bar) => bar.volume), bounding.height * VOLUME_HEIGHT_RATIO)
      const width = Math.max(1, chart.getBarSpace().gapBar)
      for (let offset = 0; offset < visible.length; offset += 1) {
        const height = heights[offset]
        if (height <= 0) continue
        const bar = visible[offset]
        const x = xAxis.convertToPixel(from + offset)
        ctx.fillStyle = bar.close >= bar.open ? UP_COLOR : DOWN_COLOR
        ctx.fillRect(Math.round(x - width / 2), bounding.height - height, Math.max(1, Math.round(width)), height)
      }
      return true
    },
  })
}
