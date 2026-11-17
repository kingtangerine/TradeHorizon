import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetchLastPrices } from './alerts.ts'
import { createMarketService, mergeAllListings } from './markets.ts'
import { parseBitget, parseBybitLinear, parseGate, parseOkx } from './venues.ts'

describe('other exchanges in the catalog', () => {
  it('names pairs by exchange and keeps the exchange symbol', () => {
    expect(
      parseOkx(
        { data: [{ state: 'live', quoteCcy: 'USDT', baseCcy: 'BTC', instId: 'BTC-USDT', tickSz: '0.1', lotSz: '0.00001' }] },
        false,
      )[0],
    ).toEqual({ exchange: 'okx', symbol: 'OKX:BTCUSDT', baseAsset: 'BTC', apiSymbol: 'BTC-USDT', pricePrecision: 1, volumePrecision: 5 })
    expect(
      parseOkx(
        {
          data: [
            { state: 'live', settleCcy: 'USDT', ctType: 'linear', ctValCcy: 'ETH', instId: 'ETH-USDT-SWAP', tickSz: '0.01', lotSz: '1' },
          ],
        },
        true,
      )[0].symbol,
    ).toBe('OKX:ETHUSDT.P')
    expect(
      parseGate(
        [{ trade_status: 'tradable', quote: 'USDT', base: 'SWARMS', id: 'SWARMS_USDT', precision: 5, amount_precision: 1 }],
        false,
      )[0],
    ).toMatchObject({ symbol: 'GATE:SWARMSUSDT', apiSymbol: 'SWARMS_USDT' })
    expect(
      parseGate(
        [
          { status: 'trading', in_delisting: false, name: 'BTC_USDT', order_price_round: '0.1' },
          { status: 'trading', in_delisting: true, name: 'OLD_USDT' },
        ],
        true,
      ).map((item) => item.symbol),
    ).toEqual(['GATE:BTCUSDT.P'])
    expect(
      parseBitget(
        { data: [{ symbolStatus: 'normal', quoteCoin: 'USDT', baseCoin: 'SOL', symbol: 'SOLUSDT', pricePlace: '3', volumePlace: '1' }] },
        true,
      )[0],
    ).toMatchObject({ symbol: 'BITGET:SOLUSDT.P', pricePrecision: 3 })
    expect(
      parseBybitLinear({
        result: {
          list: [
            {
              status: 'Trading',
              contractType: 'LinearPerpetual',
              quoteCoin: 'USDT',
              baseCoin: 'SWARMS',
              symbol: 'SWARMSUSDT',
              priceFilter: { tickSize: '0.0001' },
              lotSizeFilter: { qtyStep: '1' },
            },
          ],
        },
      })[0].symbol,
    ).toBe('BYBIT:SWARMSUSDT.P')
  })

  it('lists a Bybit pair Binance also has as BYBIT:…, and keeps Bybit-only pairs plain', () => {
    const merged = mergeAllListings(
      [{ symbol: 'BTCUSDT', baseAsset: 'BTC' }],
      [
        { exchange: 'bybit', symbol: 'BTCUSDT', baseAsset: 'BTC' },
        { exchange: 'bybit', symbol: 'ZETAUSDT', baseAsset: 'ZETA' },
      ],
      [{ exchange: 'binance-futures', symbol: 'BTCUSDT.P', baseAsset: 'BTC' }],
      [{ exchange: 'okx', symbol: 'OKX:BTCUSDT', baseAsset: 'BTC', apiSymbol: 'BTC-USDT' }],
    )
    expect(merged.map((item) => item.symbol)).toEqual(['BTCUSDT', 'BTCUSDT.P', 'BYBIT:BTCUSDT', 'ZETAUSDT', 'OKX:BTCUSDT'])
    expect(merged[2].apiSymbol).toBe('BTCUSDT')
  })

  it('finds where a symbol trades and the exchange symbol for it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'th-venues-'))
    try {
      const service = createMarketService({
        dataDir: dir,
        fetchImpl: async () => {
          throw new Error('offline')
        },
        log: {},
      })
      expect(service.apiSymbolOf('BYBIT:SOLUSDT.P')).toBe('SOLUSDT')
      expect(service.exchangeOf('SOLUSDT.P')).toBe('binance-futures')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fetches alert prices with one ticker request per exchange', async () => {
    const urls: string[] = []
    const prices = await fetchLastPrices(
      { okx: ['OKX:BTCUSDT', 'OKX:ETHUSDT'], 'gate-futures': ['GATE:SOLUSDT.P'] },
      async (url) => {
        urls.push(String(url))
        const body = String(url).includes('okx')
          ? {
              data: [
                { instId: 'BTC-USDT', last: '100' },
                { instId: 'ETH-USDT', last: '5' },
              ],
            }
          : [{ contract: 'SOL_USDT', last: '20' }]
        return { ok: true, json: async () => body }
      },
      (symbol: string) =>
        (({ 'OKX:BTCUSDT': 'BTC-USDT', 'OKX:ETHUSDT': 'ETH-USDT', 'GATE:SOLUSDT.P': 'SOL_USDT' }) as Record<string, string>)[symbol],
    )
    expect(urls).toHaveLength(2)
    expect(Object.fromEntries(prices)).toEqual({ 'OKX:BTCUSDT': 100, 'OKX:ETHUSDT': 5, 'GATE:SOLUSDT.P': 20 })
  })
})
