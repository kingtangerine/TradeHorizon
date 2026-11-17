import type { Chart, Coordinate } from 'klinecharts'
import { createDrawing, type DrawingStore, type DrawingType } from '../../drawings'
import type { MarketInterval } from '../../market'
import { lockToAxis, positionPoints, rectanglePoints, type ChartPoint } from '../geometry'
import type { CryptoMarket } from '../markets'
import { drawingFromOverlay } from '../model'
import { DRAWING_TOOLS } from '../tools'
import type { DrawingLayer } from './drawingLayer'
import { createId, intervalDurationMs } from './helpers'
import { showHandles } from './libraryInternals'
import { insidePane, pointAt, positionDefaults } from './paneGeometry'
import type { ReplayController } from './replay'

const DRAG_THRESHOLD_PX = 4

interface ToolSession {
  type: DrawingType
  draftId?: string
  start?: ChartPoint
  current?: ChartPoint
  pressOrigin?: { x: number; y: number }
  pointerId?: number
  dragged: boolean
  createdThisPress: boolean
  /** Three-point tools: the points fixed so far. Freehand: the stroke so far. */
  fixed?: ChartPoint[]
  /** Freehand: the stroke in pixels, to keep only points a few pixels apart. */
  strokePx?: Array<{ x: number; y: number }>
}

/** What the drawing tools need from the controller. */
export interface DrawingToolDeps {
  readonly chart: Chart
  readonly host: HTMLElement
  readonly store: DrawingStore
  readonly market: CryptoMarket
  readonly drawings: DrawingLayer
  readonly replay: ReplayController
  /** The chart's current timeframe. */
  readonly interval: () => MarketInterval
  readonly isDisposed: () => boolean
  /** A tool was put away (drawing placed or cancelled). */
  readonly onToolSettled: () => void
}

/**
 * Placing a new drawing with the armed tool (click-click, drag, three points or freehand), and the bar-replay picker's
 * click, which shares the same pointer handling.
 */
export class DrawingTool {
  readonly #deps: DrawingToolDeps
  #tool?: ToolSession

  /** Starts with no tool armed. */
  public constructor(deps: DrawingToolDeps) {
    this.#deps = deps
  }

  /** True while a tool is armed. */
  public get active(): boolean {
    return !!this.#tool
  }

  /** Arms a drawing tool (cancelling any other tool and the replay picker). */
  public start(type: DrawingType): boolean {
    if (this.#deps.isDisposed()) return false
    this.cancel()
    this.#deps.replay.cancelSelection()
    this.#tool = { type, dragged: false, createdThisPress: false }
    this.#deps.host.classList.add('tool-active')
    return true
  }

  /** Puts the armed tool away and removes its unfinished drawing. */
  public cancel(): void {
    const tool = this.#tool
    if (!tool) return
    this.#endTool()
    if (tool.draftId) {
      this.#deps.drawings.removeOverlaySilently(tool.draftId)
    }
    this.#deps.onToolSettled()
  }

  #endTool(): void {
    this.#tool = undefined
    this.#deps.drawings.setActiveDrawing(undefined)
    this.#deps.host.classList.remove('tool-active')
  }

  #pointAt(clientX: number, clientY: number): ChartPoint | null {
    return pointAt(this.#deps.chart, clientX, clientY, this.#deps.drawings.magnet)
  }

  #draftPoints(tool: ToolSession, current: ChartPoint, shiftKey: boolean): ChartPoint[] {
    const start = tool.start ?? current
    const placement = DRAWING_TOOLS[tool.type].placement
    if (placement === 'onePoint') return [current]
    if (placement === 'threePoint') {
      const points = [...(tool.fixed ?? [start])]
      while (points.length < 3) points.push(current)
      return points
    }
    if (placement === 'freehand') return tool.fixed && tool.fixed.length > 1 ? tool.fixed : [start, current]
    if (placement === 'position') {
      return positionPoints(
        tool.type === 'shortPosition' ? 'short' : 'long',
        start,
        tool.dragged ? current : null,
        positionDefaults(this.#deps.chart, intervalDurationMs(this.#deps.interval())),
      )
    }

    let end = current
    if (shiftKey && (tool.type === 'trendLine' || tool.type === 'ray' || tool.type === 'extendedLine' || tool.type === 'arrow')) {
      const [from, to] = this.#deps.chart.convertToPixel([start, current], { paneId: 'candle_pane' }) as Array<Partial<Coordinate>>
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
      this.#deps.chart.overrideOverlay({ id: tool.draftId, points })
      return
    }

    const id = createId()
    const result = this.#deps.chart.createOverlay({
      ...this.#deps.drawings.overlayConfiguration(id, undefined, tool.type),
      points,
    })
    if (typeof result === 'string') {
      tool.draftId = id
      this.#deps.drawings.setActiveDrawing(id)
    }
  }

  #finishDraft(tool: ToolSession): void {
    const overlay = tool.draftId ? this.#deps.chart.getOverlays({ id: tool.draftId })[0] : undefined
    let drawing = overlay ? drawingFromOverlay(overlay, this.#deps.market.marketId, undefined, tool.type) : null
    if (!drawing) return
    const startStyle = this.#deps.drawings.toolStyle(tool.type)
    if (startStyle) drawing = { ...drawing, style: { ...drawing.style, ...startStyle } }

    if (DRAWING_TOOLS[tool.type].placement === 'twoPoint') {
      const first = drawing.anchors[0]
      const sameTime = drawing.anchors.every((anchor) => anchor.timeMs === first.timeMs)
      const samePrice = drawing.anchors.every((anchor) => anchor.price === first.price)
      const lineLike = tool.type === 'trendLine' || tool.type === 'ray' || tool.type === 'extendedLine' || tool.type === 'arrow'
      const needsHeight = !lineLike && tool.type !== 'dateRange'
      const needsWidth = tool.type === 'rectangle' || tool.type === 'ellipse' || tool.type === 'dateRange' || tool.type === 'datePriceRange'
      // Nothing to commit yet: keep the tool armed so the next click sets the second point.
      if ((sameTime && samePrice) || (needsHeight && samePrice) || (needsWidth && sameTime)) return
    }

    this.#endTool()
    this.#deps.store.execute(createDrawing(drawing))
    if (this.#deps.drawings.drawingModes.stayInDrawingMode) {
      // TradingView's "Stay in drawing mode": arm the same tool again for the next drawing.
      this.start(tool.type)
      return
    }
    this.#deps.onToolSettled()
    this.#deps.drawings.selectOverlay(drawing.id)
    showHandles(this.#deps.chart, drawing.id)
  }

  /** A press on the pane places a point of the armed tool, or picks the replay start bar. */
  public readonly handleToolPointerDown = (event: PointerEvent): void => {
    const chart = this.#deps.chart
    if (this.#deps.replay.picking) {
      if (event.button !== 0 || !insidePane(chart, event.clientX, event.clientY)) return
      const picked = this.#pointAt(event.clientX, event.clientY)
      if (!picked) return
      event.stopPropagation()
      this.#deps.replay.enter(picked.timestamp)
      return
    }

    const tool = this.#tool
    if (!tool || event.button !== 0 || !insidePane(chart, event.clientX, event.clientY)) return
    const point = this.#pointAt(event.clientX, event.clientY)
    if (!point) return

    event.stopPropagation()
    tool.pointerId = event.pointerId
    tool.pressOrigin = { x: event.clientX, y: event.clientY }
    tool.dragged = false
    tool.createdThisPress = !tool.draftId
    if (!tool.draftId) {
      tool.start = point
      const placement = DRAWING_TOOLS[tool.type].placement
      if (placement === 'threePoint') tool.fixed = [point]
      if (placement === 'freehand') {
        tool.fixed = [point]
        tool.strokePx = [{ x: event.clientX, y: event.clientY }]
      }
    }
    this.#updateDraft(tool, point, event.shiftKey)
  }

  /** The unfinished drawing follows the pointer. */
  public readonly handleToolPointerMove = (event: PointerEvent): void => {
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
    if (!point) return
    if (DRAWING_TOOLS[tool.type].placement === 'freehand') {
      if (!pressed) return
      // Keep a point only when the pointer moved a few pixels, so a stroke stays light.
      const last = tool.strokePx?.at(-1)
      if (last && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 4) return
      tool.strokePx?.push({ x: event.clientX, y: event.clientY })
      if ((tool.fixed?.length ?? 0) < 400) tool.fixed?.push(point)
    }
    this.#updateDraft(tool, point, event.shiftKey)
  }

  /** Releasing the pointer fixes a point, or finishes the drawing. */
  public readonly handleToolPointerUp = (event: PointerEvent): void => {
    const tool = this.#tool
    if (!tool || tool.pointerId !== event.pointerId) return
    tool.pointerId = undefined

    if (event.type === 'pointercancel') {
      this.cancel()
      return
    }
    const placement = DRAWING_TOOLS[tool.type].placement
    // First click of a click-click placement: the shape follows the pointer until the second click.
    if (placement === 'twoPoint' && tool.createdThisPress && !tool.dragged) return
    if (placement === 'threePoint') {
      // Click, click, click; or drag the first line and click the third point.
      const fixed = tool.fixed ?? []
      if (!(tool.createdThisPress && !tool.dragged) && tool.current) fixed.push(tool.current)
      tool.fixed = fixed
      if (fixed.length < 3) return
    }
    if (placement === 'freehand' && (tool.fixed?.length ?? 0) < 2) {
      this.cancel()
      return
    }
    this.#finishDraft(tool)
  }

  /** Keeps the chart from panning while a tool or the replay picker owns presses on the pane. */
  public readonly blockChartWhileDrawing = (event: MouseEvent | TouchEvent): void => {
    if (!this.#tool && !this.#deps.replay.picking) return
    const source = 'touches' in event ? event.touches[0] : event
    if (source && insidePane(this.#deps.chart, source.clientX, source.clientY)) event.stopPropagation()
  }

  /** A right-click puts the tool (or the replay picker) away. */
  public readonly handleToolContextMenu = (event: MouseEvent): void => {
    if (!this.#tool && !this.#deps.replay.picking) return
    event.preventDefault()
    event.stopPropagation()
    this.cancel()
    this.#deps.replay.cancelSelection()
  }
}
