import { describe, expect, it } from 'vitest'
import { fibLevels, hiddenGroups, intervalGroup, visibleOnInterval } from './drawingVisibility'
import { FIB_LEVELS } from './geometry'

describe('drawing visibility and levels', () => {
  it('groups timeframes like TradingView', () => {
    expect(intervalGroup('15m')).toBe('minutes')
    expect(intervalGroup('4h')).toBe('hours')
    expect(intervalGroup('3d')).toBe('days')
    expect(intervalGroup('1w')).toBe('weeks')
    expect(intervalGroup('1M')).toBe('months')
  })

  it('hides a drawing only on the groups it was hidden on', () => {
    const style = { hiddenOn: ['minutes', 'bogus'] }
    expect(hiddenGroups(style)).toEqual(['minutes'])
    expect(visibleOnInterval(style, '5m')).toBe(false)
    expect(visibleOnInterval(style, '1h')).toBe(true)
    expect(visibleOnInterval({}, '1m')).toBe(true)
  })

  it('reads Fibonacci levels with defaults and cleanup', () => {
    expect(fibLevels({})).toEqual([...FIB_LEVELS])
    expect(fibLevels({ fibLevels: [1, 0.5, 0.5, 'x', 99, 0] })).toEqual([0, 0.5, 1])
    expect(fibLevels({ fibLevels: [] })).toEqual([...FIB_LEVELS])
  })
})
