import { describe, expect, it } from 'vitest'
import { fetchVenueKlines, fetchVenueQuotes, groupRows } from './venues'

const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
const H = 3_600_000

describe('other exchanges', () => {
  it('reads OKX candles newest-first and uses the base-coin volume for swaps', async () => {
    const urls: string[] = []
    const candles = await fetchVenueKlines(
      {
        venue: 'okx-futures',
        apiSymbol: 'BTC-USDT-SWAP',
        symbol: 'OKX:BTCUSDT.P',
        marketId: 'okx:futures:BTCUSDT',
        interval: '1h',
        limit: 2,
      },
      (url) => {
        urls.push(String(url))
        return respond({
          data: [
            ['7200000', '2', '3', '1', '2.5', '500', '5', '12', '0'],
            ['3600000', '1', '2', '0.5', '2', '400', '4', '8', '1'],
          ],
        })
      },
    )
    expect(urls[0]).toContain('instId=BTC-USDT-SWAP&bar=1H')
    expect(candles.map((c) => [c.openTimeMs, c.close, c.volume])).toEqual([
      [3_600_000, '2', '4'],
      [7_200_000, '2.5', '5'],
    ])
    expect(candles[0].marketId).toBe('okx:futures:BTCUSDT')
  })

  it('builds 8h candles on OKX from 4h ones', async () => {
    const rows = [0, 4, 8, 12]
      .map((hour) => [String(hour * H), '1', String(hour + 2), '0.5', String(hour + 1), '10', '10', '10', '1'])
      .reverse()
    const candles = await fetchVenueKlines(
      { venue: 'okx', apiSymbol: 'BTC-USDT', symbol: 'OKX:BTCUSDT', marketId: 'okx:spot:BTCUSDT', interval: '8h', limit: 2 },
      (url) => (String(url).includes('after=') ? respond({ data: [] }) : respond({ data: rows })),
    )
    expect(candles.map((c) => [c.openTimeMs, c.high, c.close, c.volume])).toEqual([
      [0, '6', '5', '20'],
      [8 * H, '14', '13', '20'],
    ])
  })

  it('maps Gate spot columns and Gate futures volume', async () => {
    const spot = await fetchVenueKlines(
      { venue: 'gate', apiSymbol: 'BTC_USDT', symbol: 'GATE:BTCUSDT', marketId: 'gate:spot:BTCUSDT', interval: '1h', limit: 1 },
      () => respond([['3600', '1000', '10.5', '11', '9', '10', '95']]),
    )
    expect([spot[0].openTimeMs, spot[0].open, spot[0].high, spot[0].low, spot[0].close, spot[0].volume]).toEqual([
      3_600_000,
      '10',
      '11',
      '9',
      '10.5',
      '95',
    ])
    const futures = await fetchVenueKlines(
      {
        venue: 'gate-futures',
        apiSymbol: 'BTC_USDT',
        symbol: 'GATE:BTCUSDT.P',
        marketId: 'gate:futures:BTCUSDT',
        interval: '1h',
        limit: 1,
      },
      () => respond([{ t: 3600, o: '10', h: '11', l: '9', c: '10', sum: '500' }]),
    )
    expect(futures[0].volume).toBe('50')
  })

  it('starts built weeks on Monday and months on the 1st', () => {
    const monday = Date.UTC(2026, 10, 2)
    const weeks = groupRows(
      [monday - 86_400_000, monday, monday + 86_400_000].map((t) => ({ t, o: '1', h: '1', l: '1', c: '1', v: '1', q: '1' })),
      '1w',
    )
    expect(weeks.map((row) => new Date(row.t).toISOString().slice(0, 10))).toEqual(['2026-10-26', '2026-11-02'])
    const months = groupRows(
      [Date.UTC(2026, 9, 31), Date.UTC(2026, 10, 1)].map((t) => ({ t, o: '1', h: '1', l: '1', c: '1', v: '1', q: '1' })),
      '1M',
    )
    expect(months.map((row) => new Date(row.t).toISOString().slice(0, 10))).toEqual(['2026-10-01', '2026-11-01'])
  })

  it('reads 24h quotes in one request per exchange', async () => {
    const okx = await fetchVenueQuotes('okx', undefined, () => respond({ data: [{ instId: 'BTC-USDT', last: '110', open24h: '100' }] }))
    expect(okx.get('BTC-USDT')).toEqual({ last: 110, change: 10, changePercent: 10 })
    const gate = await fetchVenueQuotes('gate', undefined, () =>
      respond([{ currency_pair: 'ETH_USDT', last: '110', change_percentage: '10' }]),
    )
    expect(gate.get('ETH_USDT')?.change).toBeCloseTo(10)
  })
})
