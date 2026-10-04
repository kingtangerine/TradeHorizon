import { useEffect, useRef } from 'react'
import type { DrawingStore } from '../drawings'
import type { MarketInterval } from '../market'
import { KLineChartController } from './KLineChartController'
import type { ChartRuntimeState } from './types'
import type { CryptoMarket } from './markets'

interface CryptoChartSurfaceProps {
  interval: MarketInterval
  market: CryptoMarket
  drawingStore: DrawingStore
  onRuntimeState(state: ChartRuntimeState): void
  onControllerChange(controller: KLineChartController | null): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
}

export function CryptoChartSurface({
  interval,
  market,
  drawingStore,
  onRuntimeState,
  onControllerChange,
  onToolSettled,
  onSelectionChange,
}: CryptoChartSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<KLineChartController | null>(null)
  const callbacksRef = useRef({ onRuntimeState, onToolSettled, onSelectionChange })
  callbacksRef.current = { onRuntimeState, onToolSettled, onSelectionChange }

  useEffect(() => {
    if (!hostRef.current) return

    try {
      const controller = new KLineChartController(hostRef.current, interval, market, drawingStore, {
        onRuntimeState: (state) => callbacksRef.current.onRuntimeState(state),
        onToolSettled: () => callbacksRef.current.onToolSettled(),
        onSelectionChange: (selected) => callbacksRef.current.onSelectionChange(selected),
      })
      controllerRef.current = controller
      onControllerChange(controller)

      return () => {
        controller.dispose()
        controllerRef.current = null
        onControllerChange(null)
      }
    } catch (error) {
      onRuntimeState({
        interval,
        connection: 'error',
        quote: null,
        error: error instanceof Error ? error.message : 'The chart could not be started.',
        followingLive: true,
      })
    }
  }, [drawingStore, market, onControllerChange])

  useEffect(() => {
    controllerRef.current?.setInterval(interval)
  }, [interval])

  return <div ref={hostRef} className="chart-host" aria-label={`${market.baseAsset} USDT candlestick chart`} />
}
