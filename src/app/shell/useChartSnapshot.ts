import { type Dispatch, type SetStateAction, useCallback } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import type { CryptoMarket } from '../../chart/markets'
import { formatCrosshairTime } from '../../chart/timeAxis'
import { MARKET_INTERVAL_SPECS, type MarketInterval } from '../../market'
import { composeSnapshot, copyImage, downloadBlob, snapshotFileName, snapshotValues } from '../snapshot'
import type { Theme } from '../theme'
import { offsetLabel } from '../timeZones'

interface ChartSnapshotOptions {
  controller: KLineChartController | null
  market: CryptoMarket
  interval: MarketInterval
  chartTimeZone: string
  theme: Theme
  showToast(message: string): void
  setSnapshotMenuOpen: Dispatch<SetStateAction<boolean>>
}

/** The camera button's action: saves or copies the active chart as an image. */
export function useChartSnapshot({
  controller,
  market,
  interval,
  chartTimeZone,
  theme,
  showToast,
  setSnapshotMenuOpen,
}: ChartSnapshotOptions) {
  /** Camera button (TradingView): the active chart as a PNG with a header naming the symbol, timeframe and prices. */
  const takeSnapshot = useCallback(
    (mode: 'download' | 'copy') => {
      setSnapshotMenuOpen(false)
      if (!controller) return
      const now = Date.now()
      const candle = controller.latestCandle()
      const fileName = snapshotFileName(market.symbol, interval, now, chartTimeZone)
      const image = (async () => {
        const chart = await controller.snapshot()
        if (!chart) throw new Error('The chart is not ready yet')
        return composeSnapshot({
          chart,
          title: `${market.pair} · ${MARKET_INTERVAL_SPECS[interval].label} · ${market.venue}`,
          values: candle ? snapshotValues(candle, market.pricePrecision) : [],
          stamp: `TradeHorizon · ${formatCrosshairTime(now, chartTimeZone, 60_000)} (${offsetLabel(chartTimeZone)})`,
          dark: theme === 'dark',
        })
      })()
      if (mode === 'copy') {
        copyImage(image).then(
          () => showToast('Chart image copied'),
          (error: unknown) =>
            showToast(
              error instanceof Error && error.message.startsWith('This browser')
                ? 'This browser cannot copy images. Use Download image.'
                : 'Could not copy the image',
            ),
        )
      } else {
        image.then(
          (blob) => {
            downloadBlob(blob, fileName)
            showToast('Chart image saved')
          },
          () => showToast('Could not create the image'),
        )
      }
    },
    [chartTimeZone, controller, interval, market, setSnapshotMenuOpen, showToast, theme],
  )
  return takeSnapshot
}
