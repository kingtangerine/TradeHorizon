import { describe, expect, it } from 'vitest'
import { DRAWING_TOOLS, TOOL_ORDER } from '../chart/tools'
import { RESERVED_ALT_KEYS, isChartTypingKey, parseIntervalInput } from './hotkeys'

describe('typed timeframes', () => {
  it('reads numbers as minutes and turns whole hours and days into those units', () => {
    expect(parseIntervalInput('15')).toBe('15m')
    expect(parseIntervalInput('60')).toBe('1h')
    expect(parseIntervalInput('240')).toBe('4h')
    expect(parseIntervalInput('1440')).toBe('1d')
  })

  it('reads h, d, w and M (months), with or without a number', () => {
    expect(parseIntervalInput('4h')).toBe('4h')
    expect(parseIntervalInput('1H')).toBe('1h')
    expect(parseIntervalInput('D')).toBe('1d')
    expect(parseIntervalInput('3d')).toBe('3d')
    expect(parseIntervalInput('7d')).toBe('1w')
    expect(parseIntervalInput('W')).toBe('1w')
    expect(parseIntervalInput('M')).toBe('1M')
    expect(parseIntervalInput('5m')).toBe('5m')
  })

  it('refuses what the exchange does not offer or cannot be read', () => {
    expect(parseIntervalInput('7')).toBeUndefined()
    expect(parseIntervalInput('0')).toBeUndefined()
    expect(parseIntervalInput('')).toBeUndefined()
    expect(parseIntervalInput('abc')).toBeUndefined()
  })
})

describe('typing on the chart', () => {
  const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  })
  it('takes plain characters but not shortcuts or special keys', () => {
    expect(isChartTypingKey(key('e'), null)).toBe(true)
    expect(isChartTypingKey(key('5'), null)).toBe(true)
    expect(isChartTypingKey(key('e', { ctrlKey: true }), null)).toBe(false)
    expect(isChartTypingKey(key('r', { altKey: true }), null)).toBe(false)
    expect(isChartTypingKey(key('Enter'), null)).toBe(false)
  })
})

describe('Alt shortcuts', () => {
  it('keeps Alt+R and Alt+A free of drawing tools', () => {
    const used = TOOL_ORDER.map((type) => DRAWING_TOOLS[type].shortcut)
    for (const key of RESERVED_ALT_KEYS) expect(used).not.toContain(key)
  })
})
