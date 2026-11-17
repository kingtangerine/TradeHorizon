// Binance USDT-M perpetual futures: the contract list for the symbol catalog, and funding rate / open interest for
// the chart legend. Perpetuals are named like TradingView's, with a ".P" suffix (BTCUSDT.P), so they never collide
// with the spot pair of the same coin in quotes, alerts or drawings; requests to Binance use the plain symbol.
import { MarketDataHttpError } from "../errors";
import { precisionFromStep, type BinanceSpotListing } from "./exchangeInfo";
import type { MarketDataFetch } from "./rest";

export const BINANCE_FUTURES_EXCHANGE_INFO = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex";
const OPEN_INTEREST = "https://fapi.binance.com/fapi/v1/openInterest";

export const PERPETUAL_SUFFIX = ".P";

/** The symbol Binance knows ("BTCUSDT.P" -> "BTCUSDT"). */
export function exchangeSymbol(symbol: string): string {
  return symbol.endsWith(PERPETUAL_SUFFIX) ? symbol.slice(0, -PERPETUAL_SUFFIX.length) : symbol;
}

function filterValue(filters: unknown, type: string, key: string): unknown {
  if (!Array.isArray(filters)) return undefined;
  const filter = filters.find((item) => (item as { filterType?: unknown } | null)?.filterType === type) as Record<string, unknown> | undefined;
  return filter?.[key];
}

/** Trading USDT-margined perpetual contracts, as catalog listings named "XXXUSDT.P". */
export function parseBinanceFuturesListings(payload: unknown): BinanceSpotListing[] {
  const symbols = (payload as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(symbols)) throw new TypeError("Binance futures exchangeInfo has no symbols array");
  const listings: BinanceSpotListing[] = [];
  for (const item of symbols) {
    const entry = item as Record<string, unknown> | null;
    if (
      !entry || entry.status !== "TRADING" || entry.contractType !== "PERPETUAL" || entry.quoteAsset !== "USDT" ||
      typeof entry.symbol !== "string" || typeof entry.baseAsset !== "string" || !/^[A-Z0-9]{2,30}$/.test(entry.symbol) ||
      // Binance's own BTC dominance index is listed separately (BTCDOMUSDT, kept for existing charts and alerts).
      entry.symbol === "BTCDOMUSDT"
    ) continue;
    listings.push({
      exchange: "binance-futures",
      symbol: `${entry.symbol}${PERPETUAL_SUFFIX}`,
      baseAsset: entry.baseAsset,
      pricePrecision: precisionFromStep(filterValue(entry.filters, "PRICE_FILTER", "tickSize"), 2),
      volumePrecision: precisionFromStep(filterValue(entry.filters, "LOT_SIZE", "stepSize"), 3),
    });
  }
  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
}

export async function fetchBinanceFuturesListings(
  fetcher: MarketDataFetch = (input, init) => globalThis.fetch(input, init),
  signal?: AbortSignal,
): Promise<BinanceSpotListing[]> {
  const response = await fetcher(new URL(BINANCE_FUTURES_EXCHANGE_INFO), { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new MarketDataHttpError(response.status, response.statusText);
  return parseBinanceFuturesListings(await response.json());
}

export interface FuturesStats {
  /** Funding rate of the current period, as a fraction (0.0001 = 0.01%). */
  readonly fundingRate: number;
  readonly nextFundingTimeMs: number;
  readonly markPrice: number;
  /** Open contracts in the base coin. */
  readonly openInterest?: number;
}

export async function fetchFuturesStats(symbol: string, signal?: AbortSignal): Promise<FuturesStats> {
  const plain = encodeURIComponent(exchangeSymbol(symbol));
  const [premium, interest] = await Promise.all([
    globalThis.fetch(`${PREMIUM_INDEX}?symbol=${plain}`, { signal }).then((response) => {
      if (!response.ok) throw new MarketDataHttpError(response.status, response.statusText);
      return response.json() as Promise<Record<string, unknown>>;
    }),
    globalThis.fetch(`${OPEN_INTEREST}?symbol=${plain}`, { signal })
      .then((response) => (response.ok ? response.json() as Promise<Record<string, unknown>> : undefined))
      // Open interest is optional in the legend: without it the funding rate and mark price still show.
      .catch(() => undefined),
  ]);
  const fundingRate = Number(premium.lastFundingRate);
  const nextFundingTimeMs = Number(premium.nextFundingTime);
  const markPrice = Number(premium.markPrice);
  if (!Number.isFinite(fundingRate) || !Number.isFinite(nextFundingTimeMs) || !Number.isFinite(markPrice)) {
    throw new TypeError("Unexpected premium index answer");
  }
  const openInterest = Number(interest?.openInterest);
  return { fundingRate, nextFundingTimeMs, markPrice, ...(Number.isFinite(openInterest) ? { openInterest } : {}) };
}

/** "02:41:07" until the next funding, or "now". */
export function fundingCountdown(nextFundingTimeMs: number, nowMs: number): string {
  const left = Math.max(0, Math.floor((nextFundingTimeMs - nowMs) / 1000));
  if (left === 0) return "now";
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(Math.floor(left / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`;
}
