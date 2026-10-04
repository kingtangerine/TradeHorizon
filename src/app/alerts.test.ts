import { describe, expect, it } from 'vitest'
import { alertReached, type PriceAlert } from './alerts'

const alert = (direction: 'above' | 'below', targetPrice: number): PriceAlert => ({
  id: 'alert-1',
  symbol: 'BTCUSDT',
  targetPrice,
  direction,
  enabled: true,
  createdAtMs: 1,
})

describe('alertReached', () => {
  it('triggers above alerts at or above the target', () => {
    expect(alertReached(alert('above', 100), 99)).toBe(false)
    expect(alertReached(alert('above', 100), 100)).toBe(true)
    expect(alertReached(alert('above', 100), 101)).toBe(true)
  })

  it('triggers below alerts at or below the target', () => {
    expect(alertReached(alert('below', 100), 101)).toBe(false)
    expect(alertReached(alert('below', 100), 100)).toBe(true)
    expect(alertReached(alert('below', 100), 99)).toBe(true)
  })
})
