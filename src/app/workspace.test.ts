import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  layoutsKey,
  loadSavedLayouts,
  loadWorkspace,
  saveSavedLayouts,
  saveWorkspace,
  workspaceKey,
  type SavedLayout,
  type UserWorkspace,
} from './workspace'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('crypto', { randomUUID: () => 'generated-id' })
})

describe('workspace persistence', () => {
  it('migrates the previous workspace shape with safe defaults', () => {
    storage.setItem(workspaceKey('user-1'), JSON.stringify({
      tabs: [{ id: 'tab-1', symbol: 'BTCUSDT', interval: '15m', createdAtMs: 1 }],
      activeTabId: 'tab-1',
    }))

    expect(loadWorkspace('user-1')).toMatchObject({
      layoutName: 'Main layout',
      volumeVisible: true,
      customIntervals: [],
    })
  })

  it('round-trips current workspace preferences', () => {
    const workspace: UserWorkspace = {
      tabs: [{ id: 'tab-1', symbol: 'ETHUSDT', interval: '4h', createdAtMs: 1 }],
      activeTabId: 'tab-1',
      layoutName: 'Swing desk',
      activeLayoutId: 'layout-1',
      volumeVisible: false,
      customIntervals: ['12h'],
    }

    saveWorkspace('user-1', workspace)
    expect(loadWorkspace('user-1')).toEqual(workspace)
  })

  it('round-trips saved layouts and rejects invalid records', () => {
    const layout: SavedLayout = {
      id: 'layout-1',
      name: 'Intraday',
      tabs: [{ id: 'tab-1', symbol: 'SOLUSDT', interval: '5m', createdAtMs: 1 }],
      activeTabId: 'tab-1',
      volumeVisible: true,
      customIntervals: ['3m'],
      createdAtMs: 10,
      updatedAtMs: 20,
    }
    saveSavedLayouts('user-1', [layout])
    expect(loadSavedLayouts('user-1')).toEqual([layout])

    storage.setItem(layoutsKey('user-1'), JSON.stringify([{ nope: true }]))
    expect(loadSavedLayouts('user-1')).toEqual([])
  })
})
