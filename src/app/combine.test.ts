import { describe, expect, it } from 'vitest'
import { panesOf } from './panes'
import {
  combinedPanes,
  createSplitLayout,
  defaultSplitName,
  layoutSummary,
  shortSymbol,
  splitTabFromPanes,
  type SavedLayout,
} from './workspace'

const layout = (id: string, symbol: string, interval: SavedLayout['tabs'][number]['interval'], split?: SavedLayout['tabs'][number]['split']): SavedLayout => ({
  id,
  name: id,
  tabs: [{ id: `${id}-tab`, symbol, interval, createdAtMs: 1, ...(split ? { split } : {}) }],
  activeTabId: `${id}-tab`,
  volumeVisible: true,
  customIntervals: [],
  createdAtMs: 1,
  updatedAtMs: 1,
})

describe('combining saved layouts into a split view', () => {
  it('takes the active chart of each layout, in the order given', () => {
    const picked = [layout('a', 'ETHUSDT', '1h'), layout('b', 'BTCUSDT', '15m'), layout('c', 'SOLUSDT', '4h')]
    expect(combinedPanes(picked)).toEqual([
      { symbol: 'ETHUSDT', interval: '1h' },
      { symbol: 'BTCUSDT', interval: '15m' },
      { symbol: 'SOLUSDT', interval: '4h' },
    ])
  })

  it('uses only the main chart of a layout that is already a split', () => {
    const split = layout('s', 'BTCUSDT', '15m', { count: 2, panes: [{ symbol: 'ETHUSDT', interval: '1h' }], active: 1 })
    expect(combinedPanes([split])).toEqual([{ symbol: 'BTCUSDT', interval: '15m' }])
    expect(layoutSummary(split).charts).toBe(2)
    expect(layoutSummary(layout('x', 'BTCUSDT', '1h')).charts).toBe(1)
  })

  it('builds a split tab whose first chart is the tab itself', () => {
    const tab = splitTabFromPanes(combinedPanes([layout('a', 'ETHUSDT', '1h'), layout('b', 'BTCUSDT', '15m'), layout('c', 'SOLUSDT', '4h')]), 't1', 99)
    expect(tab).toMatchObject({ id: 't1', symbol: 'ETHUSDT', interval: '1h', createdAtMs: 99 })
    expect(tab.split).toEqual({
      count: 3,
      panes: [{ symbol: 'BTCUSDT', interval: '15m' }, { symbol: 'SOLUSDT', interval: '4h' }],
      active: 0,
    })
    expect(panesOf(tab)).toHaveLength(3)
  })

  it('names a split from its symbols, or from its timeframes when they all share one symbol', () => {
    expect(defaultSplitName([{ symbol: 'ETHUSDT', interval: '1h' }, { symbol: 'BTCUSDT', interval: '15m' }, { symbol: 'ETHUSDT', interval: '4h' }])).toBe('ETH · BTC')
    expect(defaultSplitName([{ symbol: 'BTCUSDT', interval: '15m' }, { symbol: 'BTCUSDT', interval: '1h' }])).toBe('BTC 15m · 1h')
    expect(shortSymbol('ETHBTC')).toBe('ETHBTC')
  })

  it('saves a split as a layout with its own tab id and no link to another layout', () => {
    const tab = { ...splitTabFromPanes([{ symbol: 'BTCUSDT', interval: '15m' }, { symbol: 'ETHUSDT', interval: '1h' }], 't1', 5), layoutId: 'other' }
    const saved = createSplitLayout('  My pair  ', tab, { volumeVisible: false, customIntervals: ['2h'] }, 7)
    expect(saved.name).toBe('My pair')
    expect(saved.tabs).toHaveLength(1)
    expect(saved.tabs[0].id).not.toBe('t1')
    expect(saved.tabs[0].layoutId).toBeUndefined()
    expect(saved.tabs[0].split?.count).toBe(2)
    expect(saved.activeTabId).toBe(saved.tabs[0].id)
    expect(saved).toMatchObject({ volumeVisible: false, customIntervals: ['2h'], createdAtMs: 7, updatedAtMs: 7 })
    expect(createSplitLayout('', tab, { volumeVisible: true, customIntervals: [] }, 7).name).toBe('BTC · ETH')
  })
})
