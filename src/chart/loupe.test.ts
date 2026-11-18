import { describe, expect, it } from 'vitest'
import { loupeCentre, loupeSlice } from './loupe'

const area = { left: 0, top: 100, right: 400, bottom: 700 }

describe('loupeCentre', () => {
  it('sits above the finger when there is room', () => {
    expect(loupeCentre({ x: 200, y: 500 }, area, 120, 36)).toEqual({ x: 200, y: 404 })
  })

  it('stays inside the chart at the left and right edges', () => {
    expect(loupeCentre({ x: 10, y: 500 }, area, 120, 36).x).toBe(60)
    expect(loupeCentre({ x: 395, y: 500 }, area, 120, 36).x).toBe(340)
  })

  it('moves to the left of the finger near the top of the chart', () => {
    expect(loupeCentre({ x: 300, y: 150 }, area, 120, 36)).toEqual({ x: 204, y: 160 })
  })

  it('moves to the right of the finger near the top-left corner', () => {
    expect(loupeCentre({ x: 40, y: 150 }, area, 120, 36)).toEqual({ x: 136, y: 160 })
  })

  it('never covers the finger', () => {
    for (const finger of [
      { x: 0, y: 100 },
      { x: 400, y: 100 },
      { x: 200, y: 215 },
      { x: 200, y: 217 },
      { x: 399, y: 699 },
    ]) {
      const centre = loupeCentre(finger, area, 120, 36)
      expect(Math.hypot(centre.x - finger.x, centre.y - finger.y)).toBeGreaterThanOrEqual(60 + 36)
    }
  })
})

describe('loupeSlice', () => {
  const canvas = { left: 0, top: 100, right: 400, bottom: 700 }

  it('takes the square around the finger and fills the loupe with it', () => {
    expect(loupeSlice({ x: 200, y: 400 }, canvas, { x: 1, y: 1 }, 120, 2)).toEqual({
      source: [170, 270, 60, 60],
      target: [0, 0, 120, 120],
    })
  })

  it('uses canvas pixels for the source on dense screens', () => {
    expect(loupeSlice({ x: 200, y: 400 }, canvas, { x: 3, y: 3 }, 120, 2)?.source).toEqual([510, 810, 180, 180])
  })

  it('keeps only the part that is on the canvas at an edge', () => {
    expect(loupeSlice({ x: 10, y: 400 }, canvas, { x: 1, y: 1 }, 120, 2)).toEqual({
      source: [0, 270, 40, 60],
      target: [40, 0, 80, 120],
    })
  })

  it('is null for a canvas the loupe does not reach', () => {
    expect(loupeSlice({ x: 200, y: 400 }, { left: 0, top: 700, right: 400, bottom: 730 }, { x: 1, y: 1 }, 120, 2)).toBeNull()
  })
})
