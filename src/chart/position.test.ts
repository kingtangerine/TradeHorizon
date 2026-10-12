import { describe, expect, it } from 'vitest'
import { clampDcaPrice } from './geometry'
import { calculateDcaPositionMetrics, calculateLongPositionMetrics } from './position'

describe('DCA position metrics', () => {
  // entry 100, DCA 90, stop 80, target 130, risking 100 on a 10k account
  const dca = (triggered: boolean, size = 1) => calculateDcaPositionMetrics(100, 90, 130, 80, 10_000, 1, size, triggered)

  it('sizes the entry order so both fills together risk the budget', () => {
    const metrics = dca(true)
    // q1 * (20 + 10) = 100
    expect(metrics.baseQuantity).toBeCloseTo(100 / 30)
    expect(metrics.riskAmount).toBeCloseTo(metrics.totalQuantity * (metrics.averageEntry - 80))
  })

  it('keeps the entry as the average until the DCA triggers', () => {
    const metrics = dca(false)
    expect(metrics.averageEntry).toBe(100)
    expect(metrics.dcaQuantity).toBe(0)
    expect(metrics.totalQuantity).toBeCloseTo(100 / 30)
  })

  it('averages both fills once triggered', () => {
    const metrics = dca(true)
    expect(metrics.averageEntry).toBeCloseTo(95)
    expect(metrics.totalQuantity).toBeCloseTo(2 * 100 / 30)
    expect(metrics.riskAmount).toBeCloseTo(metrics.totalQuantity * 15)
    expect(metrics.rewardAmount).toBeCloseTo(metrics.totalQuantity * 35)
    expect(metrics.riskReward).toBeCloseTo(35 / 15)
  })

  it('weights the average by the size multiplier', () => {
    const metrics = dca(true, 3)
    expect(metrics.averageEntry).toBeCloseTo((100 + 90 * 3) / 4)
  })

  it('matches the plain calculation when the DCA sits on the entry', () => {
    const plain = calculateLongPositionMetrics(100, 130, 80, 10_000, 1)
    const same = calculateDcaPositionMetrics(100, 100, 130, 80, 10_000, 1, 1, true)
    expect(same.averageEntry).toBe(100)
    expect(same.riskAmount).toBeCloseTo(plain.riskAmount)
  })
})

describe('clampDcaPrice', () => {
  it('defaults to the middle of the buy region and stays between entry and stop', () => {
    expect(clampDcaPrice(100, 80)).toBe(90)
    expect(clampDcaPrice(100, 80, 120)).toBe(100)
    expect(clampDcaPrice(100, 80, 50)).toBe(80)
    expect(clampDcaPrice(100, 120, 130)).toBe(120)
  })
})
