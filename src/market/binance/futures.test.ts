import { describe, expect, it } from 'vitest'
import { exchangeSymbol, fundingCountdown, parseBinanceFuturesListings } from './futures'

describe('Binance perpetuals', () => {
  it('lists trading USDT perpetuals with a .P suffix and skips the rest', () => {
    const listings = parseBinanceFuturesListings({
      symbols: [
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          status: 'TRADING',
          contractType: 'PERPETUAL',
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.10' },
            { filterType: 'LOT_SIZE', stepSize: '0.001' },
          ],
        },
        { symbol: 'BTCUSDT_261225', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', contractType: 'CURRENT_QUARTER' },
        { symbol: 'ETHUSDC', baseAsset: 'ETH', quoteAsset: 'USDC', status: 'TRADING', contractType: 'PERPETUAL' },
        { symbol: 'OLDUSDT', baseAsset: 'OLD', quoteAsset: 'USDT', status: 'SETTLING', contractType: 'PERPETUAL' },
        { symbol: 'BTCDOMUSDT', baseAsset: 'BTCDOM', quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL' },
      ],
    })
    expect(listings).toEqual([
      { exchange: 'binance-futures', symbol: 'BTCUSDT.P', baseAsset: 'BTC', pricePrecision: 1, volumePrecision: 3 },
    ])
  })

  it('strips the suffix only for requests', () => {
    expect(exchangeSymbol('BTCUSDT.P')).toBe('BTCUSDT')
    expect(exchangeSymbol('BTCUSDT')).toBe('BTCUSDT')
  })

  it('counts down to the next funding', () => {
    expect(fundingCountdown(10_000 + 3_725_000, 10_000)).toBe('01:02:05')
    expect(fundingCountdown(5, 10)).toBe('now')
  })
})
