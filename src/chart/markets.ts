import {
  type IndexKey,
  fetchBinanceSpotListings,
  fetchBybitSpotListings,
  fetchBinanceFuturesListings,
  exchangeSymbol,
  marketIdFor,
  type BinanceSpotListing,
  type MarketDataFetch,
} from '../market'
import type { ExchangeId } from '../market/sources'
import { apiUrl } from '../platform/api'

/** A symbol the chart can show: a crypto pair or an index, with display details and price/volume precision. */
export interface CryptoMarket {
  readonly symbol: string
  readonly baseAsset: string
  readonly quoteAsset: 'USDT' | 'BTC' | '%' | 'USD'
  readonly name: string
  readonly mark: string
  readonly pricePrecision: number
  readonly volumePrecision: number
  /** Stable key for drawings and alerts. */
  readonly marketId: string
  /** Exchange that serves candles for this market. */
  readonly exchange: ExchangeId
  /** The exchange's own symbol when it differs from ours (BTC-USDT on OKX, BTC_USDT on Gate). */
  readonly apiSymbol?: string
  /** Spot pair, or a market-wide dominance index built from CoinGecko data. */
  readonly kind: 'spot' | 'futures' | 'dominance'
  /** Which engine-built index a `dominance` market shows. */
  readonly dominanceKey?: IndexKey
  /** Data source shown in the UI. */
  readonly venue: string
  /** Display form such as "BTC / USDT" or "BTC.D". */
  readonly pair: string
}

function market(baseAsset: string, name: string, mark: string, pricePrecision: number, volumePrecision = 4): CryptoMarket {
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

/** Built-in USDT pairs, available before the exchange catalog has loaded. */
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

/** The market shown when nothing else is chosen (BTCUSDT). */
export const DEFAULT_CRYPTO_MARKET = CRYPTO_MARKETS[0]

interface IndexInfo {
  readonly label: string
  readonly description: string
  readonly mark: string
  /** '%' for dominance lines, 'USD' for market-cap indices (shown in billions). */
  readonly unit: '%' | 'USD'
}

/** Labels, descriptions and units of the dominance and market-cap indices. */
export const INDEX_INFO: Readonly<Record<IndexKey, IndexInfo>> = {
  btc: { label: 'BTC.D', description: 'Bitcoin dominance', mark: '₿', unit: '%' },
  eth: { label: 'ETH.D', description: 'Ethereum dominance', mark: 'Ξ', unit: '%' },
  usdt: { label: 'USDT.D', description: 'Tether dominance', mark: '₮', unit: '%' },
  stable: { label: 'STABLE.D', description: 'Stablecoin dominance (USDT, USDC and other dollar coins)', mark: '$', unit: '%' },
  alt: { label: 'ALT.D', description: 'Altcoin dominance', mark: 'A', unit: '%' },
  total: { label: 'TOTAL', description: 'Crypto total market cap', mark: 'T', unit: 'USD' },
  total2: { label: 'TOTAL2', description: 'Crypto total market cap excluding Bitcoin', mark: '2', unit: 'USD' },
  total3: { label: 'TOTAL3', description: 'Crypto total market cap excluding Bitcoin and Ethereum', mark: '3', unit: 'USD' },
  others: { label: 'OTHERS', description: 'Crypto total market cap excluding the top 10', mark: 'O', unit: 'USD' },
}

function dominanceMarket(key: IndexKey): CryptoMarket {
  const info = INDEX_INFO[key]
  return {
    symbol: info.label,
    baseAsset: info.label.replace(/\.D$/, ''),
    quoteAsset: info.unit,
    name: info.description,
    mark: info.mark,
    pricePrecision: 2,
    volumePrecision: 0,
    marketId: `index:dominance:${key}`,
    exchange: 'binance',
    kind: 'dominance',
    dominanceKey: key,
    venue: 'Market cap',
    pair: info.label,
  }
}

/** Dominance lines first, then the market-cap indices; all are rebuilt from CoinGecko caps and Binance prices. */
export const DOMINANCE_MARKETS: readonly CryptoMarket[] = (
  ['btc', 'eth', 'usdt', 'stable', 'alt', 'total', 'total2', 'total3', 'others'] as const
).map(dominanceMarket)

/** Binance's own Bitcoin-dominance index perpetual (a price-like index, not a percentage). */
export const BTCDOM_MARKET: CryptoMarket = {
  symbol: 'BTCDOMUSDT',
  baseAsset: 'BTCDOM',
  quoteAsset: 'USDT',
  name: 'Bitcoin dominance index perpetual',
  mark: '₿',
  pricePrecision: 1,
  volumePrecision: 3,
  marketId: 'binance:futures:BTCDOMUSDT',
  exchange: 'binance-futures',
  kind: 'futures',
  venue: 'Binance Futures',
  pair: 'BTCDOMUSDT.P',
}

const COIN_NAMES: Readonly<Record<string, string>> = {
  TRX: 'TRON',
  POL: 'Polygon',
  MATIC: 'Polygon',
  LTC: 'Litecoin',
  BCH: 'Bitcoin Cash',
  SHIB: 'Shiba Inu',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  XLM: 'Stellar',
  ETC: 'Ethereum Classic',
  NEAR: 'NEAR Protocol',
  FIL: 'Filecoin',
  APT: 'Aptos',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  SUI: 'Sui',
  INJ: 'Injective',
  AAVE: 'Aave',
  MKR: 'Maker',
  ALGO: 'Algorand',
  VET: 'VeChain',
  ICP: 'Internet Computer',
  HBAR: 'Hedera',
  TON: 'Toncoin',
  PEPE: 'Pepe',
  WIF: 'dogwifhat',
  FET: 'Fetch.ai',
  RENDER: 'Render',
  GRT: 'The Graph',
  SAND: 'The Sandbox',
  MANA: 'Decentraland',
  AXS: 'Axie Infinity',
  THETA: 'Theta Network',
  EOS: 'EOS',
  XTZ: 'Tezos',
  NEO: 'NEO',
  USDC: 'USD Coin',
  FDUSD: 'First Digital USD',
  TUSD: 'TrueUSD',
  DAI: 'Dai',
  JASMY: 'JasmyCoin',
  GRASS: 'Grass',
  ZETA: 'ZetaChain',
  BONK: 'Bonk',
  FLOKI: 'FLOKI',
  SEI: 'Sei',
  TIA: 'Celestia',
  LDO: 'Lido DAO',
  CRV: 'Curve DAO',
  SNX: 'Synthetix',
  COMP: 'Compound',
  RUNE: 'THORChain',
  KAVA: 'Kava',
  EGLD: 'MultiversX',
  FTM: 'Fantom',
  S: 'Sonic',
  ENA: 'Ethena',
  WLD: 'Worldcoin',
  JUP: 'Jupiter',
  PYTH: 'Pyth Network',
  ONDO: 'Ondo',
  PENDLE: 'Pendle',
  TAO: 'Bittensor',
  IMX: 'Immutable',
  GALA: 'Gala',
  CHZ: 'Chiliz',
  ENJ: 'Enjin Coin',
  ZEC: 'Zcash',
  DASH: 'Dash',
  XMR: 'Monero',
  IOTA: 'IOTA',
  QTUM: 'Qtum',
  ZIL: 'Zilliqa',
  ONE: 'Harmony',
  OG: 'OG Fan Token',
}

const registry = new Map<string, CryptoMarket>([...CRYPTO_MARKETS, BTCDOM_MARKET, ...DOMINANCE_MARKETS].map((item) => [item.symbol, item]))
// v5: every exchange (Binance, Bybit, OKX, Bitget, Gate; spot and perpetuals), stored compactly: ~10,000 pairs.
const CATALOG_CACHE_KEY = 'trade-horizon:markets:v5'
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000
let cacheRestored = false

/** Exchange names as the symbol search and the chart show them. */
export const VENUE_NAMES: Readonly<Record<ExchangeId, string>> = {
  binance: 'Binance',
  'binance-futures': 'Binance Futures',
  bybit: 'Bybit',
  'bybit-futures': 'Bybit Futures',
  okx: 'OKX',
  'okx-futures': 'OKX Futures',
  bitget: 'Bitget',
  'bitget-futures': 'Bitget Futures',
  gate: 'Gate',
  'gate-futures': 'Gate Futures',
}

/** The symbol without our exchange prefix ("BYBIT:BTCUSDT.P" -> "BTCUSDT.P"), as TradingView shows it next to the exchange. */
export function displaySymbol(symbol: string): string {
  return symbol.replace(/^[A-Z]+:/, '')
}

function marketFromListing(listing: BinanceSpotListing): CryptoMarket {
  const exchange = listing.exchange ?? 'binance'
  const futures = exchange.endsWith('-futures')
  const quote = listing.quoteAsset ?? 'USDT'
  // The same name and badge as the coin's Binance pair (Bitcoin, ₿) when there is one.
  const known = registry.get(`${listing.baseAsset}USDT`)
  const name = known?.name ?? COIN_NAMES[listing.baseAsset] ?? listing.baseAsset
  // ids keep the shape older data uses: binance:spot:BTCUSDT, binance:futures:BTCUSDT, bybit:spot:ZETAUSDT …
  const core = exchangeSymbol(displaySymbol(listing.symbol))
  return {
    symbol: listing.symbol,
    baseAsset: listing.baseAsset,
    name: futures ? `${name} perpetual` : name,
    mark: known?.mark ?? listing.baseAsset.charAt(0),
    pricePrecision: listing.pricePrecision,
    volumePrecision: listing.volumePrecision,
    quoteAsset: futures ? 'USDT' : quote,
    marketId: `${exchange.replace('-futures', '')}:${futures ? 'futures' : 'spot'}:${core}`,
    exchange,
    ...(listing.apiSymbol ? { apiSymbol: listing.apiSymbol } : {}),
    kind: futures ? 'futures' : 'spot',
    venue: VENUE_NAMES[exchange],
    pair: futures ? `${listing.baseAsset} / USDT.P` : `${listing.baseAsset} / ${quote}`,
  }
}

function registerListings(listings: readonly BinanceSpotListing[]): void {
  for (const listing of listings) {
    if (!registry.has(listing.symbol)) registry.set(listing.symbol, marketFromListing(listing))
  }
}

/** Listings as short arrays in the local cache, so ten thousand pairs stay well under the storage limit. */
type PackedListing = [string, string, number, number, string?, string?, string?]

function packListing(listing: BinanceSpotListing): PackedListing {
  return [
    listing.symbol,
    listing.baseAsset,
    listing.pricePrecision,
    listing.volumePrecision,
    listing.exchange ?? '',
    listing.quoteAsset ?? '',
    listing.apiSymbol ?? '',
  ]
}

function unpackListing(value: unknown): unknown {
  if (!Array.isArray(value)) return null
  const [symbol, baseAsset, pricePrecision, volumePrecision, exchange, quoteAsset, apiSymbol] = value as PackedListing
  return {
    symbol,
    baseAsset,
    pricePrecision,
    volumePrecision,
    ...(exchange ? { exchange } : {}),
    ...(quoteAsset ? { quoteAsset } : {}),
    ...(apiSymbol ? { apiSymbol } : {}),
  }
}

function readCatalogCache(): { fetchedAtMs: number; listings: BinanceSpotListing[] } | null {
  try {
    const value = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) ?? 'null') as {
      fetchedAtMs?: unknown
      compact?: unknown
    } | null
    if (!value || typeof value.fetchedAtMs !== 'number' || !Array.isArray(value.compact)) return null
    const listings = value.compact
      .map(unpackListing)
      .filter(
        (item): item is BinanceSpotListing =>
          typeof item === 'object' &&
          item !== null &&
          /^([A-Z]+:)?[A-Z0-9_-]{2,40}(\.P)?$/.test((item as BinanceSpotListing).symbol) &&
          typeof (item as BinanceSpotListing).baseAsset === 'string' &&
          Number.isInteger((item as BinanceSpotListing).pricePrecision) &&
          Number.isInteger((item as BinanceSpotListing).volumePrecision),
      )
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

/** The market for a symbol, or the default market when the symbol is unknown. */
export function getMarket(symbol: string): CryptoMarket {
  restoreCatalogOnce()
  return registry.get(symbol) ?? DEFAULT_CRYPTO_MARKET
}

/** Every known market: built-in pairs, indices and the loaded exchange catalog. */
export function allMarkets(): CryptoMarket[] {
  restoreCatalogOnce()
  return [...registry.values()]
}

async function fetchServerCatalog(fetcher: MarketDataFetch | undefined, signal?: AbortSignal): Promise<BinanceSpotListing[] | null> {
  try {
    const response = await (fetcher ?? ((input, init) => globalThis.fetch(input, init)))(apiUrl('/api/markets'), {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { listings?: unknown }
    const listings = Array.isArray(payload.listings) ? payload.listings.filter(isListing) : []
    return listings.length > 100 ? listings : null
  } catch {
    return null
  }
}

function isListing(item: unknown): item is BinanceSpotListing {
  const value = item as BinanceSpotListing | null
  return (
    typeof value === 'object' &&
    value !== null &&
    /^([A-Z]+:)?[A-Z0-9_-]{2,40}(\.P)?$/.test(value.symbol) &&
    typeof value.baseAsset === 'string' &&
    Number.isInteger(value.pricePrecision) &&
    Number.isInteger(value.volumePrecision)
  )
}

/**
 * Reloads the exchange catalog (server copy, else Binance and Bybit directly) unless the cached one is still fresh.
 * Resolves true when it fetched new listings, false when the cache was used.
 */
export async function refreshMarketCatalog(fetcher?: MarketDataFetch, signal?: AbortSignal, nowMs = Date.now()): Promise<boolean> {
  restoreCatalogOnce()
  const cached = readCatalogCache()
  if (cached && nowMs - cached.fetchedAtMs < CATALOG_TTL_MS) return false

  // Our server keeps one merged, cached copy (Binance first, Bybit for pairs Binance lacks). If it is not
  // reachable, fall back to asking the exchanges directly. Bybit is optional: without it the catalog is Binance only.
  let listings = await fetchServerCatalog(fetcher, signal)
  if (!listings) {
    const [binance, bybit, futures] = await Promise.all([
      fetchBinanceSpotListings(fetcher, signal),
      fetchBybitSpotListings(fetcher, signal).catch(() => [] as BinanceSpotListing[]),
      fetchBinanceFuturesListings(fetcher, signal).catch(() => [] as BinanceSpotListing[]),
    ])
    const binanceSymbols = new Set(binance.map((item) => item.symbol))
    listings = [...binance, ...bybit.filter((item) => !binanceSymbols.has(item.symbol)), ...futures]
  }
  registerListings(listings)
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ fetchedAtMs: nowMs, compact: listings.map(packListing) }))
  } catch {
    // The list still works for this session if storage is full or unavailable.
  }
  return true
}
