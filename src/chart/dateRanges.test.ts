import { describe, expect, it } from 'vitest'
import { DATE_RANGES, rangeStart, zonedInputToTime } from './dateRanges'
import { MARKET_INTERVALS } from '../market'

const range = (key: string) => DATE_RANGES.find((item) => item.key === key)!

describe('date ranges', () => {
  it('fits every range in one history page of 1,000 candles', () => {
    const minutes: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240, '12h': 720, '1d': 1440, '1w': 10080 }
    for (const item of DATE_RANGES) {
      expect(MARKET_INTERVALS).toContain(item.interval)
      if (item.days !== undefined) expect((item.days * 1440) / minutes[item.interval]).toBeLessThanOrEqual(1000)
    }
  })

  it('starts each range at the right moment', () => {
    const now = Date.UTC(2026, 10, 2, 12)
    expect(rangeStart(range('1D'), now)).toBe(now - 86_400_000)
    expect(rangeStart(range('YTD'), now)).toBe(Date.UTC(2026, 0, 1))
    expect(rangeStart(range('All'), now)).toBe(0)
  })

  it('reads a typed date and time in the chart time zone', () => {
    expect(zonedInputToTime('2026-11-02T13:45', 'UTC')).toBe(Date.UTC(2026, 10, 2, 13, 45))
    expect(zonedInputToTime('2026-11-02T13:45', 'Asia/Dubai')).toBe(Date.UTC(2026, 10, 2, 9, 45))
    expect(zonedInputToTime('2026-11-02', 'UTC')).toBe(Date.UTC(2026, 10, 2))
    expect(zonedInputToTime('nonsense', 'UTC')).toBeUndefined()
  })
})
