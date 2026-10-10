import { MarketDataConnectionError, MarketDataHttpError, MarketDataParseError } from "../errors";
import { precisionFromStep, type BinanceSpotListing } from "../binance/exchangeInfo";
import type { FetchBinanceKlinesOptions, MarketDataFetch } from "../binance/rest";
import type { KlineStreamStatus } from "../binance/stream";
import { getMarketIntervalSpec, type MarketInterval } from "../intervals";
import { marketIdFor, normalizeBinanceSpotSymbol, type Candle } from "../types";

// Bybit spot is used for USDT pairs that Binance does not list (for example ZETA).
// Public market-data endpoints allow browser requests, so no proxy is needed.

export const BYBIT_REST_ENDPOINT = "https://api.bybit.com/v5/market";
export const BYBIT_WS_ENDPOINT = "wss://stream.bybit.com/v5/public/spot";

const PAGE_LIMIT = 1000;
const DAY_MS = 86_400_000;
const POLL_MS = 5_000;
const PING_MS = 20_000;

/** Bybit has no 8h or 3d candles, so those are built from 4h and 1d ones. */
const NATIVE_INTERVALS: Partial<Record<MarketInterval, string>> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
  "1d": "D", "1w": "W", "1M": "M",
};
const AGGREGATED: Partial<Record<MarketInterval, { base: MarketInterval; factor: number; spanMs: number }>> = {
  "8h": { base: "4h", factor: 2, spanMs: 8 * 3_600_000 },
  "3d": { base: "1d", factor: 3, spanMs: 3 * DAY_MS },
};

function closeTimeFor(openTimeMs: number, interval: MarketInterval): number {
  const duration = getMarketIntervalSpec(interval).durationMs;
  if (duration !== null) return openTimeMs + duration - 1;
  const open = new Date(openTimeMs);
  return Date.UTC(open.getUTCFullYear(), open.getUTCMonth() + 1, 1) - 1;
}

function candleFrom(
  symbol: string,
  interval: MarketInterval,
  openTimeMs: number,
  values: { open: string; high: string; low: string; close: string; volume: string; turnover: string },
  isFinal: boolean,
): Candle {
  return {
    marketId: marketIdFor(symbol, "bybit"),
    symbol,
    interval,
    openTimeMs,
    closeTimeMs: closeTimeFor(openTimeMs, interval),
    open: values.open,
    high: values.high,
    low: values.low,
    close: values.close,
    volume: values.volume,
    quoteVolume: values.turnover,
    tradeCount: 0,
    takerBuyBaseVolume: "0",
    takerBuyQuoteVolume: "0",
    isFinal,
  };
}

export function parseBybitRestKlines(payload: unknown, symbol: string, interval: MarketInterval, nowMs = Date.now()): Candle[] {
  const list = (payload as { result?: { list?: unknown } } | null)?.result?.list;
  if (!Array.isArray(list)) throw new MarketDataParseError("Bybit klines payload has no list", payload);
  const candles = list.map((row): Candle => {
    if (!Array.isArray(row) || row.length < 7) throw new MarketDataParseError("Bybit kline row is malformed", row);
    const [start, open, high, low, close, volume, turnover] = row as string[];
    const openTimeMs = Number(start);
    if (!Number.isSafeInteger(openTimeMs)) throw new MarketDataParseError("Bybit kline start is invalid", row);
    return candleFrom(symbol, interval, openTimeMs, { open, high, low, close, volume, turnover }, closeTimeFor(openTimeMs, interval) < nowMs);
  });
  return candles.sort((a, b) => a.openTimeMs - b.openTimeMs);
}

async function fetchNativePage(
  symbol: string,
  interval: MarketInterval,
  limit: number,
  range: { startTimeMs?: number; endTimeMs?: number },
  fetcher: MarketDataFetch,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const url = new URL(`${BYBIT_REST_ENDPOINT}/kline`);
  url.searchParams.set("category", "spot");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", NATIVE_INTERVALS[interval] as string);
  url.searchParams.set("limit", String(limit));
  if (range.startTimeMs !== undefined) url.searchParams.set("start", String(range.startTimeMs));
  if (range.endTimeMs !== undefined) url.searchParams.set("end", String(range.endTimeMs));
  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new MarketDataHttpError(response.status, response.statusText);
  const payload = await response.json() as { retCode?: number; retMsg?: string };
  if (payload.retCode !== 0) throw new MarketDataConnectionError(`Bybit: ${payload.retMsg ?? "request failed"}`);
  return parseBybitRestKlines(payload, symbol, interval);
}

function aggregate(base: readonly Candle[], interval: MarketInterval, spanMs: number): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const candle of base) {
    const key = Math.floor(candle.openTimeMs / spanMs) * spanMs;
    const group = groups.get(key);
    if (group) group.push(candle); else groups.set(key, [candle]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([openTimeMs, group]) => candleFrom(
    group[0].symbol,
    interval,
    openTimeMs,
    {
      open: group[0].open,
      high: String(Math.max(...group.map((item) => Number(item.high)))),
      low: String(Math.min(...group.map((item) => Number(item.low)))),
      close: group[group.length - 1].close,
      volume: String(group.reduce((sum, item) => sum + Number(item.volume), 0)),
      turnover: String(group.reduce((sum, item) => sum + Number(item.quoteVolume), 0)),
    },
    group[group.length - 1].isFinal,
  ));
}

/** Same contract as fetchBinanceKlines: ascending candles, at most `limit`, ending at endTimeMs when given. */
export async function fetchBybitKlines(
  options: FetchBinanceKlinesOptions,
  fetcher: MarketDataFetch = (input, init) => globalThis.fetch(input, init),
): Promise<Candle[]> {
  const symbol = normalizeBinanceSpotSymbol(options.symbol ?? "");
  const limit = options.limit ?? 500;
  const aggregated = AGGREGATED[options.interval];

  if (!aggregated) {
    return fetchNativePage(symbol, options.interval, limit, { startTimeMs: options.startTimeMs, endTimeMs: options.endTimeMs }, fetcher, options.signal);
  }

  // Page the base interval backwards until enough candles exist for `limit` whole aggregated bars.
  const wanted = limit * aggregated.factor + aggregated.factor;
  let base: Candle[] = [];
  let endTimeMs = options.endTimeMs;
  while (base.length < wanted) {
    const page = await fetchNativePage(symbol, aggregated.base, PAGE_LIMIT, { endTimeMs }, fetcher, options.signal);
    if (page.length === 0) break;
    base = [...page, ...base];
    if (page.length < PAGE_LIMIT) break;
    endTimeMs = page[0].openTimeMs - 1;
  }
  let bars = aggregate(base, options.interval, aggregated.spanMs);
  // The oldest bar is partial when the history was cut mid-bar; drop it unless it is all there is.
  if (base.length >= wanted && bars.length > 1) bars = bars.slice(1);
  if (options.startTimeMs !== undefined) bars = bars.filter((bar) => bar.openTimeMs >= (options.startTimeMs as number));
  return bars.slice(-limit);
}

export async function fetchBybitSpotListings(
  fetcher: MarketDataFetch = (input, init) => globalThis.fetch(input, init),
  signal?: AbortSignal,
): Promise<BinanceSpotListing[]> {
  const url = new URL(`${BYBIT_REST_ENDPOINT}/instruments-info`);
  url.searchParams.set("category", "spot");
  url.searchParams.set("limit", "1000");
  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new MarketDataHttpError(response.status, response.statusText);
  return parseBybitInstruments(await response.json());
}

export function parseBybitInstruments(payload: unknown): BinanceSpotListing[] {
  const list = (payload as { result?: { list?: unknown } } | null)?.result?.list;
  if (!Array.isArray(list)) throw new TypeError("Bybit instruments payload has no list");
  const listings: BinanceSpotListing[] = [];
  for (const item of list) {
    const entry = item as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (
      !entry || entry.status !== "Trading" || entry.quoteCoin !== "USDT" ||
      typeof entry.symbol !== "string" || typeof entry.baseCoin !== "string" ||
      !/^[A-Z0-9]{2,30}$/.test(entry.symbol)
    ) continue;
    listings.push({
      exchange: "bybit",
      symbol: entry.symbol,
      baseAsset: entry.baseCoin,
      pricePrecision: precisionFromStep(entry.priceFilter?.tickSize, 4),
      volumePrecision: precisionFromStep(entry.lotSizeFilter?.basePrecision, 4),
    });
  }
  return listings.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
}

export interface BybitKlineSubscriptionOptions {
  symbol: string;
  interval: MarketInterval;
  onCandle(candle: Candle): void;
  onStatus?(status: KlineStreamStatus): void;
  onError?(error: Error): void;
}

/**
 * Live candles for one Bybit symbol and interval, with the same surface as BinanceKlineSubscription
 * (`stop()` and status events). Intervals Bybit lacks (8h, 3d) are refreshed by polling.
 */
export class BybitKlineSubscription {
  readonly symbol: string;
  readonly interval: MarketInterval;
  readonly #options: BybitKlineSubscriptionOptions;
  #active = true;
  #generation = 1;
  #attempt = 0;
  #socket: WebSocket | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #ping: ReturnType<typeof setInterval> | undefined;

  constructor(options: BybitKlineSubscriptionOptions) {
    this.#options = options;
    this.symbol = normalizeBinanceSpotSymbol(options.symbol);
    this.interval = options.interval;
    if (AGGREGATED[options.interval]) this.#poll(); else this.#connect();
  }

  get active(): boolean {
    return this.#active;
  }

  /** See BinanceKlineSubscription.nudge: replace a connection that died in the background. */
  nudge(force = false): void {
    if (!this.#active || AGGREGATED[this.interval]) return;
    const socket = this.#socket;
    if (socket && socket.readyState === WebSocket.OPEN && !force) return;
    clearTimeout(this.#timer);
    clearInterval(this.#ping);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      this.#socket = undefined;
      try { socket.close(1000, "refreshing connection"); } catch { /* already closed */ }
    }
    this.#attempt = 0;
    this.#connect();
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#generation += 1;
    clearTimeout(this.#timer);
    clearInterval(this.#ping);
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close(1000, "subscription stopped");
    }
    this.#status("stopped");
  }

  #status(state: KlineStreamStatus["state"], retryInMs?: number): void {
    this.#options.onStatus?.({ state, generation: this.#generation, attempt: this.#attempt, ...(retryInMs === undefined ? {} : { retryInMs }) });
  }

  #poll(): void {
    const generation = this.#generation;
    this.#status("connecting");
    const tick = async (): Promise<void> => {
      if (!this.#active || generation !== this.#generation) return;
      try {
        const candles = await fetchBybitKlines({ symbol: this.symbol, interval: this.interval, limit: 2 });
        if (!this.#active || generation !== this.#generation) return;
        if (this.#attempt !== 0 || this.#timer === undefined) this.#status("open");
        this.#attempt = 0;
        for (const candle of candles) this.#options.onCandle(candle);
      } catch (error) {
        this.#attempt += 1;
        this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      if (this.#active && generation === this.#generation) this.#timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
  }

  #connect(): void {
    const generation = this.#generation;
    if (!this.#active) return;
    this.#status(this.#attempt === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(BYBIT_WS_ENDPOINT);
    this.#socket = socket;
    const topic = `kline.${NATIVE_INTERVALS[this.interval]}.${this.symbol}`;
    const current = () => this.#active && generation === this.#generation && this.#socket === socket;

    socket.onopen = () => {
      if (!current()) return;
      socket.send(JSON.stringify({ op: "subscribe", args: [topic] }));
      clearInterval(this.#ping);
      this.#ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" })); }, PING_MS);
      this.#attempt = 0;
      this.#status("open");
    };
    socket.onmessage = (event) => {
      if (!current() || typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as { topic?: string; data?: Array<Record<string, any>> }; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (message.topic !== topic || !Array.isArray(message.data)) return;
        for (const row of message.data) {
          this.#options.onCandle(candleFrom(
            this.symbol,
            this.interval,
            Number(row.start),
            { open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, turnover: row.turnover },
            row.confirm === true,
          ));
        }
      } catch (error) {
        this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    socket.onerror = () => {
      if (current()) this.#options.onError?.(new MarketDataConnectionError("Bybit WebSocket error"));
    };
    socket.onclose = () => {
      if (!current()) return;
      clearInterval(this.#ping);
      this.#socket = undefined;
      const retryInMs = Math.min(500 * 2 ** this.#attempt, 30_000);
      this.#attempt += 1;
      this.#status("reconnecting", retryInMs);
      this.#timer = setTimeout(() => this.#connect(), retryInMs);
    };
  }
}
