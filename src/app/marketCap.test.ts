import { describe, expect, it } from 'vitest'
import { capTier, coinSymbol, formatUsdCompact, indexMarketCaps } from './marketCap'

describe('market cap tiers', () => {
  it('puts coins in four tiers by size', () => {
    expect(capTier(1.6e12).tier).toBe(1)
    expect(capTier(50e9).tier).toBe(1)
    expect(capTier(49e9).tier).toBe(2)
    expect(capTier(10e9).tier).toBe(2)
    expect(capTier(2e9).tier).toBe(3)
    expect(capTier(900e6).tier).toBe(4)
    expect(capTier(undefined).tier).toBe(4)
  })

  it('formats dollar amounts compactly', () => {
    expect(formatUsdCompact(1_620_000_000_000)).toBe('$1.62T')
    expect(formatUsdCompact(84_300_000_000)).toBe('$84.3B')
    expect(formatUsdCompact(512_000_000)).toBe('$512M')
    expect(formatUsdCompact(950)).toBe('$950')
  })

  it('maps exchange base assets to coin symbols and prefers the biggest coin for a shared symbol', () => {
    expect(coinSymbol('1000PEPE')).toBe('PEPE')
    expect(coinSymbol('BTC')).toBe('BTC')
    const index = indexMarketCaps([
      { s: 'uni', n: 'Uniswap', c: 5e9, r: 30, v: 1e8 },
      { s: 'uni', n: 'Universe token', c: 1e6, r: 900, v: 1e3 },
    ])
    expect(index.get('UNI')?.name).toBe('Uniswap')
  })
})
