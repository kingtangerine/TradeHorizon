import type { AxisCreateRangeCallback, Chart } from 'klinecharts'
import { drawingIsPressed } from './libraryInternals'
import { insidePane, onPriceAxis, paneRect } from './paneGeometry'
import { priceViewRange, type PriceAxisRange } from './priceRange'
import type { ScaleMode } from './types'

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

/** What the price axis needs from the controller. */
export interface PriceAxisDeps {
  readonly chart: Chart
  /** The automatic range widened to fit what else is drawn on the candles (compare lines). */
  readonly widenRange: <T extends PriceAxisRange>(range: T) => T
  /** Something on screen moved. */
  readonly emitView: () => void
  /** The price view went from automatic to manual or back. */
  readonly onPriceViewChange: (manual: boolean) => void
  /** True while a drawing tool or the replay picker owns presses on the chart. */
  readonly panBlocked: () => boolean
}

/**
 * Price-axis zoom, vertical pan and scale mode of the candle pane.
 *
 * klinecharts scales the price axis by (current page Y / page Y where the press started). That ratio depends
 * on where on the screen you press, so the same drag zooms wildly near the top and barely near the bottom,
 * and a drag toward the top of the page collapses the range. We take over presses on the price axis and scale
 * by the drag distance instead, feeding the result through the library's own createRange hook.
 *
 * Free vertical pan: with the price axis on automatic fit the chart only scrolls sideways, so after switching to a lower
 * timeframe and going live you could never drag down to the area below the candles. Dragging on the chart now
 * also moves the price view (the library keeps handling the sideways scroll). The move is stored as a fraction of
 * the automatic range so it follows new candles; the Auto button or a double-click on the axis puts it back.
 */
export class PriceAxis {
  readonly #deps: PriceAxisDeps
  /** Price-axis zoom: 1 is the automatic fit, above 1 zooms out, below 1 zooms in. Reset by double-click/tap on the axis. */
  #priceScale = 1
  /** Vertical pan of the price view, as a fraction of the automatic price range (positive shows higher prices). */
  #priceOffset = 0
  #pan?: { pointerId: number; startY: number; startOffset: number; active: boolean }
  readonly #pointersDown = new Set<number>()
  #axisGesture?: { pointerId: number; startY: number; startScale: number }
  #lastAxisPressMs = 0
  #scaleMode: ScaleMode = 'normal'

  /** Takes over the price axis of `deps.chart` (the controller registers the handlers). */
  public constructor(deps: PriceAxisDeps) {
    this.#deps = deps
  }

  /** The current price scale mode. */
  public get scaleMode(): ScaleMode {
    return this.#scaleMode
  }

  /** The library's createRange hook: the automatic range zoomed, panned and expressed for the scale mode. */
  public readonly createPriceRange: AxisCreateRangeCallback = ({ defaultRange: autoRange }) => {
    const chart = this.#deps.chart
    const defaultRange = this.#deps.widenRange(autoRange)
    return priceViewRange(defaultRange, this.#priceScale, this.#priceOffset, this.#scaleMode, () => {
      const data = chart.getDataList()
      return data[Math.max(0, Math.floor(chart.getVisibleRange().from))]?.close
    })
  }

  /** Switches between normal, logarithmic and percent price scale (the caller skips an unchanged mode). */
  public setScaleMode(mode: ScaleMode): void {
    this.#scaleMode = mode
    const name = mode === 'log' ? 'logarithm' : mode === 'percent' ? 'percentage' : 'normal'
    // A new axis name makes klinecharts rebuild the axis widget, so its touch setting is applied again.
    this.#deps.chart.overrideYAxis({ paneId: 'candle_pane', name, createRange: this.createPriceRange } as never)
    const axisElement = this.#deps.chart.getDom('candle_pane', 'yAxis')
    if (axisElement) axisElement.style.touchAction = 'none'
    this.#deps.emitView()
  }

  #applyPriceView(scale: number, offset: number): void {
    const nextScale = Math.min(PRICE_SCALE_MAX, Math.max(PRICE_SCALE_MIN, scale))
    if (nextScale === this.#priceScale && offset === this.#priceOffset) return
    const wasManual = this.#priceScale !== 1 || this.#priceOffset !== 0
    this.#priceScale = nextScale
    this.#priceOffset = offset
    this.#deps.chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.createPriceRange })
    this.#deps.emitView()
    const manual = this.#priceScale !== 1 || this.#priceOffset !== 0
    if (manual !== wasManual) this.#deps.onPriceViewChange(manual)
  }

  #setPriceScale(next: number): void {
    this.#applyPriceView(next, this.#priceOffset)
  }

  /** Back to the automatic price fit (no zoom, no vertical pan). */
  public resetPriceView(): void {
    this.#applyPriceView(1, 0)
  }

  /** Keeps the library's own (flawed) axis handling from seeing presses on the price axis. */
  public readonly blockLibraryAxisGesture = (event: Event): void => {
    const point = 'touches' in event ? (event as TouchEvent).touches[0] : (event as MouseEvent)
    if (point && onPriceAxis(this.#deps.chart, point.clientX, point.clientY)) event.stopPropagation()
  }

  /** A press on the price axis starts a zoom drag; a quick second press resets the price view. */
  public readonly handleAxisPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !onPriceAxis(this.#deps.chart, event.clientX, event.clientY)) return
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

  /** Zooms the price axis while it is dragged. */
  public readonly handleAxisPointerMove = (event: PointerEvent): void => {
    const gesture = this.#axisGesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    // Dragging down zooms out, up zooms in; the curve is exponential so equal drags always change the range by equal ratios.
    this.#setPriceScale(gesture.startScale * Math.exp((event.clientY - gesture.startY) / AXIS_DRAG_PIXELS_PER_E))
  }

  /** Ends a price-axis drag. */
  public readonly handleAxisPointerEnd = (event: PointerEvent): void => {
    if (this.#axisGesture?.pointerId === event.pointerId) this.#axisGesture = undefined
  }

  /** A press on the candle pane may become a vertical pan of the price view. */
  public readonly handlePanPointerDown = (event: PointerEvent): void => {
    this.#pointersDown.add(event.pointerId)
    // A second finger means pinch-zoom, not a pan.
    if (this.#pointersDown.size > 1) {
      this.#pan = undefined
      return
    }
    if (event.button !== 0 || this.#deps.panBlocked() || !insidePane(this.#deps.chart, event.clientX, event.clientY)) return
    this.#pan = { pointerId: event.pointerId, startY: event.clientY, startOffset: this.#priceOffset, active: false }
  }

  /** Moves the price view while the chart is dragged vertically. */
  public readonly handlePanPointerMove = (event: PointerEvent): void => {
    const pan = this.#pan
    if (!pan || event.pointerId !== pan.pointerId) return
    if (!pan.active) {
      if (Math.abs(event.clientY - pan.startY) < PAN_START_PX) return
      if (drawingIsPressed(this.#deps.chart)) {
        this.#pan = undefined
        return
      }
      pan.active = true
      pan.startY = event.clientY
    }
    const height = paneRect(this.#deps.chart)?.height
    if (!height) return
    this.#applyPriceView(this.#priceScale, pan.startOffset + ((event.clientY - pan.startY) / height) * this.#priceScale * PRICE_GAP_FACTOR)
  }

  /** Ends a vertical pan. */
  public readonly handlePanPointerEnd = (event: PointerEvent): void => {
    this.#pointersDown.delete(event.pointerId)
    if (this.#pan?.pointerId === event.pointerId) this.#pan = undefined
  }

  /** The wheel over the price axis zooms it. */
  public readonly handleAxisWheel = (event: WheelEvent): void => {
    if (!onPriceAxis(this.#deps.chart, event.clientX, event.clientY)) return
    event.preventDefault()
    event.stopPropagation()
    this.#setPriceScale(this.#priceScale * Math.exp(Math.max(-100, Math.min(100, event.deltaY)) / AXIS_WHEEL_PIXELS_PER_E))
  }
}
