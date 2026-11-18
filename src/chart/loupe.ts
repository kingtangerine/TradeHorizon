// Geometry of the drawing loupe: the round magnifier that shows what a finger is covering while it places or moves
// a drawing point. Kept apart from the DOM code (controller/drawingLoupe.ts) so it can be tested.

/** Diameter of the loupe on screen, in CSS pixels. */
export const LOUPE_SIZE_PX = 120

/** How much the loupe enlarges the chart. */
export const LOUPE_ZOOM = 2

/** Space between the finger and the edge of the loupe, so the hand does not cover it. */
export const LOUPE_GAP_PX = 36

/** A point on screen, in CSS pixels. */
export interface ScreenPoint {
  x: number
  y: number
}

/** A rectangle on screen, in CSS pixels. */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value))
}

/**
 * Where the centre of the loupe goes for a finger at `finger`, staying inside `area` (the chart).
 * Above the finger when there is room; near the top of the chart it moves beside the finger instead, to the left
 * when that fits and to the right otherwise.
 */
export function loupeCentre(finger: ScreenPoint, area: ScreenRect, size = LOUPE_SIZE_PX, gap = LOUPE_GAP_PX): ScreenPoint {
  const radius = size / 2
  const reach = radius + gap
  if (finger.y - reach - radius >= area.top) {
    return { x: clamp(finger.x, area.left + radius, area.right - radius), y: finger.y - reach }
  }
  const y = clamp(finger.y, area.top + radius, area.bottom - radius)
  const leftFits = finger.x - reach - radius >= area.left
  return { x: leftFits ? finger.x - reach : clamp(finger.x + reach, area.left + radius, area.right - radius), y }
}

/**
 * The part of an image (a chart canvas shown at `shown`) that falls inside the region the loupe magnifies, and where
 * that part goes on the loupe. `scale` is canvas pixels per CSS pixel for the source image. Null when they do not
 * overlap.
 */
export function loupeSlice(
  finger: ScreenPoint,
  shown: ScreenRect,
  scale: ScreenPoint,
  size = LOUPE_SIZE_PX,
  zoom = LOUPE_ZOOM,
): { source: [number, number, number, number]; target: [number, number, number, number] } | null {
  const half = size / zoom / 2
  const left = Math.max(shown.left, finger.x - half)
  const top = Math.max(shown.top, finger.y - half)
  const right = Math.min(shown.right, finger.x + half)
  const bottom = Math.min(shown.bottom, finger.y + half)
  if (right <= left || bottom <= top) return null
  return {
    source: [(left - shown.left) * scale.x, (top - shown.top) * scale.y, (right - left) * scale.x, (bottom - top) * scale.y],
    target: [(left - (finger.x - half)) * zoom, (top - (finger.y - half)) * zoom, (right - left) * zoom, (bottom - top) * zoom],
  }
}
