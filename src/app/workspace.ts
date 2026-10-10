import { normalizeIndicators, type IndicatorSettings } from '../chart/indicators'
import { isMarketInterval, type MarketInterval } from '../market'
import { parseSplit, type TabSplit } from './panes'

export interface ChartTab {
  readonly id: string
  readonly symbol: string
  readonly interval: MarketInterval
  readonly createdAtMs: number
  readonly layoutId?: string
  /** Present when the tab shows 2 to 4 charts. The tab's own symbol and interval are the first chart. */
  readonly split?: TabSplit
}

export interface UserWorkspace {
  readonly tabs: readonly ChartTab[]
  readonly activeTabId: string
  readonly layoutName: string
  readonly activeLayoutId?: string
  readonly volumeVisible: boolean
  readonly customIntervals: readonly MarketInterval[]
  readonly indicators?: IndicatorSettings
  readonly magnet?: boolean
  /** Candles are the default; only the line choice is stored. */
  readonly chartType?: 'line'
}

export interface SavedLayout {
  readonly id: string
  readonly name: string
  readonly tabs: readonly ChartTab[]
  readonly activeTabId: string
  readonly volumeVisible: boolean
  readonly customIntervals: readonly MarketInterval[]
  readonly indicators?: IndicatorSettings
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly favorite?: boolean
}

export type LayoutSort = 'modified' | 'name' | 'created'

const DEFAULT_INTERVAL: MarketInterval = '15m'

export function createLayout(name: string, nowMs: number): SavedLayout {
  const tabId = crypto.randomUUID()
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled layout',
    tabs: [{ id: tabId, symbol: 'BTCUSDT', interval: DEFAULT_INTERVAL, createdAtMs: nowMs }],
    activeTabId: tabId,
    volumeVisible: true,
    customIntervals: [],
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
}

export function duplicateLayout(layout: SavedLayout, nowMs: number): SavedLayout {
  const idMap = new Map(layout.tabs.map((tab) => [tab.id, crypto.randomUUID()]))
  return {
    id: crypto.randomUUID(),
    name: `${layout.name} (copy)`.slice(0, 48),
    tabs: layout.tabs.map((tab) => ({ ...tab, id: idMap.get(tab.id) ?? tab.id })),
    activeTabId: idMap.get(layout.activeTabId) ?? layout.activeTabId,
    volumeVisible: layout.volumeVisible,
    customIntervals: layout.customIntervals,
    ...(layout.indicators ? { indicators: layout.indicators } : {}),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
}

export function layoutSummary(layout: SavedLayout): { symbol: string; interval: MarketInterval } {
  const tab = layout.tabs.find((item) => item.id === layout.activeTabId) ?? layout.tabs[0]
  return { symbol: tab.symbol, interval: tab.interval }
}

export function filterAndSortLayouts(
  layouts: readonly SavedLayout[],
  query: string,
  sort: LayoutSort,
): SavedLayout[] {
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? layouts.filter((layout) => (
        layout.name.toLowerCase().includes(needle) ||
        layout.tabs.some((tab) => tab.symbol.toLowerCase().includes(needle))
      ))
    : [...layouts]
  const order = (a: SavedLayout, b: SavedLayout): number => {
    if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    if (sort === 'created') return b.createdAtMs - a.createdAtMs
    return b.updatedAtMs - a.updatedAtMs
  }
  return matches.sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || order(a, b))
}

function defaultWorkspace(): UserWorkspace {
  const id = crypto.randomUUID()
  return {
    tabs: [{ id, symbol: 'BTCUSDT', interval: DEFAULT_INTERVAL, createdAtMs: Date.now() }],
    activeTabId: id,
    layoutName: 'Main layout',
    volumeVisible: true,
    customIntervals: [],
  }
}

export function adoptActiveLayout(workspace: UserWorkspace): UserWorkspace {
  const layoutId = workspace.activeLayoutId
  if (!layoutId || workspace.tabs.every((tab) => tab.layoutId)) return workspace
  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) => (tab.layoutId ? tab : { ...tab, layoutId })),
  }
}

export function workspaceKey(userId: string): string {
  return `trade-horizon:user:${userId}:workspace:v1`
}

export function layoutsKey(userId: string): string {
  return `trade-horizon:user:${userId}:layouts:v1`
}

function validTabs(value: unknown): ChartTab[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ChartTab => (
    typeof item === 'object' && item !== null &&
    typeof (item as ChartTab).id === 'string' &&
    typeof (item as ChartTab).symbol === 'string' &&
    isMarketInterval((item as ChartTab).interval) &&
    typeof (item as ChartTab).createdAtMs === 'number'
  )).map((tab) => {
    const { split, ...rest } = tab
    const valid = parseSplit(split, { symbol: tab.symbol, interval: tab.interval })
    return valid ? { ...rest, split: valid } : rest
  })
}

function validCustomIntervals(value: unknown): MarketInterval[] {
  return Array.isArray(value)
    ? value.filter((item, index): item is MarketInterval => (
        isMarketInterval(item) && value.indexOf(item) === index
      ))
    : []
}

export function loadWorkspace(userId: string): UserWorkspace {
  try {
    const value = JSON.parse(localStorage.getItem(workspaceKey(userId)) ?? 'null') as Partial<UserWorkspace> | null
    const tabs = validTabs(value?.tabs)
    if (!value || tabs.length === 0) return defaultWorkspace()
    const activeTabId = typeof value.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0].id
    return {
      tabs,
      activeTabId,
      layoutName: typeof value.layoutName === 'string' && value.layoutName.trim()
        ? value.layoutName.trim()
        : 'Main layout',
      ...(typeof value.activeLayoutId === 'string' ? { activeLayoutId: value.activeLayoutId } : {}),
      volumeVisible: value.volumeVisible !== false,
      customIntervals: validCustomIntervals(value.customIntervals),
      ...(value.indicators ? { indicators: normalizeIndicators(value.indicators) } : {}),
      ...(value.magnet === true ? { magnet: true } : {}),
      ...(value.chartType === 'line' ? { chartType: 'line' as const } : {}),
    }
  } catch {
    return defaultWorkspace()
  }
}

export function saveWorkspace(userId: string, workspace: UserWorkspace): void {
  localStorage.setItem(workspaceKey(userId), JSON.stringify(workspace))
}

export function loadSavedLayouts(userId: string): SavedLayout[] {
  try {
    const value = JSON.parse(localStorage.getItem(layoutsKey(userId)) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.flatMap((item): SavedLayout[] => {
      if (typeof item !== 'object' || item === null) return []
      const candidate = item as Partial<SavedLayout>
      const tabs = validTabs(candidate.tabs)
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.name !== 'string' ||
        tabs.length === 0 ||
        typeof candidate.createdAtMs !== 'number' ||
        typeof candidate.updatedAtMs !== 'number'
      ) return []
      const activeTabId = typeof candidate.activeTabId === 'string' && tabs.some((tab) => tab.id === candidate.activeTabId)
        ? candidate.activeTabId
        : tabs[0].id
      return [{
        id: candidate.id,
        name: candidate.name.trim() || 'Untitled layout',
        tabs,
        activeTabId,
        volumeVisible: candidate.volumeVisible !== false,
        customIntervals: validCustomIntervals(candidate.customIntervals),
        ...(candidate.indicators ? { indicators: normalizeIndicators(candidate.indicators) } : {}),
        createdAtMs: candidate.createdAtMs,
        updatedAtMs: candidate.updatedAtMs,
        ...(candidate.favorite === true ? { favorite: true } : {}),
      }]
    })
  } catch {
    return []
  }
}

export function saveSavedLayouts(userId: string, layouts: readonly SavedLayout[]): void {
  localStorage.setItem(layoutsKey(userId), JSON.stringify(layouts))
}
