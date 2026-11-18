import type { Chart } from 'klinecharts'
import { DRAWING_GROUP_ID } from '../model'

// klinecharts has no public API for overlay press, hover and click state, so these read or set its chart store
// directly (pinned version 10.0.3).

interface ChartStoreInternals {
  getPressedOverlayInfo?(): { overlay?: { id?: string; groupId?: string } | null; figureType?: string }
  getHoverOverlayInfo?(): { overlay?: { id?: string; groupId?: string } | null; figureType?: string }
  setClickOverlayInfo?(info: unknown, onSelected: () => void, onDeselected: () => void): void
}

function chartStore(chart: Chart): ChartStoreInternals | undefined {
  return (chart as unknown as { _chartStore?: ChartStoreInternals })._chartStore
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
