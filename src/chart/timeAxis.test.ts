import { describe, expect, it } from 'vitest'
import { buildTimeTicks, formatCrosshairTime, localTime, zoneOffsetMinutes } from './timeAxis'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const bars = (start: number, step: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({ index, timestamp: start + index * step }))

describe('time zones', () => {
  it('knows offsets including daylight saving and half-hour zones', () => {
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 15), 'UTC')).toBe(0)
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 15), 'Asia/Dubai')).toBe(240)
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 15), 'Asia/Kolkata')).toBe(330)
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 15), 'America/New_York')).toBe(-300)
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15), 'America/New_York')).toBe(-240)
  })

  it('gives local wall-clock fields', () => {
    expect(localTime(Date.UTC(2026, 10, 1, 22, 30), 'Asia/Dubai')).toMatchObject({
      year: 2026,
      month: 10,
      day: 2,
      hour: 2,
      minute: 30,
      weekday: 1,
    })
  })

  it('formats the crosshair date like TradingView', () => {
    const time = Date.UTC(2026, 10, 2, 9, 45)
    expect(formatCrosshairTime(time, 'Asia/Dubai', 15 * MINUTE)).toBe("Mon 02 Nov '26  13:45")
    expect(formatCrosshairTime(time, 'UTC', DAY)).toBe("Mon 02 Nov '26")
  })
})

describe('time axis labels', () => {
  it('puts 15-minute chart labels on round hours and the day number at midnight', () => {
    // 15m candles over two days, 6 px each: at least 72 px apart means every 3 hours (12 bars).
    const ticks = buildTimeTicks(bars(Date.UTC(2026, 10, 1, 20, 0), 15 * MINUTE, 120), {
      barSpacePx: 6,
      intervalMs: 15 * MINUTE,
      timeZone: 'UTC',
    })
    expect(ticks.map((tick) => tick.text).slice(0, 6)).toEqual(['21:00', '2', '03:00', '06:00', '09:00', '12:00'])
    for (const tick of ticks)
      expect(['00', '03', '06', '09', '12', '15', '18', '21'].includes(tick.text.slice(0, 2)) || /^\d+$/.test(tick.text)).toBe(true)
  })

  it('follows the chosen time zone', () => {
    const start = Date.UTC(2026, 10, 1, 18, 0)
    const dubai = buildTimeTicks(bars(start, HOUR, 30), { barSpacePx: 30, intervalMs: HOUR, timeZone: 'Asia/Dubai' })
    // 18:00 UTC is 22:00 in Dubai: midnight there is 20:00 UTC, two bars later.
    expect(dubai.find((tick) => tick.level === 2)).toMatchObject({ text: '2', timestamp: Date.UTC(2026, 10, 1, 20, 0) })
  })

  it('shows months and the year on daily charts, and keeps labels apart', () => {
    const ticks = buildTimeTicks(bars(Date.UTC(2025, 10, 1), DAY, 120), { barSpacePx: 4, intervalMs: DAY, timeZone: 'UTC' })
    const texts = ticks.map((tick) => tick.text)
    expect(texts).toContain('Dec')
    expect(texts).toContain('2026')
    expect(texts).toContain('Feb')
    for (let index = 1; index < ticks.length; index += 1)
      expect((ticks[index].index - ticks[index - 1].index) * 4).toBeGreaterThanOrEqual(72)
  })

  it('returns nothing without enough bars', () => {
    expect(buildTimeTicks([], { barSpacePx: 5, intervalMs: HOUR, timeZone: 'UTC' })).toEqual([])
  })
})
