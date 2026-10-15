import { describe, expect, it } from 'vitest'
import { compactMarketCaps } from './markets.mjs'

describe('market caps for the chart badge', () => {
  it('keeps symbol, name, cap, rank and volume from both pages and drops coins without a cap', () => {
    const pages = [
      [{ symbol: 'btc', name: 'Bitcoin', market_cap: 1.6e12, market_cap_rank: 1, total_volume: 3e10, image: 'x' }],
      [{ symbol: 'tiny', name: 'Tiny', market_cap: 0, market_cap_rank: null }, { symbol: 'pepe', name: 'Pepe', market_cap: 4e9, market_cap_rank: 40, total_volume: 1e9 }],
    ]
    expect(compactMarketCaps(pages)).toEqual([
      { s: 'BTC', n: 'Bitcoin', c: 1.6e12, r: 1, v: 3e10 },
      { s: 'PEPE', n: 'Pepe', c: 4e9, r: 40, v: 1e9 },
    ])
  })
})
