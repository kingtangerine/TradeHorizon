import {
  fetchBinanceSpotListings,
  fetchBybitSpotListings,
  marketIdFor,
  type BinanceSpotListing,
  type MarketDataFetch,
} from '../market'
import { DOMINANCE_DESCRIPTIONS, DOMINANCE_LABELS, type DominanceKey } from './indicators'

export interface CryptoMarket {
  readonly symbol: string
  readonly baseAsset: string
  readonly quoteAsset: 'USDT' | '%'
  readonly name: string
  readonly mark: string
  readonly pricePrecision: number
  readonly volumePrecision: number
  /** Stable key for drawings and alerts. */
  readonly marketId: string
  /** Exchange that serves candles for a spot pair. */
  readonly exchange: 'binance' | 'bybit'
  /** Spot pair, or a market-wide dominance index built from CoinGecko data. */
  readonly kind: 'spot' | 'dominance'
  readonly dominanceKey?: DominanceKey
  /** Data source shown in the UI. */
  readonly venue: string
  /** Display form such as "BTC / USDT" or "BTC.D". */
  readonly pair: string
}

function market(
  baseAsset: string,
  name: string,
  mark: string,
  pricePrecision: number,
  volumePrecision = 4,
): CryptoMarket {
  const symbol = `${baseAsset}USDT`
  return {
    symbol,
    baseAsset,
    quoteAsset: 'USDT',
    name,
    mark,
    pricePrecision,
    volumePrecision,
    marketId: marketIdFor(symbol),
    exchange: 'binance',
    kind: 'spot',
    venue: 'Binance',
    pair: `${baseAsset} / USDT`,
  }
}

export const CRYPTO_MARKETS: readonly CryptoMarket[] = [
  market('BTC', 'Bitcoin', '₿', 2, 5),
  market('ETH', 'Ethereum', 'Ξ', 2, 4),
  market('BNB', 'BNB', 'B', 2, 3),
  market('XRP', 'XRP', 'X', 4, 2),
  market('SOL', 'Solana', 'S', 2, 3),
  market('DOGE', 'Dogecoin', 'Ð', 5, 0),
  market('ADA', 'Cardano', 'A', 4, 1),
  market('AVAX', 'Avalanche', 'A', 2, 2),
  market('LINK', 'Chainlink', 'L', 2, 2),
  market('DOT', 'Polkadot', 'D', 3, 2),
] as const

export const DEFAULT_CRYPTO_MARKET = CRYPTO_MARKETS[0]

function dominanceMarket(key: DominanceKey, baseAsset: string, mark: string): CryptoMarket {
  const symbol = DOMINANCE_LABELS[key]
  return {
    symbol,
    baseAsset,
    quoteAsset: '%',
    name: DOMINANCE_DESCRIPTIONS[key],
    mark,
    pricePrecision: 2,
    volumePrecision: 0,
    marketId: `index:dominance:${key}`,
    exchange: 'binance',
    kind: 'dominance',
    dominanceKey: key,
    venue: 'Market cap',
    pair: symbol,
  }
}

export const DOMINANCE_MARKETS: readonly CryptoMarket[] = [
  dominanceMarket('btc', 'BTC', '₿'),
  dominanceMarket('usdt', 'USDT', '₮'),
  dominanceMarket('alt', 'ALT', 'A'),
]

const COIN_NAMES: Readonly<Record<string, string>> = {
  TRX: 'TRON', POL: 'Polygon', MATIC: 'Polygon', LTC: 'Litecoin', BCH: 'Bitcoin Cash',
  SHIB: 'Shiba Inu', UNI: 'Uniswap', ATOM: 'Cosmos', XLM: 'Stellar', ETC: 'Ethereum Classic',
  NEAR: 'NEAR Protocol', FIL: 'Filecoin', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism',
  SUI: 'Sui', INJ: 'Injective', AAVE: 'Aave', MKR: 'Maker', ALGO: 'Algorand', VET: 'VeChain',
  ICP: 'Internet Computer', HBAR: 'Hedera', TON: 'Toncoin', PEPE: 'Pepe', WIF: 'dogwifhat',
  FET: 'Fetch.ai', RENDER: 'Render', GRT: 'The Graph', SAND: 'The Sandbox', MANA: 'Decentraland',
  AXS: 'Axie Infinity', THETA: 'Theta Network', EOS: 'EOS', XTZ: 'Tezos', NEO: 'NEO',
  USDC: 'USD Coin', FDUSD: 'First Digital USD', TUSD: 'TrueUSD', DAI: 'Dai', JASMY: 'JasmyCoin',
  GRASS: 'Grass', ZETA: 'ZetaChain', BONK: 'Bonk', FLOKI: 'FLOKI', SEI: 'Sei', TIA: 'Celestia',
  LDO: 'Lido DAO', CRV: 'Curve DAO', SNX: 'Synthetix', COMP: 'Compound', RUNE: 'THORChain',
  KAVA: 'Kava', EGLD: 'MultiversX', FTM: 'Fantom', S: 'Sonic', ENA: 'Ethena', WLD: 'Worldcoin',
  JUP: 'Jupiter', PYTH: 'Pyth Network', ONDO: 'Ondo', PENDLE: 'Pendle', TAO: 'Bittensor',
  IMX: 'Immutable', GALA: 'Gala', CHZ: 'Chiliz', ENJ: 'Enjin Coin', ZEC: 'Zcash', DASH: 'Dash',
  XMR: 'Monero', IOTA: 'IOTA', QTUM: 'Qtum', ZIL: 'Zilliqa', ONE: 'Harmony', OG: 'OG Fan Token',
}

const registry = new Map<string, CryptoMarket>(
  [...CRYPTO_MARKETS, ...DOMINANCE_MARKETS].map((item) => [item.symbol, item]),
)
const CATALOG_CACHE_KEY = 'trade-horizon:markets:v2'
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000
let cacheRestored = false

function marketFromListing(listing: BinanceSpotListing): CryptoMarket {
  const exchange = listing.exchange ?? 'binance'
  return {
    symbol: listing.symbol,
    baseAsset: listing.baseAsset,
    quoteAsset: 'USDT',
    name: COIN_NAMES[listing.baseAsset] ?? listing.baseAsset,
    mark: listing.baseAsset.charAt(0),
    pricePrecision: listing.pricePrecision,
    volumePrecision: listing.volumePrecision,
    marketId: marketIdFor(listing.symbol, exchange),
    exchange,
    kind: 'spot',
    venue: exchange === 'bybit' ? 'Bybit' : 'Binance',
    pair: `${listing.baseAsset} / USDT`,
  }
}

function registerListings(listings: readonly BinanceSpotListing[]): void {
  for (const listing of listings) {
    if (!registry.has(listing.symbol)) registry.set(listing.symbol, marketFromListing(listing))
  }
}

function readCatalogCache(): { fetchedAtMs: number; listings: BinanceSpotListing[] } | null {
  try {
    const value = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) ?? 'null') as {
      fetchedAtMs?: unknown
      listings?: unknown
    } | null
    if (!value || typeof value.fetchedAtMs !== 'number' || !Array.isArray(value.listings)) return null
    const listings = value.listings.filter((item): item is BinanceSpotListing => (
      typeof item === 'object' && item !== null &&
      /^[A-Z0-9]{2,30}$/.test((item as BinanceSpotListing).symbol) &&
      typeof (item as BinanceSpotListing).baseAsset === 'string' &&
      Number.isInteger((item as BinanceSpotListing).pricePrecision) &&
      Number.isInteger((item as BinanceSpotListing).volumePrecision)
    ))
    return { fetchedAtMs: value.fetchedAtMs, listings }
  } catch {
    return null
  }
}

function restoreCatalogOnce(): void {
  if (cacheRestored) return
  cacheRestored = true
  const cached = readCatalogCache()
  if (cached) registerListings(cached.listings)
}

export function getMarket(symbol: string): CryptoMarket {
  restoreCatalogOnce()
  return registry.get(symbol) ?? DEFAULT_CRYPTO_MARKET
}

export function allMarkets(): CryptoMarket[] {
  restoreCatalogOnce()
  return [...registry.values()]
}

export async function refreshMarketCatalog(
  fetcher?: MarketDataFetch,
  signal?: AbortSignal,
  nowMs = Date.now(),
): Promise<boolean> {
  restoreCatalogOnce()
  const cached = readCatalogCache()
  if (cached && nowMs - cached.fetchedAtMs < CATALOG_TTL_MS) return false

  // Binance is the primary source. Bybit adds the USDT pairs Binance does not list; if it is
  // unreachable the catalog still works with Binance alone.
  const [binance, bybit] = await Promise.all([
    fetchBinanceSpotListings(fetcher, signal),
    fetchBybitSpotListings(fetcher, signal).catch(() => [] as BinanceSpotListing[]),
  ])
  const binanceSymbols = new Set(binance.map((item) => item.symbol))
  const listings = [...binance, ...bybit.filter((item) => !binanceSymbols.has(item.symbol))]
  registerListings(listings)
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ fetchedAtMs: nowMs, listings }))
  } catch {
    // The list still works for this session if storage is full or unavailable.
  }
  return true
}
