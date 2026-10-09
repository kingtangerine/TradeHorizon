import {
  dispose,
  init,
  type Chart,
  type Coordinate,
  type DataLoader,
  type KLineData,
  type OverlayCreate,
  type OverlayEvent,
  type Point,
} from 'klinecharts'
import {
  createDrawing,
  deleteDrawing,
  updateDrawing,
  type Anchor,
  type Drawing,
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
  translatePoints,
  type ChartPoint,
} from './geometry'
import {
  DOMINANCE_COLORS,
  MOVING_AVERAGE_COLORS,
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
import { DEFAULT_REPLAY_SPEED_MS, replayStartCursor } from './replay'
import { DRAWING_TOOLS } from './tools'
import { candleToQuote, type ChartQuote, type ChartRuntimeState, type ChartType } from './types'

const HISTORY_PAGE_SIZE = 1000
/** Extra history pages fetched so a timeframe switch can keep the part of the chart you were looking at. */
const MAX_VIEWPORT_BACKFILL_PAGES = 10
const VIEWPORT_BACKFILL_MARGIN_BARS = 200
const DRAG_THRESHOLD_PX = 4
const MAGNET_TOLERANCE_PX = 12
const DOMINANCE_POLL_MS = 20_000
const DOMINANCE_INDICATOR_REFRESH_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const POINT_HANDLE_KEY_PREFIX = 'overlay_figure_point_'
const VOLUME_PANE_ID = 'trade-horizon:volume'
// The HTML legend lists moving averages, so the library's own overlapping label is blanked.
const HIDDEN_INDICATOR_TOOLTIP = { name: '', calcParamsText: '', features: [], legends: [] }

registerTradeHorizonOverlays()
registerDominanceIndicators()

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

interface PendingViewport {
  followingLive: boolean
  centerTimeMs?: number
  barSpace: number
}

export interface KLineChartControllerCallbacks {
  onRuntimeState(state: ChartRuntimeState): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
}

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
  #stream?: { stop(): void }
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
  #replayPicking = false
  readonly #movingAverageIds = new Map<MovingAverageKind, string>()
  readonly #dominanceIds = new Map<DominanceKey, string>()
  #dominanceRows?: DominanceRow[]
  #dominanceRowsInterval?: MarketInterval
  #dominanceReference?: Record<string, number>
  #dominanceIndicatorPoll?: ReturnType<typeof globalThis.setInterval>
  #dominanceEpoch = 0

  readonly #handleManualNavigation = (): void => {
    if (!this.#ignoreNavigationEvents && this.#runtimeState.followingLive) {
      this.#patchRuntime({ followingLive: false })
    }
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
      if (type === 'init') {
        this.#patchRuntime({ interval, connection: 'loading', error: null })
      }

      try {
        const result = await this.#historyLoader.load({
          symbol: this.#market.symbol,
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
        if (pending && !pending.followingLive && pending.centerTimeMs !== undefined) {
          const neededFrom = pending.centerTimeMs - VIEWPORT_BACKFILL_MARGIN_BARS * this.#intervalMs()
          for (
            let page = 0;
            hasPage && bars.length > 0 && bars[0].timestamp > neededFrom && page < MAX_VIEWPORT_BACKFILL_PAGES;
            page += 1
          ) {
            const older = await this.#fetchKlines({
              symbol: this.#market.symbol,
              interval,
              limit: HISTORY_PAGE_SIZE,
              endTimeMs: Math.max(0, bars[0].timestamp - 1),
            })
            if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
            bars = [...older.map(candleToKLineData), ...bars]
            hasPage = older.length === HISTORY_PAGE_SIZE
          }
          if (bars.length > 0 && bars[0].timestamp > pending.centerTimeMs) pending.followingLive = true
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

      const streamOptions = {
        symbol: this.#market.symbol,
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
    if (import.meta.env.DEV) (globalThis as { __tradeHorizonChart?: Chart }).__tradeHorizonChart = chart

    chart.setSymbol({
      ticker: market.symbol,
      pricePrecision: market.pricePrecision,
      volumePrecision: market.volumePrecision,
    })
    chart.setPeriod(intervalToPeriod(interval))
    chart.setDataLoader(this.#dataLoader)
    chart.setOffsetRightDistance(72)
    chart.subscribeAction('onScroll', this.#handleManualNavigation)
    chart.subscribeAction('onPaneDrag', this.#handleManualNavigation)

    // Capture-phase listeners let a drawing tool own the pointer before the chart starts panning.
    host.addEventListener('pointerdown', this.#handleToolPointerDown, true)
    host.addEventListener('pointerdown', this.#handleDeselectPointerDown, true)
    host.addEventListener('mousedown', this.#blockChartWhileDrawing, true)
    host.addEventListener('touchstart', this.#blockChartWhileDrawing, true)
    host.addEventListener('contextmenu', this.#handleToolContextMenu, true)
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

  public setInterval(interval: MarketInterval): void {
    if (this.#disposed || interval === this.#interval) return

    this.cancelActiveTool()
    this.#clearReplay()
    this.#pendingViewport = this.#captureViewport()
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
    this.#patchRuntime({ interval, connection: 'loading', error: null })
    this.#chart.setPeriod(intervalToPeriod(interval))
    this.#syncDominanceData()
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
    this.#chart.setStyles({
      candle: {
        type: type === 'line' ? 'area' : 'candle_solid',
        area: { lineColor: '#2962ff', lineSize: 2, value: 'close', smooth: false, backgroundColor: 'transparent' },
      },
    })
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
    if (!this.#replay && !this.#replayPicking) return
    const wasActive = !!this.#replay
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
    this.#patchRuntime({
      replay: replay
        ? {
            status: this.#replayPicking ? 'picking' : 'active',
            playing: replay.timer !== undefined,
            speedMs: replay.speedMs,
            timeMs: replay.bars[replay.cursor - 1]?.timestamp ?? null,
            atEnd: replay.cursor >= replay.bars.length,
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

  public setVolumeVisible(requested: boolean): void {
    if (this.#disposed) return
    // An index has no traded volume, so its pane would always be empty.
    const visible = requested && this.#market.kind !== 'dominance'

    if (visible && !this.#volumeIndicatorId) {
      const id = this.#chart.createIndicator({
        name: 'VOL',
        paneId: VOLUME_PANE_ID,
        styles: {
          bars: [{
            upColor: 'rgba(8, 153, 129, 0.5)',
            downColor: 'rgba(242, 54, 69, 0.5)',
            noChangeColor: 'rgba(127, 141, 163, 0.48)',
          }],
        },
      })
      if (id) {
        this.#volumeIndicatorId = id
        this.#chart.setPaneOptions({ id: VOLUME_PANE_ID, height: 128, minHeight: 76 })
      }
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
    this.#applyDominance(settings.dominance)
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
    const drawing = overlay
      ? drawingFromOverlay(overlay, this.#market.marketId, undefined, tool.type)
      : null
    if (!drawing) return

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
    this.#callbacks.onToolSettled()
    this.#selectOverlay(drawing.id)
  }

  /** klinecharts never deselects on empty space, so a press that is not on the selected drawing clears the selection. */
  readonly #handleDeselectPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#tool || this.#replayPicking || !this.#selectedDrawingId) return
    const store = (this.#chart as unknown as { _chartStore?: { getHoverOverlayInfo?(): { overlay?: { id?: string } | null } } })._chartStore
    const hovered = store?.getHoverOverlayInfo?.().overlay?.id
    if (hovered === this.#selectedDrawingId) return
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

  public deleteSelected(): void {
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
    this.#withIgnoredNavigation(() => this.#chart.scrollToTimestamp(centerTimeMs, 180))
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
    this.#disposed = true
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#drawingStoreUnsubscribe()
    this.#chart.unsubscribeAction('onScroll', this.#handleManualNavigation)
    this.#chart.unsubscribeAction('onPaneDrag', this.#handleManualNavigation)
    this.#stopDominancePolling()
    this.#stopReplayTimer()
    if (this.#dominanceIndicatorPoll !== undefined) globalThis.clearInterval(this.#dominanceIndicatorPoll)
    this.#host.removeEventListener('pointerdown', this.#handleToolPointerDown, true)
    this.#host.removeEventListener('pointerdown', this.#handleDeselectPointerDown, true)
    this.#host.removeEventListener('mousedown', this.#blockChartWhileDrawing, true)
    this.#host.removeEventListener('touchstart', this.#blockChartWhileDrawing, true)
    this.#host.removeEventListener('contextmenu', this.#handleToolContextMenu, true)
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
  }

  #handleStreamStatus(status: KlineStreamStatus): void {
    if (status.state === 'connecting') {
      this.#patchRuntime({ connection: 'connecting' })
    } else if (status.state === 'open') {
      this.#patchRuntime({ connection: 'live', error: null })
    } else if (status.state === 'reconnecting') {
      this.#patchRuntime({ connection: 'reconnecting' })
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
        symbol: this.#market.symbol,
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
      callback(bars, { forward: page.hasMore, backward: false })

      if (type === 'init') {
        const latest = bars.at(-1)
        this.#patchRuntime({
          connection: latest ? 'live' : 'error',
          quote: latest ? barToQuote(latest) : null,
          error: latest ? null : 'No dominance data was returned.',
        })
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
          this.#withIgnoredNavigation(() => this.#chart.scrollToTimestamp(pending.centerTimeMs!))
        }
      } else {
        this.#withIgnoredNavigation(() => this.#chart.scrollToRealTime())
      }

      this.#syncDrawings()
    })
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
    const style = { ...DRAWING_TOOLS[type].defaultStyle, ...drawing?.style }
    const text = (key: string, fallback: string): string => {
      const value = style[key]
      return typeof value === 'string' ? value : fallback
    }
    const number = (key: string, fallback: number): number => {
      const value = style[key]
      return typeof value === 'number' ? value : fallback
    }

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
      lock: drawing?.locked ?? false,
      visible: !(drawing?.hidden ?? false),
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: type !== 'horizontalLine',
      needDefaultYAxisFigure: type !== 'verticalLine',
      ...(drawing ? { points: drawingPoints(drawing) } : {}),
      styles: {
        line: { color, size: lineWidth, style: lineStyle, dashedValue: [6, 4] },
        rect: {
          style: 'stroke_fill',
          color: colorWithOpacity(text('fillColor', '#3aa9ff'), fillOpacity),
          borderColor: color,
          borderSize: lineWidth,
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
        // Position labels show while placing (no stored drawing yet) or while selected.
        showValues: !drawing || id === this.#selectedDrawingId ? 1 : 0,
        point: {
          color,
          borderColor: '#131722',
          borderSize: 2,
          radius: 4,
          activeColor: '#ffffff',
          activeBorderColor: color,
          activeBorderSize: 2,
          activeRadius: 5,
        },
      },
      onPressedMoveStart: (event) => this.#beginOverlayMove(event),
      onPressedMoving: (event) => this.#continueOverlayMove(event),
      onPressedMoveEnd: (event) => {
        this.#overlayMove = undefined
        this.#commitOverlay(event, type)
      },
      // The library deletes an overlay on right-click unless this is prevented.
      onRightClick: (event) => {
        event.preventDefault?.()
        this.#selectOverlay(event.overlay.id)
      },
      onRemoved: (event) => this.#removeOverlayFromStore(event),
      onSelected: (event) => this.#selectOverlay(event.overlay.id),
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
  }

  #continueOverlayMove(event: OverlayEvent<unknown>): void {
    const move = this.#overlayMove
    if (!move || move.id !== event.overlay.id || event.x === undefined || event.y === undefined) return

    const [current] = this.#chart.convertFromPixel(
      [{ x: event.x, y: event.y }],
      { paneId: 'candle_pane' },
    ) as Array<Partial<Point>>
    if (current?.dataIndex === undefined || current.value === undefined) return

    const deltaBars = Math.round(current.dataIndex - move.startIndex)
    const overlay = event.overlay as { points: Array<Partial<Point>> }
    overlay.points = translatePoints(move.points, deltaBars * this.#intervalMs(), current.value - move.startValue)
  }

  #commitOverlay(event: OverlayEvent<unknown>, type: DrawingType): void {
    if (this.#suppressDrawingEvents || this.#disposed) return
    if (event.overlay.id === this.#activeDrawingId) return

    const existing = this.#drawingStore
      .getSnapshot()
      .drawings.find((drawing) => drawing.id === event.overlay.id)
    if (!existing) return
    const drawing = drawingFromOverlay(event.overlay, this.#market.marketId, existing, type)
    // A click without movement must not create an undo step.
    if (!drawing || anchorsEqual(existing.anchors, drawing.anchors)) return

    this.#drawingStore.execute(updateDrawing(existing.id, { anchors: drawing.anchors }))
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
