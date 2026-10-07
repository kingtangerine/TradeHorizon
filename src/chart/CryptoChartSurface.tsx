import { useEffect, useRef } from 'react'
import type { DrawingStore } from '../drawings'
import type { MarketInterval } from '../market'
import { KLineChartController } from './KLineChartController'
import type { ChartRuntimeState, ChartType } from './types'
import type { IndicatorSettings } from './indicators'
import type { CryptoMarket } from './markets'

interface CryptoChartSurfaceProps {
  interval: MarketInterval
  market: CryptoMarket
  drawingStore: DrawingStore
  volumeVisible: boolean
  indicators: IndicatorSettings
  magnet: boolean
  chartType: ChartType
  onRuntimeState(state: ChartRuntimeState): void
  onControllerChange(controller: KLineChartController | null): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
}

export function CryptoChartSurface({
  interval,
  market,
  drawingStore,
  volumeVisible,
  indicators,
  magnet,
  chartType,
  onRuntimeState,
  onControllerChange,
  onToolSettled,
  onSelectionChange,
}: CryptoChartSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<KLineChartController | null>(null)
  const callbacksRef = useRef({ onRuntimeState, onToolSettled, onSelectionChange })
  const indicatorsRef = useRef(indicators)
  indicatorsRef.current = indicators
  const magnetRef = useRef(magnet)
  magnetRef.current = magnet
  const chartTypeRef = useRef(chartType)
  chartTypeRef.current = chartType
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
      controller.setVolumeVisible(volumeVisible)
      controller.setIndicators(indicatorsRef.current)
      controller.setMagnet(magnetRef.current)
      controller.setChartType(chartTypeRef.current)
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

  useEffect(() => {
    controllerRef.current?.setVolumeVisible(volumeVisible)
  }, [volumeVisible])

  useEffect(() => {
    controllerRef.current?.setIndicators(indicators)
  }, [indicators])

  useEffect(() => {
    controllerRef.current?.setMagnet(magnet)
  }, [magnet])

  useEffect(() => {
    controllerRef.current?.setChartType(chartType)
  }, [chartType])

  return <div ref={hostRef} className="chart-host" aria-label={`${market.pair} candlestick chart`} />
}
