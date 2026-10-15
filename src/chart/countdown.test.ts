import { describe, expect, it } from 'vitest'
import { candleCloseMs, formatCountdown } from './countdown'

describe('candleCloseMs', () => {
  it('adds the interval length', () => {
    const open = Date.UTC(2026, 9, 12, 10, 0)
    expect(candleCloseMs(open, '1h')).toBe(Date.UTC(2026, 9, 12, 11, 0))
    expect(candleCloseMs(open, '15m')).toBe(Date.UTC(2026, 9, 12, 10, 15))
    expect(candleCloseMs(Date.UTC(2026, 9, 12), '1w')).toBe(Date.UTC(2026, 9, 19))
  })

  it('closes a monthly candle at the start of the next month, including year end', () => {
    expect(candleCloseMs(Date.UTC(2026, 1, 1), '1M')).toBe(Date.UTC(2026, 2, 1))
    expect(candleCloseMs(Date.UTC(2026, 11, 1), '1M')).toBe(Date.UTC(2027, 0, 1))
  })
})

describe('formatCountdown', () => {
  it('shows minutes and seconds under an hour, rounding partial seconds up', () => {
    expect(formatCountdown(42_000)).toBe('00:42')
    expect(formatCountdown(41_100)).toBe('00:42')
    expect(formatCountdown(14 * 60_000 + 59_000)).toBe('14:59')
  })

  it('adds hours, then days', () => {
    expect(formatCountdown(3_600_000 + 5 * 60_000 + 9_000)).toBe('1:05:09')
    expect(formatCountdown(2 * 86_400_000 + 3 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('2d 03:05:09')
  })

  it('never goes negative', () => {
    expect(formatCountdown(-5000)).toBe('00:00')
  })
})
