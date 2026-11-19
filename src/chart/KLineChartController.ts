import { dispose, init, type Chart, type Coordinate, type Point } from 'klinecharts'
import { candleCloseMs } from './countdown'
import { formatCrosshairTime } from './timeAxis'
import { registerVolumeOverlay } from './volumeOverlay'
import { BASELINE_NAME, HEIKIN_ASHI_NAME, registerSeriesOverlays } from './seriesOverlay'
import { registerStudyIndicators } from './studyIndicators'
import { registerCompareOverlay } from './compareOverlay'
import { registerWave3Overlays } from './overlaysWave3'
import { registerScriptIndicator } from './scriptIndicator'
import { registerDominanceIndicators } from './dominance'
import { registerVwapIndicators } from './vwapIndicator'
import type { DrawingStore, DrawingStyle, DrawingType } from '../drawings'
import type { MarketInterval } from '../market'
import type { IndicatorSettings } from './indicators'
import { intervalToPeriod } from './intervals'
import { DRAWING_GROUP_ID } from './model'
import type { CryptoMarket } from './markets'
import { registerTradeHorizonOverlays } from './overlays'
import type { ChartRuntimeState, ChartType } from './types'
import { AlertLines } from './controller/alertLines'
import { ChartSyncLink, NavigationGuard } from './controller/chartSyncLink'
import { appearanceStyles, chartInitOptions, chartTypeStyles, themeStyles } from './controller/chartStyles'
import { CompareLayer } from './controller/compareLayer'
import { CrosshairDrag } from './controller/crosshairDrag'
import { DataFeed } from './controller/dataFeed'
import { DrawingLayer } from './controller/drawingLayer'
import { DrawingLoupe } from './controller/drawingLoupe'
import { DrawingTool } from './controller/drawingTool'
import {
  HISTORY_PAGE_SIZE,
  MAX_VIEWPORT_BACKFILL_PAGES,
  VIEWPORT_BACKFILL_MARGIN_BARS,
  chartBackground,
  intervalDurationMs,
} from './controller/helpers'
import { HoverTracker } from './controller/hoverTracker'
import { IndicatorLayers } from './controller/indicatorLayers'
import { createTimeTicks, paneRect, scrollToCentre } from './controller/paneGeometry'
import { PriceAxis } from './controller/priceAxis'
import { ReplayController } from './controller/replay'
import type {
  AlertLine,
  ChartAppearanceStyle,
  DrawingEvent,
  DrawingModes,
  HoverState,
  IndicatorValues,
  KLineChartControllerCallbacks,
  PendingViewport,
  ScaleMode,
} from './controller/types'

export type {
  AlertLine,
  ChartAppearanceStyle,
  DrawingEvent,
  DrawingModes,
  HoverState,
  IndicatorValues,
  KLineChartControllerCallbacks,
  ScaleMode,
} from './controller/types'

/** Bar width when the chart opens or its view is reset (Alt+R). */
const DEFAULT_BAR_SPACE = 10

registerTradeHorizonOverlays()
registerWave3Overlays()
registerDominanceIndicators()
registerVwapIndicators()
registerVolumeOverlay()
registerSeriesOverlays()
registerStudyIndicators()
registerCompareOverlay()
registerScriptIndicator()

/**
 * The bridge between the klinecharts canvas chart and the app: owns one chart and hands each concern to a collaborator
 * (candle feed, replay, price axis, indicators, compare lines, drawings and tools, alert lines, split-view sync).
 */
export class KLineChartController {
  readonly #chart: Chart
  readonly #host: HTMLElement
  readonly #drawingStore: DrawingStore
  readonly #callbacks: KLineChartControllerCallbacks
  readonly #navigation = new NavigationGuard()
  readonly #sync: ChartSyncLink
  readonly #replay: ReplayController
  readonly #feed: DataFeed
  readonly #priceAxis: PriceAxis
  readonly #compare: CompareLayer
  readonly #indicators: IndicatorLayers
  readonly #alerts: AlertLines
  readonly #drawings: DrawingLayer
  readonly #tools: DrawingTool
  readonly #loupe: DrawingLoupe
  readonly #crosshairDrag: CrosshairDrag
  readonly #hover: HoverTracker

  #interval: MarketInterval
  #runtimeState: ChartRuntimeState
  #drawingStoreUnsubscribe: () => void
  #disposed = false
  #pendingViewport?: PendingViewport
  readonly #viewListeners = new Set<() => void>()
  #timeZone = 'UTC'
  /** Date-range button waiting for its timeframe's candles. */
  #pendingRange?: { fromMs: number; interval: MarketInterval }

  /** Calls `listener` for double-clicks, context menus and selection changes on drawings; returns the unsubscribe. */
  public subscribeDrawingEvents(listener: (event: DrawingEvent) => void): () => void {
    return this.#drawings.subscribeDrawingEvents(listener)
  }

  /** Every selected drawing: the multi-selection, or the single selected one. */
  public getSelection(): string[] {
    return this.#drawings.getSelection()
  }

  /** Ends a multi-selection. */
  public clearSelection(): void {
    this.#drawings.clearSelection()
  }

  /** Applies the tool-rail toggles (lock all, hide all, stay in drawing mode). */
  public setDrawingModes(modes: DrawingModes): void {
    if (this.#disposed) return
    this.#drawings.setDrawingModes(modes)
  }

  readonly #handleManualNavigation = (): void => {
    if (!this.#navigation.ignoring && this.#runtimeState.followingLive) {
      this.#patchRuntime({ followingLive: false })
    }
    if (!this.#navigation.ignoring) this.#sync.queueTimeSync()
  }

  readonly #handleZoomSync = (): void => {
    if (!this.#navigation.ignoring) this.#sync.queueTimeSync()
  }

  /** Joins (or leaves) the split-view group of this chart's tab. */
  public setSync(group: string | undefined, options: { crosshair: boolean; time: boolean }): void {
    if (this.#disposed) return
    this.#sync.setSync(group, options)
  }

  /** Creates the chart in `host` for `market` at `interval`, showing the drawings of `drawingStore`. */
  public constructor(
    host: HTMLElement,
    interval: MarketInterval,
    market: CryptoMarket,
    drawingStore: DrawingStore,
    callbacks: KLineChartControllerCallbacks,
  ) {
    this.#interval = interval
    this.#host = host
    this.#drawingStore = drawingStore
    this.#callbacks = callbacks
    this.#runtimeState = {
      interval,
      connection: 'loading',
      quote: null,
      error: null,
      followingLive: true,
    }

    const chart = init(host, chartInitOptions())

    if (!chart) throw new Error('The chart could not be initialized.')
    this.#chart = chart

    const isDisposed = () => this.#disposed
    const currentInterval = () => this.#interval
    const patchRuntime = (patch: Partial<ChartRuntimeState>) => this.#patchRuntime(patch)
    const runtimeState = () => this.#runtimeState
    this.#sync = new ChartSyncLink({
      chart,
      host,
      symbol: market.symbol,
      isDisposed,
      isReplaying: () => !!this.#replay.session,
      intervalMs: () => this.#intervalMs(),
      navigation: this.#navigation,
      patchRuntime,
    })
    this.#hover = new HoverTracker({ chart, symbol: market.symbol, isDisposed, sync: this.#sync })
    this.#replay = new ReplayController({
      host,
      chart,
      isDisposed,
      patchRuntime,
      hasRuntimeReplay: () => !!this.#runtimeState.replay,
      reloadData: () => this.#feed.reload(),
    })
    this.#feed = new DataFeed({
      chart,
      market,
      interval: currentInterval,
      isDisposed,
      runtimeState,
      patchRuntime,
      replay: this.#replay,
      pendingViewport: () => this.#pendingViewport,
      afterInitialData: () => this.#afterInitialData(),
    })
    this.#compare = new CompareLayer({
      chart,
      market,
      interval: currentInterval,
      isDisposed,
      patchRuntime,
      emitView: this.#emitView,
      refreshPriceAxis: () => chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.#priceAxis.createPriceRange }),
    })
    this.#priceAxis = new PriceAxis({
      chart,
      widenRange: this.#compare.withCompareRange,
      emitView: this.#emitView,
      onPriceViewChange: (manual) => this.#callbacks.onPriceViewChange?.(manual),
      panBlocked: () => this.#tools.active || this.#replay.picking || this.#crosshairDrag.active,
    })
    this.#indicators = new IndicatorLayers({ chart, market, interval: currentInterval, isDisposed, runtimeState, patchRuntime })
    this.#alerts = new AlertLines(chart, callbacks)
    this.#drawings = new DrawingLayer({
      chart,
      store: drawingStore,
      market,
      callbacks,
      interval: currentInterval,
      isDisposed,
      isBusy: () => this.#tools.active || this.#replay.picking,
    })
    this.#tools = new DrawingTool({
      chart,
      host,
      store: drawingStore,
      market,
      drawings: this.#drawings,
      replay: this.#replay,
      interval: currentInterval,
      isDisposed,
      onToolSettled: () => this.#callbacks.onToolSettled(),
    })
    this.#loupe = new DrawingLoupe({ chart, host, isPlacing: () => this.#tools.active })
    this.#crosshairDrag = new CrosshairDrag({
      chart,
      isBusy: () => this.#tools.active || this.#replay.picking,
      onCrosshairRemoved: () => this.#hover.handleHostLeave(),
    })

    chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.#priceAxis.createPriceRange })
    // TradingView-style time axis and crosshair date, in the user's time zone.
    chart.overrideXAxis({ createTicks: this.#createTimeTicks })
    chart.setFormatter({ formatDate: ({ timestamp }) => formatCrosshairTime(timestamp, this.#timeZone, this.#intervalMs()) })
    chart.subscribeAction('onCrosshairChange', this.#hover.handleCrosshair)
    // The chart area never scrolls the page, so every finger drag belongs to the chart (pan, pinch, price pan).
    host.style.touchAction = 'none'
    // Without this a finger dragging on the price axis would be taken by the browser as a page gesture.
    const axisElement = chart.getDom('candle_pane', 'yAxis')
    if (axisElement) axisElement.style.touchAction = 'none'
    if (import.meta.env.DEV) {
      ;(globalThis as { __tradeHorizonChart?: Chart }).__tradeHorizonChart = chart
      ;(globalThis as { __tradeHorizonController?: unknown }).__tradeHorizonController = this
      ;((globalThis as { __tradeHorizonCharts?: Set<Chart> }).__tradeHorizonCharts ??= new Set()).add(chart)
    }

    chart.setSymbol({
      ticker: market.symbol,
      pricePrecision: market.pricePrecision,
      volumePrecision: market.volumePrecision,
    })
    chart.setPeriod(intervalToPeriod(interval))
    chart.setDataLoader(this.#feed.dataLoader)
    chart.setOffsetRightDistance(72)
    chart.subscribeAction('onScroll', this.#handleManualNavigation)
    chart.subscribeAction('onZoom', this.#handleZoomSync)
    chart.subscribeAction('onPaneDrag', this.#handleManualNavigation)
    chart.subscribeAction('onScroll', this.#emitView)
    chart.subscribeAction('onZoom', this.#emitView)
    chart.subscribeAction('onVisibleRangeChange', this.#emitView)

    const tools = this.#tools
    const drawings = this.#drawings
    const priceAxis = this.#priceAxis
    const feed = this.#feed
    // Capture-phase listeners let a drawing tool own the pointer before the chart starts panning.
    host.addEventListener('pointerdown', tools.handleToolPointerDown, true)
    host.addEventListener('pointerdown', drawings.handleDeselectPointerDown, true)
    host.addEventListener('pointerdown', priceAxis.handleAxisPointerDown, true)
    host.addEventListener('pointerdown', priceAxis.handlePanPointerDown, true)
    globalThis.addEventListener('pointermove', priceAxis.handlePanPointerMove, true)
    globalThis.addEventListener('pointerup', priceAxis.handlePanPointerEnd, true)
    globalThis.addEventListener('pointercancel', priceAxis.handlePanPointerEnd, true)
    host.addEventListener('mousedown', priceAxis.blockLibraryAxisGesture, true)
    host.addEventListener('touchstart', priceAxis.blockLibraryAxisGesture, true)
    host.addEventListener('dblclick', priceAxis.blockLibraryAxisGesture, true)
    host.addEventListener('wheel', priceAxis.handleAxisWheel, { capture: true, passive: false })
    document.addEventListener('visibilitychange', feed.handleVisibilityChange)
    globalThis.addEventListener('pagehide', feed.handlePageHide)
    globalThis.addEventListener('pageshow', feed.handleResumeNow)
    globalThis.addEventListener('online', feed.handleResumeNow)
    globalThis.addEventListener('pointermove', priceAxis.handleAxisPointerMove, true)
    globalThis.addEventListener('pointerup', priceAxis.handleAxisPointerEnd, true)
    host.addEventListener('pointerdown', drawings.handlePointerModifier, true)
    globalThis.addEventListener('pointermove', drawings.handlePointerModifier, true)
    globalThis.addEventListener('pointerup', drawings.handlePointerModifier, true)
    globalThis.addEventListener('keydown', drawings.handleKeyDown, true)
    globalThis.addEventListener('keyup', drawings.handleKeyUp, true)
    globalThis.addEventListener('blur', drawings.handleWindowBlur)
    host.addEventListener('mousedown', tools.blockChartWhileDrawing, true)
    host.addEventListener('touchstart', tools.blockChartWhileDrawing, true)
    // With the crosshair showing, a finger drag moves the crosshair instead of panning (see CrosshairDrag).
    host.addEventListener('touchstart', this.#crosshairDrag.handleTouchStart, true)
    host.addEventListener('touchmove', this.#crosshairDrag.handleTouchMove, { capture: true, passive: false })
    host.addEventListener('touchend', this.#crosshairDrag.handleTouchEnd, true)
    host.addEventListener('touchcancel', this.#crosshairDrag.handleTouchEnd, true)
    host.addEventListener('contextmenu', tools.handleToolContextMenu, true)
    host.addEventListener('pointerdown', drawings.trackSelectionPress, true)
    host.addEventListener('pointerleave', this.#handleHostLeave)
    globalThis.addEventListener('pointermove', tools.handleToolPointerMove, true)
    globalThis.addEventListener('pointerup', tools.handleToolPointerUp, true)
    globalThis.addEventListener('pointercancel', tools.handleToolPointerUp, true)
    // After the tool's own listeners, so the loupe paints the drawing as it is after this event.
    host.addEventListener('pointerdown', this.#loupe.handlePointerDown, true)
    globalThis.addEventListener('pointermove', this.#loupe.handlePointerMove, true)
    globalThis.addEventListener('pointerup', this.#loupe.handlePointerEnd, true)
    globalThis.addEventListener('pointercancel', this.#loupe.handlePointerEnd, true)

    this.#drawingStoreUnsubscribe = drawingStore.subscribe(() => this.#drawings.sync())
    this.#drawings.sync()
    callbacks.onRuntimeState(this.#runtimeState)
  }

  /** The chart's timeframe. */
  public get interval(): MarketInterval {
    return this.#interval
  }

  /** True while Shift is held (moves keep their price, lines lock to an axis). */
  public get isShiftHeld(): boolean {
    return this.#drawings.shiftHeld
  }

  /** Switches the timeframe, keeping the moment on screen (and a running replay) where possible. */
  public setInterval(interval: MarketInterval): void {
    if (this.#disposed || interval === this.#interval) return

    this.cancelActiveTool()
    this.#replay.prepareIntervalChange(interval)

    this.resetPriceView()
    this.#pendingViewport =
      this.#pendingRange?.interval === interval ? { followingLive: true, barSpace: this.#chart.getBarSpace().bar } : this.#captureViewport()
    this.#feed.cancelForIntervalChange()
    this.#interval = interval
    // With no candles every anchor maps to the same spot, so hide drawings until data arrives.
    for (const overlay of this.#chart.getOverlays({ groupId: DRAWING_GROUP_ID })) {
      this.#chart.overrideOverlay({ id: overlay.id, visible: false })
    }
    this.#chart.setPeriod(intervalToPeriod(interval))
    this.#indicators.syncDominanceData()
    this.#compare.reloadForInterval()
  }

  /** Loads the candles again (after an error). */
  public retry(): void {
    if (this.#disposed) return
    this.#feed.retry()
  }

  /** Scrolls to the newest candle and follows new ones. */
  public goToLive(): void {
    if (this.#disposed) return
    this.#navigation.run(() => this.#chart.scrollToRealTime(240))
    this.#patchRuntime({ followingLive: true })
  }

  /** Candles, bars, hollow candles, area, Heikin Ashi or baseline. */
  public setChartType(type: ChartType): void {
    if (this.#disposed) return
    this.#chart.setStyles(chartTypeStyles(type) as never)
    // Heikin Ashi and baseline are our own series over the (hidden) candles.
    const wanted = type === 'heikinAshi' ? HEIKIN_ASHI_NAME : type === 'baseline' ? BASELINE_NAME : undefined
    this.#indicators.setSeries(wanted)
  }

  /** Price-pane bounds and the price under a viewport Y, for UI layered over the chart (alert "+" button). */
  public pricePaneBounds(): DOMRect | null {
    return paneRect(this.#chart)
  }

  /** The price at a viewport Y on the price pane (clamped to it), rounded to the symbol's precision. */
  public priceAtClientY(clientY: number): number | null {
    const rect = paneRect(this.#chart)
    if (!rect) return null
    const y = Math.min(rect.height, Math.max(0, clientY - rect.top))
    const [raw] = this.#chart.convertFromPixel([{ x: 0, y }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
    if (raw?.value === undefined || !Number.isFinite(raw.value)) return null
    return Number(raw.value.toFixed(this.#chart.getSymbol()?.pricePrecision ?? 2))
  }

  /** Arms bar replay: the next click on the chart chooses the bar to rewind to. */
  public startReplaySelection(): void {
    if (this.#disposed) return
    this.cancelActiveTool()
    this.#replay.startSelection()
  }

  /** Disarms the replay bar picker. */
  public cancelReplaySelection(): void {
    this.#replay.cancelSelection()
  }

  /** Shows the next bar of the replay. */
  public stepReplay(): void {
    this.#replay.step()
  }

  /** Plays (or pauses) the replay. */
  public setReplayPlaying(playing: boolean): void {
    this.#replay.setPlaying(playing)
  }

  /** Milliseconds per replayed bar. */
  public setReplaySpeed(speedMs: number): void {
    this.#replay.setSpeed(speedMs)
  }

  /** Leaves replay and reloads live data. */
  public exitReplay(): void {
    this.#replay.exit()
  }

  /** Draws the chart in this IANA time zone (axis labels, crosshair date). */
  public setTimeZone(timeZone: string): void {
    if (this.#disposed || timeZone === this.#timeZone) return
    this.#timeZone = timeZone
    this.#chart.setTimezone(timeZone)
    this.#chart.overrideXAxis({ createTicks: this.#createTimeTicks })
  }

  /** Chart settings window: candle colours, wicks, background, grid and the last-price line. */
  public setAppearance(appearance: ChartAppearanceStyle): void {
    if (this.#disposed) return
    this.#chart.setStyles(appearanceStyles(appearance) as never)
    // The canvases are transparent; a custom background goes on the host (and so into chart pictures too).
    this.#host.style.background = appearance.background ?? ''
  }

  /** Labels at the highest and lowest visible price. */
  public setHighLowLabels(show: boolean): void {
    if (this.#disposed) return
    this.#chart.setStyles({ candle: { priceMark: { high: { show }, low: { show } } } })
  }

  /** Normal, logarithmic or percent price scale. */
  public setScaleMode(mode: ScaleMode): void {
    if (this.#disposed || mode === this.#priceAxis.scaleMode) return
    this.#priceAxis.setScaleMode(mode)
  }

  /** The price scale mode in effect. */
  public getScaleMode(): ScaleMode {
    return this.#priceAxis.scaleMode
  }

  /**
   * Date-range buttons (1D, 5D, 1M …): show from `fromMs` to now on `interval`. When the timeframe is about to change,
   * the fit waits for the new candles.
   */
  public showRange(fromMs: number, interval: MarketInterval): void {
    if (this.#disposed) return
    this.#pendingRange = { fromMs, interval }
    if (interval === this.#interval && this.#chart.getDataList().length > 0) this.#applyPendingRange()
  }

  #applyPendingRange(): void {
    const pending = this.#pendingRange
    if (!pending || pending.interval !== this.#interval) return
    this.#pendingRange = undefined
    const data = this.#chart.getDataList()
    if (data.length === 0) return
    let first = data.findIndex((bar) => bar.timestamp >= pending.fromMs)
    if (first < 0) first = data.length - 1
    const count = Math.max(1, data.length - first)
    const width = (this.#chart.getSize('candle_pane', 'main')?.width ?? this.#host.clientWidth) - this.#chart.getOffsetRightDistance()
    this.resetPriceView()
    this.#chart.setBarSpace(Math.min(40, Math.max(1, width / count)))
    this.#navigation.run(() => this.#chart.scrollToRealTime())
    this.#patchRuntime({ followingLive: true })
  }

  /**
   * Go to date: centre the chart on a moment, loading older candles first when they are not on the chart yet.
   * Returns false when that moment is further back than the history this timeframe loads at once.
   */
  public goToTime(timeMs: number): boolean {
    if (this.#disposed || this.#replay.session) return false
    const data = this.#chart.getDataList()
    if (data.length > 0 && data[0].timestamp <= timeMs) {
      this.#navigation.run(() => scrollToCentre(this.#chart, this.#host, Math.min(timeMs, data[data.length - 1].timestamp)))
      this.#patchRuntime({ followingLive: timeMs >= data[data.length - 1].timestamp })
      return true
    }
    const barsBack = (Date.now() - timeMs) / this.#intervalMs()
    if (barsBack > (MAX_VIEWPORT_BACKFILL_PAGES + 1) * HISTORY_PAGE_SIZE - VIEWPORT_BACKFILL_MARGIN_BARS) return false
    this.#pendingViewport = { followingLive: false, centerTimeMs: timeMs, barSpace: this.#chart.getBarSpace().bar }
    this.retry()
    return true
  }

  /** TradingView's "Reset chart view" (Alt+R): automatic price scale, default zoom, latest candles. */
  public resetView(): void {
    if (this.#disposed) return
    this.resetPriceView()
    this.#chart.setBarSpace(DEFAULT_BAR_SPACE)
    this.goToLive()
  }

  /**
   * The chart as a PNG data URL with its drawings, its size in CSS pixels and the colour behind it. The crosshair is
   * hidden first (TradingView's pictures have none); the library redraws on the next animation frame, so this waits.
   */
  public async snapshot(): Promise<{ url: string; width: number; height: number; background: string } | null> {
    if (this.#disposed) return null
    this.#chart.executeAction('onCrosshairChange', null as never)
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 120)
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    if (this.#disposed) return null
    const background = chartBackground(this.#host)
    const url = this.#chart.getConvertPictureUrl(true, 'png', background)
    return url ? { url, width: this.#host.clientWidth, height: this.#host.clientHeight, background } : null
  }

  /** Calls `listener` when the hovered candle changes; returns the unsubscribe. */
  public readonly subscribeHover = (listener: () => void): (() => void) => this.#hover.subscribe(listener)

  /** The candle under the crosshair, or null. */
  public readonly getHover = (): HoverState | null => this.#hover.hover

  /** The newest candle on the chart and the close before it, read when needed (no React state follows every tick). */
  public latestCandle(): { open: number; high: number; low: number; close: number; volume?: number; previousClose?: number } | undefined {
    if (this.#disposed) return undefined
    const list = this.#chart.getDataList()
    const last = list[list.length - 1]
    return last
      ? {
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          volume: last.volume,
          previousClose: list[list.length - 2]?.close,
        }
      : undefined
  }

  /** Close of the candle before the newest one (the legend's change is measured from it). */
  public latestPreviousClose(): number | undefined {
    const list = this.#chart.getDataList()
    return list[list.length - 2]?.close
  }

  /** Moving average and VWAP values for a candle (the newest when `index` is undefined). */
  public indicatorValuesAt(index?: number): IndicatorValues {
    return this.#indicators.indicatorValuesAt(index)
  }

  /** Time-axis labels on round times in the user's zone (see timeAxis.ts), also over the empty space to the right. */
  readonly #createTimeTicks = (params: Parameters<typeof createTimeTicks>[3]) =>
    createTimeTicks(this.#chart, this.#timeZone, this.#intervalMs(), params)

  /** Shows or hides the volume bars. */
  public setVolumeVisible(requested: boolean): void {
    if (this.#disposed) return
    this.#indicators.setVolumeVisible(requested)
  }

  /** Applies the indicator settings: moving averages, VWAPs, dominance panes, studies, compare symbols and scripts. */
  public setIndicators(settings: IndicatorSettings): void {
    if (this.#disposed) return
    this.#indicators.applyMovingAverage('sma', settings.sma)
    this.#indicators.applyMovingAverage('ema', settings.ema)
    this.#indicators.applyVwap('vwap', settings.vwap.visible, settings.vwap.anchor)
    this.#indicators.applyVwap('qvwap', settings.qvwap.visible, 'quarter')
    this.#indicators.applyDominance(settings.dominance)
    this.#indicators.applyStudies(settings.studies)
    this.#compare.apply(settings.compare)
    this.#indicators.applyScripts(settings.scripts)
  }

  /** A script's plots at a candle (the newest when `index` is undefined), for the legend of scripts on the candles. */
  public scriptValuesAt(instanceId: string, index?: number): Array<{ title: string; color: string; value?: number }> {
    return this.#indicators.scriptValuesAt(instanceId, index)
  }

  /** Legend: each compare symbol's colour, last close and change over the visible candles. */
  public compareLegend(): Array<{ symbol: string; color: string; last?: number; changePercent?: number }> {
    if (this.#disposed) return []
    return this.#compare.legend()
  }

  /** A library study's line values at a candle (the newest when `index` is undefined), in its lines' order. */
  public studyValuesAt(studyId: string, index?: number): Array<number | undefined> {
    return this.#indicators.studyValuesAt(studyId, index)
  }

  /** Style that new drawings of a type start with, e.g. the user's default rectangle template. */
  public setToolDefaultStyle(type: DrawingType, style: DrawingStyle | undefined): void {
    this.#drawings.setToolDefaultStyle(type, style)
  }

  /** Arms a drawing tool; false when the chart is gone. */
  public startTool(type: DrawingType): boolean {
    return this.#tools.start(type)
  }

  /** Puts the armed drawing tool away. */
  public cancelActiveTool(): void {
    this.#tools.cancel()
  }

  /** Turns the magnet (snap to candle prices) on or off. */
  public setMagnet(enabled: boolean): void {
    this.#drawings.setMagnet(enabled)
  }

  /** Places a copy of a drawing next to it and selects the copy. */
  public cloneDrawing(id: string): void {
    this.#drawings.cloneDrawing(id)
  }

  #intervalMs(): number {
    return intervalDurationMs(this.#interval)
  }

  /** Back to the automatic price fit (no zoom, no vertical pan). */
  public resetPriceView(): void {
    this.#priceAxis.resetPriceView()
  }

  /** Shows these price alerts as draggable lines (an empty list hides them all). */
  public setAlertLines(lines: readonly AlertLine[]): void {
    if (this.#disposed) return
    this.#alerts.set(lines)
  }

  /** True while the pointer is over a drawing (a right-click there selects the drawing instead of opening the chart menu). */
  public drawingUnderPointer(): boolean {
    return this.#drawings.drawingUnderPointer()
  }

  /** Id of the drawing a finger is holding right now, if any; used to open its menu on a long press. */
  public pressedDrawingId(): string | undefined {
    return this.#drawings.pressedDrawingId()
  }

  /** Selects a drawing and opens its menu at a point on the screen (client coordinates). */
  public openDrawingMenu(id: string, clientX: number, clientY: number): void {
    this.#drawings.openContextMenu(id, clientX, clientY)
  }

  /** Deletes the selected drawing (or the whole multi-selection). */
  public deleteSelected(): void {
    this.#drawings.deleteSelected()
  }

  /** Selects a drawing and scrolls it to the middle of the chart. */
  public focusDrawing(id: string): void {
    const drawing = this.#drawingStore.getSnapshot().drawings.find((item) => item.id === id)
    if (!drawing) return

    this.#drawings.selectOverlay(id)
    const centerTimeMs = Math.round(drawing.anchors.reduce((sum, anchor) => sum + anchor.timeMs, 0) / drawing.anchors.length)
    this.#navigation.run(() => scrollToCentre(this.#chart, this.#host, centerTimeMs, 180))
  }

  /** Re-colors the chart canvas (grid, axes, crosshair, legends) for the app theme. */
  public setTheme(theme: 'dark' | 'light'): void {
    this.#chart.setStyles(themeStyles(theme) as never)
  }

  /** Deselects every drawing, including the library's own click state. */
  public clearDrawingSelection(): void {
    this.#drawings.clearDrawingSelection()
  }

  /** Stops every feed, timer and listener and destroys the chart. */
  public dispose(): void {
    if (this.#disposed) return
    this.#sync.dispose()
    this.#compare.dispose()
    if (import.meta.env.DEV) (globalThis as { __tradeHorizonCharts?: Set<Chart> }).__tradeHorizonCharts?.delete(this.#chart)
    this.#disposed = true
    this.#feed.dispose()
    this.#drawingStoreUnsubscribe()
    this.#chart.unsubscribeAction('onScroll', this.#handleManualNavigation)
    this.#chart.unsubscribeAction('onPaneDrag', this.#handleManualNavigation)
    this.#chart.unsubscribeAction('onScroll', this.#emitView)
    this.#chart.unsubscribeAction('onZoom', this.#emitView)
    this.#chart.unsubscribeAction('onVisibleRangeChange', this.#emitView)
    this.#viewListeners.clear()
    this.#feed.stopDominancePolling()
    this.#replay.stopTimer()
    this.#indicators.dispose()
    const tools = this.#tools
    const drawings = this.#drawings
    const priceAxis = this.#priceAxis
    const feed = this.#feed
    this.#host.removeEventListener('pointerdown', tools.handleToolPointerDown, true)
    this.#host.removeEventListener('pointerdown', drawings.handleDeselectPointerDown, true)
    this.#host.removeEventListener('pointerdown', priceAxis.handleAxisPointerDown, true)
    this.#host.removeEventListener('pointerdown', priceAxis.handlePanPointerDown, true)
    globalThis.removeEventListener('pointermove', priceAxis.handlePanPointerMove, true)
    globalThis.removeEventListener('pointerup', priceAxis.handlePanPointerEnd, true)
    globalThis.removeEventListener('pointercancel', priceAxis.handlePanPointerEnd, true)
    this.#host.removeEventListener('mousedown', priceAxis.blockLibraryAxisGesture, true)
    this.#host.removeEventListener('touchstart', priceAxis.blockLibraryAxisGesture, true)
    this.#host.removeEventListener('dblclick', priceAxis.blockLibraryAxisGesture, true)
    this.#host.removeEventListener('wheel', priceAxis.handleAxisWheel, true)
    document.removeEventListener('visibilitychange', feed.handleVisibilityChange)
    globalThis.removeEventListener('pagehide', feed.handlePageHide)
    globalThis.removeEventListener('pageshow', feed.handleResumeNow)
    globalThis.removeEventListener('online', feed.handleResumeNow)
    feed.clearStatusTimer()
    globalThis.removeEventListener('pointermove', priceAxis.handleAxisPointerMove, true)
    globalThis.removeEventListener('pointerup', priceAxis.handleAxisPointerEnd, true)
    globalThis.removeEventListener('pointercancel', priceAxis.handleAxisPointerEnd, true)
    this.#host.removeEventListener('pointerdown', drawings.handlePointerModifier, true)
    globalThis.removeEventListener('pointermove', drawings.handlePointerModifier, true)
    globalThis.removeEventListener('pointerup', drawings.handlePointerModifier, true)
    globalThis.removeEventListener('keydown', drawings.handleKeyDown, true)
    globalThis.removeEventListener('keyup', drawings.handleKeyUp, true)
    globalThis.removeEventListener('blur', drawings.handleWindowBlur)
    this.#host.removeEventListener('mousedown', tools.blockChartWhileDrawing, true)
    this.#host.removeEventListener('touchstart', tools.blockChartWhileDrawing, true)
    this.#host.removeEventListener('touchstart', this.#crosshairDrag.handleTouchStart, true)
    this.#host.removeEventListener('touchmove', this.#crosshairDrag.handleTouchMove, true)
    this.#host.removeEventListener('touchend', this.#crosshairDrag.handleTouchEnd, true)
    this.#host.removeEventListener('touchcancel', this.#crosshairDrag.handleTouchEnd, true)
    this.#host.removeEventListener('contextmenu', tools.handleToolContextMenu, true)
    this.#host.removeEventListener('pointerdown', drawings.trackSelectionPress, true)
    this.#host.removeEventListener('pointerleave', this.#handleHostLeave)
    this.#chart.unsubscribeAction('onCrosshairChange', this.#hover.handleCrosshair)
    this.#hover.clearListeners()
    globalThis.removeEventListener('pointermove', tools.handleToolPointerMove, true)
    globalThis.removeEventListener('pointerup', tools.handleToolPointerUp, true)
    globalThis.removeEventListener('pointercancel', tools.handleToolPointerUp, true)
    this.#host.removeEventListener('pointerdown', this.#loupe.handlePointerDown, true)
    globalThis.removeEventListener('pointermove', this.#loupe.handlePointerMove, true)
    globalThis.removeEventListener('pointerup', this.#loupe.handlePointerEnd, true)
    globalThis.removeEventListener('pointercancel', this.#loupe.handlePointerEnd, true)
    this.#loupe.dispose()
    this.#host.classList.remove('tool-active')
    this.#navigation.dispose()
    dispose(this.#chart)
  }

  /**
   * The pointer left the chart. A lifted finger also counts as leaving, but a crosshair that a tap put on screen
   * stays there, and so does the candle it points at.
   */
  readonly #handleHostLeave = (): void => {
    if (!this.#crosshairDrag.active) this.#hover.handleHostLeave()
  }

  #patchRuntime(patch: Partial<ChartRuntimeState>): void {
    this.#runtimeState = { ...this.#runtimeState, ...patch }
    this.#callbacks.onRuntimeState(this.#runtimeState)
    this.#emitView()
  }

  readonly #emitView = (): void => {
    for (const listener of this.#viewListeners) listener()
  }

  /** Called when what is on screen may have moved (scroll, zoom, price view, new price). */
  public onViewChange(listener: () => void): () => void {
    this.#viewListeners.add(listener)
    return () => {
      this.#viewListeners.delete(listener)
    }
  }

  /**
   * Time left in the current candle and where to show it: just under the last-price tag on the
   * price axis, in coordinates of the chart host. Null when there is nothing sensible to show.
   * Pure client clock and chart maths; nothing is requested from the server.
   */
  public countdownState(now = Date.now()): { remainingMs: number; top: number; left: number; width: number; up: boolean } | null {
    if (this.#disposed || this.#replay.session || this.#replay.pending) return null
    const last = this.#chart.getDataList().at(-1)
    const axis = this.#chart.getDom('candle_pane', 'yAxis')?.getBoundingClientRect()
    const pane = paneRect(this.#chart)
    if (!last || !axis || !pane) return null
    const remainingMs = candleCloseMs(last.timestamp, this.#interval) - now
    // A stale last candle (feed down, market paused) would count down from the past.
    if (remainingMs < -this.#intervalMs()) return null
    const y = (this.#chart.convertToPixel({ value: last.close }, { paneId: 'candle_pane' }) as Partial<Coordinate>).y
    if (y === undefined || !Number.isFinite(y) || y < 0 || y > pane.height) return null
    const host = this.#host.getBoundingClientRect()
    return { remainingMs, top: pane.top - host.top + y, left: axis.left - host.left, width: axis.width, up: last.close >= last.open }
  }

  #captureViewport(): PendingViewport {
    const range = this.#chart.getVisibleRange()
    const data = this.#chart.getDataList()
    const centerIndex = Math.max(0, Math.min(data.length - 1, Math.round((range.from + range.to) / 2)))
    const centerTimeMs = data[centerIndex]?.timestamp

    return {
      followingLive: this.#runtimeState.followingLive,
      ...(centerTimeMs === undefined ? {} : { centerTimeMs }),
      barSpace: this.#chart.getBarSpace().bar,
    }
  }

  #afterInitialData(): void {
    globalThis.requestAnimationFrame(() => {
      if (this.#disposed) return
      const pending = this.#pendingViewport
      this.#pendingViewport = undefined

      if (pending) {
        this.#chart.setBarSpace(pending.barSpace)
        if (pending.followingLive || pending.centerTimeMs === undefined) {
          this.#navigation.run(() => this.#chart.scrollToRealTime())
        } else {
          this.#navigation.run(() => scrollToCentre(this.#chart, this.#host, pending.centerTimeMs!))
        }
      } else {
        this.#navigation.run(() => this.#chart.scrollToRealTime())
      }
      this.#applyPendingRange()

      this.#drawings.sync()
    })
  }
}
