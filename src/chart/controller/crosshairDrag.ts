import type { Chart } from 'klinecharts'
import { draggedCrosshair, isCrosshairDrag, type PanePoint } from '../crosshairDrag'
import { clearTappedCrosshair, moveTappedCrosshair, tappedCrosshair, type CrosshairPoint } from './libraryInternals'
import { paneRect } from './paneGeometry'

/** What the crosshair drag needs from the controller. */
export interface CrosshairDragDeps {
  readonly chart: Chart
  /** True while a drawing tool or the replay picker owns presses on the chart. */
  readonly isBusy: () => boolean
  /** A tap took the crosshair off the screen, so nothing is pointed at any more. */
  readonly onCrosshairRemoved: () => void
}

interface DragSession {
  /** The finger that started the drag (Touch.identifier). */
  touchId: number
  start: PanePoint
  /** Where the crosshair was when the finger went down. */
  origin: CrosshairPoint
  moved: boolean
}

/**
 * Moving the crosshair with a finger. A tap shows the crosshair (the chart library does that). While it is showing,
 * a drag anywhere on the chart moves it by as much as the finger moves, so the price and time under it can be read
 * without the fingertip covering them, and a tap removes it again. With no crosshair showing, a drag pans the chart
 * as before.
 *
 * The library on its own lets the crosshair follow only a finger that lands within a few pixels of it; any other
 * touch removes the crosshair and pans. So while the crosshair is showing, this takes the touch before the library
 * sees it.
 */
export class CrosshairDrag {
  readonly #deps: CrosshairDragDeps
  #session?: DragSession

  /** Starts with no drag under way. */
  public constructor(deps: CrosshairDragDeps) {
    this.#deps = deps
  }

  /** True while a tap has left the crosshair on screen, so the next drag belongs to it and must not pan the chart. */
  public get active(): boolean {
    return tappedCrosshair(this.#deps.chart) !== undefined
  }

  /** A finger went down: with the crosshair showing, the touch is taken from the library and moves the crosshair. */
  public readonly handleTouchStart = (event: TouchEvent): void => {
    this.#session = undefined
    // Two fingers are a pinch, which stays with the library.
    if (event.touches.length !== 1 || this.#deps.isBusy()) return
    const origin = tappedCrosshair(this.#deps.chart)
    const touch = event.touches[0]
    if (!origin || !this.#onChart(touch)) return
    event.stopPropagation()
    this.#session = { touchId: touch.identifier, start: { x: touch.clientX, y: touch.clientY }, origin, moved: false }
  }

  /** The finger moved: the crosshair moves by the same amount. */
  public readonly handleTouchMove = (event: TouchEvent): void => {
    const session = this.#session
    const touch = session && [...event.touches].find((item) => item.identifier === session.touchId)
    if (!session || !touch) return
    const current = { x: touch.clientX, y: touch.clientY }
    if (!session.moved && !isCrosshairDrag(session.start, current)) return
    session.moved = true
    if (event.cancelable) event.preventDefault()
    const size = this.#deps.chart.getSize(session.origin.paneId, 'main')
    if (!size) return
    moveTappedCrosshair(this.#deps.chart, {
      ...draggedCrosshair(session.origin, session.start, current, size),
      paneId: session.origin.paneId,
    })
  }

  /** The finger lifted: a tap removes the crosshair; after a drag it stays where it was left. */
  public readonly handleTouchEnd = (event: TouchEvent): void => {
    const session = this.#session
    if (!session || [...event.touches].some((item) => item.identifier === session.touchId)) return
    this.#session = undefined
    if (!session.moved && event.type === 'touchend') {
      clearTappedCrosshair(this.#deps.chart)
      this.#deps.onCrosshairRemoved()
    }
    // Without this the browser would follow the touch with mouse events, which the library would take for a hover.
    if (event.cancelable) event.preventDefault()
  }

  /** True when the touch is on the charts themselves, not on the price or time axis. */
  #onChart(touch: Touch): boolean {
    const chart = this.#deps.chart
    const candles = paneRect(chart)
    if (!candles || touch.clientX < candles.left || touch.clientX > candles.right || touch.clientY < candles.top) return false
    const timeAxis = chart.getDom('x_axis_pane')?.getBoundingClientRect()
    return !timeAxis || touch.clientY < timeAxis.top
  }
}
