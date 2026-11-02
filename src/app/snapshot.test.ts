import { describe, expect, it } from 'vitest'
import { snapshotFileName, snapshotValues } from './snapshot'

describe('chart image', () => {
  it('names the file after the symbol, timeframe and time in the chart time zone', () => {
    const at = Date.UTC(2026, 10, 2, 9, 45) // 09:45 UTC
    expect(snapshotFileName('BTCUSDT', '1h', at, 'UTC')).toBe('BTCUSDT_1h_2026-11-02_09-45.png')
    expect(snapshotFileName('BTCUSDT', '1h', at, 'Asia/Dubai')).toBe('BTCUSDT_1h_2026-11-02_13-45.png')
    expect(snapshotFileName('BTC.D', '1M', Date.UTC(2026, 0, 5, 23, 5), 'UTC')).toBe('BTC.D_1M_2026-01-05_23-05.png')
  })

  it('colours the prices by the candle and the change by its sign', () => {
    const parts = snapshotValues({ open: 100, high: 110, low: 95, close: 98, previousClose: 97 }, 2)
    expect(parts.map((part) => part.text)).toEqual(['O', '100.00', 'H', '110.00', 'L', '95.00', 'C', '98.00', '+1.00 (+1.03%)'])
    expect(parts[1].tone).toBe('down') // closed below its open
    expect(parts[8].tone).toBe('up') // but above the previous close
  })
})
