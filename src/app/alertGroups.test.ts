import { describe, expect, it } from 'vitest'
import { groupAlerts, moveAlert, type PriceAlert } from './alerts'

const alert = (id: string, symbol: string, targetPrice: number, extra: Partial<PriceAlert> = {}): PriceAlert => ({
  id, symbol, targetPrice, direction: 'above', enabled: true, createdAtMs: 1, ...extra,
})

const list = [
  alert('a', 'SOLUSDT', 150),
  alert('b', 'BTCUSDT', 90_000),
  alert('c', 'BTCUSDT', 100_000),
  alert('d', 'ETHUSDT', 3000, { enabled: false }),
  alert('e', 'BTCUSDT', 80_000, { enabled: false, triggeredAtMs: 50 }),
  alert('f', 'SOLUSDT', 120, { enabled: false, triggeredAtMs: 90 }),
]

describe('groupAlerts', () => {
  it('groups active alerts per symbol, the chart symbol first, highest target first', () => {
    const groups = groupAlerts(list, 'active', '', 'SOLUSDT')
    expect(groups.map((group) => group.symbol)).toEqual(['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
    expect(groups[1].alerts.map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('shows triggered alerts newest first, and filters by search', () => {
    expect(groupAlerts(list, 'triggered', '', 'BTCUSDT').flatMap((group) => group.alerts.map((item) => item.id))).toEqual(['e', 'f'])
    expect(groupAlerts(list, 'all', 'eth', 'BTCUSDT').map((group) => group.symbol)).toEqual(['ETHUSDT'])
    expect(groupAlerts(list, 'all', '', 'X').flatMap((group) => group.alerts)).toHaveLength(6)
  })
})

describe('moveAlert', () => {
  it('re-arms a moved alert on the side of the current price', () => {
    const moved = moveAlert(alert('x', 'BTCUSDT', 100, { enabled: false, triggeredAtMs: 5, triggeredPrice: 101 }), 90, 95)
    expect(moved).toEqual({ id: 'x', symbol: 'BTCUSDT', targetPrice: 90, direction: 'below', enabled: true, createdAtMs: 1 })
    expect(moveAlert(alert('y', 'BTCUSDT', 100), 120, 95).direction).toBe('above')
    expect(moveAlert(alert('z', 'BTCUSDT', 100, { direction: 'below' }), 120, undefined).direction).toBe('below')
  })
})
