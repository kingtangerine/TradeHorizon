import { MARKET_INTERVALS, isMarketInterval, type MarketInterval } from '../market'

// Split view: a chart tab can show 2, 3 or 4 charts at once. The tab itself is always pane 0
// (its `symbol` and `interval`), so everything that already reads a tab keeps working; the other
// panes live in `tab.split`.

export const SPLIT_COUNTS = [2, 3, 4] as const
export type SplitCount = (typeof SPLIT_COUNTS)[number]

export interface PaneSpec {
  readonly symbol: string
  readonly interval: MarketInterval
}

export interface TabSplit {
  readonly count: SplitCount
  /** Panes 1 to count - 1; pane 0 is the tab's own symbol and interval. */
  readonly panes: readonly PaneSpec[]
  /** Which pane the toolbar, drawing tools and panels act on. */
  readonly active: number
}

export interface PaneTab {
  readonly symbol: string
  readonly interval: MarketInterval
  readonly split?: TabSplit
}

/** Timeframes offered as defaults for new panes, shortest to longest. */
const LADDER: readonly MarketInterval[] = ['5m', '15m', '1h', '4h', '1d']

export function paneCount(tab: PaneTab): number {
  return tab.split?.count ?? 1
}

export function activePaneIndex(tab: PaneTab): number {
  return tab.split ? Math.min(tab.split.active, tab.split.count - 1) : 0
}

export function paneOf(tab: PaneTab, index: number): PaneSpec {
  if (index > 0 && tab.split?.panes[index - 1]) return tab.split.panes[index - 1]
  return { symbol: tab.symbol, interval: tab.interval }
}

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
    if (!taken.has(interval)) { taken.add(interval); panes.push({ symbol: base.symbol, interval }) }
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
  const panes = existing.length >= wanted
    ? existing.slice(0, wanted)
    : [...existing, ...defaultPanes({ symbol: tab.symbol, interval: tab.interval }, count).slice(existing.length)]
  return { ...tab, split: { count, panes, active: Math.min(tab.split?.active ?? 0, count - 1) } }
}

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
  const raw = value as { count?: unknown, panes?: unknown, active?: unknown }
  if (!SPLIT_COUNTS.includes(raw.count as SplitCount)) return undefined
  const count = raw.count as SplitCount
  const stored = Array.isArray(raw.panes) ? raw.panes : []
  const panes: PaneSpec[] = []
  for (let index = 0; index < count - 1; index += 1) {
    const item = stored[index] as { symbol?: unknown, interval?: unknown } | undefined
    panes.push(
      typeof item?.symbol === 'string' && /^[A-Za-z0-9.]{2,30}$/.test(item.symbol) && isMarketInterval(item.interval)
        ? { symbol: item.symbol, interval: item.interval }
        : fallback,
    )
  }
  const active = typeof raw.active === 'number' && Number.isInteger(raw.active) ? Math.min(Math.max(raw.active, 0), count - 1) : 0
  return { count, panes, active }
}
