import type { Chart } from 'klinecharts'
import { describe, expect, it } from 'vitest'
import { DRAWING_GROUP_ID } from '../model'
import { drawingIsPressed, pressedDrawingId } from './libraryInternals'

/** A chart whose store reports one pressed overlay, the way klinecharts 10.0.3 exposes it. */
function chartHolding(overlay: { id?: string; groupId?: string } | null | undefined): Chart {
  return { _chartStore: { getPressedOverlayInfo: () => ({ overlay }) } } as unknown as Chart
}

describe('pressedDrawingId', () => {
  it('returns the id of the drawing being held', () => {
    expect(pressedDrawingId(chartHolding({ id: 'd1', groupId: DRAWING_GROUP_ID }))).toBe('d1')
  })

  it('ignores overlays that are not drawings, such as alert lines', () => {
    expect(pressedDrawingId(chartHolding({ id: 'alert-1', groupId: 'alerts' }))).toBeUndefined()
  })

  it('is undefined when nothing is held or the library has no such state', () => {
    expect(pressedDrawingId(chartHolding(null))).toBeUndefined()
    expect(pressedDrawingId(chartHolding(undefined))).toBeUndefined()
    expect(pressedDrawingId({} as unknown as Chart)).toBeUndefined()
  })
})

describe('drawingIsPressed', () => {
  it('is true only while an overlay is held', () => {
    expect(drawingIsPressed(chartHolding({ id: 'd1', groupId: DRAWING_GROUP_ID }))).toBe(true)
    expect(drawingIsPressed(chartHolding(null))).toBe(false)
  })
})
