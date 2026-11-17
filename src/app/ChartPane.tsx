import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CryptoChartSurface } from '../chart/CryptoChartSurface'
import {
  MOVING_AVERAGE_COLORS,
  MOVING_AVERAGE_LABELS,
  VWAP_COLORS,
  movingAverageActive,
  type IndicatorSettings,
  type MovingAverageKind,
  type VwapKind,
} from '../chart/indicators'
import { VWAP_ANCHOR_LABELS } from '../chart/vwap'
import { STUDIES, studyLabel, type Study } from '../chart/studies'
import type { ChartAppearanceStyle, DrawingModes, KLineChartController, ScaleMode } from '../chart/KLineChartController'
import type { CryptoMarket } from '../chart/markets'
import type { ChartRuntimeState, ChartType } from '../chart/types'
import type { DrawingStore } from '../drawings'
import type { MarketInterval } from '../market'
import { CloseIcon, EyeIcon, EyeOffIcon, RefreshIcon, SettingsIcon } from './Icons'
import { ChartContextMenu } from './ChartContextMenu'
import { FuturesStatsRow } from './FuturesStatsRow'
import { formatPrice } from './format'
import { getMarket } from '../chart/markets'
import { LegendIndicatorValues, LegendOhlc, LegendScriptValues, LegendStudyValues, LegendVolume } from './LegendValues'
import { compiledScript } from '../chart/scriptIndicator'
import type { ScriptInstance } from '../chart/indicators'
import type { PriceAlert } from './alerts'
import { capTier, coinSymbol, formatUsdCompact, loadMarketCaps, type MarketCapInfo } from './marketCap'
import type { AlertLine } from '../chart/KLineChartController'

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
  countdown: boolean
  timeZone: string
  highLowLabels: boolean
  scaleMode: ScaleMode
  appearance: ChartAppearanceStyle
  drawingModes: DrawingModes
  syncGroup?: string
  syncCrosshair: boolean
  syncTime: boolean
  alerts: readonly PriceAlert[]
  alertLinesVisible: boolean
  onMoveAlert(id: string, price: number, lastPrice: number | undefined): void
  onDeleteAlert(id: string): void
  onActivate(index: number): void
  onActiveRuntime(state: ChartRuntimeState): void
  onActiveController(controller: KLineChartController | null): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
  onAddAlert(price: number, symbol: string, lastPrice: number | undefined): void
  onToggleVolume(): void
  onToggleMovingAverage(kind: MovingAverageKind): void
  onToggleVwap(kind: VwapKind): void
  /** Library studies: eye, settings and remove buttons in the legend. */
  onStudyChange(study: Study): void
  onStudyRemove(id: string): void
  onStudySettings(id: string): void
  onCompareRemove(symbol: string): void
  /** User scripts on the chart: eye, settings and remove buttons in the legend. */
  onScriptChange(instance: ScriptInstance): void
  onScriptRemove(id: string): void
  onScriptSettings(id: string): void
  onOpenSettings(): void
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
  countdown,
  timeZone,
  highLowLabels,
  scaleMode,
  appearance,
  drawingModes,
  syncGroup,
  syncCrosshair,
  syncTime,
  alerts,
  alertLinesVisible,
  onMoveAlert,
  onDeleteAlert,
  onActivate,
  onActiveRuntime,
  onActiveController,
  onToolSettled,
  onSelectionChange,
  onAddAlert,
  onToggleVolume,
  onToggleMovingAverage,
  onToggleVwap,
  onStudyChange,
  onStudyRemove,
  onStudySettings,
  onCompareRemove,
  onScriptChange,
  onScriptRemove,
  onScriptSettings,
  onOpenSettings,
}: ChartPaneProps) {
  const [runtime, setRuntime] = useState<ChartRuntimeState>(() => INITIAL_RUNTIME(interval))
  const [controller, setController] = useState<KLineChartController | null>(null)
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number; price: number | null } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  // Market cap of the coin (from the server's cached CoinGecko top 500), shown as a colour-coded size tier.
  const [cap, setCap] = useState<{ symbol: string; info?: MarketCapInfo } | null>(null)
  useEffect(() => {
    if (market.kind === 'dominance') return
    let live = true
    const symbol = coinSymbol(market.baseAsset)
    void loadMarketCaps().then((index) => {
      if (live) setCap(index.size > 0 ? { symbol, info: index.get(symbol) } : null)
    })
    return () => {
      live = false
    }
  }, [market.baseAsset, market.kind])
  const capShown = market.kind !== 'dominance' && cap?.symbol === coinSymbol(market.baseAsset) ? cap : null
  const tier = capTier(capShown?.info?.marketCap)
  // This chart's alerts as lines: active and paused ones (a triggered alert has done its job).
  const alertLines = useMemo<readonly AlertLine[]>(
    () =>
      alertLinesVisible
        ? // Level alerts get a line (channels two); trend-line and "% move" alerts have no fixed level to draw.
          alerts
            .filter(
              (alert) =>
                alert.symbol === market.symbol && alert.triggeredAtMs === undefined && !alert.line && alert.condition !== 'movePercent',
            )
            .flatMap((alert) => [
              { id: alert.id, price: alert.targetPrice, paused: !alert.enabled },
              ...(alert.upperPrice !== undefined && (alert.condition === 'enterChannel' || alert.condition === 'exitChannel')
                ? [{ id: `${alert.id}:upper`, price: alert.upperPrice, paused: !alert.enabled }]
                : []),
            ])
        : [],
    [alerts, alertLinesVisible, market.symbol],
  )

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
  const blockingLoad = !quote && runtime.connection !== 'error'
  const classes = ['chart-pane', framed ? 'framed' : '', framed && active ? 'active' : ''].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      data-pane={index}
      onPointerDownCapture={() => {
        if (!latest.current.active) onActivate(index)
      }}
    >
      <div className="chart-watermark" aria-hidden="true">
        <strong>{market.name}</strong>
        <span>
          · {interval} · {market.venue}
        </span>
        <i className={`legend-dot legend-dot-${runtime.connection}`} />
      </div>

      <div className="chart-legend" aria-label="Current market and indicators">
        <LegendOhlc controller={controller} quote={quote} precision={market.pricePrecision} />
        {market.exchange === 'binance-futures' && (
          <FuturesStatsRow symbol={market.symbol} baseAsset={market.baseAsset} precision={market.pricePrecision} />
        )}
        {capShown && (
          <div
            className="chart-cap-row"
            style={{ '--cap-color': tier.color } as CSSProperties}
            title={[
              `${tier.label} (tier ${tier.tier} of 4): ${tier.description}`,
              capShown.info
                ? `24h volume ${formatUsdCompact(capShown.info.volume24h)} = ${((capShown.info.volume24h / capShown.info.marketCap) * 100).toFixed(1)}% of its market cap${capShown.info.volume24h / capShown.info.marketCap > 0.25 ? ' (very actively traded: expect fast moves)' : ''}.`
                : 'Not in the top 500 coins by market cap.',
              'Source: CoinGecko, refreshed every 30 minutes.',
            ].join('\n')}
          >
            <span className="cap-meter" aria-hidden="true">
              {[1, 2, 3, 4].map((bar) => (
                <i key={bar} className={bar <= 5 - tier.tier ? 'on' : ''} />
              ))}
            </span>
            <b>{tier.label}</b>
            <span>
              {capShown.info ? (
                <>
                  MC {formatUsdCompact(capShown.info.marketCap)} · #{capShown.info.rank}
                </>
              ) : (
                'Outside top 500'
              )}
            </span>
          </div>
        )}
        {market.kind !== 'dominance' && (
          <button
            type="button"
            className={volumeVisible ? 'chart-indicator-row' : 'chart-indicator-row muted'}
            onClick={onToggleVolume}
            title={volumeVisible ? 'Hide Volume' : 'Show Volume'}
          >
            <span>Volume · {market.baseAsset}</span>
            <LegendVolume controller={controller} quote={quote} />
            {volumeVisible ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        )}
        {(['sma', 'ema'] as const)
          .filter((kind) => movingAverageActive(indicators[kind]))
          .map((kind) => (
            <button
              type="button"
              key={kind}
              className="chart-indicator-row"
              onClick={() => onToggleMovingAverage(kind)}
              title={`Hide ${MOVING_AVERAGE_LABELS[kind]}`}
            >
              <span>
                {MOVING_AVERAGE_LABELS[kind]} {indicators[kind].periods.join(' ')}
              </span>
              <LegendIndicatorValues
                controller={controller}
                quote={quote}
                pick={(values) => values[kind]}
                colors={MOVING_AVERAGE_COLORS[kind]}
                precision={market.pricePrecision}
              />
              <EyeIcon />
            </button>
          ))}
        {market.kind !== 'dominance' && indicators.vwap.visible && (
          <button type="button" className="chart-indicator-row" onClick={() => onToggleVwap('vwap')} title="Hide VWAP">
            <span>VWAP · {VWAP_ANCHOR_LABELS[indicators.vwap.anchor]}</span>
            <LegendIndicatorValues
              controller={controller}
              quote={quote}
              pick={(values) => [values.vwap]}
              colors={[VWAP_COLORS.vwap]}
              precision={market.pricePrecision}
            />
            <EyeIcon />
          </button>
        )}
        {market.kind !== 'dominance' && indicators.qvwap.visible && (
          <button type="button" className="chart-indicator-row" onClick={() => onToggleVwap('qvwap')} title="Hide QVWAP">
            <span>QVWAP</span>
            <LegendIndicatorValues
              controller={controller}
              quote={quote}
              pick={(values) => [values.qvwap]}
              colors={[VWAP_COLORS.qvwap]}
              precision={market.pricePrecision}
            />
            <EyeIcon />
          </button>
        )}
        {controller &&
          indicators.compare.length > 0 &&
          controller.compareLegend().map((item) => (
            <div className="chart-indicator-row study-row compare-row" key={item.symbol}>
              <span>
                <i style={{ background: item.color }} aria-hidden="true" />
                {item.symbol}
              </span>
              <b style={{ color: item.color }}>{formatPrice(item.last, getMarket(item.symbol).pricePrecision)}</b>
              {item.changePercent !== undefined && (
                <b className={item.changePercent >= 0 ? 'price-up' : 'price-down'}>
                  {item.changePercent >= 0 ? '+' : ''}
                  {item.changePercent.toFixed(2)}%
                </b>
              )}
              <span className="study-actions">
                <button
                  type="button"
                  title="Remove"
                  aria-label={`Stop comparing ${item.symbol}`}
                  onClick={() => onCompareRemove(item.symbol)}
                >
                  <CloseIcon />
                </button>
              </span>
            </div>
          ))}
        {indicators.scripts.map((instance) => {
          const compiled = compiledScript(instance.source)
          const broken = compiled instanceof Error
          return (
            <div
              className={instance.visible && !broken ? 'chart-indicator-row study-row' : 'chart-indicator-row study-row muted'}
              key={instance.id}
            >
              <span title={broken ? compiled.message : instance.name}>
                {instance.name}
                {!broken && compiled.inputs.length > 0
                  ? ` ${compiled.inputs.map((input, index) => instance.inputs[index] ?? input.defaultValue).join(' ')}`
                  : ''}
              </span>
              {broken && <b className="price-down">error</b>}
              {!broken && instance.visible && compiled.overlay && (
                <LegendScriptValues
                  controller={controller}
                  quote={quote}
                  instanceId={instance.id}
                  precision={compiled.precision ?? market.pricePrecision}
                />
              )}
              <span className="study-actions">
                <button
                  type="button"
                  title={instance.visible ? 'Hide' : 'Show'}
                  aria-label={`${instance.visible ? 'Hide' : 'Show'} ${instance.name}`}
                  onClick={() => onScriptChange({ ...instance, visible: !instance.visible })}
                >
                  {instance.visible ? <EyeIcon /> : <EyeOffIcon />}
                </button>
                <button
                  type="button"
                  title="Settings"
                  aria-label={`Settings of ${instance.name}`}
                  onClick={() => onScriptSettings(instance.id)}
                >
                  <SettingsIcon />
                </button>
                <button type="button" title="Remove" aria-label={`Remove ${instance.name}`} onClick={() => onScriptRemove(instance.id)}>
                  <CloseIcon />
                </button>
              </span>
            </div>
          )
        })}
        {indicators.studies.map((study) => (
          <div className={study.visible ? 'chart-indicator-row study-row' : 'chart-indicator-row study-row muted'} key={study.id}>
            <span title={STUDIES[study.type].name}>{studyLabel(study)}</span>
            {study.visible && STUDIES[study.type].pane === 'price' && (
              <LegendStudyValues
                controller={controller}
                quote={quote}
                studyId={study.id}
                colors={study.colors}
                precision={market.pricePrecision}
              />
            )}
            <span className="study-actions">
              <button
                type="button"
                title={study.visible ? 'Hide' : 'Show'}
                aria-label={`${study.visible ? 'Hide' : 'Show'} ${studyLabel(study)}`}
                onClick={() => onStudyChange({ ...study, visible: !study.visible })}
              >
                {study.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button
                type="button"
                title="Settings"
                aria-label={`Settings of ${studyLabel(study)}`}
                onClick={() => onStudySettings(study.id)}
              >
                <SettingsIcon />
              </button>
              <button type="button" title="Remove" aria-label={`Remove ${studyLabel(study)}`} onClick={() => onStudyRemove(study.id)}>
                <CloseIcon />
              </button>
            </span>
          </div>
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
        onChartContextMenu={setContextMenu}
        alertLines={alertLines}
        onAlertMove={(id, price) => onMoveAlert(id, price, quote?.close)}
        onAlertDelete={onDeleteAlert}
        theme={theme}
        countdown={countdown}
        timeZone={timeZone}
        highLowLabels={highLowLabels}
        scaleMode={scaleMode}
        appearance={appearance}
        drawingModes={drawingModes}
        syncGroup={syncGroup}
        syncCrosshair={syncCrosshair}
        syncTime={syncTime}
      />

      {contextMenu && (
        <ChartContextMenu
          {...contextMenu}
          pricePrecision={market.pricePrecision}
          quoteAsset={market.quoteAsset}
          live={runtime.followingLive}
          onGoLive={() => controller?.goToLive()}
          onAddAlert={(price) => onAddAlert(price, market.symbol, quote?.close)}
          onOpenSettings={onOpenSettings}
          onClose={closeContextMenu}
        />
      )}

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
