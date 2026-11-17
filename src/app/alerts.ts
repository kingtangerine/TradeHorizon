import { conditionMet, isValidAlert, type AlertCondition, type AlertLineAnchors } from '../../server/alertRules.ts'

export type AlertDirection = 'above' | 'below'
export type { AlertCondition } from '../../server/alertRules.ts'

/** Conditions, trend lines, repeat, expiry and message are optional: older alerts are "crossing" a level, once. */
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
  readonly condition?: AlertCondition
  /** Other side of a channel (enter/exit channel). */
  readonly upperPrice?: number
  /** "Moving N%": the size of the move and the window it must happen in. */
  readonly percent?: number
  readonly windowMs?: number
  /** Trend-line alert: the target follows this line (market coordinates, extended past its points). */
  readonly line?: AlertLineAnchors
  readonly frequency?: 'once' | 'everyTime'
  readonly expiresAtMs?: number
  readonly message?: string
  /** "Every time" alerts stay active; their last trigger is recorded here. */
  readonly lastTriggeredAtMs?: number
  readonly lastTriggeredPrice?: number
  readonly triggerCount?: number
}

/** What the alert form chooses beyond symbol and price. */
export type AlertOptions = Pick<PriceAlert, 'targetPrice' | 'direction' | 'condition' | 'upperPrice' | 'percent' | 'windowMs' | 'line' | 'frequency' | 'expiresAtMs' | 'message'>

function key(userId: string): string {
  return `trade-horizon:user:${userId}:alerts:v1`
}

export function loadAlerts(userId: string): PriceAlert[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is PriceAlert => isValidAlert(item)) : []
  } catch {
    return []
  }
}

export function saveAlerts(userId: string, alerts: readonly PriceAlert[]): void {
  localStorage.setItem(key(userId), JSON.stringify(alerts))
}

export function alertReached(alert: PriceAlert, price: number): boolean {
  return conditionMet(alert, price, Date.now())
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
  // Only a crossing picks its side from where the price is; the other conditions keep their meaning.
  const crossing = (alert.condition ?? 'crossing') === 'crossing'
  const direction: AlertDirection = crossing && lastPrice !== undefined ? (targetPrice < lastPrice ? 'below' : 'above') : alert.direction
  return { ...rest, targetPrice, direction, enabled: true }
}
