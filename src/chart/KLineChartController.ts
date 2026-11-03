import {
  dispose,
  init,
  type Chart,
  type Coordinate,
  type DataLoader,
  type AxisCreateRangeCallback,
  type KLineData,
  type OverlayCreate,
  type OverlayEvent,
  type Point,
} from 'klinecharts'
import { candleCloseMs } from './countdown'
import { buildTimeTicks, formatCrosshairTime } from './timeAxis'
import { VOLUME_OVERLAY_NAME, registerVolumeOverlay } from './volumeOverlay'
import { BASELINE_NAME, HEIKIN_ASHI_NAME, registerSeriesOverlays } from './seriesOverlay'
import { registerStudyIndicators, studyIndicatorName } from './studyIndicators'
import { exchangeSymbol } from '../market/binance/futures'
import { COMPARE_INDICATOR_NAME, registerCompareOverlay, type CompareSeries } from './compareOverlay'
import { COMPARE_COLORS, compareChange, scaledCompare } from './compare'
import { getMarket, type CryptoMarket as CompareMarket } from './markets'
import { STUDIES, type Study } from './studies'
import { fibLevels, visibleOnInterval } from './drawingVisibility'
import { broadcastCrosshair, broadcastTime, followerBarSpace, joinSyncGroup, type SyncMember, type SyncedCrosshair, type SyncedTime } from './chartSync'
import { ALERT_LINE_OVERLAY_NAME } from './overlayNames'
import { QVWAP_INDICATOR_NAME, VWAP_INDICATOR_NAME, registerVwapIndicators } from './vwapIndicator'
import { VWAP_ANCHORS } from './vwap'
import { MAX_CACHE_GAP_BARS, loadCachedBars, saveCachedBars } from './candleCache'
import {
  batchDrawings,
  createDrawing,
  deleteDrawing,
  updateDrawing,
  type Anchor,
  type Drawing,
  type DrawingStyle,
  type DrawingType,
  type DrawingStore,
} from '../drawings'
import {
  BinanceKlineSubscription,
  BINANCE_FUTURES_REST_ENDPOINT,
  BINANCE_FUTURES_WS_ENDPOINT,
  BybitKlineSubscription,
  fetchBybitKlines,
  LatestBinanceKlinesLoader,
  MARKET_INTERVAL_SPECS,
  StaleMarketDataRequestError,
  fetchBinanceKlines,
  type Candle,
  type DominanceRow,
  type FetchBinanceKlinesOptions,
  type KlineStreamStatus,
  type MarketInterval,
} from '../market'
import {
  DOMINANCE_KEYS,
  dominanceCalc,
  dominanceCandles,
  dominanceIndicatorName,
  fetchDominancePage,
  loadDominanceWeights,
  registerDominanceIndicators,
} from './dominance'
import {
  lockToAxis,
  magnetPrice,
  positionPoints,
  rectanglePoints,
  stackLevels,
  translatePoints,
  type ChartPoint,
} from './geometry'
import {
  DOMINANCE_COLORS,
  MOVING_AVERAGE_COLORS,
  VWAP_COLORS,
  movingAverageActive,
  type DominanceKey,
  type IndicatorSettings,
  type MovingAverageKind,
  type MovingAverageSettings,
} from './indicators'
import { intervalToPeriod, periodToInterval } from './intervals'
import {
  DRAWING_GROUP_ID,
  candleToKLineData,
  decimalString,
  drawingFromOverlay,
  drawingPoints,
} from './model'
import type { CryptoMarket } from './markets'
import { registerTradeHorizonOverlays } from './overlays'
import { DEFAULT_REPLAY_SPEED_MS, replayStartCursor, replayTransitionCursor } from './replay'
import { DRAWING_TOOLS } from './tools'
import { candleToQuote, type ChartQuote, type ChartRuntimeState, type ChartType } from './types'

const HISTORY_PAGE_SIZE = 1000
/** Coming back after this long, replace the live connection even if it looks open. */
const RESUME_RECONNECT_AFTER_MS = 10_000
/** A dropped live connection is only shown to the user if it has not recovered after this long. */
const STATUS_GRACE_MS = 1500
/** Drag distance before a press on the chart counts as a pan rather than a click. */
const PAN_START_PX = 6
/** The library adds empty space above and below the candles (gap 0.16 + 0.12), so a pixel of drag is worth this many range fractions. */
const PRICE_GAP_FACTOR = 1.28
const PRICE_SCALE_MIN = 0.05
const PRICE_SCALE_MAX = 20
/** Pixels of drag (or wheel) for the price range to change by a factor of e (about 2.7). */
const AXIS_DRAG_PIXELS_PER_E = 160
const AXIS_WHEEL_PIXELS_PER_E = 500
const AXIS_DOUBLE_PRESS_MS = 320
/** Extra history pages fetched so a timeframe switch can keep the part of the chart you were looking at. */
const MAX_VIEWPORT_BACKFILL_PAGES = 10
const VIEWPORT_BACKFILL_MARGIN_BARS = 200
const DRAG_THRESHOLD_PX = 4
const MAGNET_TOLERANCE_PX = 12
const DOMINANCE_POLL_MS = 20_000
const DOMINANCE_INDICATOR_REFRESH_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const POINT_HANDLE_KEY_PREFIX = 'overlay_figure_point_'
// The HTML legend lists moving averages, so the library's own overlapping label is blanked.
/** The colour behind the chart (its canvases are transparent), for pictures of it. */
function chartBackground(element: HTMLElement): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color
  }
  return '#131722'
}

/** Price scale of the candle pane: regular, logarithmic, or percent from the first visible candle. */
export type ScaleMode = 'normal' | 'log' | 'percent'

/** What the chart settings window controls (kept free of app imports; preferences.ts has the stored form). */
export interface ChartAppearanceStyle {
  readonly upColor: string
  readonly downColor: string
  readonly wicks: boolean
  readonly background: string | null
  readonly grid: 'both' | 'vertical' | 'horizontal' | 'none'
  readonly lastPriceLine: boolean
}

/** Bar width when the chart opens or its view is reset (Alt+R). */
const DEFAULT_BAR_SPACE = 10
const HIDDEN_INDICATOR_TOOLTIP = { name: '', calcParamsText: '', features: [], legends: [] }

registerTradeHorizonOverlays()
registerDominanceIndicators()
registerVwapIndicators()
registerVolumeOverlay()
registerSeriesOverlays()
registerStudyIndicators()
registerCompareOverlay()

/** The candle under the crosshair, for the legend (TradingView shows the hovered candle's values). */
export interface HoverState {
  readonly index: number
  readonly bar: { readonly timestamp: number, readonly open: number, readonly high: number, readonly low: number, readonly close: number, readonly volume?: number }
  readonly previousClose?: number
  /** The newest candle: the legend shows live values instead. */
  readonly latest: boolean
}

/** Indicator values for one candle, in the order the legend lists them. */
export interface IndicatorValues {
  readonly sma: ReadonlyArray<number | undefined>
  readonly ema: ReadonlyArray<number | undefined>
  readonly vwap?: number
  readonly qvwap?: number
}

interface ToolSession {
  type: DrawingType
  draftId?: string
  start?: ChartPoint
  current?: ChartPoint
  pressOrigin?: { x: number; y: number }
  pointerId?: number
  dragged: boolean
  createdThisPress: boolean
}

interface OverlayMove {
  id: string
  startIndex: number
  startValue: number
  points: ChartPoint[]
}

function barToQuote(bar: KLineData): ChartQuote {
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    changePercent: bar.open === 0 ? 0 : ((bar.close - bar.open) / bar.open) * 100,
    isFinal: false,
    updatedAtMs: Date.now(),
  }
}

function anchorsEqual(a: readonly Anchor[], b: readonly Anchor[]): boolean {
  return a.length === b.length && a.every((anchor, index) => (
    anchor.timeMs === b[index].timeMs && anchor.price === b[index].price
  ))
}

interface ReplaySession {
  /** Every bar that was loaded when the replay began; the chart shows the first `cursor` of them. */
  bars: KLineData[]
  cursor: number
  speedMs: number
  push?: (bar: KLineData) => void
  timer?: ReturnType<typeof globalThis.setInterval>
}

interface PendingReplay {
  targetTimeMs: number
  speedMs: number
  wasPlaying: boolean
  wasPicking: boolean
}

interface PendingViewport {
  followingLive: boolean
  centerTimeMs?: number
  barSpace: number
}

export interface KLineChartControllerCallbacks {
  onRuntimeState(state: ChartRuntimeState): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
  /** The price scale was moved or zoomed by the user (true) or is back on automatic fit (false). */
  onPriceViewChange?(manual: boolean): void
  /** An alert line was dragged to a new price. */
  onAlertMove?(id: string, price: number): void
  /** The ✕ on an alert line was clicked. */
  onAlertDelete?(id: string): void
}

/** Drawing gestures the app answers with its own UI (settings window, context menu, multi-selection toolbar). */
export type DrawingEvent =
  | { readonly kind: 'doubleClick', readonly id: string }
  | { readonly kind: 'contextMenu', readonly id: string, readonly clientX: number, readonly clientY: number }
  | { readonly kind: 'selection', readonly ids: readonly string[] }

/** Tool-rail toggles that apply to every drawing. */
export interface DrawingModes {
  /** Keep the tool armed after a drawing is placed. */
  readonly stayInDrawingMode: boolean
  readonly lockAll: boolean
  readonly hideAll: boolean
}

/** A price alert shown as a line on this chart. */
export interface AlertLine {
  readonly id: string
  readonly price: number
  readonly paused: boolean
}

const ALERT_GROUP_ID = 'trade-horizon:alerts'
const ALERT_OVERLAY_PREFIX = 'alert:'
const ALERT_COLOR = '#f5a623'
/**
 * Stacking (klinecharts zLevel): drawings get theirs from stackLevels() and keep it while hovered, because the
 * library's hover-raise would leave a big box on top of a small box inside it, so the small one could not be clicked.
 * A drawing being placed sits above all of them, alert lines above everything.
 */
const DRAFT_Z_LEVEL = 1_000_000
const ALERT_Z_LEVEL = 2_000_000
const ALERT_PAUSED_COLOR = '#787b86'

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `trend-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Market data is temporarily unavailable.'
}

function colorWithOpacity(color: string, opacityPercent: number): string {
  const opacity = Math.max(0, Math.min(100, opacityPercent)) / 100
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const value = hex[1]
    return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${opacity})`
  }

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color)
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})` : color
}

export class KLineChartController {
  readonly #chart: Chart
  readonly #host: HTMLElement
  readonly #drawingStore: DrawingStore
  readonly #callbacks: KLineChartControllerCallbacks
  readonly #market: CryptoMarket
  readonly #historyLoader = new LatestBinanceKlinesLoader((options) => this.#fetchKlines(options))

  #interval: MarketInterval
  #runtimeState: ChartRuntimeState
  #stream?: { stop(): void; nudge?(force?: boolean): void }
  readonly #vwapIds = new Map<'vwap' | 'qvwap', string>()
  #hiddenAtMs?: number
  #statusTimer?: ReturnType<typeof globalThis.setTimeout>
  /** True when the chart was painted from the local candle cache and still has to catch up with the exchange. */
  #catchUpPending = false
  readonly #toolStyles = new Map<DrawingType, DrawingStyle>()
  /** Price-axis zoom: 1 is the automatic fit, above 1 zooms out, below 1 zooms in. Reset by double-click/tap on the axis. */
  #priceScale = 1
  /** Vertical pan of the price view, as a fraction of the automatic price range (positive shows higher prices). */
  #priceOffset = 0
  #pan?: { pointerId: number; startY: number; startOffset: number; active: boolean }
  readonly #pointersDown = new Set<number>()
  #axisGesture?: { pointerId: number; startY: number; startScale: number }
  #lastAxisPressMs = 0
  #drawingStoreUnsubscribe: () => void
  #dataEpoch = 0
  #disposed = false
  #activeDrawingId?: string
  #selectedDrawingId?: string
  #suppressDrawingEvents = false
  #pendingViewport?: PendingViewport
  #ignoreNavigationEvents = false
  #navigationTimer?: ReturnType<typeof globalThis.setTimeout>
  #volumeIndicatorId?: string
  #tool?: ToolSession
  #overlayMove?: OverlayMove
  #magnet = false
  #dominancePoll?: ReturnType<typeof globalThis.setInterval>
  #replay?: ReplaySession
  #pendingReplay?: PendingReplay
  #replayPicking = false
  #shiftHeld = false
  #drawingModes: DrawingModes = { stayInDrawingMode: false, lockAll: false, hideAll: false }
  // Split-view sync: the group is the tab; crosshair and time are passed to its other charts.
  #syncGroup?: string
  #syncOptions = { crosshair: false, time: false }
  #leaveSync?: () => void
  #applyingSync = false
  #timeSyncFrame?: number
  readonly #syncMember: SyncMember = {
    syncedCrosshair: (state) => this.#applySyncedCrosshair(state),
    syncedTime: (state) => this.#applySyncedTime(state),
  }
  /** Drawings selected together (Ctrl/Shift+click); the library itself only knows one selected overlay. */
  readonly #multiSelection = new Set<string>()
  #modifierPress = false
  #groupSeed?: string
  readonly #drawingListeners = new Set<(event: DrawingEvent) => void>()
  /** Start points of the other drawings while a multi-selection is dragged. */
  #groupMove?: Map<string, ChartPoint[]>
  #lastOverlayMoveEvent?: OverlayEvent<unknown>
  readonly #viewListeners = new Set<() => void>()
  #timeZone = 'UTC'
  #hover: HoverState | null = null
  #seriesIndicator: { id: string, name: string } | undefined
  #scaleMode: ScaleMode = 'normal'
  /** Compare symbols: their candles at this chart's timeframe, refreshed while shown. */
  #compareSymbols: readonly string[] = []
  #compareSeries: CompareSeries[] = []
  #compareIndicatorId?: string
  #compareTimer?: ReturnType<typeof globalThis.setInterval>
  #compareEpoch = 0
  /** Indicator-library studies on the chart: study id -> klinecharts indicator. */
  readonly #studyIds = new Map<string, { indicatorId: string, type: Study['type'] }>()
  /** Date-range button waiting for its timeframe's candles. */
  #pendingRange?: { fromMs: number, interval: MarketInterval }
  readonly #hoverListeners = new Set<() => void>()
  #alertLines: readonly AlertLine[] = []
  #stackLevels = new Map<string, number>()
  readonly #movingAverageIds = new Map<MovingAverageKind, string>()
  readonly #dominanceIds = new Map<DominanceKey, string>()
  #dominanceRows?: DominanceRow[]
  #dominanceRowsInterval?: MarketInterval
  #dominanceReference?: Record<string, number>
  #dominanceIndicatorPoll?: ReturnType<typeof globalThis.setInterval>
  #dominanceEpoch = 0

  readonly #trackSelectionPress = (event: PointerEvent): void => {
    this.#modifierPress = event.ctrlKey || event.metaKey || event.shiftKey
    // A plain press on empty chart ends a multi-selection (a press on a member keeps it, to drag the group).
    if (!this.#modifierPress && event.button === 0 && !this.drawingUnderPointer() && this.#multiSelection.size > 0) {
      this.#setMultiSelection([])
    }
  }

  #emitDrawing(event: DrawingEvent): void {
    for (const listener of this.#drawingListeners) listener(event)
  }

  public subscribeDrawingEvents(listener: (event: DrawingEvent) => void): () => void {
    this.#drawingListeners.add(listener)
    return () => { this.#drawingListeners.delete(listener) }
  }

  /** Every selected drawing: the multi-selection, or the single selected one. */
  public getSelection(): string[] {
    if (this.#multiSelection.size > 0) return [...this.#multiSelection]
    return this.#selectedDrawingId ? [this.#selectedDrawingId] : []
  }

  public clearSelection(): void {
    this.#setMultiSelection([])
  }

  #setMultiSelection(ids: readonly string[]): void {
    const before = [...this.#multiSelection].join(',')
    this.#multiSelection.clear()
    if (ids.length > 1) for (const id of ids) this.#multiSelection.add(id)
    if ([...this.#multiSelection].join(',') === before) return
    this.#syncDrawings()
    this.#emitDrawing({ kind: 'selection', ids: [...this.#multiSelection] })
  }

  public setDrawingModes(modes: DrawingModes): void {
    if (this.#disposed) return
    const changed = modes.lockAll !== this.#drawingModes.lockAll || modes.hideAll !== this.#drawingModes.hideAll
    this.#drawingModes = modes
    if (changed) this.#syncDrawings()
  }

  readonly #handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') {
      this.#shiftHeld = true
      if (this.#overlayMove && this.#lastOverlayMoveEvent) {
        this.#continueOverlayMove(this.#lastOverlayMoveEvent)
        this.#chart.overrideOverlay({
          id: this.#overlayMove.id,
          points: (this.#lastOverlayMoveEvent.overlay as { points: Array<Partial<Point>> }).points,
        })
      }
    }
  }

  readonly #handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') {
      this.#shiftHeld = false
      if (this.#overlayMove && this.#lastOverlayMoveEvent) {
        this.#continueOverlayMove(this.#lastOverlayMoveEvent)
        this.#chart.overrideOverlay({
          id: this.#overlayMove.id,
          points: (this.#lastOverlayMoveEvent.overlay as { points: Array<Partial<Point>> }).points,
        })
      }
    }
  }

  readonly #handlePointerModifier = (event: PointerEvent): void => {
    this.#shiftHeld = event.shiftKey
  }

  readonly #handleWindowBlur = (): void => {
    this.#shiftHeld = false
  }

  readonly #handleManualNavigation = (): void => {
    if (!this.#ignoreNavigationEvents && this.#runtimeState.followingLive) {
      this.#patchRuntime({ followingLive: false })
    }
    if (!this.#ignoreNavigationEvents) this.#queueTimeSync()
  }

  readonly #handleZoomSync = (): void => {
    if (!this.#ignoreNavigationEvents) this.#queueTimeSync()
  }

  /** Joins (or leaves) the split-view group of this chart's tab. */
  public setSync(group: string | undefined, options: { crosshair: boolean, time: boolean }): void {
    if (this.#disposed) return
    this.#syncOptions = options
    if (group !== this.#syncGroup) {
      this.#leaveSync?.()
      this.#leaveSync = group ? joinSyncGroup(group, this.#syncMember) : undefined
      this.#syncGroup = group
    }
    if (!options.crosshair) this.#chart.executeAction('onCrosshairChange', null as never)
  }

  /** At most one time message per frame while the user drags or zooms. */
  #queueTimeSync(): void {
    if (!this.#syncGroup || !this.#syncOptions.time || this.#applyingSync || this.#timeSyncFrame !== undefined) return
    this.#timeSyncFrame = requestAnimationFrame(() => {
      this.#timeSyncFrame = undefined
      if (this.#disposed || !this.#syncGroup) return
      const range = this.#chart.getVisibleRange()
      const data = this.#chart.getDataList()
      const centre = data[Math.max(0, Math.min(data.length - 1, Math.round((range.from + range.to) / 2)))]
      if (!centre) return
      broadcastTime(this.#syncGroup, this.#syncMember, { centreTimeMs: centre.timestamp, pixelsPerMs: this.#chart.getBarSpace().bar / this.#intervalMs() })
    })
  }

  #applySyncedTime(state: SyncedTime): void {
    if (this.#disposed || !this.#syncOptions.time || this.#replay || this.#chart.getDataList().length === 0) return
    this.#applyingSync = true
    try {
      this.#withIgnoredNavigation(() => {
        this.#chart.setBarSpace(followerBarSpace(state, this.#intervalMs()))
        this.#scrollToCentre(state.centreTimeMs)
      })
      this.#patchRuntime({ followingLive: false })
    } finally {
      this.#applyingSync = false
    }
  }

  #applySyncedCrosshair(state: SyncedCrosshair | null): void {
    if (this.#disposed || !this.#syncOptions.crosshair) return
    if (!state) { this.#chart.executeAction('onCrosshairChange', null as never); return }
    const data = this.#chart.getDataList()
    if (data.length === 0) return
    // The candle of this timeframe that contains the moment (the last one opening at or before it).
    let low = 0
    let high = data.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (data[middle].timestamp <= state.timestamp) low = middle
      else high = middle - 1
    }
    const x = (this.#chart.convertToPixel({ dataIndex: low }, { paneId: 'candle_pane' }) as Partial<Coordinate>).x
    if (x === undefined) return
    const sameSymbol = state.symbol === this.#market.symbol
    const y = sameSymbol ? (this.#chart.convertToPixel({ value: state.price }, { paneId: 'candle_pane' }) as Partial<Coordinate>).y : undefined
    // Off-screen y: only the vertical line shows on charts of other symbols.
    this.#chart.executeAction('onCrosshairChange', { x, y: y ?? -1000, paneId: 'candle_pane' } as never)
  }

  readonly #dataLoader: DataLoader = {
    getBars: async ({ type, timestamp, period, callback }) => {
      const interval = periodToInterval(period)
      if (!interval) {
        callback([], false)
        this.#patchRuntime({
          connection: 'error',
          error: `Unsupported chart period ${period.span} ${period.type}`,
        })
        return
      }

      // During a replay the chart is fed from memory; only older history still comes from the network.
      const replay = this.#replay
      if (replay && type !== 'forward') {
        if (type !== 'init') {
          callback([], false)
          return
        }
        const shown = replay.bars.slice(0, replay.cursor)
        callback(shown, { forward: true, backward: false })
        const latest = shown.at(-1)
        this.#patchRuntime({ interval, connection: 'live', quote: latest ? barToQuote(latest) : null, error: null })
        this.#publishReplay()
        this.#afterInitialData()
        return
      }

      if (this.#market.kind === 'dominance') {
        await this.#loadDominanceBars(type, interval, timestamp, callback)
        return
      }

      const epoch = this.#dataEpoch

      // Reopening a chart (or the app) paints from the local cache at once; the live feed then fills in what is new.
      if (type === 'init' && !this.#pendingViewport && !this.#pendingReplay) {
        const cached = await loadCachedBars(this.#market.marketId, interval)
        if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
        const newest = cached?.at(-1)
        if (cached && newest && cached.length >= 200 && Date.now() - newest.timestamp < MAX_CACHE_GAP_BARS * this.#intervalMs()) {
          this.#catchUpPending = true
          callback(cached, { forward: true, backward: false })
          this.#patchRuntime({ interval, connection: 'connecting', quote: barToQuote(newest), error: null })
          this.#afterInitialData()
          return
        }
      }

      if (type === 'init') {
        this.#patchRuntime({ interval, connection: 'loading', error: null })
      }

      try {
        const result = await this.#historyLoader.load({
          symbol: exchangeSymbol(this.#market.symbol),
          interval,
          limit: HISTORY_PAGE_SIZE,
          ...(type === 'forward' && timestamp !== null
            ? { endTimeMs: Math.max(0, timestamp - 1) }
            : {}),
          ...(type === 'backward' && timestamp !== null
            ? { startTimeMs: timestamp + 1 }
            : {}),
        })

        if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return

        let bars = result.candles.map(candleToKLineData)
        let hasPage = bars.length === HISTORY_PAGE_SIZE

        // After a timeframe switch, fetch enough older candles to show the same moment again.
        const pending = type === 'init' ? this.#pendingViewport : undefined
        const pendingReplay = type === 'init' ? this.#pendingReplay : undefined
        const targetReplayTime = pendingReplay?.targetTimeMs
        const targetCenterTime = pending?.followingLive ? undefined : pending?.centerTimeMs
        const backfillTarget = targetReplayTime !== undefined
          ? (targetCenterTime !== undefined ? Math.min(targetReplayTime, targetCenterTime) : targetReplayTime)
          : targetCenterTime

        if (backfillTarget !== undefined) {
          const neededFrom = backfillTarget - VIEWPORT_BACKFILL_MARGIN_BARS * this.#intervalMs()
          for (
            let page = 0;
            hasPage && bars.length > 0 && bars[0].timestamp > neededFrom && page < MAX_VIEWPORT_BACKFILL_PAGES;
            page += 1
          ) {
            const older = await this.#fetchKlines({
              symbol: exchangeSymbol(this.#market.symbol),
              interval,
              limit: HISTORY_PAGE_SIZE,
              endTimeMs: Math.max(0, bars[0].timestamp - 1),
            })
            if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
            bars = [...older.map(candleToKLineData), ...bars]
            hasPage = older.length === HISTORY_PAGE_SIZE
          }
          if (pending && pending.centerTimeMs !== undefined && bars.length > 0 && bars[0].timestamp > pending.centerTimeMs) {
            pending.followingLive = true
          }
        }

        if (type === 'init' && this.#pendingReplay) {
          const replayInfo = this.#pendingReplay
          this.#pendingReplay = undefined
          const cursor = replayTransitionCursor(bars.map((b) => b.timestamp), replayInfo.targetTimeMs)
          this.#replay = { bars, cursor, speedMs: replayInfo.speedMs }
          this.#replayPicking = replayInfo.wasPicking
          if (replayInfo.wasPicking) {
            this.#host.classList.add('replay-picking')
          }
          const shown = bars.slice(0, cursor)
          callback(shown, { forward: hasPage, backward: false })
          const latest = shown.at(-1)
          this.#patchRuntime({
            interval,
            connection: 'live',
            quote: latest ? barToQuote(latest) : null,
            error: null,
          })
          saveCachedBars(this.#market.marketId, interval, bars)
          this.#publishReplay()
          this.#afterInitialData()
          if (replayInfo.wasPlaying) {
            this.setReplayPlaying(true)
          }
          return
        }

        callback(bars, {
          forward: type === 'backward' ? false : hasPage,
          backward: type === 'backward' ? hasPage : false,
        })

        if (type === 'init') {
          const latest = result.candles.at(-1)
          this.#patchRuntime({
            connection: 'connecting',
            quote: latest ? candleToQuote(latest) : null,
            error: latest ? null : 'No candles were returned for this market.',
          })
          saveCachedBars(this.#market.marketId, interval, bars)
          this.#publishReplay()
          this.#afterInitialData()
        }
      } catch (error) {
        if (
          this.#disposed ||
          epoch !== this.#dataEpoch ||
          error instanceof StaleMarketDataRequestError ||
          isAbortError(error)
        ) {
          return
        }

        callback([], false)
        this.#patchRuntime({ connection: 'error', error: errorMessage(error) })
      }
    },

    subscribeBar: ({ period, callback }) => {
      const interval = periodToInterval(period)
      if (!interval || interval !== this.#interval || this.#disposed) return
      if (this.#replay) {
        this.#replay.push = callback
        return
      }
      if (this.#market.kind === 'dominance') {
        this.#startDominancePolling(interval, callback)
        return
      }

      this.#stream?.stop()
      const epoch = this.#dataEpoch
      let hasOpened = false
      if (this.#catchUpPending) {
        this.#catchUpPending = false
        void this.#backfillAfterReconnect(interval, epoch, callback)
      }

      const streamOptions = {
        symbol: exchangeSymbol(this.#market.symbol),
        interval,
        onCandle: (candle: Candle) => {
          if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
          callback(candleToKLineData(candle))
          this.#patchRuntime({ quote: candleToQuote(candle), error: null })
        },
        onStatus: (status: KlineStreamStatus) => {
          if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
          this.#handleStreamStatus(status)
          if (status.state === 'open') {
            if (hasOpened) void this.#backfillAfterReconnect(interval, epoch, callback)
            hasOpened = true
          }
        },
        onError: (error: Error) => {
          if (this.#disposed || epoch !== this.#dataEpoch) return
          this.#patchRuntime({ error: error.message })
        },
      }
      const exchange = this.#market.exchange
      this.#stream = exchange === 'bybit'
        ? new BybitKlineSubscription(streamOptions)
        : new BinanceKlineSubscription(exchange === 'binance-futures' ? { ...streamOptions, endpoint: BINANCE_FUTURES_WS_ENDPOINT } : streamOptions)
    },

    unsubscribeBar: () => {
      this.#stream?.stop()
      this.#stream = undefined
      this.#stopDominancePolling()
    },
  }

  public constructor(
    host: HTMLElement,
    interval: MarketInterval,
    market: CryptoMarket,
    drawingStore: DrawingStore,
    callbacks: KLineChartControllerCallbacks,
  ) {
    this.#interval = interval
    this.#host = host
    this.#market = market
    this.#drawingStore = drawingStore
    this.#callbacks = callbacks
    this.#runtimeState = {
      interval,
      connection: 'loading',
      quote: null,
      error: null,
      followingLive: true,
    }

    const chart = init(host, {
      locale: 'en-US',
      timezone: 'UTC',
      zoomAnchor: 'cursor',
      hotkey: { enabled: true },
      layout: {
        barSpaceLimit: { min: 0.4, max: 60 },
        pane: { minHeight: 120 },
        yAxis: {
          position: 'right',
          inside: false,
          scrollZoomEnabled: true,
          gap: { top: 0.16, bottom: 0.12 },
        },
      },
      styles: {
        grid: {
          horizontal: { color: '#1f2330', style: 'dashed', dashedValue: [3, 3] },
          vertical: { color: '#1f2330', style: 'dashed', dashedValue: [3, 3] },
        },
        candle: {
          bar: {
            upColor: '#089981',
            downColor: '#f23645',
            noChangeColor: '#787b86',
            upBorderColor: '#089981',
            downBorderColor: '#f23645',
            noChangeBorderColor: '#787b86',
            upWickColor: '#089981',
            downWickColor: '#f23645',
            noChangeWickColor: '#787b86',
          },
          tooltip: { showRule: 'none' },
          priceMark: {
            high: { show: false },
            low: { show: false },
            last: {
              line: { show: true, style: 'dashed', size: 1, dashedValue: [4, 4] },
            },
          },
        },
        xAxis: {
          axisLine: { color: '#2a2e39' },
          tickLine: { color: '#2a2e39' },
          tickText: { color: '#787b86', size: 12, family: 'Inter, system-ui, sans-serif' },
        },
        yAxis: {
          axisLine: { color: '#2a2e39' },
          tickLine: { color: '#2a2e39' },
          tickText: { color: '#b2b5be', size: 12, family: 'Inter, system-ui, sans-serif' },
        },
        indicator: {
          tooltip: {
            title: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#b2b5be' },
            legend: { family: 'Inter, system-ui, sans-serif', size: 12 },
          },
        },
        crosshair: {
          horizontal: {
            line: { color: '#9598a1', style: 'dashed', size: 1, dashedValue: [4, 4] },
          },
          vertical: {
            line: { color: '#9598a1', style: 'dashed', size: 1, dashedValue: [4, 4] },
          },
        },
        overlay: {
          line: { color: '#f4b860', size: 2 },
          point: {
            color: '#f4b860',
            borderColor: '#080b10',
            activeColor: '#fff1cf',
            activeBorderColor: '#f4b860',
          },
        },
      },
    })

    if (!chart) throw new Error('The chart could not be initialized.')
    this.#chart = chart
    chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.#createPriceRange })
    // TradingView-style time axis and crosshair date, in the user's time zone.
    chart.overrideXAxis({ createTicks: this.#createTimeTicks })
    chart.setFormatter({ formatDate: ({ timestamp }) => formatCrosshairTime(timestamp, this.#timeZone, this.#intervalMs()) })
    chart.subscribeAction('onCrosshairChange', this.#handleCrosshair)
    // The chart area never scrolls the page, so every finger drag belongs to the chart (pan, pinch, price pan).
    host.style.touchAction = 'none'
    // Without this a finger dragging on the price axis would be taken by the browser as a page gesture.
    const axisElement = chart.getDom('candle_pane', 'yAxis')
    if (axisElement) axisElement.style.touchAction = 'none'
    if (import.meta.env.DEV) {
      (globalThis as { __tradeHorizonChart?: Chart }).__tradeHorizonChart = chart
      ;(globalThis as { __tradeHorizonController?: unknown }).__tradeHorizonController = this
      ;((globalThis as { __tradeHorizonCharts?: Set<Chart> }).__tradeHorizonCharts ??= new Set()).add(chart)
    }

    chart.setSymbol({
      ticker: market.symbol,
      pricePrecision: market.pricePrecision,
      volumePrecision: market.volumePrecision,
    })
    chart.setPeriod(intervalToPeriod(interval))
    chart.setDataLoader(this.#dataLoader)
    chart.setOffsetRightDistance(72)
    chart.subscribeAction('onScroll', this.#handleManualNavigation)
    chart.subscribeAction('onZoom', this.#handleZoomSync)
    chart.subscribeAction('onPaneDrag', this.#handleManualNavigation)
    chart.subscribeAction('onScroll', this.#emitView)
    chart.subscribeAction('onZoom', this.#emitView)
    chart.subscribeAction('onVisibleRangeChange', this.#emitView)

    // Capture-phase listeners let a drawing tool own the pointer before the chart starts panning.
    host.addEventListener('pointerdown', this.#handleToolPointerDown, true)
    host.addEventListener('pointerdown', this.#handleDeselectPointerDown, true)
    host.addEventListener('pointerdown', this.#handleAxisPointerDown, true)
    host.addEventListener('pointerdown', this.#handlePanPointerDown, true)
    globalThis.addEventListener('pointermove', this.#handlePanPointerMove, true)
    globalThis.addEventListener('pointerup', this.#handlePanPointerEnd, true)
    globalThis.addEventListener('pointercancel', this.#handlePanPointerEnd, true)
    host.addEventListener('mousedown', this.#blockLibraryAxisGesture, true)
    host.addEventListener('touchstart', this.#blockLibraryAxisGesture, true)
    host.addEventListener('dblclick', this.#blockLibraryAxisGesture, true)
    host.addEventListener('wheel', this.#handleAxisWheel, { capture: true, passive: false })
    document.addEventListener('visibilitychange', this.#handleVisibilityChange)
    globalThis.addEventListener('pagehide', this.#handlePageHide)
    globalThis.addEventListener('pageshow', this.#handleResumeNow)
    globalThis.addEventListener('online', this.#handleResumeNow)
    globalThis.addEventListener('pointermove', this.#handleAxisPointerMove, true)
    globalThis.addEventListener('pointerup', this.#handleAxisPointerEnd, true)
    host.addEventListener('pointerdown', this.#handlePointerModifier, true)
    globalThis.addEventListener('pointermove', this.#handlePointerModifier, true)
    globalThis.addEventListener('pointerup', this.#handlePointerModifier, true)
    globalThis.addEventListener('keydown', this.#handleKeyDown, true)
    globalThis.addEventListener('keyup', this.#handleKeyUp, true)
    globalThis.addEventListener('blur', this.#handleWindowBlur)
    host.addEventListener('mousedown', this.#blockChartWhileDrawing, true)
    host.addEventListener('touchstart', this.#blockChartWhileDrawing, true)
    host.addEventListener('contextmenu', this.#handleToolContextMenu, true)
    host.addEventListener('pointerdown', this.#trackSelectionPress, true)
    host.addEventListener('pointerleave', this.#handleHostLeave)
    globalThis.addEventListener('pointermove', this.#handleToolPointerMove, true)
    globalThis.addEventListener('pointerup', this.#handleToolPointerUp, true)
    globalThis.addEventListener('pointercancel', this.#handleToolPointerUp, true)

    this.#drawingStoreUnsubscribe = drawingStore.subscribe(() => this.#syncDrawings())
    this.#syncDrawings()
    callbacks.onRuntimeState(this.#runtimeState)
  }

  public get interval(): MarketInterval {
    return this.#interval
  }

  public get isShiftHeld(): boolean {
    return this.#shiftHeld
  }

  public setInterval(interval: MarketInterval): void {
    if (this.#disposed || interval === this.#interval) return

    this.cancelActiveTool()
    const targetTimeMs = this.#replay
      ? (this.#replay.bars[this.#replay.cursor - 1]?.timestamp ?? null)
      : this.#pendingReplay?.targetTimeMs ?? null
    const speedMs = this.#replay?.speedMs ?? this.#pendingReplay?.speedMs ?? DEFAULT_REPLAY_SPEED_MS
    const wasPlaying = (this.#replay?.timer !== undefined) || (this.#pendingReplay?.wasPlaying ?? false)
    const wasPicking = this.#replayPicking || (this.#pendingReplay?.wasPicking ?? false)

    if (targetTimeMs !== null) {
      this.#pendingReplay = { targetTimeMs, speedMs, wasPlaying, wasPicking }
      this.#stopReplayTimer()
      this.#replay = undefined
      this.#patchRuntime({
        interval,
        connection: 'loading',
        error: null,
        replay: {
          status: wasPicking ? 'picking' : 'active',
          playing: false,
          speedMs,
          timeMs: targetTimeMs,
          atEnd: false,
        },
      })
    } else if (this.#replayPicking) {
      this.#patchRuntime({
        interval,
        connection: 'loading',
        error: null,
        replay: {
          status: 'picking',
          playing: false,
          speedMs: DEFAULT_REPLAY_SPEED_MS,
          timeMs: null,
          atEnd: false,
        },
      })
    } else {
      this.#clearReplay()
      this.#patchRuntime({ interval, connection: 'loading', error: null })
    }

    this.resetPriceView()
    this.#pendingViewport = this.#pendingRange?.interval === interval
      ? { followingLive: true, barSpace: this.#chart.getBarSpace().bar }
      : this.#captureViewport()
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.#stopDominancePolling()
    this.#dataEpoch += 1
    this.#interval = interval
    // With no candles every anchor maps to the same spot, so hide drawings until data arrives.
    for (const overlay of this.#chart.getOverlays({ groupId: DRAWING_GROUP_ID })) {
      this.#chart.overrideOverlay({ id: overlay.id, visible: false })
    }
    this.#chart.setPeriod(intervalToPeriod(interval))
    this.#syncDominanceData()
    if (this.#compareSymbols.length > 0) { this.#compareSeries = []; void this.#loadCompare() }
  }

  public retry(): void {
    if (this.#disposed) return
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.#dataEpoch += 1
    this.#patchRuntime({ connection: 'loading', error: null })
    this.#chart.resetData()
  }

  public goToLive(): void {
    if (this.#disposed) return
    this.#withIgnoredNavigation(() => this.#chart.scrollToRealTime(240))
    this.#patchRuntime({ followingLive: true })
  }

  public setChartType(type: ChartType): void {
    if (this.#disposed) return
    const drawnByUs = type === 'heikinAshi' || type === 'baseline'
    const candleType = type === 'bars' ? 'ohlc' : type === 'hollow' ? 'candle_up_stroke' : type === 'candles' ? 'candle_solid' : 'area'
    const area = type === 'area'
      ? { lineColor: '#2962ff', lineSize: 2, backgroundColor: [{ offset: 0, color: 'rgba(41, 98, 255, 0.02)' }, { offset: 1, color: 'rgba(41, 98, 255, 0.32)' }] }
      : drawnByUs
        ? { lineColor: 'transparent', lineSize: 0, backgroundColor: 'transparent' }
        : { lineColor: '#2962ff', lineSize: 2, backgroundColor: 'transparent' }
    this.#chart.setStyles({ candle: { type: candleType, area: { ...area, value: 'close', smooth: false, point: { show: false } } } } as never)
    // Heikin Ashi and baseline are our own series over the (hidden) candles.
    const wanted = type === 'heikinAshi' ? HEIKIN_ASHI_NAME : type === 'baseline' ? BASELINE_NAME : undefined
    if (this.#seriesIndicator && this.#seriesIndicator.name !== wanted) {
      this.#chart.removeIndicator({ id: this.#seriesIndicator.id })
      this.#seriesIndicator = undefined
    }
    if (wanted && !this.#seriesIndicator) {
      const id = this.#chart.createIndicator({ name: wanted, paneId: 'candle_pane', createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP }, true)
      if (id) this.#seriesIndicator = { id, name: wanted }
    }
  }

  /** Price-pane bounds and the price under a viewport Y, for UI layered over the chart (alert "+" button). */
  public pricePaneBounds(): DOMRect | null {
    return this.#paneRect()
  }

  public priceAtClientY(clientY: number): number | null {
    const rect = this.#paneRect()
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
    this.#stopReplayTimer()
    this.#replayPicking = true
    this.#host.classList.add('replay-picking')
    this.#publishReplay()
  }

  public cancelReplaySelection(): void {
    if (!this.#replayPicking) return
    this.#replayPicking = false
    if (this.#pendingReplay) this.#pendingReplay.wasPicking = false
    this.#host.classList.remove('replay-picking')
    this.#publishReplay()
  }

  public stepReplay(): void {
    const replay = this.#replay
    if (!replay?.push || this.#disposed) return
    if (replay.cursor < replay.bars.length) {
      const bar = replay.bars[replay.cursor]
      replay.cursor += 1
      replay.push(bar)
      this.#patchRuntime({ quote: barToQuote(bar) })
    }
    if (replay.cursor >= replay.bars.length) this.#stopReplayTimer()
    this.#publishReplay()
  }

  public setReplayPlaying(playing: boolean): void {
    const replay = this.#replay
    if (!replay) return
    this.#stopReplayTimer()
    if (playing && replay.cursor < replay.bars.length) {
      replay.timer = globalThis.setInterval(() => this.stepReplay(), replay.speedMs)
    }
    this.#publishReplay()
  }

  public setReplaySpeed(speedMs: number): void {
    const replay = this.#replay
    if (!replay || !(speedMs > 0)) return
    const wasPlaying = replay.timer !== undefined
    replay.speedMs = speedMs
    this.setReplayPlaying(wasPlaying)
  }

  /** Leaves replay and reloads live data. */
  public exitReplay(): void {
    if (!this.#replay && !this.#replayPicking && !this.#pendingReplay) return
    const wasActive = !!this.#replay || !!this.#pendingReplay
    this.#clearReplay()
    if (wasActive) this.#reloadData()
  }

  #enterReplay(timestamp: number): void {
    // Picking a new start while already replaying must rewind within the full original data.
    const bars = this.#replay?.bars ?? this.#chart.getDataList().slice()
    const cursor = replayStartCursor(bars.map((bar) => bar.timestamp), timestamp)
    if (cursor === null) return

    const speedMs = this.#replay?.speedMs ?? DEFAULT_REPLAY_SPEED_MS
    this.#stopReplayTimer()
    this.#replayPicking = false
    this.#host.classList.remove('replay-picking')
    this.#replay = { bars, cursor, speedMs }
    this.#reloadData()
  }

  #clearReplay(): void {
    this.#stopReplayTimer()
    this.#replay = undefined
    this.#pendingReplay = undefined
    this.#replayPicking = false
    this.#host.classList.remove('replay-picking')
    if (this.#runtimeState.replay) this.#patchRuntime({ replay: null })
  }

  #stopReplayTimer(): void {
    const replay = this.#replay
    if (replay?.timer === undefined) return
    globalThis.clearInterval(replay.timer)
    replay.timer = undefined
  }

  #publishReplay(): void {
    const replay = this.#replay
    const pending = this.#pendingReplay
    this.#patchRuntime({
      replay: replay
        ? {
            status: this.#replayPicking ? 'picking' : 'active',
            playing: replay.timer !== undefined,
            speedMs: replay.speedMs,
            timeMs: replay.bars[replay.cursor - 1]?.timestamp ?? null,
            atEnd: replay.cursor >= replay.bars.length,
          }
        : pending
          ? {
              status: this.#replayPicking ? 'picking' : 'active',
              playing: pending.wasPlaying,
              speedMs: pending.speedMs,
              timeMs: pending.targetTimeMs,
              atEnd: false,
            }
          : this.#replayPicking
            ? { status: 'picking', playing: false, speedMs: DEFAULT_REPLAY_SPEED_MS, timeMs: null, atEnd: false }
            : null,
    })
  }

  #reloadData(): void {
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.#stopDominancePolling()
    this.#dataEpoch += 1
    this.#chart.resetData()
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
    const { upColor, downColor } = appearance
    const wick = (color: string) => (appearance.wicks ? color : 'transparent')
    this.#chart.setStyles({
      candle: {
        bar: { upColor, downColor, upBorderColor: upColor, downBorderColor: downColor, upWickColor: wick(upColor), downWickColor: wick(downColor) },
        priceMark: { last: { upColor, downColor, line: { show: appearance.lastPriceLine } } },
      },
      grid: {
        horizontal: { show: appearance.grid === 'both' || appearance.grid === 'horizontal' },
        vertical: { show: appearance.grid === 'both' || appearance.grid === 'vertical' },
      },
    } as never)
    // The canvases are transparent; a custom background goes on the host (and so into chart pictures too).
    this.#host.style.background = appearance.background ?? ''
  }

  /** Labels at the highest and lowest visible price. */
  public setHighLowLabels(show: boolean): void {
    if (this.#disposed) return
    this.#chart.setStyles({ candle: { priceMark: { high: { show }, low: { show } } } })
  }

  public setScaleMode(mode: ScaleMode): void {
    if (this.#disposed || mode === this.#scaleMode) return
    this.#scaleMode = mode
    const name = mode === 'log' ? 'logarithm' : mode === 'percent' ? 'percentage' : 'normal'
    // A new axis name makes klinecharts rebuild the axis widget, so its touch setting is applied again.
    this.#chart.overrideYAxis({ paneId: 'candle_pane', name, createRange: this.#createPriceRange } as never)
    const axisElement = this.#chart.getDom('candle_pane', 'yAxis')
    if (axisElement) axisElement.style.touchAction = 'none'
    this.#emitView()
  }

  public getScaleMode(): ScaleMode {
    return this.#scaleMode
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
    this.#withIgnoredNavigation(() => this.#chart.scrollToRealTime())
    this.#patchRuntime({ followingLive: true })
  }

  /**
   * Go to date: centre the chart on a moment, loading older candles first when they are not on the chart yet.
   * Returns false when that moment is further back than the history this timeframe loads at once.
   */
  public goToTime(timeMs: number): boolean {
    if (this.#disposed || this.#replay) return false
    const data = this.#chart.getDataList()
    if (data.length > 0 && data[0].timestamp <= timeMs) {
      this.#withIgnoredNavigation(() => this.#scrollToCentre(Math.min(timeMs, data[data.length - 1].timestamp)))
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
  public async snapshot(): Promise<{ url: string, width: number, height: number, background: string } | null> {
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

  public readonly subscribeHover = (listener: () => void): (() => void) => {
    this.#hoverListeners.add(listener)
    return () => { this.#hoverListeners.delete(listener) }
  }

  public readonly getHover = (): HoverState | null => this.#hover

  /** The newest candle on the chart and the close before it, read when needed (no React state follows every tick). */
  public latestCandle(): { open: number, high: number, low: number, close: number, volume?: number, previousClose?: number } | undefined {
    if (this.#disposed) return undefined
    const list = this.#chart.getDataList()
    const last = list[list.length - 1]
    return last ? { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume, previousClose: list[list.length - 2]?.close } : undefined
  }

  /** Close of the candle before the newest one (the legend's change is measured from it). */
  public latestPreviousClose(): number | undefined {
    const list = this.#chart.getDataList()
    return list[list.length - 2]?.close
  }

  /** Moving average and VWAP values for a candle (the newest when `index` is undefined). */
  public indicatorValuesAt(index?: number): IndicatorValues {
    const at = index ?? this.#chart.getDataList().length - 1
    const row = (id: string | undefined): Record<string, number | undefined> | undefined => {
      if (!id) return undefined
      const indicator = this.#chart.getIndicators({ id })[0] as { result?: Array<Record<string, number | undefined>> } | undefined
      return indicator?.result?.[at]
    }
    const series = (kind: MovingAverageKind, prefix: string): Array<number | undefined> => {
      const values = row(this.#movingAverageIds.get(kind))
      return values ? Object.keys(values).filter((key) => key.startsWith(prefix)).sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length))).map((key) => values[key]) : []
    }
    return {
      sma: series('sma', 'ma'),
      ema: series('ema', 'ema'),
      vwap: row(this.#vwapIds.get('vwap'))?.vwap,
      qvwap: row(this.#vwapIds.get('qvwap'))?.vwap,
    }
  }

  #setHover(next: HoverState | null): void {
    if (next === this.#hover || (next && this.#hover && next.index === this.#hover.index && next.bar === this.#hover.bar)) return
    this.#hover = next
    for (const listener of this.#hoverListeners) listener()
  }

  readonly #handleCrosshair = (data?: unknown): void => {
    const x = (data as { x?: number } | undefined)?.x
    if (typeof x !== 'number' || this.#disposed) return
    const list = this.#chart.getDataList()
    if (list.length === 0) return
    const [point] = this.#chart.convertFromPixel([{ x }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
    if (point?.dataIndex === undefined) return
    const index = Math.max(0, Math.min(list.length - 1, point.dataIndex))
    this.#setHover({ index, bar: list[index], previousClose: list[index - 1]?.close, latest: index === list.length - 1 })
    if (this.#syncGroup && this.#syncOptions.crosshair) {
      const y = (data as { y?: number }).y
      const [value] = typeof y === 'number' ? this.#chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane' }) as Array<Partial<Point>> : []
      broadcastCrosshair(this.#syncGroup, this.#syncMember, { timestamp: list[index].timestamp, price: value?.value ?? list[index].close, symbol: this.#market.symbol })
    }
  }

  readonly #handleHostLeave = (): void => {
    this.#setHover(null)
    if (this.#syncGroup && this.#syncOptions.crosshair) broadcastCrosshair(this.#syncGroup, this.#syncMember, null)
  }

  /** Time-axis labels on round times in the user's zone (see timeAxis.ts), also over the empty space to the right. */
  readonly #createTimeTicks = ({ range, defaultTicks }: { range: { realFrom: number, realTo: number }, defaultTicks: Array<{ coord: number, value: number | string, text: string }> }) => {
    const data = this.#chart.getDataList()
    if (data.length === 0) return defaultTicks
    const intervalMs = this.#intervalMs()
    const last = data[data.length - 1]
    const bars: Array<{ index: number, timestamp: number }> = []
    for (let index = Math.max(0, Math.floor(range.realFrom) - 1); index <= Math.ceil(range.realTo); index += 1) {
      bars.push({ index, timestamp: index < data.length ? data[index].timestamp : last.timestamp + (index - data.length + 1) * intervalMs })
    }
    const ticks = buildTimeTicks(bars, { barSpacePx: this.#chart.getBarSpace().bar, intervalMs, timeZone: this.#timeZone })
    return ticks.map((tick) => ({
      coord: (this.#chart.convertToPixel({ dataIndex: tick.index }, { paneId: 'candle_pane' }) as Partial<Coordinate>).x ?? 0,
      value: tick.timestamp,
      text: tick.text,
    }))
  }

  public setVolumeVisible(requested: boolean): void {
    if (this.#disposed) return
    // An index has no traded volume, so its pane would always be empty.
    const visible = requested && this.#market.kind !== 'dominance'

    if (visible && !this.#volumeIndicatorId) {
      // Along the bottom of the price pane, behind the candles (negative zLevel), like TradingView.
      const id = this.#chart.createIndicator(
        { name: VOLUME_OVERLAY_NAME, paneId: 'candle_pane', zLevel: -1, createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP },
        true,
      )
      if (id) this.#volumeIndicatorId = id
      return
    }

    if (!visible && this.#volumeIndicatorId) {
      this.#chart.removeIndicator({ id: this.#volumeIndicatorId })
      this.#volumeIndicatorId = undefined
    }
  }

  public setIndicators(settings: IndicatorSettings): void {
    if (this.#disposed) return
    this.#applyMovingAverage('sma', settings.sma)
    this.#applyMovingAverage('ema', settings.ema)
    this.#applyVwap('vwap', settings.vwap.visible, settings.vwap.anchor)
    this.#applyVwap('qvwap', settings.qvwap.visible, 'quarter')
    this.#applyDominance(settings.dominance)
    this.#applyStudies(settings.studies)
    this.#applyCompare(settings.compare)
  }

  #applyCompare(symbols: readonly string[]): void {
    const wanted = symbols.filter((symbol) => symbol !== this.#market.symbol)
    if (wanted.join(',') === this.#compareSymbols.join(',')) return
    this.#compareSymbols = wanted
    this.#compareSeries = this.#compareSeries.filter((item) => wanted.includes(item.symbol))
    void this.#loadCompare()
  }

  /** Loads every compare symbol's recent candles, then keeps the newest ones fresh every 20 seconds. */
  async #loadCompare(): Promise<void> {
    const epoch = ++this.#compareEpoch
    if (this.#compareTimer !== undefined) { globalThis.clearInterval(this.#compareTimer); this.#compareTimer = undefined }
    if (this.#compareSymbols.length === 0) { this.#renderCompare(); return }
    const interval = this.#interval
    const load = async (limit: number) => {
      const results = await Promise.all(this.#compareSymbols.map(async (symbol, index) => {
        const market = getMarket(symbol)
        if (market.symbol !== symbol || market.kind === 'dominance') return undefined
        try {
          const candles = await this.#fetchKlinesFor(market, { symbol: exchangeSymbol(market.symbol), interval, limit })
          const bars = candles.map((candle) => ({ timestamp: candle.openTimeMs, close: Number(candle.close) })).filter((bar) => Number.isFinite(bar.close))
          const previous = this.#compareSeries.find((item) => item.symbol === symbol)?.bars ?? []
          const merged = limit < HISTORY_PAGE_SIZE && previous.length > 0
            ? [...previous.filter((bar) => bar.timestamp < (bars[0]?.timestamp ?? Infinity)), ...bars]
            : bars
          return { symbol, color: COMPARE_COLORS[index % COMPARE_COLORS.length], bars: merged }
        } catch {
          return this.#compareSeries.find((item) => item.symbol === symbol)
        }
      }))
      if (this.#disposed || epoch !== this.#compareEpoch || interval !== this.#interval) return
      this.#compareSeries = results.filter((item): item is CompareSeries => item !== undefined)
      this.#renderCompare()
    }
    await load(HISTORY_PAGE_SIZE)
    if (this.#disposed || epoch !== this.#compareEpoch) return
    this.#compareTimer = globalThis.setInterval(() => void load(3), 20_000)
  }

  #renderCompare(): void {
    if (this.#compareSeries.length === 0) {
      if (this.#compareIndicatorId) this.#chart.removeIndicator({ id: this.#compareIndicatorId })
      this.#compareIndicatorId = undefined
      this.#patchRuntime({})
      return
    }
    const config = { name: COMPARE_INDICATOR_NAME, extendData: { series: this.#compareSeries } }
    if (this.#compareIndicatorId) this.#chart.overrideIndicator({ id: this.#compareIndicatorId, ...config })
    else {
      const id = this.#chart.createIndicator({ ...config, paneId: 'candle_pane', createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP }, true)
      if (id) this.#compareIndicatorId = id
    }
    // The price range includes the compare lines, so ask the axis to measure again.
    this.#chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.#createPriceRange })
    this.#emitView()
  }

  /** Legend: each compare symbol's colour, last close and change over the visible candles. */
  public compareLegend(): Array<{ symbol: string, color: string, last?: number, changePercent?: number }> {
    if (this.#disposed) return []
    const data = this.#chart.getDataList()
    const range = this.#chart.getVisibleRange()
    const from = Math.max(0, Math.floor(range.from))
    const to = Math.min(data.length, Math.ceil(range.to))
    return this.#compareSeries.map((item) => ({
      symbol: item.symbol,
      color: item.color,
      last: item.bars.at(-1)?.close,
      changePercent: compareChange(data, item.bars, from, to),
    }))
  }

  #fetchKlinesFor(market: CompareMarket, options: FetchBinanceKlinesOptions): Promise<Candle[]> {
    if (market.exchange === 'bybit') return fetchBybitKlines(options)
    return fetchBinanceKlines(market.exchange === 'binance-futures' ? { ...options, endpoint: BINANCE_FUTURES_REST_ENDPOINT } : options)
  }

  /** The automatic price range widened to fit the visible part of the compare lines. */
  #withCompareRange<T extends { from: number, to: number, range: number, realFrom: number, realTo: number, realRange: number, displayFrom: number, displayTo: number, displayRange: number }>(range: T): T {
    if (this.#compareSeries.length === 0) return range
    const data = this.#chart.getDataList()
    const visible = this.#chart.getVisibleRange()
    const from = Math.max(0, Math.floor(visible.from))
    const to = Math.min(data.length, Math.ceil(visible.to))
    let low = range.from
    let high = range.to
    for (const item of this.#compareSeries) {
      for (const value of scaledCompare(data, item.bars, from, to)) {
        if (value === undefined) continue
        if (value < low) low = value
        if (value > high) high = value
      }
    }
    if (low === range.from && high === range.to) return range
    const pad = (high - low) * 0.04
    low = Math.min(range.from, low - pad)
    high = Math.max(range.to, high + pad)
    return { ...range, from: low, to: high, range: high - low, realFrom: low, realTo: high, realRange: high - low, displayFrom: low, displayTo: high, displayRange: high - low }
  }

  /** Library studies: price-pane ones stack on the candles (legend in HTML), the rest get their own pane and legend. */
  #applyStudies(studies: readonly Study[]): void {
    const wanted = new Map(studies.map((study) => [study.id, study]))
    for (const [id, entry] of this.#studyIds) {
      const study = wanted.get(id)
      if (!study || study.type !== entry.type) {
        this.#chart.removeIndicator({ id: entry.indicatorId })
        this.#studyIds.delete(id)
      }
    }
    for (const study of studies) {
      const definition = STUDIES[study.type]
      const onPrice = definition.pane === 'price'
      const precision = onPrice || study.type === 'atr' ? (this.#chart.getSymbol()?.pricePrecision ?? 2) : definition.type === 'macd' ? 4 : 2
      const config = {
        name: studyIndicatorName(study.type),
        calcParams: [...study.params],
        visible: study.visible,
        precision,
        extendData: { colors: study.colors },
        styles: { lines: study.colors.map((color) => ({ color, size: 1.5 })) },
      }
      const existing = this.#studyIds.get(study.id)
      if (existing) {
        this.#chart.overrideIndicator({ id: existing.indicatorId, ...config })
        continue
      }
      const paneId = onPrice ? 'candle_pane' : `trade-horizon:study:${study.id}`
      const created = this.#chart.createIndicator(
        { ...config, paneId, ...(onPrice ? { createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP } : {}) },
        onPrice,
      )
      if (!created) continue
      this.#studyIds.set(study.id, { indicatorId: created, type: study.type })
      if (!onPrice) this.#chart.setPaneOptions({ id: paneId, height: 120, minHeight: 64 })
    }
  }

  /** A library study's line values at a candle (the newest when `index` is undefined), in its lines' order. */
  public studyValuesAt(studyId: string, index?: number): Array<number | undefined> {
    const entry = this.#studyIds.get(studyId)
    if (!entry || this.#disposed) return []
    const at = index ?? this.#chart.getDataList().length - 1
    const indicator = this.#chart.getIndicators({ id: entry.indicatorId })[0] as { result?: Array<Record<string, number | undefined>> } | undefined
    const row = indicator?.result?.[at]
    return STUDIES[entry.type].lines.map((line) => row?.[line.key])
  }

  /** VWAP lines sit on the price pane. An index has no traded volume, so there is nothing to average. */
  #applyVwap(kind: 'vwap' | 'qvwap', visible: boolean, anchor: (typeof VWAP_ANCHORS)[number]): void {
    const id = this.#vwapIds.get(kind)
    if (!visible || this.#market.kind === 'dominance') {
      if (id) {
        this.#chart.removeIndicator({ id })
        this.#vwapIds.delete(kind)
      }
      return
    }
    const styles = { lines: [{ color: VWAP_COLORS[kind], size: 1.5 }] }
    const calcParams = [VWAP_ANCHORS.indexOf(anchor)]
    const name = kind === 'vwap' ? VWAP_INDICATOR_NAME : QVWAP_INDICATOR_NAME
    if (id) {
      this.#chart.overrideIndicator({ id, name, calcParams, styles })
      return
    }
    const created = this.#chart.createIndicator(
      { name, paneId: 'candle_pane', calcParams, styles, createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP },
      true,
    )
    if (created) this.#vwapIds.set(kind, created)
  }

  #applyMovingAverage(kind: MovingAverageKind, settings: MovingAverageSettings): void {
    const id = this.#movingAverageIds.get(kind)
    if (!movingAverageActive(settings)) {
      if (id) {
        this.#chart.removeIndicator({ id })
        this.#movingAverageIds.delete(kind)
      }
      return
    }

    const calcParams = [...settings.periods]
    const colors = MOVING_AVERAGE_COLORS[kind]
    const styles = {
      lines: calcParams.map((_, index) => ({ color: colors[index % colors.length], size: 1.5 })),
    }
    if (id) {
      this.#chart.overrideIndicator({ id, name: kind === 'sma' ? 'MA' : 'EMA', calcParams, styles })
      return
    }
    const created = this.#chart.createIndicator(
      {
        name: kind === 'sma' ? 'MA' : 'EMA',
        paneId: 'candle_pane',
        calcParams,
        styles,
        createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP,
      },
      true,
    )
    if (created) this.#movingAverageIds.set(kind, created)
  }

  #applyDominance(wanted: Readonly<Record<DominanceKey, boolean>>): void {
    for (const key of DOMINANCE_KEYS) {
      const id = this.#dominanceIds.get(key)
      if (!wanted[key]) {
        if (id) {
          this.#chart.removeIndicator({ id })
          this.#dominanceIds.delete(key)
        }
        continue
      }
      if (id) continue

      const paneId = `trade-horizon:dominance:${key}`
      const created = this.#chart.createIndicator({
        name: dominanceIndicatorName(key),
        paneId,
        styles: { lines: [{ color: DOMINANCE_COLORS[key], size: 1.5 }] },
      })
      if (created) {
        this.#dominanceIds.set(key, created)
        this.#chart.setPaneOptions({ id: paneId, height: 112, minHeight: 64 })
      }
    }
    this.#syncDominanceData()
  }

  #syncDominanceData(): void {
    if (this.#dominanceIds.size === 0) {
      this.#dominanceEpoch += 1
      if (this.#dominanceIndicatorPoll !== undefined) {
        globalThis.clearInterval(this.#dominanceIndicatorPoll)
        this.#dominanceIndicatorPoll = undefined
      }
      if (this.#runtimeState.dominance && this.#runtimeState.dominance !== 'idle') {
        this.#patchRuntime({ dominance: 'idle', dominanceError: null })
      }
      return
    }

    this.#dominanceIndicatorPoll ??= globalThis.setInterval(
      () => this.#refreshDominanceRows(false),
      DOMINANCE_INDICATOR_REFRESH_MS,
    )
    if (this.#dominanceRows && this.#dominanceRowsInterval === this.#interval) {
      this.#pushDominanceRows(this.#dominanceRows)
      return
    }
    this.#refreshDominanceRows(true)
  }

  #refreshDominanceRows(showProgress: boolean): void {
    const epoch = ++this.#dominanceEpoch
    const interval = this.#interval
    if (showProgress) this.#patchRuntime({ dominance: 'loading', dominanceError: null })

    loadDominanceWeights()
      .then((weights) => fetchDominancePage(weights, interval))
      .then((page) => {
        if (this.#disposed || epoch !== this.#dominanceEpoch) return
        this.#dominanceRows = page.rows
        this.#dominanceRowsInterval = interval
        this.#pushDominanceRows(page.rows)
        this.#patchRuntime({ dominance: 'ready', dominanceError: null })
      })
      .catch((error: unknown) => {
        if (this.#disposed || epoch !== this.#dominanceEpoch || !showProgress) return
        this.#patchRuntime({ dominance: 'error', dominanceError: errorMessage(error) })
      })
  }

  #pushDominanceRows(rows: readonly DominanceRow[]): void {
    for (const [key, id] of this.#dominanceIds) {
      this.#chart.overrideIndicator({ id, name: dominanceIndicatorName(key), calc: dominanceCalc(key, rows) })
    }
  }

  /** Style that new drawings of a type start with, e.g. the user's default rectangle template. */
  public setToolDefaultStyle(type: DrawingType, style: DrawingStyle | undefined): void {
    if (style) this.#toolStyles.set(type, style)
    else this.#toolStyles.delete(type)
  }

  public startTool(type: DrawingType): boolean {
    if (this.#disposed) return false
    this.cancelActiveTool()
    this.cancelReplaySelection()
    this.#tool = { type, dragged: false, createdThisPress: false }
    this.#host.classList.add('tool-active')
    return true
  }

  public cancelActiveTool(): void {
    const tool = this.#tool
    if (!tool) return
    this.#endTool()
    if (tool.draftId) {
      this.#suppressDrawingEvents = true
      this.#chart.removeOverlay({ id: tool.draftId })
      this.#suppressDrawingEvents = false
    }
    this.#callbacks.onToolSettled()
  }

  public setMagnet(enabled: boolean): void {
    if (this.#disposed || this.#magnet === enabled) return
    this.#magnet = enabled
    this.#syncDrawings()
  }

  public cloneDrawing(id: string): void {
    const source = this.#drawingStore.getSnapshot().drawings.find((item) => item.id === id)
    if (!source || this.#disposed) return

    const offset = this.#positionDefaults()
    const points = translatePoints(drawingPoints(source), 3 * this.#intervalMs(), -offset.priceSpan / 4)
    const { locked: _locked, ...rest } = source
    const copy: Drawing = {
      ...rest,
      id: createId(),
      revision: 0,
      anchors: points.map((point) => ({ timeMs: point.timestamp, price: decimalString(Math.max(0, point.value)) })),
    }
    this.#drawingStore.execute(createDrawing(copy))
    this.#selectOverlay(copy.id)
    this.#showHandles(copy.id)
  }

  #endTool(): void {
    this.#tool = undefined
    this.#activeDrawingId = undefined
    this.#host.classList.remove('tool-active')
  }

  #intervalMs(): number {
    return MARKET_INTERVAL_SPECS[this.#interval].durationMs ?? 30 * DAY_MS
  }

  #paneRect(): DOMRect | null {
    return this.#chart.getDom('candle_pane', 'main')?.getBoundingClientRect() ?? null
  }

  #insidePane(clientX: number, clientY: number): boolean {
    const rect = this.#paneRect()
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  #priceToPixel(price: number): number {
    return (this.#chart.convertToPixel({ value: price }, { paneId: 'candle_pane' }) as Partial<Coordinate>).y ?? 0
  }

  /** Converts a pointer position to a bar-aligned market point, clamped to the price pane. */
  #pointAt(clientX: number, clientY: number): ChartPoint | null {
    const rect = this.#paneRect()
    if (!rect) return null
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
    const y = Math.min(rect.height, Math.max(0, clientY - rect.top))
    const [raw] = this.#chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
    if (raw?.timestamp === undefined || raw.value === undefined || !Number.isFinite(raw.value)) return null

    const candle = raw.dataIndex === undefined ? undefined : this.#chart.getDataList()[raw.dataIndex]
    const value = this.#magnet
      ? magnetPrice(raw.value, candle, (price) => this.#priceToPixel(price), MAGNET_TOLERANCE_PX)
      : raw.value
    return { timestamp: raw.timestamp, value }
  }

  #positionDefaults(): { priceSpan: number; timeSpanMs: number } {
    const rect = this.#paneRect()
    const [top, bottom] = this.#chart.convertFromPixel(
      [{ y: 0 }, { y: rect?.height ?? 0 }],
      { paneId: 'candle_pane' },
    ) as Array<Partial<Point>>
    const visiblePrice = Math.abs((top?.value ?? 0) - (bottom?.value ?? 0))
    const range = this.#chart.getVisibleRange()
    const bars = Math.max(8, Math.round((range.realTo - range.realFrom) * 0.18))
    return { priceSpan: visiblePrice * 0.12, timeSpanMs: bars * this.#intervalMs() }
  }

  #draftPoints(tool: ToolSession, current: ChartPoint, shiftKey: boolean): ChartPoint[] {
    const start = tool.start ?? current
    const placement = DRAWING_TOOLS[tool.type].placement
    if (placement === 'onePoint') return [current]
    if (placement === 'position') {
      return positionPoints(
        tool.type === 'shortPosition' ? 'short' : 'long',
        start,
        tool.dragged ? current : null,
        this.#positionDefaults(),
      )
    }

    let end = current
    if (shiftKey && (tool.type === 'trendLine' || tool.type === 'ray')) {
      const [from, to] = this.#chart.convertToPixel(
        [start, current],
        { paneId: 'candle_pane' },
      ) as Array<Partial<Coordinate>>
      end = lockToAxis(start, current, {
        dx: (to?.x ?? 0) - (from?.x ?? 0),
        dy: (to?.y ?? 0) - (from?.y ?? 0),
      })
    }
    return tool.type === 'rectangle' ? rectanglePoints(start, end) : [start, end]
  }

  #updateDraft(tool: ToolSession, current: ChartPoint, shiftKey: boolean): void {
    tool.current = current
    const points = this.#draftPoints(tool, current, shiftKey)
    if (tool.draftId) {
      this.#chart.overrideOverlay({ id: tool.draftId, points })
      return
    }

    const id = createId()
    const result = this.#chart.createOverlay({
      ...this.#drawingOverlayConfiguration(id, undefined, tool.type),
      points,
    })
    if (typeof result === 'string') {
      tool.draftId = id
      this.#activeDrawingId = id
    }
  }

  #finishDraft(tool: ToolSession): void {
    const overlay = tool.draftId ? this.#chart.getOverlays({ id: tool.draftId })[0] : undefined
    let drawing = overlay
      ? drawingFromOverlay(overlay, this.#market.marketId, undefined, tool.type)
      : null
    if (!drawing) return
    const startStyle = this.#toolStyles.get(tool.type)
    if (startStyle) drawing = { ...drawing, style: { ...drawing.style, ...startStyle } }

    if (DRAWING_TOOLS[tool.type].placement === 'twoPoint') {
      const first = drawing.anchors[0]
      const sameTime = drawing.anchors.every((anchor) => anchor.timeMs === first.timeMs)
      const samePrice = drawing.anchors.every((anchor) => anchor.price === first.price)
      const needsHeight = tool.type !== 'trendLine' && tool.type !== 'ray'
      // Nothing to commit yet: keep the tool armed so the next click sets the second point.
      if ((sameTime && samePrice) || (needsHeight && samePrice) || (tool.type === 'rectangle' && sameTime)) return
    }

    this.#endTool()
    this.#drawingStore.execute(createDrawing(drawing))
    if (this.#drawingModes.stayInDrawingMode) {
      // TradingView's "Stay in drawing mode": arm the same tool again for the next drawing.
      this.startTool(tool.type)
      return
    }
    this.#callbacks.onToolSettled()
    this.#selectOverlay(drawing.id)
    this.#showHandles(drawing.id)
  }

  // --- Price axis zoom ---------------------------------------------------------------------------
  // klinecharts scales the price axis by (current page Y / page Y where the press started). That ratio depends
  // on where on the screen you press, so the same drag zooms wildly near the top and barely near the bottom,
  // and a drag toward the top of the page collapses the range. We take over presses on the price axis and scale
  // by the drag distance instead, feeding the result through the library's own createRange hook.

  readonly #createPriceRange: AxisCreateRangeCallback = ({ defaultRange: autoRange }) => {
    const defaultRange = this.#withCompareRange(autoRange)
    const k = this.#priceScale
    const shift = this.#priceOffset
    const grow = (from: number, to: number): [number, number] => {
      if (k === 1 && shift === 0) return [from, to]
      const middle = (from + to) / 2 + shift * (to - from)
      const half = ((to - from) / 2) * k
      return [middle - half, middle + half]
    }
    if (this.#scaleMode !== 'normal') {
      // Log and percent scales (bottom bar): zoom in price, then express the range the way that axis expects.
      const [rawFrom, to] = grow(defaultRange.from, defaultRange.to)
      let from = rawFrom
      if (this.#scaleMode === 'log') {
        from = Math.max(from, to * 1e-4, Number.MIN_VALUE)
        const realFrom = Math.log10(from)
        const realTo = Math.log10(Math.max(to, from * 1.0001))
        return { from, to, range: to - from, realFrom, realTo, realRange: realTo - realFrom, displayFrom: from, displayTo: to, displayRange: to - from }
      }
      const data = this.#chart.getDataList()
      const base = data[Math.max(0, Math.floor(this.#chart.getVisibleRange().from))]?.close
      if (!base) return defaultRange
      const realFrom = ((from - base) / base) * 100
      const realTo = ((to - base) / base) * 100
      return { from, to, range: to - from, realFrom, realTo, realRange: realTo - realFrom, displayFrom: realFrom, displayTo: realTo, displayRange: realTo - realFrom }
    }
    if (k === 1 && shift === 0) return defaultRange
    const [from, to] = grow(defaultRange.from, defaultRange.to)
    const [realFrom, realTo] = grow(defaultRange.realFrom, defaultRange.realTo)
    const [displayFrom, displayTo] = grow(defaultRange.displayFrom, defaultRange.displayTo)
    return { from, to, range: to - from, realFrom, realTo, realRange: realTo - realFrom, displayFrom, displayTo, displayRange: displayTo - displayFrom }
  }

  #applyPriceView(scale: number, offset: number): void {
    const nextScale = Math.min(PRICE_SCALE_MAX, Math.max(PRICE_SCALE_MIN, scale))
    if (nextScale === this.#priceScale && offset === this.#priceOffset) return
    const wasManual = this.#priceScale !== 1 || this.#priceOffset !== 0
    this.#priceScale = nextScale
    this.#priceOffset = offset
    this.#chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.#createPriceRange })
    this.#emitView()
    const manual = this.#priceScale !== 1 || this.#priceOffset !== 0
    if (manual !== wasManual) this.#callbacks.onPriceViewChange?.(manual)
  }

  #setPriceScale(next: number): void {
    this.#applyPriceView(next, this.#priceOffset)
  }

  /** Back to the automatic price fit (no zoom, no vertical pan). */
  public resetPriceView(): void {
    this.#applyPriceView(1, 0)
  }

  #onPriceAxis(clientX: number, clientY: number): boolean {
    const rect = this.#chart.getDom('candle_pane', 'yAxis')?.getBoundingClientRect()
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  /** Keeps the library's own (flawed) axis handling from seeing presses on the price axis. */
  readonly #blockLibraryAxisGesture = (event: Event): void => {
    const point = 'touches' in event ? (event as TouchEvent).touches[0] : (event as MouseEvent)
    if (point && this.#onPriceAxis(point.clientX, point.clientY)) event.stopPropagation()
  }

  readonly #handleAxisPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.#onPriceAxis(event.clientX, event.clientY)) return
    event.preventDefault()
    // A quick second press (double-click or double-tap) goes back to the automatic fit.
    const now = performance.now()
    if (now - this.#lastAxisPressMs < AXIS_DOUBLE_PRESS_MS) {
      this.#lastAxisPressMs = 0
      this.#axisGesture = undefined
      this.resetPriceView()
      return
    }
    this.#lastAxisPressMs = now
    this.#axisGesture = { pointerId: event.pointerId, startY: event.clientY, startScale: this.#priceScale }
  }

  readonly #handleAxisPointerMove = (event: PointerEvent): void => {
    const gesture = this.#axisGesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    // Dragging down zooms out, up zooms in; the curve is exponential so equal drags always change the range by equal ratios.
    this.#setPriceScale(gesture.startScale * Math.exp((event.clientY - gesture.startY) / AXIS_DRAG_PIXELS_PER_E))
  }

  readonly #handleAxisPointerEnd = (event: PointerEvent): void => {
    if (this.#axisGesture?.pointerId === event.pointerId) this.#axisGesture = undefined
  }

  /** Leaving the page saves the chart; coming back replaces a live connection that died in the background. */
  readonly #handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.#hiddenAtMs = Date.now()
      this.#persistBars()
      return
    }
    const away = this.#hiddenAtMs === undefined ? 0 : Date.now() - this.#hiddenAtMs
    this.#hiddenAtMs = undefined
    this.#stream?.nudge?.(away > RESUME_RECONNECT_AFTER_MS)
  }

  readonly #handlePageHide = (): void => this.#persistBars()
  readonly #handleResumeNow = (): void => { this.#stream?.nudge?.(true) }

  #persistBars(): void {
    if (this.#disposed || this.#replay || this.#pendingReplay || this.#market.kind === 'dominance') return
    const bars = this.#chart.getDataList()
    if (bars.length >= 50) saveCachedBars(this.#market.marketId, this.#interval, bars)
  }

  // --- Free vertical pan ------------------------------------------------------------------------
  // With the price axis on automatic fit the chart only scrolls sideways, so after switching to a lower
  // timeframe and going live you could never drag down to the area below the candles. Dragging on the chart now
  // also moves the price view (the library keeps handling the sideways scroll). The move is stored as a fraction of
  // the automatic range so it follows new candles; the Auto button or a double-click on the axis puts it back.

  /** True while the library is dragging a drawing or one of its handles, in which case the chart must not pan. */
  #drawingIsPressed(): boolean {
    const store = (this.#chart as unknown as { _chartStore?: { getPressedOverlayInfo?(): { overlay?: unknown } } })._chartStore
    return !!store?.getPressedOverlayInfo?.().overlay
  }

  readonly #handlePanPointerDown = (event: PointerEvent): void => {
    this.#pointersDown.add(event.pointerId)
    // A second finger means pinch-zoom, not a pan.
    if (this.#pointersDown.size > 1) { this.#pan = undefined; return }
    if (event.button !== 0 || this.#tool || this.#replayPicking || !this.#insidePane(event.clientX, event.clientY)) return
    this.#pan = { pointerId: event.pointerId, startY: event.clientY, startOffset: this.#priceOffset, active: false }
  }

  readonly #handlePanPointerMove = (event: PointerEvent): void => {
    const pan = this.#pan
    if (!pan || event.pointerId !== pan.pointerId) return
    if (!pan.active) {
      if (Math.abs(event.clientY - pan.startY) < PAN_START_PX) return
      if (this.#drawingIsPressed()) { this.#pan = undefined; return }
      pan.active = true
      pan.startY = event.clientY
    }
    const height = this.#paneRect()?.height
    if (!height) return
    this.#applyPriceView(this.#priceScale, pan.startOffset + ((event.clientY - pan.startY) / height) * this.#priceScale * PRICE_GAP_FACTOR)
  }

  readonly #handlePanPointerEnd = (event: PointerEvent): void => {
    this.#pointersDown.delete(event.pointerId)
    if (this.#pan?.pointerId === event.pointerId) this.#pan = undefined
  }

  readonly #handleAxisWheel = (event: WheelEvent): void => {
    if (!this.#onPriceAxis(event.clientX, event.clientY)) return
    event.preventDefault()
    event.stopPropagation()
    this.#setPriceScale(this.#priceScale * Math.exp(Math.max(-100, Math.min(100, event.deltaY)) / AXIS_WHEEL_PIXELS_PER_E))
  }

  /** klinecharts never deselects on empty space, so a press that is not on the selected drawing clears the selection. */
  readonly #handleDeselectPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#tool || this.#replayPicking || !this.#selectedDrawingId) return
    const store = (this.#chart as unknown as { _chartStore?: { getHoverOverlayInfo?(): { overlay?: { id?: string } | null } } })._chartStore
    const hovered = store?.getHoverOverlayInfo?.().overlay?.id
    if (hovered === this.#selectedDrawingId) return
    // Pressing another member of a multi-selection keeps the group (to drag it); Ctrl/Shift+press adds to it.
    if (hovered && this.#multiSelection.has(hovered)) return
    if (hovered && (event.ctrlKey || event.metaKey || event.shiftKey)) this.#groupSeed = this.#selectedDrawingId
    this.clearDrawingSelection()
  }

  readonly #handleToolPointerDown = (event: PointerEvent): void => {
    if (this.#replayPicking) {
      if (event.button !== 0 || !this.#insidePane(event.clientX, event.clientY)) return
      const picked = this.#pointAt(event.clientX, event.clientY)
      if (!picked) return
      event.stopPropagation()
      this.#enterReplay(picked.timestamp)
      return
    }

    const tool = this.#tool
    if (!tool || event.button !== 0 || !this.#insidePane(event.clientX, event.clientY)) return
    const point = this.#pointAt(event.clientX, event.clientY)
    if (!point) return

    event.stopPropagation()
    tool.pointerId = event.pointerId
    tool.pressOrigin = { x: event.clientX, y: event.clientY }
    tool.dragged = false
    tool.createdThisPress = !tool.draftId
    if (!tool.draftId) tool.start = point
    this.#updateDraft(tool, point, event.shiftKey)
  }

  readonly #handleToolPointerMove = (event: PointerEvent): void => {
    const tool = this.#tool
    if (!tool?.draftId) return

    const pressed = tool.pointerId === event.pointerId
    if (pressed && tool.pressOrigin && !tool.dragged) {
      const distance = Math.hypot(event.clientX - tool.pressOrigin.x, event.clientY - tool.pressOrigin.y)
      if (distance > DRAG_THRESHOLD_PX) tool.dragged = true
    }
    // A press that has not moved yet is still a click; do not let hand tremor resize the draft.
    if (pressed && !tool.dragged) return
    if (!pressed && event.buttons !== 0) return

    const point = this.#pointAt(event.clientX, event.clientY)
    if (point) this.#updateDraft(tool, point, event.shiftKey)
  }

  readonly #handleToolPointerUp = (event: PointerEvent): void => {
    const tool = this.#tool
    if (!tool || tool.pointerId !== event.pointerId) return
    tool.pointerId = undefined

    if (event.type === 'pointercancel') {
      this.cancelActiveTool()
      return
    }
    // First click of a click-click placement: the shape follows the pointer until the second click.
    if (DRAWING_TOOLS[tool.type].placement === 'twoPoint' && tool.createdThisPress && !tool.dragged) return
    this.#finishDraft(tool)
  }

  readonly #blockChartWhileDrawing = (event: MouseEvent | TouchEvent): void => {
    if (!this.#tool && !this.#replayPicking) return
    const source = 'touches' in event ? event.touches[0] : event
    if (source && this.#insidePane(source.clientX, source.clientY)) event.stopPropagation()
  }

  readonly #handleToolContextMenu = (event: MouseEvent): void => {
    if (!this.#tool && !this.#replayPicking) return
    event.preventDefault()
    event.stopPropagation()
    this.cancelActiveTool()
    this.cancelReplaySelection()
  }

  /** Shows these price alerts as draggable lines (an empty list hides them all). */
  public setAlertLines(lines: readonly AlertLine[]): void {
    if (this.#disposed) return
    this.#alertLines = lines
    const wanted = new Map(lines.map((line) => [ALERT_OVERLAY_PREFIX + line.id, line]))
    for (const overlay of this.#chart.getOverlays({ groupId: ALERT_GROUP_ID })) {
      if (!wanted.has(overlay.id)) this.#chart.removeOverlay({ id: overlay.id })
    }
    const existing = new Set(this.#chart.getOverlays({ groupId: ALERT_GROUP_ID }).map((overlay) => overlay.id))
    // The line spans the whole chart, so only its price matters; the time just has to be a valid candle.
    const timestamp = this.#chart.getDataList().at(-1)?.timestamp ?? Date.now()
    for (const [overlayId, line] of wanted) {
      const configuration = {
        id: overlayId,
        name: ALERT_LINE_OVERLAY_NAME,
        groupId: ALERT_GROUP_ID,
        zLevel: ALERT_Z_LEVEL,
        fixedZLevel: true,
        points: [{ timestamp, value: line.price }],
        styles: { alertColor: line.paused ? ALERT_PAUSED_COLOR : ALERT_COLOR, alertPaused: line.paused ? 1 : 0 },
        onPressedMoveEnd: (event: OverlayEvent<unknown>) => {
          const price = event.overlay.points[0]?.value
          const current = this.#alertLines.find((item) => item.id === line.id)
          if (price === undefined || !Number.isFinite(price) || price <= 0 || !current) return
          const rounded = Number(price.toFixed(this.#chart.getSymbol()?.pricePrecision ?? 8))
          if (rounded !== current.price) this.#callbacks.onAlertMove?.(line.id, rounded)
        },
        onClick: (event: OverlayEvent<unknown>) => {
          if (event.figure?.key === 'alert-delete') this.#callbacks.onAlertDelete?.(line.id)
        },
        // The library deletes an overlay on right-click unless this is prevented.
        onRightClick: (event: OverlayEvent<unknown>) => { event.preventDefault?.() },
      }
      if (existing.has(overlayId)) this.#chart.overrideOverlay(configuration as never)
      else this.#chart.createOverlay(configuration as never)
    }
  }

  /** True while the pointer is over a drawing (a right-click there selects the drawing instead of opening the chart menu). */
  public drawingUnderPointer(): boolean {
    const store = (this.#chart as unknown as { _chartStore?: { getHoverOverlayInfo?(): { overlay?: { groupId?: string } | null, figureType?: string } } })._chartStore
    const hovered = store?.getHoverOverlayInfo?.()
    return !!hovered?.overlay && hovered.figureType !== 'none' && hovered.overlay.groupId === DRAWING_GROUP_ID
  }

  public deleteSelected(): void {
    if (this.#multiSelection.size > 1) {
      const ids = [...this.#multiSelection]
      this.#multiSelection.clear()
      this.#selectedDrawingId = undefined
      this.#drawingStore.execute(batchDrawings(ids.map((id) => deleteDrawing(id))))
      this.#callbacks.onSelectionChange(undefined)
      this.#emitDrawing({ kind: 'selection', ids: [] })
      return
    }
    if (!this.#selectedDrawingId) return
    const id = this.#selectedDrawingId
    this.#selectedDrawingId = undefined
    this.#drawingStore.execute(deleteDrawing(id))
    this.#callbacks.onSelectionChange(undefined)
  }

  public focusDrawing(id: string): void {
    const drawing = this.#drawingStore.getSnapshot().drawings.find((item) => item.id === id)
    if (!drawing) return

    this.#selectOverlay(id)
    const centerTimeMs = Math.round(
      drawing.anchors.reduce((sum, anchor) => sum + anchor.timeMs, 0) / drawing.anchors.length,
    )
    this.#withIgnoredNavigation(() => this.#scrollToCentre(centerTimeMs, 180))
  }

  /** Re-colors the chart canvas (grid, axes, crosshair, legends) for the app theme. */
  public setTheme(theme: 'dark' | 'light'): void {
    const light = theme === 'light'
    const grid = light ? '#e6e9ef' : '#1f2330'
    const axis = light ? '#d3d8e0' : '#2a2e39'
    const crosshair = light ? '#6b7280' : '#9598a1'
    this.#chart.setStyles({
      grid: {
        horizontal: { color: grid },
        vertical: { color: grid },
      },
      xAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: light ? '#4b5563' : '#787b86' } },
      yAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: light ? '#374151' : '#b2b5be' } },
      indicator: { tooltip: { title: { color: light ? '#374151' : '#b2b5be' } } },
      crosshair: {
        horizontal: { line: { color: crosshair } },
        vertical: { line: { color: crosshair } },
      },
    } as never)
  }

  /**
   * A drawing that was just placed (or copied) is selected like one that was clicked: its handles and
   * axis tags show at once, so it can be adjusted without first clicking it. klinecharts has no public
   * API for this, so the click state is set directly (pinned version 10.0.3).
   */
  #showHandles(id: string): void {
    const overlay = this.#chart.getOverlays({ id })[0]
    const store = (this.#chart as unknown as { _chartStore?: { setClickOverlayInfo?(info: unknown, onSelected: () => void, onDeselected: () => void): void } })._chartStore
    if (!overlay || !store?.setClickOverlayInfo) return
    store.setClickOverlayInfo(
      { paneId: 'candle_pane', overlay, figureType: 'point', figureIndex: 0, figure: null },
      () => undefined,
      () => undefined,
    )
  }

  public clearDrawingSelection(): void {
    this.#selectOverlay(undefined)
    // klinecharts has no public API to deselect, so it keeps drawing handles on the last
    // clicked overlay. Reset its click state (pinned version 10.0.3) so Esc leaves clean shapes.
    const store = (this.#chart as unknown as { _chartStore?: { setClickOverlayInfo?(info: unknown, onSelected: () => void, onDeselected: () => void): void } })._chartStore
    store?.setClickOverlayInfo?.(
      { paneId: '', overlay: null, figureType: 'none', figureIndex: -1, figure: null },
      () => undefined,
      () => undefined,
    )
  }

  public dispose(): void {
    if (this.#disposed) return
    this.#leaveSync?.()
    this.#leaveSync = undefined
    if (this.#compareTimer !== undefined) globalThis.clearInterval(this.#compareTimer)
    this.#compareEpoch += 1
    if (import.meta.env.DEV) (globalThis as { __tradeHorizonCharts?: Set<Chart> }).__tradeHorizonCharts?.delete(this.#chart)
    if (this.#timeSyncFrame !== undefined) cancelAnimationFrame(this.#timeSyncFrame)
    this.#disposed = true
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#drawingStoreUnsubscribe()
    this.#chart.unsubscribeAction('onScroll', this.#handleManualNavigation)
    this.#chart.unsubscribeAction('onPaneDrag', this.#handleManualNavigation)
    this.#chart.unsubscribeAction('onScroll', this.#emitView)
    this.#chart.unsubscribeAction('onZoom', this.#emitView)
    this.#chart.unsubscribeAction('onVisibleRangeChange', this.#emitView)
    this.#viewListeners.clear()
    this.#stopDominancePolling()
    this.#stopReplayTimer()
    if (this.#dominanceIndicatorPoll !== undefined) globalThis.clearInterval(this.#dominanceIndicatorPoll)
    this.#host.removeEventListener('pointerdown', this.#handleToolPointerDown, true)
    this.#host.removeEventListener('pointerdown', this.#handleDeselectPointerDown, true)
    this.#host.removeEventListener('pointerdown', this.#handleAxisPointerDown, true)
    this.#host.removeEventListener('pointerdown', this.#handlePanPointerDown, true)
    globalThis.removeEventListener('pointermove', this.#handlePanPointerMove, true)
    globalThis.removeEventListener('pointerup', this.#handlePanPointerEnd, true)
    globalThis.removeEventListener('pointercancel', this.#handlePanPointerEnd, true)
    this.#host.removeEventListener('mousedown', this.#blockLibraryAxisGesture, true)
    this.#host.removeEventListener('touchstart', this.#blockLibraryAxisGesture, true)
    this.#host.removeEventListener('dblclick', this.#blockLibraryAxisGesture, true)
    this.#host.removeEventListener('wheel', this.#handleAxisWheel, true)
    document.removeEventListener('visibilitychange', this.#handleVisibilityChange)
    globalThis.removeEventListener('pagehide', this.#handlePageHide)
    globalThis.removeEventListener('pageshow', this.#handleResumeNow)
    globalThis.removeEventListener('online', this.#handleResumeNow)
    globalThis.clearTimeout(this.#statusTimer)
    globalThis.removeEventListener('pointermove', this.#handleAxisPointerMove, true)
    globalThis.removeEventListener('pointerup', this.#handleAxisPointerEnd, true)
    globalThis.removeEventListener('pointercancel', this.#handleAxisPointerEnd, true)
    this.#host.removeEventListener('pointerdown', this.#handlePointerModifier, true)
    globalThis.removeEventListener('pointermove', this.#handlePointerModifier, true)
    globalThis.removeEventListener('pointerup', this.#handlePointerModifier, true)
    globalThis.removeEventListener('keydown', this.#handleKeyDown, true)
    globalThis.removeEventListener('keyup', this.#handleKeyUp, true)
    globalThis.removeEventListener('blur', this.#handleWindowBlur)
    this.#host.removeEventListener('mousedown', this.#blockChartWhileDrawing, true)
    this.#host.removeEventListener('touchstart', this.#blockChartWhileDrawing, true)
    this.#host.removeEventListener('contextmenu', this.#handleToolContextMenu, true)
    this.#host.removeEventListener('pointerdown', this.#trackSelectionPress, true)
    this.#host.removeEventListener('pointerleave', this.#handleHostLeave)
    this.#chart.unsubscribeAction('onCrosshairChange', this.#handleCrosshair)
    this.#hoverListeners.clear()
    globalThis.removeEventListener('pointermove', this.#handleToolPointerMove, true)
    globalThis.removeEventListener('pointerup', this.#handleToolPointerUp, true)
    globalThis.removeEventListener('pointercancel', this.#handleToolPointerUp, true)
    this.#host.classList.remove('tool-active')
    if (this.#navigationTimer !== undefined) globalThis.clearTimeout(this.#navigationTimer)
    dispose(this.#chart)
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
    return () => { this.#viewListeners.delete(listener) }
  }

  /**
   * Time left in the current candle and where to show it: just under the last-price tag on the
   * price axis, in coordinates of the chart host. Null when there is nothing sensible to show.
   * Pure client clock and chart maths; nothing is requested from the server.
   */
  public countdownState(now = Date.now()): { remainingMs: number; top: number; left: number; width: number; up: boolean } | null {
    if (this.#disposed || this.#replay || this.#pendingReplay) return null
    const last = this.#chart.getDataList().at(-1)
    const axis = this.#chart.getDom('candle_pane', 'yAxis')?.getBoundingClientRect()
    const pane = this.#paneRect()
    if (!last || !axis || !pane) return null
    const remainingMs = candleCloseMs(last.timestamp, this.#interval) - now
    // A stale last candle (feed down, market paused) would count down from the past.
    if (remainingMs < -(MARKET_INTERVAL_SPECS[this.#interval].durationMs ?? 30 * DAY_MS)) return null
    const y = (this.#chart.convertToPixel({ value: last.close }, { paneId: 'candle_pane' }) as Partial<Coordinate>).y
    if (y === undefined || !Number.isFinite(y) || y < 0 || y > pane.height) return null
    const host = this.#host.getBoundingClientRect()
    return { remainingMs, top: pane.top - host.top + y, left: axis.left - host.left, width: axis.width, up: last.close >= last.open }
  }

  #handleStreamStatus(status: KlineStreamStatus): void {
    globalThis.clearTimeout(this.#statusTimer)
    if (status.state === 'open') {
      this.#patchRuntime({ connection: 'live', error: null })
    } else if (status.state === 'connecting' || status.state === 'reconnecting') {
      const connection = status.state
      // A connection that was live usually recovers within a moment (for example right after you return to the
      // tab), so only tell the user if it has not come back after a short grace period.
      if (this.#runtimeState.connection === 'live') {
        this.#statusTimer = globalThis.setTimeout(() => {
          if (!this.#disposed) this.#patchRuntime({ connection })
        }, STATUS_GRACE_MS)
      } else {
        this.#patchRuntime({ connection })
      }
    }
  }

  /** Candle history from the exchange this market trades on. */
  #fetchKlines(options: FetchBinanceKlinesOptions): Promise<Candle[]> {
    const { exchange } = this.#market
    if (exchange === 'bybit') return fetchBybitKlines(options)
    return fetchBinanceKlines(exchange === 'binance-futures' ? { ...options, endpoint: BINANCE_FUTURES_REST_ENDPOINT } : options)
  }

  async #backfillAfterReconnect(
    interval: MarketInterval,
    epoch: number,
    callback: (data: KLineData) => void,
  ): Promise<void> {
    try {
      const candles = await this.#fetchKlines({
        symbol: exchangeSymbol(this.#market.symbol),
        interval,
        limit: HISTORY_PAGE_SIZE,
      })
      if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return

      const latestTimestamp = this.#chart.getDataList().at(-1)?.timestamp ?? 0
      for (const candle of candles) {
        if (candle.openTimeMs >= latestTimestamp) callback(candleToKLineData(candle))
      }

      const latest = candles.at(-1)
      if (latest) this.#patchRuntime({ quote: candleToQuote(latest), error: null })
    } catch (error) {
      if (!this.#disposed && epoch === this.#dataEpoch) {
        this.#patchRuntime({ error: errorMessage(error) })
      }
    }
  }

  async #loadDominanceBars(
    type: string,
    interval: MarketInterval,
    timestamp: number | null,
    callback: Parameters<DataLoader['getBars']>[0]['callback'],
  ): Promise<void> {
    const key = this.#market.dominanceKey
    if (!key || type === 'backward' || (type === 'forward' && timestamp === null)) {
      callback([], false)
      return
    }

    const epoch = this.#dataEpoch
    if (type === 'init') this.#patchRuntime({ interval, connection: 'loading', error: null })

    try {
      const weights = await loadDominanceWeights()
      const page = await fetchDominancePage(weights, interval, type === 'forward' && timestamp !== null
        ? { endTimeMs: Math.max(0, timestamp - 1), reference: this.#dominanceReference }
        : {})
      if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return

      if (type === 'init') this.#dominanceReference = page.reference
      const bars = dominanceCandles(page.rows, key)

      if (type === 'init' && this.#pendingReplay) {
        const replayInfo = this.#pendingReplay
        this.#pendingReplay = undefined
        const cursor = replayTransitionCursor(bars.map((b) => b.timestamp), replayInfo.targetTimeMs)
        this.#replay = { bars, cursor, speedMs: replayInfo.speedMs }
        this.#replayPicking = replayInfo.wasPicking
        if (replayInfo.wasPicking) {
          this.#host.classList.add('replay-picking')
        }
        const shown = bars.slice(0, cursor)
        callback(shown, { forward: page.hasMore, backward: false })
        const latest = shown.at(-1)
        this.#patchRuntime({
          connection: latest ? 'live' : 'error',
          quote: latest ? barToQuote(latest) : null,
          error: latest ? null : 'No dominance data was returned.',
        })
        this.#publishReplay()
        this.#afterInitialData()
        if (replayInfo.wasPlaying) {
          this.setReplayPlaying(true)
        }
        return
      }

      callback(bars, { forward: page.hasMore, backward: false })

      if (type === 'init') {
        const latest = bars.at(-1)
        this.#patchRuntime({
          connection: latest ? 'live' : 'error',
          quote: latest ? barToQuote(latest) : null,
          error: latest ? null : 'No dominance data was returned.',
        })
        this.#publishReplay()
        this.#afterInitialData()
      }
    } catch (error) {
      if (this.#disposed || epoch !== this.#dataEpoch) return
      callback([], false)
      if (type === 'init') this.#patchRuntime({ connection: 'error', quote: null, error: errorMessage(error) })
    }
  }

  #startDominancePolling(interval: MarketInterval, callback: (data: KLineData) => void): void {
    this.#stopDominancePolling()
    const key = this.#market.dominanceKey
    if (!key) return
    const epoch = this.#dataEpoch

    this.#dominancePoll = globalThis.setInterval(() => {
      void loadDominanceWeights()
        .then((weights) => fetchDominancePage(weights, interval, { limit: 2, reference: this.#dominanceReference }))
        .then((page) => {
          if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
          const lastTimestamp = this.#chart.getDataList().at(-1)?.timestamp ?? 0
          let latest: KLineData | undefined
          for (const bar of dominanceCandles(page.rows, key)) {
            if (bar.timestamp < lastTimestamp) continue
            callback(bar)
            latest = bar
          }
          if (latest) this.#patchRuntime({ quote: barToQuote(latest), connection: 'live', error: null })
        })
        .catch(() => {
          // A missed poll is harmless; the next tick catches up.
        })
    }, DOMINANCE_POLL_MS)
  }

  #stopDominancePolling(): void {
    if (this.#dominancePoll === undefined) return
    globalThis.clearInterval(this.#dominancePoll)
    this.#dominancePoll = undefined
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
          this.#withIgnoredNavigation(() => this.#chart.scrollToRealTime())
        } else {
          this.#withIgnoredNavigation(() => this.#scrollToCentre(pending.centerTimeMs!))
        }
      } else {
        this.#withIgnoredNavigation(() => this.#chart.scrollToRealTime())
      }
      this.#applyPendingRange()

      this.#syncDrawings()
    })
  }

  /** klinecharts' scrollToTimestamp puts the candle at the right edge; every caller here wants it in the middle. */
  #scrollToCentre(timestamp: number, animationDuration?: number): void {
    this.#chart.scrollToTimestamp(timestamp)
    const width = this.#chart.getSize('candle_pane', 'main')?.width ?? this.#host.clientWidth
    this.#chart.scrollByDistance(-width / 2, animationDuration)
  }

  #withIgnoredNavigation(action: () => void): void {
    this.#ignoreNavigationEvents = true
    action()
    if (this.#navigationTimer !== undefined) globalThis.clearTimeout(this.#navigationTimer)
    this.#navigationTimer = globalThis.setTimeout(() => {
      this.#ignoreNavigationEvents = false
      this.#navigationTimer = undefined
    }, 300)
  }

  #drawingOverlayConfiguration(
    id: string,
    drawing: Drawing | undefined,
    type: DrawingType,
  ): OverlayCreate {
    const style = { ...DRAWING_TOOLS[type].defaultStyle, ...this.#toolStyles.get(type), ...drawing?.style }
    const text = (key: string, fallback: string): string => {
      const value = style[key]
      return typeof value === 'string' ? value : fallback
    }
    const number = (key: string, fallback: number): number => {
      const value = style[key]
      return typeof value === 'number' ? value : fallback
    }

    // Finger-sized grab handles on touch screens.
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
    const color = text('color', '#f4b860')
    const lineWidth = number('lineWidth', 2)
    const lineStyle = style.lineStyle === 'dashed' ? 'dashed' : 'solid'
    const fillOpacity = number('fillOpacity', 14)

    return {
      name: DRAWING_TOOLS[type].overlayName,
      id,
      groupId: DRAWING_GROUP_ID,
      paneId: 'candle_pane',
      mode: this.#magnet ? 'weak_magnet' : 'normal',
      modeSensitivity: MAGNET_TOLERANCE_PX,
      lock: (drawing?.locked ?? false) || this.#drawingModes.lockAll,
      visible: !(drawing?.hidden ?? false) && !this.#drawingModes.hideAll && visibleOnInterval(drawing?.style, this.#interval),
      zLevel: drawing ? this.#stackLevels.get(id) ?? DRAFT_Z_LEVEL : DRAFT_Z_LEVEL,
      fixedZLevel: true,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: type !== 'horizontalLine',
      needDefaultYAxisFigure: type !== 'verticalLine',
      ...(drawing ? { points: drawingPoints(drawing) } : {}),
      styles: {
        // A drawing in a multi-selection is drawn a little thicker, so the group can be seen.
        line: { color, size: lineWidth + (this.#multiSelection.has(id) ? 1.5 : 0), style: lineStyle, dashedValue: [6, 4] },
        fibLevels: type === 'fibRetracement' ? fibLevels(style).join(',') : '',
        rect: {
          // "No color" for a rectangle's line: fill only (a zero-width border would still be drawn 1px wide).
          style: style.noBorder === true ? 'fill' : 'stroke_fill',
          color: colorWithOpacity(text('fillColor', '#3aa9ff'), fillOpacity),
          borderColor: color,
          borderSize: style.noBorder === true ? 0 : lineWidth + (this.#multiSelection.has(id) ? 1.5 : 0),
          borderStyle: lineStyle,
          borderDashedValue: [4, 4],
          borderRadius: 0,
        },
        lineWidth,
        lineStyle,
        fillOpacity,
        showMidline: style.midline === true ? 1 : 0,
        textValue: text('text', 'Text'),
        fontSize: number('fontSize', 14),
        bold: style.bold === true ? 1 : 0,
        targetColor: text('targetColor', '#16a085'),
        stopColor: text('stopColor', '#f0445e'),
        upColor: text('upColor', '#10b981'),
        downColor: text('downColor', '#ef4444'),
        textColor: type === 'text' ? color : text('textColor', '#ffffff'),
        positionLineColor: text('lineColor', '#c7d0db'),
        positionLineWidth: number('lineWidth', 1),
        positionFillOpacity: number('fillOpacity', 22),
        accountSize: number('accountSize', 10_000),
        riskPercent: number('riskPercent', 1),
        dcaTriggered: style.dcaTriggered === true ? 1 : 0,
        dcaSize: number('dcaSize', 1),
        // Position labels show while placing (no stored drawing yet) or while selected.
        showValues: !drawing || id === this.#selectedDrawingId ? 1 : 0,
        point: {
          color,
          borderColor: '#131722',
          borderSize: 2,
          radius: coarse ? 9 : 4,
          activeColor: '#ffffff',
          activeBorderColor: color,
          activeBorderSize: 2,
          activeRadius: coarse ? 11 : 5,
        },
      },
      onPressedMoveStart: (event) => this.#beginOverlayMove(event),
      onPressedMoving: (event) => this.#continueOverlayMove(event),
      onPressedMoveEnd: (event) => {
        this.#overlayMove = undefined
        this.#lastOverlayMoveEvent = undefined
        this.#commitOverlay(event, type)
      },
      // The library deletes an overlay on right-click unless this is prevented.
      onRightClick: (event) => {
        event.preventDefault?.()
        if (!this.#multiSelection.has(event.overlay.id)) this.#setMultiSelection([])
        this.#selectOverlay(event.overlay.id)
        const rect = this.#paneRect()
        if (rect && event.x !== undefined && event.y !== undefined) {
          this.#emitDrawing({ kind: 'contextMenu', id: event.overlay.id, clientX: rect.left + event.x, clientY: rect.top + event.y })
        }
      },
      onDoubleClick: (event) => {
        this.#emitDrawing({ kind: 'doubleClick', id: event.overlay.id })
        return true
      },
      onRemoved: (event) => this.#removeOverlayFromStore(event),
      onSelected: (event) => {
        const id = event.overlay.id
        const previous = this.#selectedDrawingId ?? this.#groupSeed
        this.#groupSeed = undefined
        if (this.#modifierPress) {
          // Ctrl/Shift+click adds to the selection (or takes the drawing out of it).
          const ids = new Set(this.#multiSelection.size > 0 ? this.#multiSelection : previous ? [previous] : [])
          if (ids.has(id) && ids.size > 1) ids.delete(id)
          else ids.add(id)
          this.#setMultiSelection([...ids])
        } else if (!this.#multiSelection.has(id)) {
          this.#setMultiSelection([])
        }
        this.#selectOverlay(id)
      },
      onDeselected: (event) => this.#deselectOverlay(event.overlay.id),
    }
  }

  /**
   * Dragging a drawing's body: remember its anchors so the move can be applied as a
   * pure time/price offset. The library would otherwise re-snap every anchor to the
   * current timeframe's bars, which distorts or collapses shapes drawn on a finer one.
   */
  #beginOverlayMove(event: OverlayEvent<unknown>): void {
    this.#overlayMove = undefined
    this.#lastOverlayMoveEvent = undefined
    if (event.figure?.key?.startsWith(POINT_HANDLE_KEY_PREFIX)) return
    if (event.x === undefined || event.y === undefined) return

    const [start] = this.#chart.convertFromPixel(
      [{ x: event.x, y: event.y }],
      { paneId: 'candle_pane' },
    ) as Array<Partial<Point>>
    const points: ChartPoint[] = []
    for (const point of event.overlay.points) {
      if (point.timestamp === undefined || point.value === undefined) return
      points.push({ timestamp: point.timestamp, value: point.value })
    }
    if (start?.dataIndex === undefined || start.value === undefined) return

    this.#overlayMove = {
      id: event.overlay.id,
      startIndex: start.dataIndex,
      startValue: start.value,
      points,
    }
    this.#groupMove = undefined
    if (this.#multiSelection.has(event.overlay.id) && this.#multiSelection.size > 1) {
      const group = new Map<string, ChartPoint[]>()
      for (const id of this.#multiSelection) {
        if (id === event.overlay.id) continue
        const other = this.#chart.getOverlays({ id })[0]
        const drawing = this.#drawingStore.getSnapshot().drawings.find((item) => item.id === id)
        if (!other || !drawing || drawing.locked || this.#drawingModes.lockAll) continue
        const start = other.points.filter((point) => point.timestamp !== undefined && point.value !== undefined).map((point) => ({ timestamp: point.timestamp!, value: point.value! }))
        if (start.length === other.points.length) group.set(id, start)
      }
      if (group.size > 0) this.#groupMove = group
    }
  }

  #continueOverlayMove(event: OverlayEvent<unknown>): void {
    const move = this.#overlayMove
    if (!move || move.id !== event.overlay.id || event.x === undefined || event.y === undefined) return
    this.#lastOverlayMoveEvent = event

    const [current] = this.#chart.convertFromPixel(
      [{ x: event.x, y: event.y }],
      { paneId: 'candle_pane' },
    ) as Array<Partial<Point>>
    if (current?.dataIndex === undefined || current.value === undefined) return

    const deltaBars = Math.round(current.dataIndex - move.startIndex)
    const overlay = event.overlay as { points: Array<Partial<Point>> }
    const deltaValue = this.#shiftHeld ? 0 : current.value - move.startValue
    overlay.points = translatePoints(move.points, deltaBars * this.#intervalMs(), deltaValue)
    if (this.#groupMove) {
      for (const [id, start] of this.#groupMove) {
        this.#chart.overrideOverlay({ id, points: translatePoints(start, deltaBars * this.#intervalMs(), deltaValue) })
      }
    }
  }

  #commitOverlay(event: OverlayEvent<unknown>, type: DrawingType): void {
    if (this.#suppressDrawingEvents || this.#disposed) return
    if (event.overlay.id === this.#activeDrawingId) return

    const existing = this.#drawingStore
      .getSnapshot()
      .drawings.find((drawing) => drawing.id === event.overlay.id)
    if (!existing) return
    const drawing = drawingFromOverlay(event.overlay, this.#market.marketId, existing, type)
    const group = this.#groupMove
    this.#groupMove = undefined
    // A click without movement must not create an undo step.
    if (!drawing || anchorsEqual(existing.anchors, drawing.anchors)) return

    const commands = [updateDrawing(existing.id, { anchors: drawing.anchors })]
    if (group) {
      // The whole multi-selection moved: one undo step for all of it.
      for (const id of group.keys()) {
        const other = this.#chart.getOverlays({ id })[0]
        const stored = this.#drawingStore.getSnapshot().drawings.find((item) => item.id === id)
        const moved = other && stored ? drawingFromOverlay(other, this.#market.marketId, stored, stored.type) : null
        if (moved && stored && !anchorsEqual(stored.anchors, moved.anchors)) commands.push(updateDrawing(id, { anchors: moved.anchors }))
      }
    }
    this.#drawingStore.execute(batchDrawings(commands))
  }

  #removeOverlayFromStore(event: OverlayEvent<unknown>): void {
    if (this.#suppressDrawingEvents || this.#disposed) return

    if (this.#selectedDrawingId === event.overlay.id) this.#selectOverlay(undefined)
    this.#drawingStore.execute(deleteDrawing(event.overlay.id))
  }

  #selectOverlay(id: string | undefined): void {
    const previous = this.#selectedDrawingId
    this.#selectedDrawingId = id
    if (previous !== id) {
      for (const [overlayId, showValues] of [[previous, 0], [id, 1]] as const) {
        if (overlayId) this.#chart.overrideOverlay({ id: overlayId, styles: { showValues } })
      }
    }
    this.#callbacks.onSelectionChange(id)
  }

  #deselectOverlay(id: string): void {
    // The library deselects the old drawing before selecting the Ctrl/Shift-clicked one; keep it for the group.
    if (this.#modifierPress && this.#selectedDrawingId === id) this.#groupSeed = id
    if (this.#selectedDrawingId === id) this.#selectOverlay(undefined)
  }

  #syncDrawings(): void {
    if (this.#disposed) return

    const desired = this.#drawingStore
      .getSnapshot()
      .drawings.filter((drawing) => drawing.marketId === this.#market.marketId)
    const desiredById = new Map(desired.map((drawing) => [drawing.id, drawing]))
    const existing = this.#chart.getOverlays({ groupId: DRAWING_GROUP_ID })
    const existingIds = new Set(existing.map((overlay) => overlay.id))
    this.#stackLevels = stackLevels(desired)

    this.#suppressDrawingEvents = true
    try {
      for (const overlay of existing) {
        if (!desiredById.has(overlay.id) && overlay.id !== this.#activeDrawingId) {
          this.#chart.removeOverlay({ id: overlay.id })
        }
      }

      for (const drawing of desired) {
        if (existingIds.has(drawing.id)) {
          this.#chart.overrideOverlay(this.#drawingOverlayConfiguration(drawing.id, drawing, drawing.type))
        } else {
          this.#chart.createOverlay(this.#drawingOverlayConfiguration(drawing.id, drawing, drawing.type))
        }
      }
    } finally {
      this.#suppressDrawingEvents = false
    }

    if (this.#selectedDrawingId && !desiredById.has(this.#selectedDrawingId)) {
      this.#selectOverlay(undefined)
    }
  }
}
