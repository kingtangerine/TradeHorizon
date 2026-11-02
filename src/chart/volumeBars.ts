// Volume bar maths for the price-pane volume (no klinecharts import, so tests can use it).

/** Share of the price pane's height the tallest bar reaches. */
export const VOLUME_HEIGHT_RATIO = 0.2

/** Heights in pixels for the visible bars, tallest = `maxHeight`; any volume above zero stays at least 1 px. */
export function volumeBarHeights(volumes: ReadonlyArray<number | undefined>, maxHeight: number): number[] {
  const highest = volumes.reduce<number>((max, volume) => Math.max(max, volume ?? 0), 0)
  if (highest <= 0) return volumes.map(() => 0)
  return volumes.map((volume) => (volume && volume > 0 ? Math.max(1, (volume / highest) * maxHeight) : 0))
}
