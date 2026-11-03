import { describe, expect, it } from 'vitest'
import { baselineLevel, heikinAshi, isChartType } from './chartTypes'

describe('chart types', () => {
  it('builds Heikin Ashi candles from the previous HA body', () => {
    const [first, second] = heikinAshi([
      { open: 10, high: 14, low: 8, close: 12 },
      { open: 12, high: 16, low: 11, close: 15 },
    ])
    expect(first).toEqual({ open: 11, close: 11, high: 14, low: 8 })
    expect(second.open).toBe(11) // (11 + 11) / 2
    expect(second.close).toBe(13.5) // (12 + 16 + 11 + 15) / 4
    expect(second.high).toBe(16)
    expect(second.low).toBe(11)
  })

  it('puts the baseline in the middle of the closes', () => {
    expect(baselineLevel([10, 30, 20])).toBe(20)
    expect(baselineLevel([])).toBeUndefined()
  })

  it('accepts only known chart types', () => {
    expect(isChartType('heikinAshi')).toBe(true)
    expect(isChartType('renko')).toBe(false)
  })
})
