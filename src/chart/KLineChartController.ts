import {
  dispose,
  init,
  type Chart,
  type DataLoader,
  type KLineData,
  type Overlay,
  type OverlayCreate,
  type OverlayEvent,
} from 'klinecharts'
import {
  createDrawing,
  deleteDrawing,
  updateDrawing,
  type Drawing,
  type DrawingType,
  type DrawingStore,
} from '../drawings'
import {
  BinanceKlineSubscription,
  LatestBinanceKlinesLoader,
  StaleMarketDataRequestError,
  fetchBinanceKlines,
  type Candle,
  type KlineStreamStatus,
  type MarketInterval,
} from '../market'
import { intervalToPeriod, periodToInterval } from './intervals'
import {
  DRAWING_GROUP_ID,
  candleToKLineData,
  drawingFromOverlay,
  drawingPoints,
} from './model'
import type { CryptoMarket } from './markets'
import {
  HORIZONTAL_LINE_OVERLAY_NAME,
  LONG_POSITION_OVERLAY_NAME,
  PRICE_RANGE_OVERLAY_NAME,
  RECTANGLE_OVERLAY_NAME,
  registerTradeHorizonOverlays,
} from './overlays'
import { candleToQuote, type ChartRuntimeState } from './types'

const HISTORY_PAGE_SIZE = 1000

registerTradeHorizonOverlays()

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
  readonly #drawingStore: DrawingStore
  readonly #callbacks: KLineChartControllerCallbacks
  readonly #market: CryptoMarket
  readonly #historyLoader = new LatestBinanceKlinesLoader()

  #interval: MarketInterval
  #runtimeState: ChartRuntimeState
  #stream?: BinanceKlineSubscription
  #drawingStoreUnsubscribe: () => void
  #dataEpoch = 0
  #disposed = false
  #activeDrawingId?: string
  #selectedDrawingId?: string
  #suppressDrawingEvents = false
  #pendingViewport?: PendingViewport
  #ignoreNavigationEvents = false
  #navigationTimer?: ReturnType<typeof globalThis.setTimeout>

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

        const bars = result.candles.map(candleToKLineData)
        const hasPage = bars.length === HISTORY_PAGE_SIZE
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

      this.#stream?.stop()
      const epoch = this.#dataEpoch
      let hasOpened = false

      this.#stream = new BinanceKlineSubscription({
        symbol: this.#market.symbol,
        interval,
        onCandle: (candle) => {
          if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
          callback(candleToKLineData(candle))
          this.#patchRuntime({ quote: candleToQuote(candle), error: null })
        },
        onStatus: (status) => {
          if (this.#disposed || epoch !== this.#dataEpoch || interval !== this.#interval) return
          this.#handleStreamStatus(status)
          if (status.state === 'open') {
            if (hasOpened) void this.#backfillAfterReconnect(interval, epoch, callback)
            hasOpened = true
          }
        },
        onError: (error) => {
          if (this.#disposed || epoch !== this.#dataEpoch) return
          this.#patchRuntime({ error: error.message })
        },
      })
    },

    unsubscribeBar: () => {
      this.#stream?.stop()
      this.#stream = undefined
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
        barSpaceLimit: { min: 2, max: 42 },
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
          horizontal: { color: '#1a222e', style: 'dashed', dashedValue: [3, 3] },
          vertical: { color: '#1a222e', style: 'dashed', dashedValue: [3, 3] },
        },
        candle: {
          bar: {
            upColor: '#25c78b',
            downColor: '#f05b78',
            noChangeColor: '#8492a6',
            upBorderColor: '#25c78b',
            downBorderColor: '#f05b78',
            noChangeBorderColor: '#8492a6',
            upWickColor: '#25c78b',
            downWickColor: '#f05b78',
            noChangeWickColor: '#8492a6',
          },
          tooltip: { showRule: 'none' },
          priceMark: {
            last: {
              line: { show: true, style: 'dashed', size: 1, dashedValue: [4, 4] },
            },
          },
        },
        xAxis: {
          axisLine: { color: '#263140' },
          tickLine: { color: '#263140' },
          tickText: { color: '#7f8da3', size: 12, family: 'Inter, system-ui, sans-serif' },
        },
        yAxis: {
          axisLine: { color: '#263140' },
          tickLine: { color: '#263140' },
          tickText: { color: '#9aa7ba', size: 12, family: 'IBM Plex Mono, ui-monospace, monospace' },
        },
        crosshair: {
          horizontal: {
            line: { color: '#7f8da3', style: 'dashed', size: 1, dashedValue: [4, 4] },
          },
          vertical: {
            line: { color: '#7f8da3', style: 'dashed', size: 1, dashedValue: [4, 4] },
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
    this.#pendingViewport = this.#captureViewport()
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.#dataEpoch += 1
    this.#interval = interval
    this.#patchRuntime({ interval, connection: 'loading', error: null })
    this.#chart.setPeriod(intervalToPeriod(interval))
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

  public startTrendLine(): boolean {
    return this.#startDrawing('trendLine')
  }

  public startHorizontalLine(): boolean {
    return this.#startDrawing('horizontalLine')
  }

  public startRectangle(): boolean {
    return this.#startDrawing('rectangle')
  }

  public startLongPosition(): boolean {
    return this.#startDrawing('longPosition')
  }

  public startPriceRange(): boolean {
    return this.#startDrawing('priceRange')
  }

  #startDrawing(
    type: 'trendLine' | 'horizontalLine' | 'rectangle' | 'longPosition' | 'priceRange',
  ): boolean {
    if (this.#disposed) return false
    this.cancelActiveTool()

    const id = createId()
    this.#activeDrawingId = id
    const result = this.#chart.createOverlay(this.#drawingOverlayConfiguration(id, undefined, type))
    if (typeof result !== 'string') {
      this.#activeDrawingId = undefined
      return false
    }

    return true
  }

  public cancelActiveTool(): void {
    if (!this.#activeDrawingId) return
    const id = this.#activeDrawingId
    this.#activeDrawingId = undefined
    this.#suppressDrawingEvents = true
    this.#chart.removeOverlay({ id })
    this.#suppressDrawingEvents = false
    this.#callbacks.onToolSettled()
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

  public clearDrawingSelection(): void {
    this.#selectOverlay(undefined)
  }

  public dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#drawingStoreUnsubscribe()
    this.#chart.unsubscribeAction('onScroll', this.#handleManualNavigation)
    this.#chart.unsubscribeAction('onPaneDrag', this.#handleManualNavigation)
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

  async #backfillAfterReconnect(
    interval: MarketInterval,
    epoch: number,
    callback: (data: KLineData) => void,
  ): Promise<void> {
    try {
      const candles = await fetchBinanceKlines({
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

  #overlayConfiguration(id: string, drawing?: Drawing): OverlayCreate {
    return this.#drawingOverlayConfiguration(
      id,
      drawing,
      drawing?.type === 'rectangle'
        ? 'rectangle'
        : drawing?.type === 'horizontalLine'
          ? 'horizontalLine'
          : drawing?.type === 'priceRange'
            ? 'priceRange'
            : drawing?.type === 'longPosition'
              ? 'longPosition'
              : 'trendLine',
    )
  }

  #drawingOverlayConfiguration(
    id: string,
    drawing: Drawing | undefined,
    type: 'trendLine' | 'horizontalLine' | 'rectangle' | 'longPosition' | 'priceRange',
  ): OverlayCreate {
    const defaultColor = type === 'rectangle' || type === 'priceRange' ? '#3aa9ff' : '#f4b860'
    const color = typeof drawing?.style.color === 'string' ? drawing.style.color : defaultColor
    const lineWidth = typeof drawing?.style.lineWidth === 'number' ? drawing.style.lineWidth : 2
    const rawFillColor = typeof drawing?.style.fillColor === 'string'
      ? drawing.style.fillColor
      : '#3aa9ff'
    const fillOpacity = typeof drawing?.style.fillOpacity === 'number'
      ? drawing.style.fillOpacity
      : 14
    const fillColor = colorWithOpacity(rawFillColor, fillOpacity)
    const lineStyle = drawing?.style.lineStyle === 'dashed' ? 'dashed' : 'solid'
    const positionLineColor = typeof drawing?.style.lineColor === 'string'
      ? drawing.style.lineColor
      : '#c7d0db'
    const positionLineWidth = typeof drawing?.style.lineWidth === 'number'
      ? drawing.style.lineWidth
      : 1
    const targetColor = typeof drawing?.style.targetColor === 'string'
      ? drawing.style.targetColor
      : '#16a085'
    const stopColor = typeof drawing?.style.stopColor === 'string'
      ? drawing.style.stopColor
      : '#f0445e'
    const upColor = typeof drawing?.style.upColor === 'string'
      ? drawing.style.upColor
      : '#10b981'
    const downColor = typeof drawing?.style.downColor === 'string'
      ? drawing.style.downColor
      : '#ef4444'
    const textColor = typeof drawing?.style.textColor === 'string'
      ? drawing.style.textColor
      : '#ffffff'
    const positionFillOpacity = typeof drawing?.style.fillOpacity === 'number'
      ? drawing.style.fillOpacity
      : 22
    const accountSize = typeof drawing?.style.accountSize === 'number'
      ? drawing.style.accountSize
      : 10_000
    const riskPercent = typeof drawing?.style.riskPercent === 'number'
      ? drawing.style.riskPercent
      : 1

    return {
      name: type === 'rectangle'
        ? RECTANGLE_OVERLAY_NAME
        : type === 'horizontalLine'
          ? HORIZONTAL_LINE_OVERLAY_NAME
          : type === 'priceRange'
            ? PRICE_RANGE_OVERLAY_NAME
            : type === 'longPosition'
              ? LONG_POSITION_OVERLAY_NAME
              : 'segment',
      id,
      groupId: DRAWING_GROUP_ID,
      paneId: 'candle_pane',
      mode: 'weak_magnet',
      modeSensitivity: 8,
      lock: drawing?.locked ?? false,
      visible: !(drawing?.hidden ?? false),
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: type !== 'horizontalLine',
      needDefaultYAxisFigure: true,
      ...(drawing ? { points: drawingPoints(drawing) } : {}),
      styles: {
        line: { color, size: lineWidth, style: lineStyle },
        rect: {
          style: 'stroke_fill',
          color: fillColor,
          borderColor: color,
          borderSize: lineWidth,
          borderStyle: lineStyle,
          borderDashedValue: [4, 4],
          borderRadius: 0,
        },
        targetColor,
        stopColor,
        upColor,
        downColor,
        textColor,
        positionLineColor,
        positionLineWidth,
        positionFillOpacity,
        accountSize,
        riskPercent,
        point: {
          color,
          borderColor: '#080b10',
          borderSize: 2,
          radius: 4,
          activeColor: '#fff4d8',
          activeBorderColor: color,
          activeBorderSize: 2,
          activeRadius: 5,
        },
      },
      onDrawEnd: (event) => this.#commitOverlay(event, type),
      onPressedMoveEnd: (event) => this.#commitOverlay(event, type),
      onRemoved: (event) => this.#removeOverlayFromStore(event),
      onSelected: (event) => this.#selectOverlay(event.overlay.id),
      onDeselected: (event) => this.#deselectOverlay(event.overlay.id),
    }
  }

  #commitOverlay(event: OverlayEvent<unknown>, type: DrawingType): void {
    if (this.#suppressDrawingEvents || this.#disposed) return

    const existing = this.#drawingStore
      .getSnapshot()
      .drawings.find((drawing) => drawing.id === event.overlay.id)
    const drawing = drawingFromOverlay(event.overlay, this.#market.marketId, existing, type)
    if (!drawing) return

    if (this.#activeDrawingId === event.overlay.id) {
      this.#activeDrawingId = undefined
      this.#callbacks.onToolSettled()
    }

    if (existing) {
      this.#drawingStore.execute(updateDrawing(existing.id, { anchors: drawing.anchors }))
    } else {
      this.#drawingStore.execute(createDrawing(drawing))
    }
  }

  #removeOverlayFromStore(event: OverlayEvent<unknown>): void {
    if (this.#suppressDrawingEvents || this.#disposed) return

    if (this.#activeDrawingId === event.overlay.id) {
      this.#activeDrawingId = undefined
      this.#callbacks.onToolSettled()
    }
    if (this.#selectedDrawingId === event.overlay.id) this.#selectOverlay(undefined)
    this.#drawingStore.execute(deleteDrawing(event.overlay.id))
  }

  #selectOverlay(id: string | undefined): void {
    this.#selectedDrawingId = id
    this.#callbacks.onSelectionChange(id)
  }

  #deselectOverlay(id: string): void {
    if (this.#selectedDrawingId === id) this.#selectOverlay(undefined)
  }

  #syncDrawings(): void {
    if (this.#disposed) return

    const desired = this.#drawingStore
      .getSnapshot()
      .drawings.filter(
        (drawing) => drawing.marketId === this.#market.marketId &&
          (drawing.type === 'trendLine' ||
            drawing.type === 'horizontalLine' ||
            drawing.type === 'rectangle' ||
            drawing.type === 'longPosition' ||
            drawing.type === 'priceRange'),
      )
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
          this.#chart.overrideOverlay(this.#overlayConfiguration(drawing.id, drawing))
        } else {
          this.#chart.createOverlay(this.#overlayConfiguration(drawing.id, drawing))
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
