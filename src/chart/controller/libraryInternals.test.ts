import type { Chart } from 'klinecharts'
import { describe, expect, it } from 'vitest'
import { DRAWING_GROUP_ID } from '../model'
import {
  clearTappedCrosshair,
  drawingIsPressed,
  moveTappedCrosshair,
  pressedDrawingHandle,
  pressedDrawingId,
  tappedCrosshair,
} from './libraryInternals'

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

describe('the crosshair a tap left on screen', () => {
  /** A chart in the state klinecharts 10.0.3 is in after a tap (or without one when `tapped` is false). */
  function chartWithCrosshair(tapped: boolean) {
    const state = {
      crosshair: { x: 40, y: 50, paneId: 'candle_pane' } as { x?: number; y?: number; paneId?: string },
      event: { _touchCoordinate: tapped ? { x: 40, y: 50 } : null, _touchCancelCrosshair: true } as {
        _touchCoordinate: { x: number; y: number } | null
        _touchCancelCrosshair: boolean
      },
    }
    const chart = {
      _chartEvent: state.event,
      _chartStore: {
        getCrosshair: () => state.crosshair,
        setCrosshair: (next?: { x: number; y: number; paneId: string }) => {
          state.crosshair = next ?? {}
        },
      },
    } as unknown as Chart
    return { chart, state }
  }

  it('is reported with its pane', () => {
    expect(tappedCrosshair(chartWithCrosshair(true).chart)).toEqual({ x: 40, y: 50, paneId: 'candle_pane' })
  })

  it('is not reported for a crosshair that only follows the mouse, or on a chart without that state', () => {
    expect(tappedCrosshair(chartWithCrosshair(false).chart)).toBeUndefined()
    expect(tappedCrosshair({} as unknown as Chart)).toBeUndefined()
  })

  it('moves together with the library record of it', () => {
    const { chart, state } = chartWithCrosshair(true)
    moveTappedCrosshair(chart, { x: 70, y: 20, paneId: 'candle_pane' })
    expect(state.crosshair).toEqual({ x: 70, y: 20, paneId: 'candle_pane' })
    expect(state.event._touchCoordinate).toEqual({ x: 70, y: 20 })
    expect(tappedCrosshair(chart)).toEqual({ x: 70, y: 20, paneId: 'candle_pane' })
  })

  it('is removed so that the next tap shows a crosshair again', () => {
    const { chart, state } = chartWithCrosshair(true)
    clearTappedCrosshair(chart)
    expect(state.crosshair).toEqual({})
    expect(state.event._touchCoordinate).toBeNull()
    expect(state.event._touchCancelCrosshair).toBe(false)
    expect(tappedCrosshair(chart)).toBeUndefined()
  })
})

describe('drawingIsPressed', () => {
  it('is true only while an overlay is held', () => {
    expect(drawingIsPressed(chartHolding({ id: 'd1', groupId: DRAWING_GROUP_ID }))).toBe(true)
    expect(drawingIsPressed(chartHolding(null))).toBe(false)
  })
})
