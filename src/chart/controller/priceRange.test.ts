import { describe, expect, it } from 'vitest'
import { priceViewRange, rangeWithCompareLines, type PriceAxisRange } from './priceRange'

function range(from: number, to: number): PriceAxisRange {
  return {
    from,
    to,
    range: to - from,
    realFrom: from,
    realTo: to,
    realRange: to - from,
    displayFrom: from,
    displayTo: to,
    displayRange: to - from,
  }
}

describe('priceViewRange', () => {
  const noBase = () => undefined

  it('returns the automatic range itself on the normal scale without zoom or pan', () => {
    const auto = range(100, 200)
    expect(priceViewRange(auto, 1, 0, 'normal', noBase)).toBe(auto)
  })

  it('zooms around the middle and pans by a fraction of the range', () => {
    expect(priceViewRange(range(100, 200), 2, 0, 'normal', noBase)).toMatchObject({ from: 50, to: 250, range: 200 })
    expect(priceViewRange(range(100, 200), 1, 0.1, 'normal', noBase)).toMatchObject({ from: 110, to: 210, displayFrom: 110 })
  })

  it('expresses the log scale in log10 while displaying prices', () => {
    const result = priceViewRange(range(10, 1000), 1, 0, 'log', noBase)
    expect(result.realFrom).toBeCloseTo(1)
    expect(result.realTo).toBeCloseTo(3)
    expect(result).toMatchObject({ from: 10, to: 1000, displayFrom: 10, displayTo: 1000 })
  })

  it('keeps the log scale above zero', () => {
    const result = priceViewRange(range(-50, 100), 1, 0, 'log', noBase)
    expect(result.from).toBeCloseTo(0.01)
  })

  it('expresses the percent scale relative to the base close, and falls back without one', () => {
    const result = priceViewRange(range(90, 120), 1, 0, 'percent', () => 100)
    expect(result.realFrom).toBeCloseTo(-10)
    expect(result.realTo).toBeCloseTo(20)
    expect(result.displayFrom).toBeCloseTo(-10)
    const auto = range(90, 120)
    expect(priceViewRange(auto, 1, 0, 'percent', noBase)).toBe(auto)
  })

  it('only reads the percent base on the percent scale', () => {
    let reads = 0
    const base = () => {
      reads += 1
      return 100
    }
    priceViewRange(range(1, 2), 2, 0, 'normal', base)
    priceViewRange(range(1, 2), 2, 0, 'log', base)
    expect(reads).toBe(0)
  })
})

describe('rangeWithCompareLines', () => {
  const main = [
    { timestamp: 1, close: 100 },
    { timestamp: 2, close: 100 },
  ]

  it('returns the same range when the compare lines already fit', () => {
    const auto = range(50, 150)
    expect(rangeWithCompareLines(auto, [], main, 0, 2)).toBe(auto)
    const flat = [{ symbol: 'X', color: '#fff', bars: [{ timestamp: 1, close: 10 }] }]
    expect(rangeWithCompareLines(auto, flat, main, 0, 2)).toBe(auto)
  })

  it('widens the range with 4% padding to fit the scaled compare lines', () => {
    const series = [
      {
        symbol: 'X',
        color: '#fff',
        bars: [
          { timestamp: 1, close: 10 },
          { timestamp: 2, close: 20 },
        ],
      },
    ]
    const result = rangeWithCompareLines(range(90, 110), series, main, 0, 2)
    expect(result.from).toBeCloseTo(85.6)
    expect(result.to).toBeCloseTo(204.4)
    expect(result.displayRange).toBeCloseTo(118.8)
  })
})
