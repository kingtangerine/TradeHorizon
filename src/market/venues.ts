// More exchanges, as in TradingView's symbol search: OKX, Bitget and Gate (spot and USDT perpetuals). Their public
// REST APIs allow browser requests. Live candles come from polling the newest two candles every few seconds, and
// timeframes an exchange lacks are built from shorter ones (8h from 4h, a week from days …).
import { MarketDataHttpError, MarketDataParseError } from "./errors";
import type { KlineStreamStatus } from "./binance/stream";
import type { MarketDataFetch } from "./binance/rest";
import { getMarketIntervalSpec, type MarketInterval } from "./intervals";
import type { Candle, MarketId } from "./types";

export const POLLED_VENUES = ["okx", "okx-futures", "bitget", "bitget-futures", "gate", "gate-futures"] as const;
export type PolledVenue = (typeof POLLED_VENUES)[number];

export function isPolledVenue(value: string): value is PolledVenue {
  return (POLLED_VENUES as readonly string[]).includes(value);
}

const DAY = 86_400_000;

/** A raw candle before it gets the market's id. Times in ms, prices as strings. */
interface Row { readonly t: number, readonly o: string, readonly h: string, readonly l: string, readonly c: string, readonly v: string, readonly q: string }

interface VenueSource {
  /** Exchange code per timeframe; missing timeframes are built from `BUILT_FROM`. */
  readonly native: Partial<Record<MarketInterval, string>>;
  readonly pageLimit: number;
  /** Newest `limit` candles ending at or before `endTimeMs` (now when undefined), ascending. */
  page(symbol: string, code: string, interval: MarketInterval, limit: number, endTimeMs: number | undefined, fetcher: MarketDataFetch, signal?: AbortSignal): Promise<Row[]>;
}

/** How a missing timeframe is built: from which one, and how its candles are grouped. */
const BUILT_FROM: Partial<Record<MarketInterval, readonly MarketInterval[]>> = {
  "2h": ["1h"], "8h": ["4h", "1h"], "6h": ["1h"], "12h": ["4h", "1h"], "3d": ["1d"], "1w": ["1d"], "1M": ["1d"], "3m": ["1m"],
};

function bucketStart(timeMs: number, interval: MarketInterval): number {
  if (interval === "1M") { const date = new Date(timeMs); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); }
  // Weeks start on Monday 00:00 UTC like Binance's (1970-01-01 was a Thursday, so shift by 4 days).
  if (interval === "1w") return Math.floor((timeMs - 4 * DAY) / (7 * DAY)) * 7 * DAY + 4 * DAY;
  const span = getMarketIntervalSpec(interval).durationMs ?? DAY;
  return Math.floor(timeMs / span) * span;
}

function closeTime(openTimeMs: number, interval: MarketInterval): number {
  const duration = getMarketIntervalSpec(interval).durationMs;
  if (duration !== null) return openTimeMs + duration - 1;
  const open = new Date(openTimeMs);
  return Date.UTC(open.getUTCFullYear(), open.getUTCMonth() + 1, 1) - 1;
}

export function groupRows(rows: readonly Row[], interval: MarketInterval): Row[] {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const key = bucketStart(row.t, interval);
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([t, group]) => ({
    t,
    o: group[0].o,
    h: String(Math.max(...group.map((row) => Number(row.h)))),
    l: String(Math.min(...group.map((row) => Number(row.l)))),
    c: group[group.length - 1].c,
    v: String(group.reduce((sum, row) => sum + Number(row.v), 0)),
    q: String(group.reduce((sum, row) => sum + Number(row.q), 0)),
  }));
}

async function getJson(url: string, fetcher: MarketDataFetch, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new MarketDataHttpError(response.status, response.statusText);
  return response.json();
}

const rowsOf = (payload: unknown, name: string): unknown[] => {
  if (!Array.isArray(payload)) throw new MarketDataParseError(`${name} candles payload is not a list`, payload);
  return payload;
};

// --- OKX: newest first, `after` pages back; 300 a page. ------------------------------------------------------------
const OKX_CODES: Partial<Record<MarketInterval, string>> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H",
  "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc", "3d": "3Dutc", "1w": "1Wutc", "1M": "1Mutc",
};
function okxSource(swap: boolean): VenueSource {
  return {
    native: OKX_CODES,
    pageLimit: 300,
    async page(symbol, code, _interval, limit, endTimeMs, fetcher, signal) {
      // Recent candles first; older ones live on the history endpoint.
      const query = `instId=${encodeURIComponent(symbol)}&bar=${code}&limit=${Math.min(limit, 300)}${endTimeMs !== undefined ? `&after=${endTimeMs + 1}` : ""}`;
      let payload = (await getJson(`https://www.okx.com/api/v5/market/candles?${query}`, fetcher, signal) as { data?: unknown }).data;
      if (Array.isArray(payload) && payload.length === 0 && endTimeMs !== undefined) {
        payload = (await getJson(`https://www.okx.com/api/v5/market/history-candles?${query}`, fetcher, signal) as { data?: unknown }).data;
      }
      return rowsOf(payload, "OKX").map((raw) => {
        const row = raw as string[];
        // Swaps count volume in contracts (index 5); index 6 is the base coin.
        return { t: Number(row[0]), o: row[1], h: row[2], l: row[3], c: row[4], v: swap ? row[6] : row[5], q: row[7] ?? "0" };
      }).reverse();
    },
  };
}

// --- Bitget: ascending; `endTime` pages back; recent 1000, older 200 a page. ------------------------------------
const BITGET_SPOT: Partial<Record<MarketInterval, string>> = {
  "1m": "1min", "3m": "3min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h",
  "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc", "3d": "3Dutc", "1w": "1Wutc", "1M": "1Mutc",
};
const BITGET_MIX: Partial<Record<MarketInterval, string>> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H",
  "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc", "3d": "3Dutc", "1w": "1Wutc", "1M": "1Mutc",
};
function bitgetSource(mix: boolean): VenueSource {
  const base = mix ? "https://api.bitget.com/api/v2/mix/market" : "https://api.bitget.com/api/v2/spot/market";
  const product = mix ? "&productType=USDT-FUTURES" : "";
  return {
    native: mix ? BITGET_MIX : BITGET_SPOT,
    pageLimit: 200,
    async page(symbol, code, _interval, limit, endTimeMs, fetcher, signal) {
      const end = endTimeMs !== undefined ? `&endTime=${endTimeMs}` : "";
      let data = (await getJson(`${base}/candles?symbol=${encodeURIComponent(symbol)}&granularity=${code}&limit=${Math.min(limit, 1000)}${product}${end}`, fetcher, signal) as { data?: unknown }).data;
      if (Array.isArray(data) && data.length === 0 && endTimeMs !== undefined) {
        data = (await getJson(`${base}/history-candles?symbol=${encodeURIComponent(symbol)}&granularity=${code}&limit=${Math.min(limit, 200)}${product}${end}`, fetcher, signal) as { data?: unknown }).data;
      }
      return rowsOf(data, "Bitget").map((raw) => {
        const row = raw as string[];
        return { t: Number(row[0]), o: row[1], h: row[2], l: row[3], c: row[4], v: row[5], q: row[6] ?? "0" };
      }).sort((a, b) => a.t - b.t);
    },
  };
}

// --- Gate: seconds; a from/to window of up to 1000 candles. Futures weeks start on Thursday, so weeks are built. ---
const GATE_SPOT: Partial<Record<MarketInterval, string>> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h",
  "8h": "8h", "12h": "12h", "1d": "1d", "3d": "3d", "1w": "7d", "1M": "30d",
};
const GATE_FUTURES: Partial<Record<MarketInterval, string>> = { ...GATE_SPOT, "1w": undefined, "1M": undefined };
function gateSource(futures: boolean): VenueSource {
  return {
    native: futures ? GATE_FUTURES : GATE_SPOT,
    pageLimit: 1000,
    async page(symbol, code, interval, limit, endTimeMs, fetcher, signal) {
      const to = Math.floor((endTimeMs ?? Date.now()) / 1000)
      const span = (getMarketIntervalSpec(interval).durationMs ?? 30 * DAY) / 1000
      const from = to - span * (Math.min(limit, 1000) - 1)
      const url = futures
        ? `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(symbol)}&interval=${code}&from=${from}&to=${to}`
        : `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(symbol)}&interval=${code}&from=${from}&to=${to}`
      return rowsOf(await getJson(url, fetcher, signal), "Gate").map((raw) => {
        if (futures) {
          const row = raw as { t: number, o: string, h: string, l: string, c: string, sum?: string }
          // Futures volume is in contracts; the quote volume over the close is the base amount.
          const quote = Number(row.sum ?? 0)
          return { t: row.t * 1000, o: row.o, h: row.h, l: row.l, c: row.c, v: String(Number(row.c) > 0 ? quote / Number(row.c) : 0), q: String(quote) }
        }
        const row = raw as string[]
        return { t: Number(row[0]) * 1000, o: row[5], h: row[3], l: row[4], c: row[2], v: row[6], q: row[1] }
      }).sort((a, b) => a.t - b.t)
    },
  }
}

const SOURCES: Readonly<Record<PolledVenue, VenueSource>> = {
  okx: okxSource(false), "okx-futures": okxSource(true),
  bitget: bitgetSource(false), "bitget-futures": bitgetSource(true),
  gate: gateSource(false), "gate-futures": gateSource(true),
};

export interface VenueKlineOptions {
  readonly venue: PolledVenue;
  /** The exchange's own symbol (BTC-USDT, BTC_USDT, BTCUSDT). */
  readonly apiSymbol: string;
  /** Our symbol and market id, written on every candle. */
  readonly symbol: string;
  readonly marketId: string;
  readonly interval: MarketInterval;
  readonly limit?: number;
  readonly endTimeMs?: number;
  readonly startTimeMs?: number;
  readonly signal?: AbortSignal;
}

async function pageBack(source: VenueSource, apiSymbol: string, code: string, interval: MarketInterval, wanted: number, endTimeMs: number | undefined, fetcher: MarketDataFetch, signal?: AbortSignal): Promise<Row[]> {
  let rows: Row[] = [];
  let end = endTimeMs;
  for (let pages = 0; rows.length < wanted && pages < 25; pages += 1) {
    const page = await source.page(apiSymbol, code, interval, Math.min(source.pageLimit, wanted - rows.length + 1), end, fetcher, signal);
    const older = page.filter((row) => rows.length === 0 || row.t < rows[0].t);
    if (older.length === 0) break;
    rows = [...older, ...rows];
    end = older[0].t - 1;
  }
  return rows.slice(-wanted);
}

/** Same contract as fetchBinanceKlines: ascending candles, at most `limit`, ending at `endTimeMs` when given. */
export async function fetchVenueKlines(options: VenueKlineOptions, fetcher: MarketDataFetch = (input, init) => globalThis.fetch(input, init)): Promise<Candle[]> {
  const source = SOURCES[options.venue];
  const limit = options.limit ?? 500;
  const code = source.native[options.interval];
  let rows: Row[];
  if (code) {
    rows = await pageBack(source, options.apiSymbol, code, options.interval, limit, options.endTimeMs, fetcher, options.signal);
  } else {
    const base = (BUILT_FROM[options.interval] ?? []).find((candidate) => source.native[candidate]);
    if (!base) throw new MarketDataParseError(`No ${options.interval} candles on this exchange`, options.interval);
    const ratio = Math.ceil((getMarketIntervalSpec(options.interval).durationMs ?? 31 * DAY) / (getMarketIntervalSpec(base).durationMs ?? DAY));
    const baseRows = await pageBack(source, options.apiSymbol, source.native[base]!, base, Math.min(limit * ratio + ratio, 20_000), options.endTimeMs, fetcher, options.signal);
    rows = groupRows(baseRows, options.interval);
    // The oldest group is usually cut short by where the history started.
    if (rows.length > limit) rows = rows.slice(1);
  }
  if (options.startTimeMs !== undefined) rows = rows.filter((row) => row.t >= options.startTimeMs!);
  const now = Date.now();
  return rows.slice(-limit).map((row) => ({
    marketId: options.marketId as MarketId,
    symbol: options.symbol,
    interval: options.interval,
    openTimeMs: row.t,
    closeTimeMs: closeTime(row.t, options.interval),
    open: row.o, high: row.h, low: row.l, close: row.c,
    volume: row.v, quoteVolume: row.q,
    tradeCount: 0, takerBuyBaseVolume: "0", takerBuyQuoteVolume: "0",
    isFinal: closeTime(row.t, options.interval) < now,
  }));
}

export interface VenueSubscriptionOptions extends Omit<VenueKlineOptions, "limit" | "endTimeMs" | "startTimeMs" | "signal"> {
  onCandle(candle: Candle): void;
  onStatus?(status: KlineStreamStatus): void;
  onError?(error: Error): void;
}

const POLL_MS = 3_000;

/** Live candles by polling the newest ones: the same surface as the WebSocket subscriptions (stop, nudge, status). */
export class PollingKlineSubscription {
  readonly #options: VenueSubscriptionOptions;
  #active = true;
  #generation = 1;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #opened = false;

  constructor(options: VenueSubscriptionOptions) {
    this.#options = options;
    this.#status("connecting");
    void this.#tick(this.#generation);
  }

  get active(): boolean { return this.#active; }

  nudge(): void {
    if (!this.#active) return;
    clearTimeout(this.#timer);
    this.#generation += 1;
    void this.#tick(this.#generation);
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#generation += 1;
    clearTimeout(this.#timer);
    this.#status("stopped");
  }

  #status(state: KlineStreamStatus["state"], retryInMs?: number): void {
    this.#options.onStatus?.({ state, generation: this.#generation, attempt: this.#attempt, ...(retryInMs === undefined ? {} : { retryInMs }) });
  }

  async #tick(generation: number): Promise<void> {
    if (!this.#active || generation !== this.#generation) return;
    let delay = POLL_MS;
    try {
      const candles = await fetchVenueKlines({ ...this.#options, limit: 2 });
      if (!this.#active || generation !== this.#generation) return;
      if (!this.#opened || this.#attempt > 0) this.#status("open");
      this.#opened = true;
      this.#attempt = 0;
      for (const candle of candles) this.#options.onCandle(candle);
    } catch (error) {
      if (!this.#active || generation !== this.#generation) return;
      this.#attempt += 1;
      delay = Math.min(POLL_MS * 2 ** this.#attempt, 30_000);
      this.#status("reconnecting", delay);
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
    if (this.#active && generation === this.#generation) this.#timer = setTimeout(() => void this.#tick(generation), delay);
  }
}

export interface VenueQuote { readonly last: number, readonly change: number, readonly changePercent: number }

/** 24h quotes for many symbols of one venue in one request (watchlist). Keys are the exchange's own symbols. */
export async function fetchVenueQuotes(venue: PolledVenue, signal?: AbortSignal, fetcher: MarketDataFetch = (input, init) => globalThis.fetch(input, init)): Promise<Map<string, VenueQuote>> {
  const quotes = new Map<string, VenueQuote>();
  const add = (symbol: unknown, last: unknown, open: unknown) => {
    const price = Number(last);
    const base = Number(open);
    if (typeof symbol === "string" && Number.isFinite(price) && Number.isFinite(base) && base > 0) quotes.set(symbol, { last: price, change: price - base, changePercent: ((price - base) / base) * 100 });
  };
  if (venue === "okx" || venue === "okx-futures") {
    const data = (await getJson(`https://www.okx.com/api/v5/market/tickers?instType=${venue === "okx" ? "SPOT" : "SWAP"}`, fetcher, signal) as { data?: Array<Record<string, string>> }).data ?? [];
    for (const row of data) add(row.instId, row.last, row.open24h);
  } else if (venue === "bitget" || venue === "bitget-futures") {
    const url = venue === "bitget" ? "https://api.bitget.com/api/v2/spot/market/tickers" : "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES";
    const data = (await getJson(url, fetcher, signal) as { data?: Array<Record<string, string>> }).data ?? [];
    for (const row of data) add(row.symbol, row.lastPr, row.open ?? (Number(row.lastPr) / (1 + Number(row.change24h ?? 0))));
  } else {
    const url = venue === "gate" ? "https://api.gateio.ws/api/v4/spot/tickers" : "https://api.gateio.ws/api/v4/futures/usdt/tickers";
    const data = await getJson(url, fetcher, signal) as Array<Record<string, string>>;
    for (const row of Array.isArray(data) ? data : []) {
      const last = Number(row.last);
      const percent = Number(row.change_percentage);
      add(venue === "gate" ? row.currency_pair : row.contract, last, Number.isFinite(percent) ? last / (1 + percent / 100) : NaN);
    }
  }
  return quotes;
}
