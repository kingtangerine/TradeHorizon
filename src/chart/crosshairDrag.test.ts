import { describe, expect, it } from 'vitest'
import { draggedCrosshair, isCrosshairDrag } from './crosshairDrag'

describe('isCrosshairDrag', () => {
  it('treats a press that barely moves as a tap', () => {
    expect(isCrosshairDrag({ x: 100, y: 100 }, { x: 102, y: 102 })).toBe(false)
  })

  it('treats a press that travels as a drag, in any direction', () => {
    expect(isCrosshairDrag({ x: 100, y: 100 }, { x: 104, y: 100 })).toBe(true)
    expect(isCrosshairDrag({ x: 100, y: 100 }, { x: 97, y: 96 })).toBe(true)
  })
})

describe('draggedCrosshair', () => {
  const pane = { width: 300, height: 400 }

  it('moves the crosshair by as much as the finger moved, wherever the finger is', () => {
    expect(draggedCrosshair({ x: 50, y: 60 }, { x: 250, y: 380 }, { x: 270, y: 350 }, pane)).toEqual({ x: 70, y: 30 })
  })

  it('stays put while the finger has not moved', () => {
    expect(draggedCrosshair({ x: 50, y: 60 }, { x: 10, y: 10 }, { x: 10, y: 10 }, pane)).toEqual({ x: 50, y: 60 })
  })

  it('stops at the edges of the pane', () => {
    expect(draggedCrosshair({ x: 50, y: 60 }, { x: 100, y: 100 }, { x: 0, y: 0 }, pane)).toEqual({ x: 0, y: 0 })
    expect(draggedCrosshair({ x: 250, y: 380 }, { x: 100, y: 100 }, { x: 300, y: 300 }, pane)).toEqual({ x: 300, y: 400 })
  })
})
