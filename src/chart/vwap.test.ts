import { describe, expect, it } from 'vitest'
import { VWAP_ANCHORS, anchorStart, computeVwap, type VwapBar } from './vwap'

const utc = (iso: string) => Date.parse(`${iso}Z`)
const bar = (iso: string, price: number, volume: number): VwapBar => ({ timestamp: utc(iso), high: price, low: price, close: price, volume })

describe('anchor periods (UTC)', () => {
  it('finds the start of the day, week, month, quarter and year', () => {
    const t = utc('2026-05-14T15:30:00') // a Thursday
    expect(anchorStart(t, 'day')).toBe(utc('2026-05-14T00:00:00'))
    expect(anchorStart(t, 'week')).toBe(utc('2026-05-11T00:00:00')) // Monday
    expect(anchorStart(t, 'month')).toBe(utc('2026-05-01T00:00:00'))
    expect(anchorStart(t, 'quarter')).toBe(utc('2026-04-01T00:00:00'))
    expect(anchorStart(t, 'year')).toBe(utc('2026-01-01T00:00:00'))
  })

  it('puts a Sunday in the week that began the previous Monday, and quarter boundaries in the right quarter', () => {
    expect(anchorStart(utc('2026-05-17T23:59:00'), 'week')).toBe(utc('2026-05-11T00:00:00'))
    expect(anchorStart(utc('2026-03-31T23:00:00'), 'quarter')).toBe(utc('2026-01-01T00:00:00'))
    expect(anchorStart(utc('2026-10-01T00:00:00'), 'quarter')).toBe(utc('2026-10-01T00:00:00'))
    expect(VWAP_ANCHORS).toHaveLength(5)
  })
})

describe('computeVwap', () => {
  it('is the volume-weighted average since the period began', () => {
    const bars = [bar('2026-05-14T10:00:00', 100, 1), bar('2026-05-14T11:00:00', 200, 3)]
    const [first, second] = computeVwap(bars, 'day')
    expect(first).toBe(100)
    expect(second).toBeCloseTo((100 * 1 + 200 * 3) / 4)
  })

  it('uses the typical price of each bar', () => {
    const [value] = computeVwap([{ timestamp: utc('2026-05-14T10:00:00'), high: 120, low: 90, close: 105, volume: 2 }], 'day')
    expect(value).toBe(105)
    const [other] = computeVwap([{ timestamp: utc('2026-05-14T10:00:00'), high: 130, low: 90, close: 110, volume: 2 }], 'day')
    expect(other).toBeCloseTo((130 + 90 + 110) / 3)
  })

  it('restarts at the next period', () => {
    const bars = [bar('2026-05-14T23:00:00', 100, 5), bar('2026-05-15T00:00:00', 300, 1), bar('2026-05-15T01:00:00', 500, 1)]
    const values = computeVwap(bars, 'day')
    expect(values[1]).toBe(300)
    expect(values[2]).toBeCloseTo(400)
    // over a week the same bars are still one period
    expect(computeVwap(bars, 'week')[2]).toBeCloseTo((100 * 5 + 300 + 500) / 7)
  })

  it('has no value until some volume has traded in the period', () => {
    const bars = [bar('2026-05-14T10:00:00', 100, 0), bar('2026-05-14T11:00:00', 100, 2)]
    expect(computeVwap(bars, 'day')).toEqual([undefined, 100])
    expect(computeVwap([{ timestamp: 0, high: 1, low: 1, close: 1 }], 'day')).toEqual([undefined])
  })

  it('quarterly VWAP spans the whole quarter', () => {
    const bars = [bar('2026-04-02T00:00:00', 100, 1), bar('2026-06-30T00:00:00', 200, 1), bar('2026-07-01T00:00:00', 900, 1)]
    const values = computeVwap(bars, 'quarter')
    expect(values[1]).toBeCloseTo(150)
    expect(values[2]).toBe(900)
  })
})
