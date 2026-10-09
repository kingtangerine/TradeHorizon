import { describe, expect, it } from 'vitest'
import {
  activeList,
  addSymbol,
  createList,
  cycleFlag,
  defaultWatchlists,
  deleteList,
  parseWatchlists,
  removeSymbol,
  renameList,
  setActiveList,
  sortItems,
  type WatchQuote,
} from './watchlists'

describe('watchlists', () => {
  it('starts with a default list', () => {
    const state = defaultWatchlists()
    expect(activeList(state).items.map((item) => item.symbol)).toContain('BTCUSDT')
  })

  it('adds a symbol once and removes it', () => {
    let state = createList(defaultWatchlists(), 'Alts', 'alts')
    state = addSymbol(state, 'ZETAUSDT')
    state = addSymbol(state, 'ZETAUSDT')
    expect(activeList(state).items).toEqual([{ symbol: 'ZETAUSDT' }])
    state = removeSymbol(state, 'ZETAUSDT')
    expect(activeList(state).items).toEqual([])
  })

  it('cycles the flag through every color and back to none', () => {
    let state = addSymbol(createList(defaultWatchlists(), 'x', 'x'), 'ETHUSDT')
    const seen: Array<string | undefined> = []
    for (let step = 0; step < 7; step += 1) {
      state = cycleFlag(state, 'ETHUSDT')
      seen.push(activeList(state).items[0].flag)
    }
    expect(seen).toEqual(['red', 'orange', 'yellow', 'green', 'blue', 'purple', undefined])
  })

  it('creates, renames, switches and deletes lists but keeps the last one', () => {
    let state = createList(defaultWatchlists(), '  Majors ', 'm')
    expect(state.activeId).toBe('m')
    state = renameList(state, 'm', 'Core')
    expect(state.lists.find((list) => list.id === 'm')?.name).toBe('Core')
    state = setActiveList(state, 'default')
    expect(state.activeId).toBe('default')
    state = deleteList(state, 'm')
    expect(state.lists).toHaveLength(1)
    expect(deleteList(state, 'default')).toBe(state)
  })

  it('moves to another list when the active one is deleted', () => {
    const state = deleteList(createList(defaultWatchlists(), 'B', 'b'), 'b')
    expect(state.activeId).toBe('default')
  })

  it('sorts by change with missing quotes last, and keeps manual order', () => {
    const items = [{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }, { symbol: 'D' }]
    const quote = (changePercent: number): WatchQuote => ({ last: 1, change: 0, changePercent })
    const quotes = { A: quote(1), B: quote(-3), D: quote(5) }
    expect(sortItems(items, quotes, 'changePercent', 'desc').map((item) => item.symbol)).toEqual(['D', 'A', 'B', 'C'])
    expect(sortItems(items, quotes, 'changePercent', 'asc').map((item) => item.symbol)).toEqual(['B', 'A', 'D', 'C'])
    expect(sortItems(items, quotes, 'manual', 'asc').map((item) => item.symbol)).toEqual(['A', 'B', 'C', 'D'])
    expect(sortItems(items, quotes, 'symbol', 'desc').map((item) => item.symbol)).toEqual(['D', 'C', 'B', 'A'])
  })

  it('repairs invalid stored data', () => {
    expect(parseWatchlists(null)).toEqual(defaultWatchlists())
    const parsed = parseWatchlists({
      lists: [{ id: 'a', name: 'ok', items: [{ symbol: 'BTCUSDT', flag: 'red' }, { symbol: 'BTCUSDT' }, { symbol: 5 }, { symbol: 'X Y' }, { symbol: 'ETHUSDT', flag: 'pink' }] }],
      activeId: 'gone',
    })
    expect(parsed.activeId).toBe('a')
    expect(parsed.lists[0].items).toEqual([{ symbol: 'BTCUSDT', flag: 'red' }, { symbol: 'ETHUSDT' }])
  })
})
