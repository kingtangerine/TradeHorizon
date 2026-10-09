import { MarketDataHttpError } from "../errors";
import type { MarketDataFetch } from "./rest";

export const BINANCE_EXCHANGE_INFO_ENDPOINT = "https://data-api.binance.vision/api/v3/exchangeInfo";

export interface BinanceSpotListing {
  /** Where the pair trades; missing means Binance (older cached catalogs). */
  exchange?: "binance" | "bybit";
  /** Quote currency; missing means USDT. */
  quoteAsset?: "USDT" | "BTC";
  symbol: string;
  baseAsset: string;
  pricePrecision: number;
  volumePrecision: number;
}

export function precisionFromStep(step: unknown, fallback: number): number {
  if (typeof step !== "string") return fallback;
  const value = Number(step);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  if (value >= 1) return 0;
  const decimals = step.split(".")[1] ?? "";
  const lastSignificant = decimals.search(/[1-9]0*$/);
  return lastSignificant === -1 ? fallback : lastSignificant + 1;
}

function filterValue(filters: unknown, type: string, key: string): unknown {
  if (!Array.isArray(filters)) return undefined;
  const filter = filters.find((item) => (
    typeof item === "object" && item !== null && (item as { filterType?: unknown }).filterType === type
  )) as Record<string, unknown> | undefined;
  return filter?.[key];
}

export function parseBinanceExchangeInfo(payload: unknown): BinanceSpotListing[] {
  const symbols = (payload as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(symbols)) {
    throw new TypeError("Binance exchangeInfo payload has no symbols array");
  }

  const listings: BinanceSpotListing[] = [];
  for (const item of symbols) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    if (
      entry.status !== "TRADING" ||
      (entry.quoteAsset !== "USDT" && entry.quoteAsset !== "BTC") ||
      entry.isSpotTradingAllowed === false ||
      typeof entry.symbol !== "string" ||
      typeof entry.baseAsset !== "string" ||
      !/^[A-Z0-9]{2,30}$/.test(entry.symbol)
    ) continue;

    listings.push({
      ...(entry.quoteAsset === "BTC" ? { quoteAsset: "BTC" as const } : {}),
      symbol: entry.symbol,
      baseAsset: entry.baseAsset,
      pricePrecision: precisionFromStep(filterValue(entry.filters, "PRICE_FILTER", "tickSize"), 2),
      volumePrecision: precisionFromStep(filterValue(entry.filters, "LOT_SIZE", "stepSize"), 4),
    });
  }

  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
}

export async function fetchBinanceSpotListings(
  fetcher: MarketDataFetch = (input, init) => globalThis.fetch(input, init),
  signal?: AbortSignal,
): Promise<BinanceSpotListing[]> {
  const url = new URL(BINANCE_EXCHANGE_INFO_ENDPOINT);
  url.searchParams.set("showPermissionSets", "false");

  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    throw new MarketDataHttpError(response.status, response.statusText);
  }

  return parseBinanceExchangeInfo(await response.json());
}
