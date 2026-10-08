import type { MarketInterval } from "./intervals";

export const DEFAULT_BINANCE_SPOT_SYMBOL = "BTCUSDT" as const;

/** A stable identifier used by drawings and caches. */
export type MarketExchange = "binance" | "bybit";
export type MarketId = `${MarketExchange}:spot:${string}`;

/**
 * Prices and quantities stay as strings at the market-data boundary so that
 * JavaScript does not silently round exchange values before the chart needs
 * them as numbers.
 */
export interface Candle {
  marketId: MarketId;
  symbol: string;
  interval: MarketInterval;
  openTimeMs: number;
  closeTimeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradeCount: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
  isFinal: boolean;
  eventTimeMs?: number;
}

export function normalizeBinanceSpotSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();

  if (!/^[A-Z0-9]{2,30}$/.test(normalized)) {
    throw new TypeError(`Invalid Binance spot symbol: ${symbol}`);
  }

  return normalized;
}

export function marketIdFor(symbol: string, exchange: MarketExchange = "binance"): MarketId {
  return `${exchange}:spot:${normalizeBinanceSpotSymbol(symbol)}`;
}

export function candleKey(candle: Pick<Candle, "marketId" | "interval" | "openTimeMs">): string {
  return `${candle.marketId}:${candle.interval}:${candle.openTimeMs}`;
}

