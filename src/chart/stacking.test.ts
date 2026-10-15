import { describe, expect, it } from 'vitest'
import { stackLevels } from './geometry'

const box = (id: string, t0: number, t1: number, p0: number, p1: number, type = 'rectangle') => ({
  id, type, anchors: [{ timeMs: t0, price: String(p0) }, { timeMs: t1, price: String(p1) }],
})

describe('stackLevels', () => {
  it('puts a smaller box above the bigger box around it, whatever order they were drawn in', () => {
    const levels = stackLevels([box('small', 4, 6, 40, 45), box('big', 0, 10, 30, 60)])
    expect(levels.get('small')!).toBeGreaterThan(levels.get('big')!)
  })

  it('puts lines and text above every area, and covers every drawing', () => {
    const levels = stackLevels([
      box('line', 0, 100, 0, 100, 'trendLine'),
      box('big', 0, 10, 30, 60),
      box('pos', 1, 2, 31, 32, 'longPosition'),
      { id: 'note', type: 'text', anchors: [{ timeMs: 1, price: '5' }] },
    ])
    expect(levels.size).toBe(4)
    expect(Math.min(levels.get('line')!, levels.get('note')!)).toBeGreaterThan(Math.max(levels.get('big')!, levels.get('pos')!))
    expect(levels.get('pos')!).toBeGreaterThan(levels.get('big')!)
  })
})
