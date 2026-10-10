import { describe, expect, it } from 'vitest'
import {
  activePaneIndex,
  defaultPanes,
  paneCount,
  paneOf,
  panesOf,
  parseSplit,
  withActivePane,
  withPaneChange,
  withPaneCount,
  type PaneTab,
} from './panes'

const tab: PaneTab = { symbol: 'BTCUSDT', interval: '15m' }

describe('split panes', () => {
  it('treats a tab without a split as one pane', () => {
    expect(paneCount(tab)).toBe(1)
    expect(activePaneIndex(tab)).toBe(0)
    expect(panesOf(tab)).toEqual([{ symbol: 'BTCUSDT', interval: '15m' }])
  })

  it('starts new panes on the same symbol with longer timeframes', () => {
    expect(defaultPanes({ symbol: 'BTCUSDT', interval: '15m' }, 4).map((pane) => pane.interval)).toEqual(['1h', '4h', '1d'])
    // at the long end it falls back to shorter ones, never repeating a timeframe
    expect(defaultPanes({ symbol: 'ETHUSDT', interval: '1d' }, 3).map((pane) => pane.interval)).toEqual(['4h', '1h'])
  })

  it('splits into 2, 3 or 4 charts and back, keeping pane 0 as the tab itself', () => {
    const two = withPaneCount(tab, 2)
    expect(paneCount(two)).toBe(2)
    expect(paneOf(two, 0)).toEqual({ symbol: 'BTCUSDT', interval: '15m' })
    expect(paneOf(two, 1)).toEqual({ symbol: 'BTCUSDT', interval: '1h' })
    const four = withPaneCount(two, 4)
    expect(panesOf(four).map((pane) => pane.interval)).toEqual(['15m', '1h', '4h', '1d'])
    const single = withPaneCount(four, 1)
    expect(single.split).toBeUndefined()
    expect(single.symbol).toBe('BTCUSDT')
  })

  it('keeps extra panes you already set when the count changes', () => {
    let current = withPaneCount(tab, 4)
    current = withPaneChange(current, 2, { symbol: 'ETHUSDT', interval: '5m' })
    const shrunk = withPaneCount(current, 3)
    expect(paneOf(shrunk, 2)).toEqual({ symbol: 'ETHUSDT', interval: '5m' })
    expect(withPaneCount(shrunk, 4).split?.panes[1]).toEqual({ symbol: 'ETHUSDT', interval: '5m' })
  })

  it('changes the main pane through the tab fields and others through the split', () => {
    const current = withPaneCount(tab, 3)
    expect(withPaneChange(current, 0, { symbol: 'SOLUSDT' }).symbol).toBe('SOLUSDT')
    const other = withPaneChange(current, 2, { interval: '1w' })
    expect(other.symbol).toBe('BTCUSDT')
    expect(paneOf(other, 2).interval).toBe('1w')
  })

  it('moves the active pane within range and clamps when shrinking', () => {
    let current = withActivePane(withPaneCount(tab, 4), 3)
    expect(activePaneIndex(current)).toBe(3)
    expect(withActivePane(current, 9)).toBe(current)
    current = withPaneCount(current, 2)
    expect(activePaneIndex(current)).toBe(1)
  })

  it('repairs invalid stored data', () => {
    const fallback = { symbol: 'BTCUSDT', interval: '15m' as const }
    expect(parseSplit('nope', fallback)).toBeUndefined()
    expect(parseSplit({ count: 7, panes: [] }, fallback)).toBeUndefined()
    expect(parseSplit({ count: 3, panes: [{ symbol: 'ETHUSDT', interval: '1h' }, { symbol: 5 }], active: 9 }, fallback)).toEqual({
      count: 3,
      panes: [{ symbol: 'ETHUSDT', interval: '1h' }, fallback],
      active: 2,
    })
  })
})
