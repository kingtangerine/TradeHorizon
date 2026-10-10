import { describe, expect, it } from 'vitest'
import {
  adoptActiveLayout,
  createLayout,
  duplicateLayout,
  filterAndSortLayouts,
  layoutSummary,
  type SavedLayout,
  type UserWorkspace,
} from './workspace'

function layout(overrides: Partial<SavedLayout>): SavedLayout {
  return { ...createLayout('Base', 1000), ...overrides }
}

describe('layout helpers', () => {
  it('creates a layout with one default BTCUSDT tab', () => {
    const created = createLayout('  ', 5)
    expect(created.name).toBe('Untitled layout')
    expect(created.tabs).toHaveLength(1)
    expect(layoutSummary(created)).toEqual({ symbol: 'BTCUSDT', interval: '15m', charts: 1 })
  })

  it('duplicates with fresh ids and a copy name while keeping the active tab mapping', () => {
    const source = layout({ name: 'Swing' })
    const copy = duplicateLayout(source, 2000)
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Swing (copy)')
    expect(copy.tabs[0].id).not.toBe(source.tabs[0].id)
    expect(copy.activeTabId).toBe(copy.tabs[0].id)
    expect(copy.createdAtMs).toBe(2000)
  })

  it('puts favorites first, then sorts by the chosen order', () => {
    const a = layout({ name: 'Alpha', updatedAtMs: 10 })
    const b = layout({ name: 'Bravo', updatedAtMs: 30 })
    const c = layout({ name: 'Charlie', updatedAtMs: 20, favorite: true })
    expect(filterAndSortLayouts([a, b, c], '', 'modified').map((item) => item.name)).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect(filterAndSortLayouts([b, a], '', 'name').map((item) => item.name)).toEqual(['Alpha', 'Bravo'])
  })

  it('filters by layout name or symbol', () => {
    const a = layout({ name: 'Alpha' })
    const b = layout({ name: 'Bravo' })
    expect(filterAndSortLayouts([a, b], 'brav', 'name')).toEqual([b])
    expect(filterAndSortLayouts([a, b], 'btcusdt', 'name')).toHaveLength(2)
    expect(filterAndSortLayouts([a, b], 'zzz', 'name')).toEqual([])
  })

  it('adopts the previously active layout id onto untagged tabs only', () => {
    const base: UserWorkspace = {
      tabs: [
        { id: 'a', symbol: 'BTCUSDT', interval: '15m', createdAtMs: 1 },
        { id: 'b', symbol: 'ETHUSDT', interval: '1h', createdAtMs: 2, layoutId: 'other' },
      ],
      activeTabId: 'a',
      layoutName: 'Main layout',
      activeLayoutId: 'layout-1',
      volumeVisible: true,
      customIntervals: [],
    }
    expect(adoptActiveLayout(base).tabs.map((tab) => tab.layoutId)).toEqual(['layout-1', 'other'])
    const { activeLayoutId: _unused, ...unsaved } = base
    expect(adoptActiveLayout(unsaved)).toBe(unsaved)
  })
})
