import { describe, expect, it } from 'vitest'
import { drawingFromOverlay, drawingPoints } from './model'
import { calculateLongPositionMetrics } from './position'

describe('calculateLongPositionMetrics', () => {
  it('sizes a position from account risk and stop distance', () => {
    const metrics = calculateLongPositionMetrics(100, 110, 95, 10_000, 1)

    expect(metrics.riskAmount).toBe(100)
    expect(metrics.quantity).toBe(20)
    expect(metrics.rewardAmount).toBe(200)
    expect(metrics.riskReward).toBe(2)
    expect(metrics.targetPercent).toBe(10)
    expect(metrics.stopPercent).toBe(5)
  })

  it('returns finite zero sizing when entry and stop match', () => {
    const metrics = calculateLongPositionMetrics(100, 110, 100, 10_000, 1)

    expect(metrics.quantity).toBe(0)
    expect(metrics.riskReward).toBe(0)
    expect(metrics.rewardAmount).toBe(0)
  })

  it('does not produce negative risk from invalid negative inputs', () => {
    const metrics = calculateLongPositionMetrics(100, 110, 95, -10_000, -2)
    expect(metrics.riskAmount).toBe(0)
    expect(metrics.quantity).toBe(0)
  })
})

describe('drawingFromOverlay with rectangle', () => {
  it('converts a 2-point overlay into an 8-anchor rectangle drawing', () => {
    const overlay = {
      id: 'rect-1',
      points: [
        { timestamp: 1_000, value: 100 },
        { timestamp: 2_000, value: 200 },
      ],
    } as any

    const drawing = drawingFromOverlay(overlay, 'binance:spot:BTC-USDT' as any, undefined, 'rectangle')
    expect(drawing).not.toBeNull()
    expect(drawing?.anchors).toHaveLength(8)
    expect(drawing?.anchors).toEqual([
      { timeMs: 1_000, price: '200' },
      { timeMs: 1_500, price: '200' },
      { timeMs: 2_000, price: '200' },
      { timeMs: 2_000, price: '150' },
      { timeMs: 2_000, price: '100' },
      { timeMs: 1_500, price: '100' },
      { timeMs: 1_000, price: '100' },
      { timeMs: 1_000, price: '150' },
    ])

    const points = drawingPoints(drawing!)
    expect(points).toHaveLength(8)
    expect(points[0]).toEqual({ timestamp: 1_000, value: 200 })
    expect(points[1]).toEqual({ timestamp: 1_500, value: 200 })
    expect(points[2]).toEqual({ timestamp: 2_000, value: 200 })
    expect(points[3]).toEqual({ timestamp: 2_000, value: 150 })
    expect(points[4]).toEqual({ timestamp: 2_000, value: 100 })
    expect(points[5]).toEqual({ timestamp: 1_500, value: 100 })
    expect(points[6]).toEqual({ timestamp: 1_000, value: 100 })
    expect(points[7]).toEqual({ timestamp: 1_000, value: 150 })
  })

  it('preserves an existing 8-point rectangle overlay', () => {
    const overlay = {
      id: 'rect-1',
      points: [
        { timestamp: 1_000, value: 200 },
        { timestamp: 1_500, value: 200 },
        { timestamp: 2_000, value: 200 },
        { timestamp: 2_000, value: 150 },
        { timestamp: 2_000, value: 100 },
        { timestamp: 1_500, value: 100 },
        { timestamp: 1_000, value: 100 },
        { timestamp: 1_000, value: 150 },
      ],
    } as any

    const drawing = drawingFromOverlay(overlay, 'binance:spot:BTC-USDT' as any, undefined, 'rectangle')
    expect(drawing).not.toBeNull()
    expect(drawing?.anchors).toHaveLength(8)
    expect(drawing?.anchors[1]).toEqual({ timeMs: 1_500, price: '200' })
    expect(drawing?.anchors[3]).toEqual({ timeMs: 2_000, price: '150' })
    expect(drawing?.anchors[5]).toEqual({ timeMs: 1_500, price: '100' })
    expect(drawing?.anchors[7]).toEqual({ timeMs: 1_000, price: '150' })
  })

  it('converts horizontalLine and priceRange overlays', () => {
    const hOverlay = {
      id: 'hline-1',
      points: [{ timestamp: 1_000, value: 45000 }],
    } as any
    const hDrawing = drawingFromOverlay(hOverlay, 'binance:spot:BTC-USDT' as any, undefined, 'horizontalLine')
    expect(hDrawing).not.toBeNull()
    expect(hDrawing?.anchors).toHaveLength(1)
    expect(hDrawing?.anchors[0]).toEqual({ timeMs: 1_000, price: '45000' })

    const prOverlay = {
      id: 'pr-1',
      points: [
        { timestamp: 1_000, value: 45000 },
        { timestamp: 2_000, value: 47500 },
      ],
    } as any
    const prDrawing = drawingFromOverlay(prOverlay, 'binance:spot:BTC-USDT' as any, undefined, 'priceRange')
    expect(prDrawing).not.toBeNull()
    expect(prDrawing?.anchors).toHaveLength(2)
    expect(prDrawing?.anchors[0]).toEqual({ timeMs: 1_000, price: '45000' })
    expect(prDrawing?.anchors[1]).toEqual({ timeMs: 2_000, price: '47500' })
  })
})
