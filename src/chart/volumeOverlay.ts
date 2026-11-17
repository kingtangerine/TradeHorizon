// Volume drawn the TradingView way: bars along the bottom of the price chart, behind the candles, scaled to the
// highest volume on screen, with no moving averages. It has no plotted values, so it never changes the price scale.
import { getSupportedIndicators, registerIndicator } from 'klinecharts'
import { VOLUME_HEIGHT_RATIO, volumeBarHeights } from './volumeBars'

/** klinecharts indicator name of the volume bars. */
export const VOLUME_OVERLAY_NAME = 'tradeHorizonVolume'
/** The candle colour at 45% opacity, so volume follows the chart settings. */
function faded(color: unknown, fallback: string): string {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}73` : fallback
}

/** Registers the volume-bars indicator, drawn at the bottom of the price pane, once. */
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
      const heights = volumeBarHeights(
        visible.map((bar) => bar.volume),
        bounding.height * VOLUME_HEIGHT_RATIO,
      )
      const width = Math.max(1, chart.getBarSpace().gapBar)
      const bar = chart.getStyles().candle.bar
      const up = faded(bar.upColor, 'rgba(8, 153, 129, 0.45)')
      const down = faded(bar.downColor, 'rgba(242, 54, 69, 0.45)')
      for (let offset = 0; offset < visible.length; offset += 1) {
        const height = heights[offset]
        if (height <= 0) continue
        const candle = visible[offset]
        const x = xAxis.convertToPixel(from + offset)
        ctx.fillStyle = candle.close >= candle.open ? up : down
        ctx.fillRect(Math.round(x - width / 2), bounding.height - height, Math.max(1, Math.round(width)), height)
      }
      return true
    },
  })
}
