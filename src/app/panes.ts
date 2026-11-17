import { MARKET_INTERVALS, isMarketInterval, type MarketInterval } from '../market'

// Split view: a chart tab can show 2, 3 or 4 charts at once. The tab itself is always pane 0
// (its `symbol` and `interval`), so everything that already reads a tab keeps working; the other
// panes live in `tab.split`.

/** Number of charts a split tab can show. */
export const SPLIT_COUNTS = [2, 3, 4] as const
/** Number of charts in a split tab. */
export type SplitCount = (typeof SPLIT_COUNTS)[number]

/** What one pane of a split shows. */
export interface PaneSpec {
  readonly symbol: string
  readonly interval: MarketInterval
}

/** The split layout of a chart tab. */
export interface TabSplit {
  readonly count: SplitCount
  /** Panes 1 to count - 1; pane 0 is the tab's own symbol and interval. */
  readonly panes: readonly PaneSpec[]
  /** Which pane the toolbar, drawing tools and panels act on. */
  readonly active: number
  /** What the charts of this tab share (TradingView's "Sync in layout"). */
  readonly sync?: SplitSync
}

/** Which settings the panes of a split share. */
export interface SplitSync {
  readonly symbol?: boolean
  readonly interval?: boolean
  readonly crosshair?: boolean
  readonly time?: boolean
}

/** Everything a split can sync, in display order. */
export const SYNC_KEYS = ['symbol', 'interval', 'crosshair', 'time'] as const

/** Changes one pane; a synced symbol or timeframe goes to every pane of the tab. */
export function withSyncedPaneChange<T extends PaneTab>(tab: T, index: number, changes: Partial<PaneSpec>): T {
  const sync = tab.split?.sync
  if (!tab.split || !sync || (!(sync.symbol && changes.symbol) && !(sync.interval && changes.interval)))
    return withPaneChange(tab, index, changes)
  const shared: Partial<PaneSpec> = {
    ...(sync.symbol && changes.symbol ? { symbol: changes.symbol } : {}),
    ...(sync.interval && changes.interval ? { interval: changes.interval } : {}),
  }
  let next = withPaneChange(tab, index, changes)
  for (let pane = 0; pane < tab.split.count; pane += 1) if (pane !== index) next = withPaneChange(next, pane, shared)
  return next
}

/** Turns syncing of one setting on or off. Returns the tab unchanged when it is not split. */
export function withSplitSync<T extends PaneTab>(tab: T, key: (typeof SYNC_KEYS)[number], on: boolean): T {
  if (!tab.split) return tab
  const sync = { ...tab.split.sync, [key]: on }
  for (const item of SYNC_KEYS) if (!sync[item]) delete sync[item]
  const { sync: _previous, ...rest } = tab.split
  return { ...tab, split: Object.keys(sync).length > 0 ? { ...rest, sync } : rest }
}

/** The parts of a chart tab that the split view reads. */
export interface PaneTab {
  readonly symbol: string
  readonly interval: MarketInterval
  readonly split?: TabSplit
}

/** Timeframes offered as defaults for new panes, shortest to longest. */
const LADDER: readonly MarketInterval[] = ['5m', '15m', '1h', '4h', '1d']

/** Number of charts the tab shows (1 when not split). */
export function paneCount(tab: PaneTab): number {
  return tab.split?.count ?? 1
}

/** Index of the pane the toolbar acts on (0 when not split). */
export function activePaneIndex(tab: PaneTab): number {
  return tab.split ? Math.min(tab.split.active, tab.split.count - 1) : 0
}

/** Symbol and timeframe of one pane; pane 0, or a missing pane, is the tab itself. */
export function paneOf(tab: PaneTab, index: number): PaneSpec {
  if (index > 0 && tab.split?.panes[index - 1]) return tab.split.panes[index - 1]
  return { symbol: tab.symbol, interval: tab.interval }
}

/** Symbol and timeframe of every pane, pane 0 first. */
export function panesOf(tab: PaneTab): PaneSpec[] {
  return Array.from({ length: paneCount(tab) }, (_, index) => paneOf(tab, index))
}

/** New panes start on the same symbol with progressively longer timeframes, so a split is a multi-timeframe view. */
export function defaultPanes(base: PaneSpec, count: number): PaneSpec[] {
  const taken = new Set<MarketInterval>([base.interval])
  const longer = LADDER.filter((interval) => MARKET_INTERVALS.indexOf(interval) > MARKET_INTERVALS.indexOf(base.interval))
  const shorter = [...LADDER].reverse().filter((interval) => MARKET_INTERVALS.indexOf(interval) < MARKET_INTERVALS.indexOf(base.interval))
  const panes: PaneSpec[] = []
  for (const interval of [...longer, ...shorter]) {
    if (panes.length >= count - 1) break
    if (!taken.has(interval)) {
      taken.add(interval)
      panes.push({ symbol: base.symbol, interval })
    }
  }
  while (panes.length < count - 1) panes.push({ symbol: base.symbol, interval: base.interval })
  return panes
}

/** Switches a tab to `count` charts (1 returns to a single chart). Existing extra panes are kept when growing. */
export function withPaneCount<T extends PaneTab>(tab: T, count: 1 | SplitCount): T {
  if (count === 1) {
    const { split: _split, ...rest } = tab
    return rest as T
  }
  const existing = tab.split?.panes ?? []
  const wanted = count - 1
  const panes =
    existing.length >= wanted
      ? existing.slice(0, wanted)
      : [...existing, ...defaultPanes({ symbol: tab.symbol, interval: tab.interval }, count).slice(existing.length)]
  return { ...tab, split: { count, panes, active: Math.min(tab.split?.active ?? 0, count - 1) } }
}

/** Makes another pane the active one. Returns the tab unchanged for an invalid or already active index. */
export function withActivePane<T extends PaneTab>(tab: T, index: number): T {
  if (!tab.split || index === tab.split.active || index < 0 || index >= tab.split.count) return tab
  return { ...tab, split: { ...tab.split, active: index } }
}

/** Changes the symbol and/or timeframe of one pane. */
export function withPaneChange<T extends PaneTab>(tab: T, index: number, changes: Partial<PaneSpec>): T {
  if (index === 0 || !tab.split) return { ...tab, ...changes }
  const panes = tab.split.panes.map((pane, position) => (position === index - 1 ? { ...pane, ...changes } : pane))
  return { ...tab, split: { ...tab.split, panes } }
}

/** Reads a stored split, dropping anything that is not valid. */
export function parseSplit(value: unknown, fallback: PaneSpec): TabSplit | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as { count?: unknown; panes?: unknown; active?: unknown }
  if (!SPLIT_COUNTS.includes(raw.count as SplitCount)) return undefined
  const count = raw.count as SplitCount
  const stored = Array.isArray(raw.panes) ? raw.panes : []
  const panes: PaneSpec[] = []
  for (let index = 0; index < count - 1; index += 1) {
    const item = stored[index] as { symbol?: unknown; interval?: unknown } | undefined
    panes.push(
      typeof item?.symbol === 'string' && /^[A-Za-z0-9.]{2,30}$/.test(item.symbol) && isMarketInterval(item.interval)
        ? { symbol: item.symbol, interval: item.interval }
        : fallback,
    )
  }
  const active = typeof raw.active === 'number' && Number.isInteger(raw.active) ? Math.min(Math.max(raw.active, 0), count - 1) : 0
  const storedSync = (raw as { sync?: Record<string, unknown> }).sync
  const sync: Record<string, boolean> = {}
  for (const key of SYNC_KEYS) if (storedSync?.[key] === true) sync[key] = true
  return { count, panes, active, ...(Object.keys(sync).length > 0 ? { sync } : {}) }
}
