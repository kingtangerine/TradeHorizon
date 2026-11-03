import { describe, expect, it } from 'vitest'
import { ellipsePolygon, extendLine, fibExtensionPrice, formatDuration, parallelOffset, pitchforkMedian, rangeSummary, thinStroke } from './geometry'

describe('wave 3 drawing maths', () => {
  it('projects Fibonacci extensions from the third point', () => {
    expect(fibExtensionPrice(100, 150, 120, 1)).toBe(170)
    expect(fibExtensionPrice(100, 150, 120, 1.618)).toBeCloseTo(200.9)
  })

  it('extends a line to an x position', () => {
    expect(extendLine({ x: 0, y: 0 }, { x: 10, y: 5 }, 100)).toEqual({ x: 100, y: 50 })
  })

  it('offsets a parallel channel through the third point', () => {
    expect(parallelOffset({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 15 })).toBe(10)
  })

  it('aims the pitchfork median at the middle of points 2 and 3', () => {
    expect(pitchforkMedian({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }).through).toEqual({ x: 10, y: 10 })
  })

  it('draws an ellipse inside its box', () => {
    const points = ellipsePolygon({ x: 0, y: 0 }, { x: 20, y: 10 }, 4)
    expect(points[0]).toEqual({ x: 20, y: 5 })
    expect(points[1].x).toBeCloseTo(10)
    expect(points[1].y).toBeCloseTo(10)
  })

  it('formats ranges in bars and time', () => {
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(rangeSummary(0, 3_600_000, 900_000)).toBe('4 bars, 1h')
  })

  it('thins a freehand stroke', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }))
    expect(thinStroke(points, 10)).toHaveLength(10)
    expect(thinStroke(points, 1, 20)).toHaveLength(20)
  })
})
