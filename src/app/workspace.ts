import type { MarketInterval } from '../market'

export interface ChartTab {
  readonly id: string
  readonly symbol: string
  readonly interval: MarketInterval
  readonly createdAtMs: number
}

export interface UserWorkspace {
  readonly tabs: readonly ChartTab[]
  readonly activeTabId: string
}

const DEFAULT_INTERVAL: MarketInterval = '15m'

function defaultWorkspace(): UserWorkspace {
  const id = crypto.randomUUID()
  return {
    tabs: [{ id, symbol: 'BTCUSDT', interval: DEFAULT_INTERVAL, createdAtMs: Date.now() }],
    activeTabId: id,
  }
}

export function workspaceKey(userId: string): string {
  return `trade-horizon:user:${userId}:workspace:v1`
}

export function loadWorkspace(userId: string): UserWorkspace {
  try {
    const value = JSON.parse(localStorage.getItem(workspaceKey(userId)) ?? 'null') as UserWorkspace | null
    if (!value || !Array.isArray(value.tabs) || value.tabs.length === 0) return defaultWorkspace()
    const activeTabId = value.tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : value.tabs[0].id
    return { tabs: value.tabs, activeTabId }
  } catch {
    return defaultWorkspace()
  }
}

export function saveWorkspace(userId: string, workspace: UserWorkspace): void {
  localStorage.setItem(workspaceKey(userId), JSON.stringify(workspace))
}
