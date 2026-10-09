import { MarketDataHttpError, StaleMarketDataRequestError } from "../errors";
import { toBinanceKlineInterval, type MarketInterval } from "../intervals";
import { DEFAULT_BINANCE_SPOT_SYMBOL, normalizeBinanceSpotSymbol, type Candle } from "../types";
import { parseBinanceRestKlines } from "./parsers";

export const BINANCE_MARKET_DATA_REST_ENDPOINT = "https://data-api.binance.vision/api/v3/klines";

export const BINANCE_FUTURES_REST_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";

export interface FetchBinanceKlinesOptions {
  symbol?: string;
  interval: MarketInterval;
  startTimeMs?: number;
  endTimeMs?: number;
  limit?: number;
  signal?: AbortSignal;
  endpoint?: string;
}

export type MarketDataFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function defaultFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("fetch is unavailable in this runtime");
  }

  return globalThis.fetch(input, init);
}

function validateOptionalTime(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

export async function fetchBinanceKlines(
  options: FetchBinanceKlinesOptions,
  fetcher: MarketDataFetch = defaultFetch,
): Promise<Candle[]> {
  const symbol = normalizeBinanceSpotSymbol(options.symbol ?? DEFAULT_BINANCE_SPOT_SYMBOL);
  const limit = options.limit ?? 500;

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("Binance kline limit must be an integer from 1 to 1000");
  }

  validateOptionalTime(options.startTimeMs, "startTimeMs");
  validateOptionalTime(options.endTimeMs, "endTimeMs");

  if (
    options.startTimeMs !== undefined &&
    options.endTimeMs !== undefined &&
    options.startTimeMs > options.endTimeMs
  ) {
    throw new RangeError("startTimeMs cannot be later than endTimeMs");
  }

  const url = new URL(options.endpoint ?? BINANCE_MARKET_DATA_REST_ENDPOINT);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", toBinanceKlineInterval(options.interval));
  url.searchParams.set("limit", String(limit));

  if (options.startTimeMs !== undefined) {
    url.searchParams.set("startTime", String(options.startTimeMs));
  }

  if (options.endTimeMs !== undefined) {
    url.searchParams.set("endTime", String(options.endTimeMs));
  }

  const response = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new MarketDataHttpError(response.status, response.statusText);
  }

  const payload = (await response.json()) as unknown;
  return parseBinanceRestKlines(payload, { symbol, interval: options.interval });
}

export interface LatestKlinesResult {
  generation: number;
  candles: Candle[];
}

export type BinanceKlineFetcher = (options: FetchBinanceKlinesOptions) => Promise<Candle[]>;

/**
 * Owns the active history request. Starting a new load aborts the prior one;
 * the generation check still rejects stale results when a custom fetcher does
 * not honour AbortSignal.
 */
export class LatestBinanceKlinesLoader {
  readonly #fetcher: BinanceKlineFetcher;
  #generation = 0;
  #controller: AbortController | undefined;

  constructor(fetcher: BinanceKlineFetcher = fetchBinanceKlines) {
    this.#fetcher = fetcher;
  }

  get generation(): number {
    return this.#generation;
  }

  async load(options: FetchBinanceKlinesOptions): Promise<LatestKlinesResult> {
    this.#controller?.abort();

    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#controller = controller;
    const abortFromCaller = (): void => controller.abort();

    if (options.signal?.aborted) {
      controller.abort();
    } else {
      options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const candles = await this.#fetcher({ ...options, signal: controller.signal });

      if (generation !== this.#generation) {
        throw new StaleMarketDataRequestError(generation);
      }

      return { generation, candles };
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);

      if (generation === this.#generation) {
        this.#controller = undefined;
      }
    }
  }

  cancel(): void {
    ++this.#generation;
    this.#controller?.abort();
    this.#controller = undefined;
  }
}

