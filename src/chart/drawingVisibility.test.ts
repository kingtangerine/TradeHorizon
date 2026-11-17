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

describe('Fibonacci retracement settings', () => {
  it('keeps older drawings as they were and gives new ones TradingView levels', async () => {
    const { TV_FIB_ROWS, fibLevelText, fibSettings } = await import('./drawingVisibility')
    expect(fibSettings({}).rows.map((row) => row.v)).toEqual([...FIB_LEVELS])
    expect(fibSettings({ fibLevels: [0.5, 1] }).rows).toEqual([
      { v: 0.5, c: '#4caf50', on: true },
      { v: 1, c: '#787b86', on: true },
    ])
    const custom = fibSettings({
      fibRows: [{ v: 0.618, c: '#123456', on: false }, { v: 'x' }],
      fibReverse: true,
      fibLabelSide: 'right',
      fibOneColor: '#ffffff',
    })
    expect(custom.rows).toEqual([{ v: 0.618, c: '#123456', on: false }])
    expect([custom.reverse, custom.labelSide, custom.oneColor, custom.background]).toEqual([true, 'right', '#ffffff', true])
    expect(TV_FIB_ROWS.filter((row) => row.on)).toHaveLength(11)
    expect(fibLevelText(0.618, true)).toBe('61.8%')
    expect(fibLevelText(1.618, false)).toBe('1.618')
  })
})
