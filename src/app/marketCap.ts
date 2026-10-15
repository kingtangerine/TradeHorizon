// Market capitalisation of the coin on the chart, from the server's cached CoinGecko list (top 500),
// grouped into four tiers so a trader sees at a glance how big (and roughly how volatile) a coin is.

export interface MarketCapInfo {
  readonly name: string
  readonly marketCap: number
  readonly rank: number
  readonly volume24h: number
}

export type CapTier = 1 | 2 | 3 | 4

export interface CapTierInfo {
  readonly tier: CapTier
  readonly label: string
  readonly color: string
  readonly description: string
}

const TIERS: readonly CapTierInfo[] = [
  { tier: 1, label: 'Mega cap', color: '#22ab94', description: 'Over $50B. The most liquid coins, usually with the calmest moves.' },
  { tier: 2, label: 'Large cap', color: '#2962ff', description: '$10B to $50B. Established and liquid, but moves more than the leaders.' },
  { tier: 3, label: 'Mid cap', color: '#f5a623', description: '$1B to $10B. Noticeably more volatile: size positions with care.' },
  { tier: 4, label: 'Small cap', color: '#f23645', description: 'Under $1B. Thin liquidity and sharp swings: the highest risk.' },
]

export function capTier(marketCap: number | undefined): CapTierInfo {
  if (marketCap === undefined) return TIERS[3]
  if (marketCap >= 50e9) return TIERS[0]
  if (marketCap >= 10e9) return TIERS[1]
  if (marketCap >= 1e9) return TIERS[2]
  return TIERS[3]
}

export function formatUsdCompact(value: number): string {
  const units: Array<[number, string]> = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) {
      const scaled = value / size
      return `$${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`
    }
  }
  return `$${value.toFixed(0)}`
}

/** "1000PEPE" trades a bundle of 1000 tokens; CoinGecko lists the token itself. */
export function coinSymbol(baseAsset: string): string {
  return baseAsset.toUpperCase().replace(/^(1000000|1000|1M)(?=[A-Z])/, '')
}

export interface CapRow { s: string, n: string, c: number, r: number, v: number }

/** Index by symbol; when several coins share a symbol the biggest wins (the one traders mean). */
export function indexMarketCaps(rows: readonly CapRow[]): Map<string, MarketCapInfo> {
  const index = new Map<string, MarketCapInfo>()
  for (const row of rows) {
    const symbol = row.s.toUpperCase()
    const existing = index.get(symbol)
    if (existing && existing.marketCap >= row.c) continue
    index.set(symbol, { name: row.n, marketCap: row.c, rank: row.r, volume24h: row.v })
  }
  return index
}

let loading: Promise<Map<string, MarketCapInfo>> | undefined
let loadedAtMs = 0
const REFRESH_MS = 30 * 60_000

/** The cached list (one request per 30 minutes per tab). An empty map when the server cannot provide it. */
export function loadMarketCaps(): Promise<Map<string, MarketCapInfo>> {
  if (!loading || Date.now() - loadedAtMs > REFRESH_MS) {
    loadedAtMs = Date.now()
    loading = fetch('/api/cg/caps')
      .then(async (response) => (response.ok ? indexMarketCaps(await response.json() as CapRow[]) : new Map<string, MarketCapInfo>()))
      .catch(() => new Map<string, MarketCapInfo>())
      .then((index) => {
        if (index.size === 0) loadedAtMs = 0 // try again on the next chart instead of keeping the failure for 30 minutes
        return index
      })
  }
  return loading
}
