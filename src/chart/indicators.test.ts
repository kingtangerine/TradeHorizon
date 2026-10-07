import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INDICATORS,
  MAX_MOVING_AVERAGE_PERIODS,
  addMovingAveragePeriod,
  movingAverageActive,
  normalizeIndicators,
  parsePeriod,
  removeMovingAveragePeriod,
} from './indicators'

describe('moving average settings', () => {
  it('accepts whole numbers from 1 to 500 only', () => {
    expect(parsePeriod('20')).toBe(20)
    expect(parsePeriod(500)).toBe(500)
    for (const bad of ['0', '501', '2.5', '', 'abc', undefined, null, -3]) {
      expect(parsePeriod(bad)).toBeUndefined()
    }
  })

  it('adds periods in ascending order, ignores duplicates, and caps the count', () => {
    let settings = addMovingAveragePeriod({ visible: false, periods: [] }, 50)
    settings = addMovingAveragePeriod(settings, 9)
    expect(settings).toEqual({ visible: true, periods: [9, 50] })
    expect(addMovingAveragePeriod(settings, 9).periods).toEqual([9, 50])

    let full = settings
    for (const period of [100, 150, 200]) full = addMovingAveragePeriod(full, period)
    expect(full.periods).toHaveLength(MAX_MOVING_AVERAGE_PERIODS)
    expect(addMovingAveragePeriod(full, 300)).toBe(full)
  })

  it('hides the indicator when its last period is removed', () => {
    const settings = removeMovingAveragePeriod({ visible: true, periods: [20] }, 20)
    expect(settings).toEqual({ visible: false, periods: [] })
    expect(movingAverageActive(settings)).toBe(false)
    expect(movingAverageActive({ visible: true, periods: [20] })).toBe(true)
  })
})

describe('normalizeIndicators', () => {
  it('falls back to defaults for missing or malformed data', () => {
    expect(normalizeIndicators(undefined)).toBe(DEFAULT_INDICATORS)
    expect(normalizeIndicators('nope')).toBe(DEFAULT_INDICATORS)
    expect(normalizeIndicators({ sma: 5, ema: null, dominance: 'x' })).toEqual(DEFAULT_INDICATORS)
  })

  it('sanitises persisted periods and visibility', () => {
    const result = normalizeIndicators({
      sma: { visible: true, periods: [50, '20', 20, 0, 999, 'x'] },
      ema: { visible: true, periods: [] },
      dominance: { btc: true, usdt: 'yes', alt: true },
    })
    expect(result.sma).toEqual({ visible: true, periods: [20, 50] })
    expect(result.ema.visible).toBe(false)
    expect(result.dominance).toEqual({ btc: true, usdt: false, alt: true })
  })
})
