import { describe, expect, it } from 'vitest'
import { baseOf, baseOfRaw, merge, mergeRaw } from './syncMerge'

const layout = (id: string, name = id, updatedAtMs = 1) => ({ id, name, updatedAtMs })
const ids = (value: unknown) => (value as Array<{ id: string }>).map((item) => item.id)

describe('merging lists of items (layouts, alerts, drawings)', () => {
  const base = [layout('a'), layout('b'), layout('c')]

  it('keeps layouts added on both devices (the 15 + 5 case)', () => {
    const desktop = [layout('d1'), layout('d2'), ...base]
    const laptop = [layout('l1'), ...base]
    const merged = merge(baseOf(base), laptop, desktop)
    expect(ids(merged).sort()).toEqual(['a', 'b', 'c', 'd1', 'd2', 'l1'])
  })

  it('takes the other side outright when only it changed', () => {
    const remote = [layout('new'), ...base]
    expect(merge(baseOf(base), base, remote)).toBe(remote)
    const local = base.slice(1)
    expect(merge(baseOf(base), local, base)).toBe(local)
  })

  it('removes an item deleted on one side and untouched on the other', () => {
    const laptop = [layout('a'), layout('c')] // deleted b
    const desktop = [layout('x'), ...base] // added x, b untouched
    expect(ids(merge(baseOf(base), laptop, desktop)).sort()).toEqual(['a', 'c', 'x'])
    expect(ids(merge(baseOf(base), desktop, laptop)).sort()).toEqual(['a', 'c', 'x'])
  })

  it('keeps an item that one side deleted but the other edited', () => {
    const laptop = [layout('a'), layout('c')]
    const desktop = [layout('a'), layout('b', 'renamed', 2), layout('c')]
    expect(ids(merge(baseOf(base), laptop, desktop)).sort()).toEqual(['a', 'b', 'c'])
  })

  it('merges an item changed on both sides field by field', () => {
    const start = [{ id: 'a', name: 'A', favorite: false, updatedAtMs: 1 }]
    const laptop = [{ id: 'a', name: 'Renamed', favorite: false, updatedAtMs: 2 }]
    const desktop = [{ id: 'a', name: 'A', favorite: true, updatedAtMs: 3 }]
    expect(merge(baseOf(start), laptop, desktop)).toEqual([{ id: 'a', name: 'Renamed', favorite: true, updatedAtMs: 2 }])
  })

  it('with no common base (first sync after the update) keeps everything from both sides', () => {
    const laptop = [layout('a'), layout('b')]
    const desktop = [layout('a'), layout('c')]
    expect(ids(merge(undefined, laptop, desktop)).sort()).toEqual(['a', 'b', 'c'])
  })

  it("keeps the server's order and places local additions next to their neighbours", () => {
    const local = [layout('new'), ...base]
    const remote = [layout('r'), ...base]
    expect(ids(merge(baseOf(base), local, remote))).toEqual(['new', 'r', 'a', 'b', 'c'])
  })
})

describe('merging nested documents', () => {
  it('merges drawings inside their envelope', () => {
    const start = { version: 1, drawings: [{ id: 'd1', anchors: [1] }] }
    const local = { version: 1, drawings: [{ id: 'd1', anchors: [1] }, { id: 'mine', anchors: [2] }] }
    const remote = { version: 1, drawings: [{ id: 'd1', anchors: [1] }, { id: 'theirs', anchors: [3] }] }
    const merged = merge(baseOf(start), local, remote) as typeof start
    expect(merged.drawings.map((drawing) => drawing.id).sort()).toEqual(['d1', 'mine', 'theirs'])
  })

  it('merges folders and their assignments', () => {
    const start = { groups: [{ id: 'g1', name: 'One' }], assignments: { x: 'g1' } }
    const local = { groups: [{ id: 'g1', name: 'One' }], assignments: { x: 'g1', y: 'g1' } }
    const remote = { groups: [{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }], assignments: { x: 'g1', z: 'g2' } }
    expect(merge(baseOf(start), local, remote)).toEqual({
      groups: [{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }],
      assignments: { x: 'g1', z: 'g2', y: 'g1' },
    })
  })

  it('merges lists of plain values such as watchlist symbols', () => {
    const start = { symbols: ['BTC', 'ETH'] }
    const merged = merge(baseOf(start), { symbols: ['BTC', 'ETH', 'SOL'] }, { symbols: ['BTC', 'XRP'] })
    expect(merged).toEqual({ symbols: ['BTC', 'SOL', 'XRP'] })
  })

  it('lets this device win a plain value changed on both sides, and the server win when there is no base', () => {
    expect(merge(baseOf('dark'), 'light', 'blue')).toBe('light')
    expect(merge(undefined, 'light', 'blue')).toBe('blue')
  })
})

describe('mergeRaw', () => {
  it('works on stored strings and returns an input unchanged when one side wins', () => {
    const base = JSON.stringify([layout('a')])
    const remote = JSON.stringify([layout('b'), layout('a')])
    expect(mergeRaw(baseOfRaw(base), base, remote)).toBe(remote)
    const merged = mergeRaw(baseOfRaw(base), JSON.stringify([layout('c'), layout('a')]), remote)
    expect(ids(JSON.parse(merged)).sort()).toEqual(['a', 'b', 'c'])
  })

  it('handles values that are not JSON (the theme is stored as a bare word)', () => {
    expect(mergeRaw(baseOfRaw('dark'), 'dark', 'light')).toBe('light')
    expect(mergeRaw(baseOfRaw('dark'), 'light', 'dark')).toBe('light')
    expect(mergeRaw(undefined, 'light', 'dark')).toBe('dark')
  })
})
