export type AlertDirection = 'above' | 'below'

export interface PriceAlert {
  readonly id: string
  readonly symbol: string
  readonly targetPrice: number
  readonly direction: AlertDirection
  readonly enabled: boolean
  readonly createdAtMs: number
  readonly triggeredAtMs?: number
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
