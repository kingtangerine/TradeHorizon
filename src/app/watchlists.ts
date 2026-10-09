// Watchlists: named lists of symbols to monitor, with an optional color flag per symbol.
// Stored per user and synced with the rest of the account's data.

export const FLAGS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type Flag = (typeof FLAGS)[number]

export interface WatchItem {
  readonly symbol: string
  readonly flag?: Flag
}

export interface Watchlist {
  readonly id: string
  readonly name: string
  readonly items: readonly WatchItem[]
}

export interface WatchlistState {
  readonly lists: readonly Watchlist[]
  readonly activeId: string
}

export const MAX_LISTS = 20
export const MAX_ITEMS = 200

export function watchlistKey(userId: string): string {
  return `trade-horizon:user:${userId}:watchlists:v1`
}

export function defaultWatchlists(): WatchlistState {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BTC.D', 'USDT.D', 'OTHERS']
  return { lists: [{ id: 'default', name: 'Watchlist', items: symbols.map((symbol) => ({ symbol })) }], activeId: 'default' }
}

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, 40) || fallback
}

export function parseWatchlists(value: unknown): WatchlistState {
  if (typeof value !== 'object' || value === null) return defaultWatchlists()
  const raw = value as { lists?: unknown, activeId?: unknown }
  const lists: Watchlist[] = []
  if (Array.isArray(raw.lists)) {
    for (const entry of raw.lists) {
      if (typeof entry !== 'object' || entry === null) continue
      const { id, name, items } = entry as Record<string, unknown>
      if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(items) || lists.some((list) => list.id === id)) continue
      const seen = new Set<string>()
      const valid: WatchItem[] = []
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue
        const { symbol, flag } = item as Record<string, unknown>
        if (typeof symbol !== 'string' || !/^[A-Za-z0-9.]{2,30}$/.test(symbol) || seen.has(symbol)) continue
        seen.add(symbol)
        valid.push(FLAGS.includes(flag as Flag) ? { symbol, flag: flag as Flag } : { symbol })
      }
      lists.push({ id, name: name.slice(0, 40), items: valid.slice(0, MAX_ITEMS) })
    }
  }
  if (lists.length === 0) return defaultWatchlists()
  const activeId = lists.some((list) => list.id === raw.activeId) ? (raw.activeId as string) : lists[0].id
  return { lists: lists.slice(0, MAX_LISTS), activeId }
}

export function loadWatchlists(userId: string): WatchlistState {
  try {
    return parseWatchlists(JSON.parse(localStorage.getItem(watchlistKey(userId)) ?? 'null'))
  } catch {
    return defaultWatchlists()
  }
}

export function saveWatchlists(userId: string, state: WatchlistState): void {
  try {
    localStorage.setItem(watchlistKey(userId), JSON.stringify(state))
  } catch {
    // Storage full or blocked: lists are simply not remembered.
  }
}

export function activeList(state: WatchlistState): Watchlist {
  return state.lists.find((list) => list.id === state.activeId) ?? state.lists[0]
}

function updateActive(state: WatchlistState, change: (list: Watchlist) => Watchlist): WatchlistState {
  return { ...state, lists: state.lists.map((list) => (list.id === state.activeId ? change(list) : list)) }
}

export function addSymbol(state: WatchlistState, symbol: string): WatchlistState {
  return updateActive(state, (list) => (
    list.items.some((item) => item.symbol === symbol) || list.items.length >= MAX_ITEMS
      ? list
      : { ...list, items: [...list.items, { symbol }] }
  ))
}

export function removeSymbol(state: WatchlistState, symbol: string): WatchlistState {
  return updateActive(state, (list) => ({ ...list, items: list.items.filter((item) => item.symbol !== symbol) }))
}

/** Cycles a symbol's flag: none, then each color, then none again. */
export function cycleFlag(state: WatchlistState, symbol: string): WatchlistState {
  return updateActive(state, (list) => ({
    ...list,
    items: list.items.map((item) => {
      if (item.symbol !== symbol) return item
      const next = item.flag === undefined ? 0 : FLAGS.indexOf(item.flag) + 1
      return next >= FLAGS.length ? { symbol } : { symbol, flag: FLAGS[next] }
    }),
  }))
}

export function createList(state: WatchlistState, name: string, id: string = crypto.randomUUID()): WatchlistState {
  if (state.lists.length >= MAX_LISTS) return state
  return { lists: [...state.lists, { id, name: cleanName(name, 'New list'), items: [] }], activeId: id }
}

export function renameList(state: WatchlistState, id: string, name: string): WatchlistState {
  return { ...state, lists: state.lists.map((list) => (list.id === id ? { ...list, name: cleanName(name, list.name) } : list)) }
}

/** The last remaining list cannot be deleted. */
export function deleteList(state: WatchlistState, id: string): WatchlistState {
  if (state.lists.length <= 1) return state
  const lists = state.lists.filter((list) => list.id !== id)
  return { lists, activeId: state.activeId === id ? lists[0].id : state.activeId }
}

export function setActiveList(state: WatchlistState, id: string): WatchlistState {
  return state.lists.some((list) => list.id === id) ? { ...state, activeId: id } : state
}

export interface WatchQuote {
  readonly last: number
  readonly change: number
  readonly changePercent: number
}

export type SortKey = 'manual' | 'symbol' | 'last' | 'changePercent'
export type SortDirection = 'asc' | 'desc'

/** Display order. `manual` keeps the saved order; symbols without a quote sort last. */
export function sortItems(
  items: readonly WatchItem[],
  quotes: Readonly<Record<string, WatchQuote | undefined>>,
  key: SortKey,
  direction: SortDirection,
): WatchItem[] {
  if (key === 'manual') return [...items]
  const sign = direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    if (key === 'symbol') return sign * a.symbol.localeCompare(b.symbol)
    const left = quotes[a.symbol]?.[key]
    const right = quotes[b.symbol]?.[key]
    if (left === undefined && right === undefined) return 0
    if (left === undefined) return 1
    if (right === undefined) return -1
    return sign * (left - right)
  })
}
