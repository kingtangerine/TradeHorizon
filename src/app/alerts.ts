export type AlertDirection = 'above' | 'below'

export interface PriceAlert {
  readonly id: string
  readonly symbol: string
  readonly targetPrice: number
  readonly direction: AlertDirection
  readonly enabled: boolean
  readonly createdAtMs: number
  readonly triggeredAtMs?: number
  /** Price at the moment the alert triggered (seen by the server, or by the app while open). */
  readonly triggeredPrice?: number
}

function key(userId: string): string {
  return `trade-horizon:user:${userId}:alerts:v1`
}

export function loadAlerts(userId: string): PriceAlert[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is PriceAlert => (
      typeof item === 'object' && item !== null &&
      typeof (item as PriceAlert).id === 'string' &&
      typeof (item as PriceAlert).symbol === 'string' &&
      typeof (item as PriceAlert).targetPrice === 'number'
    )) : []
  } catch {
    return []
  }
}

export function saveAlerts(userId: string, alerts: readonly PriceAlert[]): void {
  localStorage.setItem(key(userId), JSON.stringify(alerts))
}

export function alertReached(alert: PriceAlert, price: number): boolean {
  return alert.direction === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice
}

export type AlertFilter = 'active' | 'triggered' | 'all'

export const isTriggered = (alert: PriceAlert): boolean => typeof alert.triggeredAtMs === 'number'

export interface AlertGroup {
  readonly symbol: string
  readonly alerts: readonly PriceAlert[]
}

/**
 * Alerts for the side panel: filtered (active = not triggered, paused included), searched by symbol, and grouped
 * per symbol. The chart's own symbol comes first, then A to Z; inside a group the highest target is on top.
 */
export function groupAlerts(alerts: readonly PriceAlert[], filter: AlertFilter, query: string, currentSymbol: string): AlertGroup[] {
  const needle = query.trim().toUpperCase()
  const groups = new Map<string, PriceAlert[]>()
  for (const alert of alerts) {
    if (filter === 'active' && isTriggered(alert)) continue
    if (filter === 'triggered' && !isTriggered(alert)) continue
    if (needle && !alert.symbol.toUpperCase().includes(needle)) continue
    groups.set(alert.symbol, [...(groups.get(alert.symbol) ?? []), alert])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === currentSymbol ? -1 : b === currentSymbol ? 1 : a.localeCompare(b)))
    .map(([symbol, list]) => ({
      symbol,
      alerts: filter === 'triggered'
        ? [...list].sort((a, b) => (b.triggeredAtMs ?? 0) - (a.triggeredAtMs ?? 0))
        : [...list].sort((a, b) => b.targetPrice - a.targetPrice),
    }))
}

/** Moving an alert line re-arms it on the side of the price it is now on. */
export function moveAlert(alert: PriceAlert, targetPrice: number, lastPrice: number | undefined): PriceAlert {
  const { triggeredAtMs: _triggered, triggeredPrice: _price, ...rest } = alert
  const direction: AlertDirection = lastPrice !== undefined ? (targetPrice < lastPrice ? 'below' : 'above') : alert.direction
  return { ...rest, targetPrice, direction, enabled: true }
}
