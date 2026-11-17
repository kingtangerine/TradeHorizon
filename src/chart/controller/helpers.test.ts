import { describe, expect, it } from 'vitest'
import { anchorsEqual, barToQuote, colorWithOpacity, errorMessage, intervalDurationMs, isAbortError } from './helpers'

describe('colorWithOpacity', () => {
  it('turns a hex colour into rgba with the opacity, clamped to 0-100', () => {
    expect(colorWithOpacity('#3aa9ff', 14)).toBe('rgba(58, 169, 255, 0.14)')
    expect(colorWithOpacity('#FFFFFF', 150)).toBe('rgba(255, 255, 255, 1)')
    expect(colorWithOpacity('#000000', -5)).toBe('rgba(0, 0, 0, 0)')
  })

  it('replaces the alpha of rgb() and rgba() colours and leaves others alone', () => {
    expect(colorWithOpacity('rgb(1, 2, 3)', 50)).toBe('rgba(1, 2, 3, 0.5)')
    expect(colorWithOpacity('rgba(1,2,3,0.9)', 20)).toBe('rgba(1, 2, 3, 0.2)')
    expect(colorWithOpacity('red', 50)).toBe('red')
    expect(colorWithOpacity('#abc', 50)).toBe('#abc')
  })
})

describe('anchorsEqual', () => {
  it('compares times and prices in order', () => {
    const a = [
      { timeMs: 1, price: '10' },
      { timeMs: 2, price: '20' },
    ]
    expect(anchorsEqual(a, [...a])).toBe(true)
    expect(anchorsEqual(a, [a[0]])).toBe(false)
    expect(anchorsEqual(a, [a[0], { timeMs: 2, price: '21' }])).toBe(false)
    expect(anchorsEqual(a, [a[1], a[0]])).toBe(false)
  })
})

describe('barToQuote', () => {
  it('computes the change from the open and defaults missing volume to zero', () => {
    const quote = barToQuote({ timestamp: 0, open: 100, high: 120, low: 90, close: 110 })
    expect(quote).toMatchObject({ open: 100, high: 120, low: 90, close: 110, volume: 0, changePercent: 10, isFinal: false })
  })

  it('reports no change for a zero open', () => {
    expect(barToQuote({ timestamp: 0, open: 0, high: 1, low: 0, close: 1, volume: 5 }).changePercent).toBe(0)
  })
})

describe('errorMessage and isAbortError', () => {
  it('uses the error message, with a generic fallback', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('nope')).toBe('Market data is temporarily unavailable.')
  })

  it('recognises aborted requests', () => {
    expect(isAbortError(new DOMException('stop', 'AbortError'))).toBe(true)
    const error = new Error('stop')
    error.name = 'AbortError'
    expect(isAbortError(error)).toBe(true)
    expect(isAbortError(new Error('other'))).toBe(false)
  })
})

describe('intervalDurationMs', () => {
  it('gives the candle length, counting a month as 30 days', () => {
    expect(intervalDurationMs('1h')).toBe(60 * 60 * 1000)
    expect(intervalDurationMs('1M')).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
