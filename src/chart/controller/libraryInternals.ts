import type { Chart } from 'klinecharts'
import { DRAWING_GROUP_ID } from '../model'

// klinecharts has no public API for overlay press, hover and click state, so these read or set its chart store
// directly (pinned version 10.0.3).

interface ChartStoreInternals {
  getCrosshair?(): { x?: number; y?: number; paneId?: string }
  setCrosshair?(crosshair?: CrosshairPoint): void
  getPressedOverlayInfo?(): { overlay?: { id?: string; groupId?: string } | null; figureType?: string }
  getHoverOverlayInfo?(): { overlay?: { id?: string; groupId?: string } | null; figureType?: string }
  setClickOverlayInfo?(info: unknown, onSelected: () => void, onDeselected: () => void): void
}

function chartStore(chart: Chart): ChartStoreInternals | undefined {
  return (chart as unknown as { _chartStore?: ChartStoreInternals })._chartStore
}

/** The library's touch state: where a tap put the crosshair, and whether the next tap should not show one. */
interface ChartEventInternals {
  _touchCoordinate?: { x: number; y: number } | null
  _touchCancelCrosshair?: boolean
}

function chartEvent(chart: Chart): ChartEventInternals | undefined {
  return (chart as unknown as { _chartEvent?: ChartEventInternals })._chartEvent
}

/** The crosshair's place: pixels from the top-left corner of the pane it is in. */
export interface CrosshairPoint {
  x: number
  y: number
  paneId: string
}

/**
 * The crosshair that a tap left on screen, if there is one. A crosshair that merely follows the mouse does not
 * count: only a tap puts the library into the state where the crosshair stays after the finger lifts.
 */
export function tappedCrosshair(chart: Chart): CrosshairPoint | undefined {
  if (!chartEvent(chart)?._touchCoordinate) return undefined
  const crosshair = chartStore(chart)?.getCrosshair?.()
  if (typeof crosshair?.x !== 'number' || typeof crosshair.y !== 'number' || typeof crosshair.paneId !== 'string') return undefined
  return { x: crosshair.x, y: crosshair.y, paneId: crosshair.paneId }
}

/** Moves the crosshair that a tap left on screen, keeping the library's own record of it in step. */
export function moveTappedCrosshair(chart: Chart, point: CrosshairPoint): void {
  const event = chartEvent(chart)
  const store = chartStore(chart)
  if (!event || !store?.setCrosshair) return
  event._touchCoordinate = { x: point.x, y: point.y }
  store.setCrosshair(point)
}

/** Removes the crosshair that a tap left on screen, so that the next tap shows one again. */
export function clearTappedCrosshair(chart: Chart): void {
  const event = chartEvent(chart)
  if (event) {
    event._touchCoordinate = null
    event._touchCancelCrosshair = false
  }
  chartStore(chart)?.setCrosshair?.()
}

/** True while the library is dragging a drawing or one of its handles, in which case the chart must not pan. */
export function drawingIsPressed(chart: Chart): boolean {
  const store = chartStore(chart)
  return !!store?.getPressedOverlayInfo?.().overlay
}

/**
 * Id of the drawing that a finger (or the mouse button) is holding right now, if any. The library sets this on press
 * and clears it on release; it does not set it for locked drawings, which cannot be dragged.
 */
export function pressedDrawingId(chart: Chart): string | undefined {
  const overlay = chartStore(chart)?.getPressedOverlayInfo?.().overlay
  return overlay?.groupId === DRAWING_GROUP_ID ? overlay.id : undefined
}

/** True while a finger (or the mouse button) is holding one of a drawing's points, as opposed to its body. */
export function pressedDrawingHandle(chart: Chart): boolean {
  const pressed = chartStore(chart)?.getPressedOverlayInfo?.()
  return pressed?.overlay?.groupId === DRAWING_GROUP_ID && pressed.figureType === 'point'
}

/** Id of the overlay under the pointer, if any. */
export function hoveredOverlayId(chart: Chart): string | undefined {
  const store = chartStore(chart)
  return store?.getHoverOverlayInfo?.().overlay?.id
}

/** True while the pointer is over a drawing (a right-click there selects the drawing instead of opening the chart menu). */
export function drawingUnderPointer(chart: Chart): boolean {
  const store = chartStore(chart)
  const hovered = store?.getHoverOverlayInfo?.()
  return !!hovered?.overlay && hovered.figureType !== 'none' && hovered.overlay.groupId === DRAWING_GROUP_ID
}

/**
 * A drawing that was just placed (or copied) is selected like one that was clicked: its handles and
 * axis tags show at once, so it can be adjusted without first clicking it. klinecharts has no public
 * API for this, so the click state is set directly (pinned version 10.0.3).
 */
export function showHandles(chart: Chart, id: string): void {
  const overlay = chart.getOverlays({ id })[0]
  const store = chartStore(chart)
  if (!overlay || !store?.setClickOverlayInfo) return
  store.setClickOverlayInfo(
    { paneId: 'candle_pane', overlay, figureType: 'point', figureIndex: 0, figure: null },
    () => undefined,
    () => undefined,
  )
}

/**
 * klinecharts has no public API to deselect, so it keeps drawing handles on the last
 * clicked overlay. Reset its click state (pinned version 10.0.3) so Esc leaves clean shapes.
 */
export function resetClickedOverlay(chart: Chart): void {
  const store = chartStore(chart)
  store?.setClickOverlayInfo?.(
    { paneId: '', overlay: null, figureType: 'none', figureIndex: -1, figure: null },
    () => undefined,
    () => undefined,
  )
}
