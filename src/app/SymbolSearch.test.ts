import { describe, expect, it } from 'vitest'
import { CRYPTO_MARKETS, type CryptoMarket } from '../chart/markets'
import { matchMarkets } from './SymbolSearch'

function listed(baseAsset: string, name = baseAsset): CryptoMarket {
  return { ...CRYPTO_MARKETS[0], symbol: `${baseAsset}USDT`, baseAsset, name }
}

describe('matchMarkets', () => {
  it('returns every market for an empty query', () => {
    expect(matchMarkets('  ', CRYPTO_MARKETS)).toHaveLength(CRYPTO_MARKETS.length)
  })

  it('matches by ticker, name, and slash-separated pair', () => {
    expect(matchMarkets('btcusdt', CRYPTO_MARKETS).map((item) => item.symbol)).toEqual(['BTCUSDT'])
    expect(matchMarkets('ethereum', CRYPTO_MARKETS).map((item) => item.symbol)).toEqual(['ETHUSDT'])
    expect(matchMarkets('sol / usdt', CRYPTO_MARKETS).map((item) => item.symbol)).toEqual(['SOLUSDT'])
  })

  it('returns nothing when no market matches', () => {
    expect(matchMarkets('zzzz', CRYPTO_MARKETS)).toEqual([])
  })

  it('ranks exact ticker, then prefix, then substring matches', () => {
    const markets = [listed('WBTC'), listed('BTCDOM'), listed('BTC', 'Bitcoin'), listed('ABTCX')]
    expect(matchMarkets('btc', markets).map((item) => item.baseAsset)).toEqual(['BTC', 'BTCDOM', 'WBTC', 'ABTCX'])
  })
})
