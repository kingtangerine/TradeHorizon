import { describe, expect, it, vi } from 'vitest'
import { broadcastCrosshair, broadcastTime, followerBarSpace, joinSyncGroup } from './chartSync'

describe('split-view sync hub', () => {
  it('passes a chart’s crosshair and time to the other charts of its group only', () => {
    const make = () => ({ syncedCrosshair: vi.fn(), syncedTime: vi.fn() })
    const a = make()
    const b = make()
    const other = make()
    const leaveA = joinSyncGroup('tab-1', a)
    joinSyncGroup('tab-1', b)
    joinSyncGroup('tab-2', other)
    broadcastCrosshair('tab-1', a, { timestamp: 1, price: 2, symbol: 'BTCUSDT' })
    expect(b.syncedCrosshair).toHaveBeenCalledWith({ timestamp: 1, price: 2, symbol: 'BTCUSDT' })
    expect(a.syncedCrosshair).not.toHaveBeenCalled()
    expect(other.syncedCrosshair).not.toHaveBeenCalled()
    leaveA()
    broadcastTime('tab-1', b, { centreTimeMs: 5, pixelsPerMs: 1 })
    expect(a.syncedTime).not.toHaveBeenCalled()
  })

  it('keeps the same time span on another timeframe', () => {
    // 10 px per 15-minute bar = 10 / 900000 px per ms; on 1h bars that is 40 px.
    expect(followerBarSpace({ centreTimeMs: 0, pixelsPerMs: 10 / 900_000 }, 3_600_000)).toBeCloseTo(40)
    expect(followerBarSpace({ centreTimeMs: 0, pixelsPerMs: 1 }, 3_600_000)).toBe(60)
  })
})
