import type { Chart, OverlayCreate, OverlayEvent, Point } from 'klinecharts'
import {
  batchDrawings,
  createDrawing,
  deleteDrawing,
  updateDrawing,
  type Drawing,
  type DrawingStore,
  type DrawingStyle,
  type DrawingType,
} from '../../drawings'
import type { MarketInterval } from '../../market'
import { fibSettings, visibleOnInterval } from '../drawingVisibility'
import { stackLevels, translatePoints, type ChartPoint } from '../geometry'
import type { CryptoMarket } from '../markets'
import { DRAWING_GROUP_ID, decimalString, drawingFromOverlay, drawingPoints } from '../model'
import { DRAWING_TOOLS } from '../tools'
import { MAGNET_TOLERANCE_PX, anchorsEqual, colorWithOpacity, createId, intervalDurationMs } from './helpers'
import { drawingUnderPointer, hoveredOverlayId, resetClickedOverlay, showHandles } from './libraryInternals'
import { paneRect, positionDefaults } from './paneGeometry'
import type { DrawingEvent, DrawingModes, KLineChartControllerCallbacks } from './types'

const POINT_HANDLE_KEY_PREFIX = 'overlay_figure_point_'
/**
 * Stacking (klinecharts zLevel): drawings get theirs from stackLevels() and keep it while hovered, because the
 * library's hover-raise would leave a big box on top of a small box inside it, so the small one could not be clicked.
 * A drawing being placed sits above all of them, alert lines above everything.
 */
const DRAFT_Z_LEVEL = 1_000_000

interface OverlayMove {
  id: string
  startIndex: number
  startValue: number
  points: ChartPoint[]
}

/** What the drawings on the chart need from the controller. */
export interface DrawingLayerDeps {
  readonly chart: Chart
  readonly store: DrawingStore
  readonly market: CryptoMarket
  readonly callbacks: Pick<KLineChartControllerCallbacks, 'onSelectionChange'>
  /** The chart's current timeframe. */
  readonly interval: () => MarketInterval
  readonly isDisposed: () => boolean
  /** True while a drawing tool or the replay picker owns presses on the chart. */
  readonly isBusy: () => boolean
}

/**
 * The stored drawings shown as klinecharts overlays: keeping them in sync with the drawing store, selection and
 * multi-selection, moving them (alone or as a group) and committing the moves as undo steps.
 */
export class DrawingLayer {
  readonly #deps: DrawingLayerDeps
  readonly #toolStyles = new Map<DrawingType, DrawingStyle>()
  #activeDrawingId?: string
  #selectedDrawingId?: string
  #suppressDrawingEvents = false
  #overlayMove?: OverlayMove
  #magnet = false
  #shiftHeld = false
  #drawingModes: DrawingModes = { stayInDrawingMode: false, lockAll: false, hideAll: false }
  /** Drawings selected together (Ctrl/Shift+click); the library itself only knows one selected overlay. */
  readonly #multiSelection = new Set<string>()
  #modifierPress = false
  #groupSeed?: string
  readonly #drawingListeners = new Set<(event: DrawingEvent) => void>()
  /** Start points of the other drawings while a multi-selection is dragged. */
  #groupMove?: Map<string, ChartPoint[]>
  #lastOverlayMoveEvent?: OverlayEvent<unknown>
  #stackLevels = new Map<string, number>()

  /** Shows the drawings of `deps.market` on `deps.chart` (the controller calls `sync`). */
  public constructor(deps: DrawingLayerDeps) {
    this.#deps = deps
  }

  /** True while Shift is held (moves keep their price, lines lock to an axis). */
  public get shiftHeld(): boolean {
    return this.#shiftHeld
  }

  /** True when new points snap to the candles' prices. */
  public get magnet(): boolean {
    return this.#magnet
  }

  /** The tool-rail toggles in effect. */
  public get drawingModes(): DrawingModes {
    return this.#drawingModes
  }

  /** The user's starting style for new drawings of a type, if set. */
  public toolStyle(type: DrawingType): DrawingStyle | undefined {
    return this.#toolStyles.get(type)
  }

  /** Style that new drawings of a type start with, e.g. the user's default rectangle template. */
  public setToolDefaultStyle(type: DrawingType, style: DrawingStyle | undefined): void {
    if (style) this.#toolStyles.set(type, style)
    else this.#toolStyles.delete(type)
  }

  /** The drawing being placed (its overlay is not in the store yet), or undefined. */
  public setActiveDrawing(id: string | undefined): void {
    this.#activeDrawingId = id
  }

  /** Removes an overlay without treating it as the user deleting a drawing. */
  public removeOverlaySilently(id: string): void {
    this.#suppressDrawingEvents = true
    this.#deps.chart.removeOverlay({ id })
    this.#suppressDrawingEvents = false
  }

  /** Records whether a press on the chart is a Ctrl/Shift press, and ends a multi-selection on a plain press on empty chart. */
  public readonly trackSelectionPress = (event: PointerEvent): void => {
    this.#modifierPress = event.ctrlKey || event.metaKey || event.shiftKey
    // A plain press on empty chart ends a multi-selection (a press on a member keeps it, to drag the group).
    if (!this.#modifierPress && event.button === 0 && !this.drawingUnderPointer() && this.#multiSelection.size > 0) {
      this.#setMultiSelection([])
    }
  }

  #emitDrawing(event: DrawingEvent): void {
    for (const listener of this.#drawingListeners) listener(event)
  }

  /** Calls `listener` for double-clicks, context menus and selection changes on drawings; returns the unsubscribe. */
  public subscribeDrawingEvents(listener: (event: DrawingEvent) => void): () => void {
    this.#drawingListeners.add(listener)
    return () => {
      this.#drawingListeners.delete(listener)
    }
  }

  /** Every selected drawing: the multi-selection, or the single selected one. */
  public getSelection(): string[] {
    if (this.#multiSelection.size > 0) return [...this.#multiSelection]
    return this.#selectedDrawingId ? [this.#selectedDrawingId] : []
  }

  /** Ends a multi-selection. */
  public clearSelection(): void {
    this.#setMultiSelection([])
  }

  #setMultiSelection(ids: readonly string[]): void {
    const before = [...this.#multiSelection].join(',')
    this.#multiSelection.clear()
    if (ids.length > 1) for (const id of ids) this.#multiSelection.add(id)
    if ([...this.#multiSelection].join(',') === before) return
    this.sync()
    this.#emitDrawing({ kind: 'selection', ids: [...this.#multiSelection] })
  }

  /** Applies the tool-rail toggles (lock all, hide all, stay in drawing mode). */
  public setDrawingModes(modes: DrawingModes): void {
    const changed = modes.lockAll !== this.#drawingModes.lockAll || modes.hideAll !== this.#drawingModes.hideAll
    this.#drawingModes = modes
    if (changed) this.sync()
  }

  /** Turns the magnet (snap to candle prices) on or off. */
  public setMagnet(enabled: boolean): void {
    if (this.#deps.isDisposed() || this.#magnet === enabled) return
    this.#magnet = enabled
    this.sync()
  }

  /** Shift pressed: a drawing being moved keeps its price from now on. */
  public readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') {
      this.#shiftHeld = true
      if (this.#overlayMove && this.#lastOverlayMoveEvent) {
        this.#continueOverlayMove(this.#lastOverlayMoveEvent)
        this.#deps.chart.overrideOverlay({
          id: this.#overlayMove.id,
          points: (this.#lastOverlayMoveEvent.overlay as { points: Array<Partial<Point>> }).points,
        })
      }
    }
  }

  /** Shift released: a drawing being moved follows the pointer's price again. */
  public readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Shift') {
      this.#shiftHeld = false
      if (this.#overlayMove && this.#lastOverlayMoveEvent) {
        this.#continueOverlayMove(this.#lastOverlayMoveEvent)
        this.#deps.chart.overrideOverlay({
          id: this.#overlayMove.id,
          points: (this.#lastOverlayMoveEvent.overlay as { points: Array<Partial<Point>> }).points,
        })
      }
    }
  }

  /** Reads Shift from pointer events too (key events miss it when the window was not focused). */
  public readonly handlePointerModifier = (event: PointerEvent): void => {
    this.#shiftHeld = event.shiftKey
  }

  /** The window lost focus: Shift can no longer be known to be held. */
  public readonly handleWindowBlur = (): void => {
    this.#shiftHeld = false
  }

  /** klinecharts never deselects on empty space, so a press that is not on the selected drawing clears the selection. */
  public readonly handleDeselectPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#deps.isBusy() || !this.#selectedDrawingId) return
    const hovered = hoveredOverlayId(this.#deps.chart)
    if (hovered === this.#selectedDrawingId) return
    // Pressing another member of a multi-selection keeps the group (to drag it); Ctrl/Shift+press adds to it.
    if (hovered && this.#multiSelection.has(hovered)) return
    if (hovered && (event.ctrlKey || event.metaKey || event.shiftKey)) this.#groupSeed = this.#selectedDrawingId
    this.clearDrawingSelection()
  }

  /** Places a copy of a drawing a little to the right and below it, and selects the copy. */
  public cloneDrawing(id: string): void {
    const source = this.#deps.store.getSnapshot().drawings.find((item) => item.id === id)
    if (!source || this.#deps.isDisposed()) return

    const intervalMs = intervalDurationMs(this.#deps.interval())
    const offset = positionDefaults(this.#deps.chart, intervalMs)
    const points = translatePoints(drawingPoints(source), 3 * intervalMs, -offset.priceSpan / 4)
    const { locked: _locked, ...rest } = source
    const copy: Drawing = {
      ...rest,
      id: createId(),
      revision: 0,
      anchors: points.map((point) => ({ timeMs: point.timestamp, price: decimalString(Math.max(0, point.value)) })),
    }
    this.#deps.store.execute(createDrawing(copy))
    this.selectOverlay(copy.id)
    showHandles(this.#deps.chart, copy.id)
  }

  /** True while the pointer is over a drawing (a right-click there selects the drawing instead of opening the chart menu). */
  public drawingUnderPointer(): boolean {
    return drawingUnderPointer(this.#deps.chart)
  }

  /** Deletes the selected drawing (or the whole multi-selection, as one undo step). */
  public deleteSelected(): void {
    if (this.#multiSelection.size > 1) {
      const ids = [...this.#multiSelection]
      this.#multiSelection.clear()
      this.#selectedDrawingId = undefined
      this.#deps.store.execute(batchDrawings(ids.map((id) => deleteDrawing(id))))
      this.#deps.callbacks.onSelectionChange(undefined)
      this.#emitDrawing({ kind: 'selection', ids: [] })
      return
    }
    if (!this.#selectedDrawingId) return
    const id = this.#selectedDrawingId
    this.#selectedDrawingId = undefined
    this.#deps.store.execute(deleteDrawing(id))
    this.#deps.callbacks.onSelectionChange(undefined)
  }

  /** Deselects every drawing, including the library's own click state. */
  public clearDrawingSelection(): void {
    this.selectOverlay(undefined)
    // klinecharts has no public API to deselect, so it keeps drawing handles on the last
    // clicked overlay. Reset its click state (pinned version 10.0.3) so Esc leaves clean shapes.
    resetClickedOverlay(this.#deps.chart)
  }

  /** The klinecharts overlay for a stored drawing, or for a draft of `type` when `drawing` is undefined. */
  public overlayConfiguration(id: string, drawing: Drawing | undefined, type: DrawingType): OverlayCreate {
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
      visible: !(drawing?.hidden ?? false) && !this.#drawingModes.hideAll && visibleOnInterval(drawing?.style, this.#deps.interval()),
      zLevel: drawing ? (this.#stackLevels.get(id) ?? DRAFT_Z_LEVEL) : DRAFT_Z_LEVEL,
      fixedZLevel: true,
      needDefaultPointFigure: type !== 'brush',
      needDefaultXAxisFigure: type !== 'horizontalLine' && type !== 'horizontalRay' && type !== 'brush',
      needDefaultYAxisFigure: type !== 'verticalLine' && type !== 'dateRange' && type !== 'brush',
      ...(drawing ? { points: drawingPoints(drawing) } : {}),
      styles: {
        // A drawing in a multi-selection is drawn a little thicker, so the group can be seen.
        line: { color, size: lineWidth + (this.#multiSelection.has(id) ? 1.5 : 0), style: lineStyle, dashedValue: [6, 4] },
        fibConfig: type === 'fibRetracement' ? JSON.stringify(fibSettings(style)) : '',
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
        this.selectOverlay(event.overlay.id)
        const rect = paneRect(this.#deps.chart)
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
        this.selectOverlay(id)
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

    const [start] = this.#deps.chart.convertFromPixel([{ x: event.x, y: event.y }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
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
        const other = this.#deps.chart.getOverlays({ id })[0]
        const drawing = this.#deps.store.getSnapshot().drawings.find((item) => item.id === id)
        if (!other || !drawing || drawing.locked || this.#drawingModes.lockAll) continue
        const start = other.points
          .filter((point) => point.timestamp !== undefined && point.value !== undefined)
          .map((point) => ({ timestamp: point.timestamp!, value: point.value! }))
        if (start.length === other.points.length) group.set(id, start)
      }
      if (group.size > 0) this.#groupMove = group
    }
  }

  #continueOverlayMove(event: OverlayEvent<unknown>): void {
    const move = this.#overlayMove
    if (!move || move.id !== event.overlay.id || event.x === undefined || event.y === undefined) return
    this.#lastOverlayMoveEvent = event

    const [current] = this.#deps.chart.convertFromPixel([{ x: event.x, y: event.y }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
    if (current?.dataIndex === undefined || current.value === undefined) return

    const intervalMs = intervalDurationMs(this.#deps.interval())
    const deltaBars = Math.round(current.dataIndex - move.startIndex)
    const overlay = event.overlay as { points: Array<Partial<Point>> }
    const deltaValue = this.#shiftHeld ? 0 : current.value - move.startValue
    overlay.points = translatePoints(move.points, deltaBars * intervalMs, deltaValue)
    if (this.#groupMove) {
      for (const [id, start] of this.#groupMove) {
        this.#deps.chart.overrideOverlay({ id, points: translatePoints(start, deltaBars * intervalMs, deltaValue) })
      }
    }
  }

  #commitOverlay(event: OverlayEvent<unknown>, type: DrawingType): void {
    if (this.#suppressDrawingEvents || this.#deps.isDisposed()) return
    if (event.overlay.id === this.#activeDrawingId) return

    const store = this.#deps.store
    const existing = store.getSnapshot().drawings.find((drawing) => drawing.id === event.overlay.id)
    if (!existing) return
    const drawing = drawingFromOverlay(event.overlay, this.#deps.market.marketId, existing, type)
    const group = this.#groupMove
    this.#groupMove = undefined
    // A click without movement must not create an undo step.
    if (!drawing || anchorsEqual(existing.anchors, drawing.anchors)) return

    const commands = [updateDrawing(existing.id, { anchors: drawing.anchors })]
    if (group) {
      // The whole multi-selection moved: one undo step for all of it.
      for (const id of group.keys()) {
        const other = this.#deps.chart.getOverlays({ id })[0]
        const stored = store.getSnapshot().drawings.find((item) => item.id === id)
        const moved = other && stored ? drawingFromOverlay(other, this.#deps.market.marketId, stored, stored.type) : null
        if (moved && stored && !anchorsEqual(stored.anchors, moved.anchors)) commands.push(updateDrawing(id, { anchors: moved.anchors }))
      }
    }
    store.execute(batchDrawings(commands))
  }

  #removeOverlayFromStore(event: OverlayEvent<unknown>): void {
    if (this.#suppressDrawingEvents || this.#deps.isDisposed()) return

    if (this.#selectedDrawingId === event.overlay.id) this.selectOverlay(undefined)
    this.#deps.store.execute(deleteDrawing(event.overlay.id))
  }

  /** Makes `id` the selected drawing (its position values show) and tells the app. */
  public selectOverlay(id: string | undefined): void {
    const previous = this.#selectedDrawingId
    this.#selectedDrawingId = id
    if (previous !== id) {
      for (const [overlayId, showValues] of [
        [previous, 0],
        [id, 1],
      ] as const) {
        if (overlayId) this.#deps.chart.overrideOverlay({ id: overlayId, styles: { showValues } })
      }
    }
    this.#deps.callbacks.onSelectionChange(id)
  }

  #deselectOverlay(id: string): void {
    // The library deselects the old drawing before selecting the Ctrl/Shift-clicked one; keep it for the group.
    if (this.#modifierPress && this.#selectedDrawingId === id) this.#groupSeed = id
    if (this.#selectedDrawingId === id) this.selectOverlay(undefined)
  }

  /** Brings the overlays in line with the drawing store (this market's drawings, the current modes and selection). */
  public sync(): void {
    if (this.#deps.isDisposed()) return

    const chart = this.#deps.chart
    const desired = this.#deps.store.getSnapshot().drawings.filter((drawing) => drawing.marketId === this.#deps.market.marketId)
    const desiredById = new Map(desired.map((drawing) => [drawing.id, drawing]))
    const existing = chart.getOverlays({ groupId: DRAWING_GROUP_ID })
    const existingIds = new Set(existing.map((overlay) => overlay.id))
    this.#stackLevels = stackLevels(desired)

    this.#suppressDrawingEvents = true
    try {
      for (const overlay of existing) {
        if (!desiredById.has(overlay.id) && overlay.id !== this.#activeDrawingId) {
          chart.removeOverlay({ id: overlay.id })
        }
      }

      for (const drawing of desired) {
        if (existingIds.has(drawing.id)) {
          chart.overrideOverlay(this.overlayConfiguration(drawing.id, drawing, drawing.type))
        } else {
          chart.createOverlay(this.overlayConfiguration(drawing.id, drawing, drawing.type))
        }
      }
    } finally {
      this.#suppressDrawingEvents = false
    }

    if (this.#selectedDrawingId && !desiredById.has(this.#selectedDrawingId)) {
      this.selectOverlay(undefined)
    }
  }
}
