import { describe, expect, it } from 'vitest'
import {
  STUDIES,
  STUDY_TYPES,
  atr,
  bollinger,
  clampParam,
  ichimoku,
  macd,
  newStudy,
  normalizeStudies,
  rsi,
  stochRsi,
  supertrend,
  volumeProfile,
} from './studies'

const flat = (n: number, price = 100) =>
  Array.from({ length: n }, () => ({ open: price, high: price + 1, low: price - 1, close: price, volume: 10 }))

describe('study maths', () => {
  it('matches the StockCharts RSI example (14)', () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
    const values = rsi(closes, 14)
    expect(values[13]).toBeUndefined()
    expect(values[14]).toBeCloseTo(70.46, 1)
  })

  it('gives RSI 100 for a rising series and MACD 0 for a flat one', () => {
    expect(
      rsi(
        Array.from({ length: 30 }, (_, i) => i + 1),
        14,
      ).at(-1),
    ).toBe(100)
    const flatMacd = macd(
      Array.from({ length: 60 }, () => 5),
      12,
      26,
      9,
    ).at(-1)!
    expect(flatMacd.macd).toBe(0)
    expect(flatMacd.histogram).toBe(0)
  })

  it('puts Bollinger bands on the average when the price does not move', () => {
    const last = bollinger(
      Array.from({ length: 25 }, () => 7),
      20,
      2,
    ).at(-1)!
    expect(last).toEqual({ basis: 7, upper: 7, lower: 7 })
    const spread = bollinger([1, 3, 1, 3], 4, 1).at(-1)!
    expect(spread.upper! - spread.basis!).toBeCloseTo(1)
  })

  it('measures ATR as the usual candle range', () => {
    expect(atr(flat(30), 14).at(-1)).toBeCloseTo(2)
  })

  it('keeps Stoch RSI between 0 and 100', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5)
    for (const row of stochRsi(closes, 3, 3, 14, 14)) {
      if (row.k !== undefined) {
        expect(row.k).toBeGreaterThanOrEqual(0)
        expect(row.k).toBeLessThanOrEqual(100)
      }
    }
  })

  it('shifts Ichimoku spans onto later bars', () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({ open: i, high: i + 1, low: i - 1, close: i }))
    const rows = ichimoku(bars, 9, 26, 52, 26)
    expect(rows[60].conversion).toBeCloseTo(56) // mid of bars 52..60: (61 + 51) / 2
    expect(rows[55].spanA).toBeDefined()
    expect(rows[45].spanA).toBeUndefined()
    expect(rows[10].spanA).toBeUndefined()
    expect(rows[0].lagging).toBe(25)
  })

  it('draws Supertrend below the price in an uptrend and above in a downtrend', () => {
    const rising = Array.from({ length: 40 }, (_, i) => ({ open: 100 + i, high: 101 + i, low: 99 + i, close: 100.8 + i }))
    const up = supertrend(rising, 10, 3).at(-1)!
    expect(up.up).toBeLessThan(rising.at(-1)!.close)
    const falling = rising.map((bar) => ({ open: 300 - bar.open, high: 300 - bar.low, low: 300 - bar.high, close: 300 - bar.close }))
    expect(supertrend(falling, 10, 3).at(-1)!.down).toBeGreaterThan(falling.at(-1)!.close)
  })

  it('spreads volume over price rows and finds the point of control', () => {
    const profile = volumeProfile(
      [
        { open: 10, high: 12, low: 10, close: 12, volume: 30 },
        { open: 12, high: 12, low: 11, close: 11, volume: 50 },
      ],
      2,
    )!
    const total = profile.rows.reduce((sum, row) => sum + row.up + row.down, 0)
    expect(total).toBeCloseTo(80)
    expect(profile.pocIndex).toBe(1)
  })
})

describe('stored studies', () => {
  it('fills defaults and clamps bad values', () => {
    const [study] = normalizeStudies([{ id: 'a', type: 'bb', params: [9999, 2.04], colors: ['nope'] }])
    expect(study.params).toEqual([400, 2])
    expect(study.colors[0]).toBe(STUDIES.bb.lines[0].color)
    expect(study.visible).toBe(true)
    expect(normalizeStudies([{ id: 'a', type: 'renko' }, 'x', null])).toEqual([])
    expect(clampParam(STUDIES.rsi.params[0], 3.6)).toBe(4)
  })

  it('has a line colour and default per definition', () => {
    for (const type of STUDY_TYPES) {
      const study = newStudy(type, type)
      expect(study.colors).toHaveLength(STUDIES[type].lines.length)
      expect(study.params).toHaveLength(STUDIES[type].params.length)
    }
  })
})
