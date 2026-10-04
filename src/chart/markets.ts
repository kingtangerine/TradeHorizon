import { marketIdFor, type MarketId } from '../market'

export interface CryptoMarket {
  readonly symbol: string
  readonly baseAsset: string
  readonly quoteAsset: 'USDT'
  readonly name: string
  readonly mark: string
  readonly pricePrecision: number
  readonly volumePrecision: number
  readonly marketId: MarketId
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
