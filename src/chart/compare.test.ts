import { describe, expect, it } from 'vitest'
import { closeAt, compareChange, normalizeCompare, scaledCompare } from './compare'

const main = [100, 110, 120, 130].map((close, index) => ({ timestamp: index * 10, close }))

describe('compare symbols', () => {
  it('finds the compare candle containing a moment', () => {
    const bars = [
      { timestamp: 0, close: 1 },
      { timestamp: 20, close: 3 },
    ]
    expect(closeAt(bars, -5)).toBeUndefined()
    expect(closeAt(bars, 10)).toBe(1)
    expect(closeAt(bars, 25)).toBe(3)
  })

  it('starts the compare line at the main price of the first visible candle', () => {
    const compare = [
      { timestamp: 0, close: 10 },
      { timestamp: 10, close: 12 },
      { timestamp: 20, close: 9 },
      { timestamp: 30, close: 10 },
    ]
    expect(scaledCompare(main, compare, 1, 4)).toEqual([110, 82.5, (110 / 12) * 10])
    expect(compareChange(main, compare, 1, 4)).toBeCloseTo(((10 - 12) / 12) * 100)
  })

  it('leaves gaps before the compare symbol has data', () => {
    const late = [
      { timestamp: 20, close: 5 },
      { timestamp: 30, close: 6 },
    ]
    expect(scaledCompare(main, late, 0, 4)).toEqual([undefined, undefined, 120, 144])
  })

  it('keeps up to three valid symbols', () => {
    expect(normalizeCompare(['ETHUSDT', 'ETHUSDT', 'x y', 'SOLUSDT.P', 'BNBUSDT', 'ADAUSDT', 4])).toEqual([
      'ETHUSDT',
      'SOLUSDT.P',
      'BNBUSDT',
    ])
  })
})
