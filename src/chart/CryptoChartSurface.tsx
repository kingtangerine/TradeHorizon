import { useEffect, useRef, useState } from 'react'
import type { DrawingStore } from '../drawings'
import type { MarketInterval } from '../market'
import { KLineChartController } from './KLineChartController'
import type { ChartRuntimeState, ChartType } from './types'
import type { IndicatorSettings } from './indicators'
import type { CryptoMarket } from './markets'
import { formatCountdown } from './countdown'

interface CryptoChartSurfaceProps {
  interval: MarketInterval
  market: CryptoMarket
  drawingStore: DrawingStore
  volumeVisible: boolean
  indicators: IndicatorSettings
  magnet: boolean
  chartType: ChartType
  /** Show the time left in the current candle under the last price. */
  countdown?: boolean
  onRuntimeState(state: ChartRuntimeState): void
  onControllerChange(controller: KLineChartController | null): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
  onAddAlert?(price: number): void
  /** Right-click on the chart (not on a drawing, not while a tool is armed): where, and the price there. */
  onChartContextMenu?(info: { left: number, top: number, price: number | null }): void
  theme?: 'dark' | 'light'
}

export function CryptoChartSurface({
  interval,
  market,
  drawingStore,
  volumeVisible,
  indicators,
  magnet,
  chartType,
  countdown = false,
  onRuntimeState,
  onControllerChange,
  onToolSettled,
  onSelectionChange,
  onAddAlert,
  onChartContextMenu,
  theme = 'dark',
}: CryptoChartSurfaceProps) {
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [priceViewManual, setPriceViewManual] = useState(false)
  const [alertHover, setAlertHover] = useState<{ top: number, left: number, price: number } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<HTMLDivElement>(null)
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
        onPriceViewChange: setPriceViewManual,
      })
      controllerRef.current = controller
      controller.setVolumeVisible(volumeVisible)
      controller.setIndicators(indicatorsRef.current)
      controller.setMagnet(magnetRef.current)
      controller.setChartType(chartTypeRef.current)
      controller.setTheme(themeRef.current)
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

  useEffect(() => {
    controllerRef.current?.setTheme(theme)
  }, [theme])

  // Candle countdown: text once a second, position whenever the view moves (coalesced to one frame).
  // The label is moved by writing to the element directly, so a ticking clock never re-renders React.
  useEffect(() => {
    const element = countdownRef.current
    const controller = controllerRef.current
    if (!countdown || !element || !controller) return
    const update = () => {
      const state = controller.countdownState()
      if (!state) { element.hidden = true; return }
      element.hidden = false
      const text = formatCountdown(state.remainingMs)
      if (element.textContent !== text) element.textContent = text
      element.style.top = `${state.top}px`
      element.style.left = `${state.left}px`
      element.style.width = `${state.width}px`
      element.dataset.direction = state.up ? 'up' : 'down'
    }
    let frame = 0
    const schedule = () => {
      if (frame || document.hidden) return
      frame = requestAnimationFrame(() => { frame = 0; update() })
    }
    const unsubscribe = controller.onViewChange(schedule)
    const timer = setInterval(() => { if (!document.hidden) update() }, 1000)
    update()
    return () => {
      unsubscribe()
      clearInterval(timer)
      cancelAnimationFrame(frame)
      element.hidden = true
    }
  }, [countdown, drawingStore, market, onControllerChange])

  // Right-click menu. The controller has already handled right-clicks that cancel a drawing tool (and stopped them).
  const contextMenuRef = useRef(onChartContextMenu)
  contextMenuRef.current = onChartContextMenu
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const open = (event: MouseEvent) => {
      const controller = controllerRef.current
      event.preventDefault()
      if (!controller || !contextMenuRef.current || controller.drawingUnderPointer()) return
      const hostRect = host.getBoundingClientRect()
      const pane = controller.pricePaneBounds()
      const onPriceChart = !!pane && event.clientX >= pane.left && event.clientX <= pane.right && event.clientY >= pane.top && event.clientY <= pane.bottom
      setAlertHover(null)
      contextMenuRef.current({
        left: event.clientX - hostRect.left,
        top: event.clientY - hostRect.top,
        price: onPriceChart ? controller.priceAtClientY(event.clientY) : null,
      })
    }
    host.addEventListener('contextmenu', open)
    return () => host.removeEventListener('contextmenu', open)
  }, [])

  // TradingView-style "+" next to the price axis at the crosshair level: click to alert at that price.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !onAddAlert) return
    const move = (event: PointerEvent) => {
      const bounds = controllerRef.current?.pricePaneBounds()
      const hostRect = host.getBoundingClientRect()
      if (!bounds || event.buttons !== 0 || event.pointerType === 'touch' ||
          event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) {
        setAlertHover(null)
        return
      }
      const price = controllerRef.current?.priceAtClientY(event.clientY)
      if (price === null || price === undefined) { setAlertHover(null); return }
      setAlertHover({ top: event.clientY - hostRect.top, left: bounds.right - hostRect.left, price })
    }
    const leave = (event: PointerEvent) => {
      if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('.chart-alert-plus'))) setAlertHover(null)
    }
    host.addEventListener('pointermove', move, true)
    host.addEventListener('pointerleave', leave)
    return () => {
      host.removeEventListener('pointermove', move, true)
      host.removeEventListener('pointerleave', leave)
    }
  }, [onAddAlert, market])

  return (
    <>
      <div ref={hostRef} className="chart-host" aria-label={`${market.pair} candlestick chart`} />
      {countdown && <div ref={countdownRef} className="chart-countdown" hidden aria-hidden="true" title="Time left until this candle closes" />}
      {priceViewManual && (
        <button
          type="button"
          className="chart-auto-reset"
          title="Price scale is moved or zoomed. Click to fit the candles automatically again."
          onClick={() => controllerRef.current?.resetPriceView()}
        >
          Auto
        </button>
      )}
      {alertHover && onAddAlert && (
        <button
          type="button"
          className="chart-alert-plus"
          style={{ top: alertHover.top, left: alertHover.left }}
          title={`Add alert at ${alertHover.price}`}
          aria-label={`Add alert at ${alertHover.price}`}
          onPointerLeave={() => setAlertHover(null)}
          onClick={() => { onAddAlert(alertHover.price); setAlertHover(null) }}
        >+</button>
      )}
    </>
  )
}
