// Geometry of moving the crosshair with a finger: the crosshair moves by as much as the finger does, from wherever
// it was, so the fingertip never has to cover it. Kept apart from the DOM code (controller/crosshairDrag.ts).

/** A finger has to travel this far before a press counts as a drag rather than a tap. */
export const CROSSHAIR_DRAG_START_PX = 4

/** A point inside a chart pane, in CSS pixels from the pane's top-left corner. */
export interface PanePoint {
  x: number
  y: number
}

/** True once the finger has moved far enough from where it went down to be a drag. */
export function isCrosshairDrag(start: PanePoint, current: PanePoint, threshold = CROSSHAIR_DRAG_START_PX): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

/**
 * Where the crosshair goes when the finger has moved from `start` to `current`: its `origin` shifted by the same
 * amount, kept inside a pane of the given size.
 */
export function draggedCrosshair(
  origin: PanePoint,
  start: PanePoint,
  current: PanePoint,
  pane: { width: number; height: number },
): PanePoint {
  return {
    x: Math.min(Math.max(origin.x + current.x - start.x, 0), Math.max(pane.width, 0)),
    y: Math.min(Math.max(origin.y + current.y - start.y, 0), Math.max(pane.height, 0)),
  }
}
