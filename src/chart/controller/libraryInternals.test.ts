import type { Chart } from 'klinecharts'
import { describe, expect, it } from 'vitest'
import { DRAWING_GROUP_ID } from '../model'
import { drawingIsPressed, pressedDrawingHandle, pressedDrawingId } from './libraryInternals'

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

describe('pressedDrawingHandle', () => {
  const holding = (groupId: string, figureType: string): Chart =>
    ({ _chartStore: { getPressedOverlayInfo: () => ({ overlay: { id: 'd1', groupId }, figureType }) } }) as unknown as Chart

  it('is true while a point of a drawing is held', () => {
    expect(pressedDrawingHandle(holding(DRAWING_GROUP_ID, 'point'))).toBe(true)
  })

  it('is false for the body of a drawing, for other overlays and when nothing is held', () => {
    expect(pressedDrawingHandle(holding(DRAWING_GROUP_ID, 'other'))).toBe(false)
    expect(pressedDrawingHandle(holding('alerts', 'point'))).toBe(false)
    expect(pressedDrawingHandle(chartHolding(null))).toBe(false)
    expect(pressedDrawingHandle({} as unknown as Chart)).toBe(false)
  })
})

describe('drawingIsPressed', () => {
  it('is true only while an overlay is held', () => {
    expect(drawingIsPressed(chartHolding({ id: 'd1', groupId: DRAWING_GROUP_ID }))).toBe(true)
    expect(drawingIsPressed(chartHolding(null))).toBe(false)
  })
})
