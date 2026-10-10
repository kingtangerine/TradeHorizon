import { useCallback, useEffect, useRef, useState } from 'react'
import { CryptoChartSurface } from '../chart/CryptoChartSurface'
import {
  MOVING_AVERAGE_COLORS,
  MOVING_AVERAGE_LABELS,
  movingAverageActive,
  type IndicatorSettings,
  type MovingAverageKind,
} from '../chart/indicators'
import type { KLineChartController } from '../chart/KLineChartController'
import type { CryptoMarket } from '../chart/markets'
import type { ChartRuntimeState, ChartType } from '../chart/types'
import type { DrawingStore } from '../drawings'
import type { MarketInterval } from '../market'
import { formatCompact, formatPrice } from './format'
import { EyeIcon, EyeOffIcon, RefreshIcon } from './Icons'

interface ChartPaneProps {
  index: number
  /** The pane the toolbar, drawing tools and side panels act on. */
  active: boolean
  /** Split view: draw a focus frame so it is clear which chart is active. */
  framed: boolean
  market: CryptoMarket
  interval: MarketInterval
  drawingStore: DrawingStore
  volumeVisible: boolean
  indicators: IndicatorSettings
  magnet: boolean
  chartType: ChartType
  theme: 'dark' | 'light'
  onActivate(index: number): void
  onActiveRuntime(state: ChartRuntimeState): void
  onActiveController(controller: KLineChartController | null): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
  onAddAlert(price: number, symbol: string, lastPrice: number | undefined): void
  onToggleVolume(): void
  onToggleMovingAverage(kind: MovingAverageKind): void
}

const INITIAL_RUNTIME = (interval: MarketInterval): ChartRuntimeState => ({
  interval,
  connection: 'loading',
  quote: null,
  error: null,
  followingLive: true,
})

/**
 * One chart with its own legend, loading and error states. Several of these make up a split view.
 * Only the active pane reports its state and controller upward, so the rest of the app keeps
 * working with "the chart" exactly as it did before there could be more than one.
 */
export function ChartPane({
  index,
  active,
  framed,
  market,
  interval,
  drawingStore,
  volumeVisible,
  indicators,
  magnet,
  chartType,
  theme,
  onActivate,
  onActiveRuntime,
  onActiveController,
  onToolSettled,
  onSelectionChange,
  onAddAlert,
  onToggleVolume,
  onToggleMovingAverage,
}: ChartPaneProps) {
  const [runtime, setRuntime] = useState<ChartRuntimeState>(() => INITIAL_RUNTIME(interval))
  const [controller, setController] = useState<KLineChartController | null>(null)

  // Callbacks go through refs so the handlers handed to the chart surface stay stable
  // (a changing handler would make the surface rebuild its chart).
  const latest = useRef({ active, onActiveRuntime, onSelectionChange, onToolSettled })
  latest.current = { active, onActiveRuntime, onSelectionChange, onToolSettled }

  const handleRuntime = useCallback((state: ChartRuntimeState) => {
    setRuntime(state)
    if (latest.current.active) latest.current.onActiveRuntime(state)
  }, [])
  const handleController = useCallback((next: KLineChartController | null) => setController(next), [])
  const handleSelection = useCallback((id?: string) => {
    if (latest.current.active) latest.current.onSelectionChange(id)
  }, [])
  const handleToolSettled = useCallback(() => {
    if (latest.current.active) latest.current.onToolSettled()
  }, [])

  // When this pane becomes the active one (or its chart is rebuilt), hand its chart and state to the app.
  useEffect(() => {
    if (active) onActiveController(controller)
  }, [active, controller, onActiveController])
  useEffect(() => {
    if (active) onActiveRuntime(runtime)
    // Only when the pane changes hands; ongoing updates are forwarded by handleRuntime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const quote = runtime.quote
  const isPositive = (quote?.changePercent ?? 0) >= 0
  const blockingLoad = !quote && runtime.connection !== 'error'
  const classes = ['chart-pane', framed ? 'framed' : '', framed && active ? 'active' : ''].filter(Boolean).join(' ')

  return (
    <div className={classes} data-pane={index} onPointerDownCapture={() => { if (!latest.current.active) onActivate(index) }}>
      <div className="chart-watermark" aria-hidden="true">
        <strong>{market.name}</strong>
        <span>· {interval} · {market.venue}</span>
        <i className={`legend-dot legend-dot-${runtime.connection}`} />
      </div>

      <div className="chart-legend" aria-label="Current market and indicators">
        <div className="chart-ohlc-row">
          <span><b>O</b>{formatPrice(quote?.open, market.pricePrecision)}</span>
          <span><b>H</b>{formatPrice(quote?.high, market.pricePrecision)}</span>
          <span><b>L</b>{formatPrice(quote?.low, market.pricePrecision)}</span>
          <span><b>C</b>{formatPrice(quote?.close, market.pricePrecision)}</span>
          <span className={isPositive ? 'price-up' : 'price-down'}>{quote ? `${isPositive ? '+' : ''}${quote.changePercent.toFixed(2)}%` : '—'}</span>
        </div>
        {market.kind !== 'dominance' && <button
          type="button"
          className={volumeVisible ? 'chart-indicator-row' : 'chart-indicator-row muted'}
          onClick={onToggleVolume}
          title={volumeVisible ? 'Hide Volume' : 'Show Volume'}
        >
          <span>Volume · {market.baseAsset}</span>
          <b>{formatCompact(quote?.volume)}</b>
          {volumeVisible ? <EyeIcon /> : <EyeOffIcon />}
        </button>}
        {(['sma', 'ema'] as const).filter((kind) => movingAverageActive(indicators[kind])).map((kind) => (
          <button
            type="button"
            key={kind}
            className="chart-indicator-row"
            onClick={() => onToggleMovingAverage(kind)}
            title={`Hide ${MOVING_AVERAGE_LABELS[kind]}`}
          >
            <span>{MOVING_AVERAGE_LABELS[kind]}</span>
            {indicators[kind].periods.map((period, position) => (
              <b key={period} style={{ color: MOVING_AVERAGE_COLORS[kind][position % MOVING_AVERAGE_COLORS[kind].length] }}>{period}</b>
            ))}
            <EyeIcon />
          </button>
        ))}
      </div>

      <CryptoChartSurface
        interval={interval}
        market={market}
        drawingStore={drawingStore}
        volumeVisible={volumeVisible}
        indicators={indicators}
        magnet={magnet}
        chartType={chartType}
        onRuntimeState={handleRuntime}
        onControllerChange={handleController}
        onToolSettled={handleToolSettled}
        onSelectionChange={handleSelection}
        onAddAlert={(price) => onAddAlert(price, market.symbol, quote?.close)}
        theme={theme}
      />

      {blockingLoad && (
        <div className="chart-state" role="status">
          <span className="loader-ring" />
          <strong>Loading {market.symbol}</strong>
          <span>Connecting to the {market.venue} data feed…</span>
        </div>
      )}

      {!quote && runtime.connection === 'error' && (
        <div className="chart-state error-state" role="alert">
          <span className="error-symbol">!</span>
          <strong>Market feed unavailable</strong>
          <span>{runtime.error ?? 'Check your connection and try again.'}</span>
          <button type="button" onClick={() => controller?.retry()}>
            <RefreshIcon />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
