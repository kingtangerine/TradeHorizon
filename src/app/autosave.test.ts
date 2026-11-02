import { describe, expect, it } from 'vitest'
import { autosaveLayouts, type ChartTab, type SavedLayout, type UserWorkspace } from './workspace'

const tab = (id: string, symbol: string, layoutId?: string): ChartTab => ({ id, symbol, interval: '15m', createdAtMs: 1, ...(layoutId ? { layoutId } : {}) })
const layout = (id: string, tabs: ChartTab[], extra: Partial<SavedLayout> = {}): SavedLayout => ({
  id, name: id, tabs, activeTabId: tabs[0].id, volumeVisible: true, customIntervals: [], createdAtMs: 1, updatedAtMs: 1, ...extra,
})
const workspace = (tabs: ChartTab[], activeTabId: string, extra: Partial<UserWorkspace> = {}): UserWorkspace => ({
  tabs, activeTabId, layoutName: 'x', volumeVisible: true, customIntervals: [], ...extra,
})

describe('layout autosave', () => {
  const saved = [layout('A', [tab('a1', 'BTCUSDT')]), layout('B', [tab('b1', 'ETHUSDT')])]

  it('changes nothing when the open tabs match (reopening gives tabs new ids, which is not a change)', () => {
    const open = workspace([tab('new-1', 'BTCUSDT', 'A')], 'new-1')
    expect(autosaveLayouts(saved, open, 99)).toBe(saved)
  })

  it('saves a changed symbol, an added tab and the active tab into the open layout', () => {
    const open = workspace([tab('t1', 'SOLUSDT', 'A'), tab('t2', 'XRPUSDT', 'A'), tab('t3', 'DOGEUSDT')], 't2')
    const next = autosaveLayouts(saved, open, 99)
    expect(next[0]).toMatchObject({ id: 'A', activeTabId: 't2', updatedAtMs: 99 })
    expect(next[0].tabs.map((item) => item.symbol)).toEqual(['SOLUSDT', 'XRPUSDT'])
    expect(next[0].tabs[0]).not.toHaveProperty('layoutId')
    expect(next[1]).toBe(saved[1]) // not open: untouched
  })

  it('gives workspace-wide settings only to the layout of the active tab', () => {
    const open = workspace([tab('t1', 'BTCUSDT', 'A'), tab('t2', 'ETHUSDT', 'B')], 't1', { volumeVisible: false })
    const next = autosaveLayouts(saved, open, 99)
    expect(next[0]).toMatchObject({ volumeVisible: false, updatedAtMs: 99 })
    expect(next[1]).toBe(saved[1])
  })
})
