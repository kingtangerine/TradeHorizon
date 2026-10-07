/**
 * Market dominance (share of total crypto market cap) at any timeframe.
 *
 * Free APIs do not serve historical global market cap, and CoinGecko's public
 * tier allows only a handful of requests per minute. So the model is:
 *   - today's market caps come from CoinGecko (two requests, cached), and
 *   - history is rebuilt from Binance prices: a coin's cap at time t is its cap
 *     today scaled by price(t) / price(today), i.e. supply is held constant.
 * Stablecoins are held at today's cap, and coins without a Binance pair move
 * with the tracked altcoin basket. Values are therefore estimates that are
 * exact now and drift slowly the further back you look.
 */
export const COINGECKO_API_ENDPOINT = "https://api.coingecko.com/api/v3";

export type DominanceComponent = "btc" | "usdt" | "alt";

export const BITCOIN_PRICE_SYMBOL = "BTCUSDT";
/** Upper bound on Binance price series fetched per page (one request each). */
export const MAX_TRACKED_SYMBOLS = 12;

/** Wrapped or staked coins that follow another coin's price. */
const PRICE_FOLLOWS: Readonly<Record<string, string>> = {
  "wrapped-bitcoin": "BTCUSDT",
  "coinbase-wrapped-btc": "BTCUSDT",
  "staked-ether": "ETHUSDT",
  "wrapped-steth": "ETHUSDT",
  weth: "ETHUSDT",
  "wrapped-eeth": "ETHUSDT",
  "wrapped-beacon-eth": "ETHUSDT",
};

export interface DominanceWeights {
  fetchedAtMs: number;
  totalCap: number;
  bitcoinCap: number;
  tetherCap: number;
  /** Other dollar-pegged coins, held constant through history. */
  stableCap: number;
  /** Today's cap of price-following coins, keyed by the Binance symbol they follow. */
  trackedCaps: Record<string, number>;
  /** Everything else; assumed to move with the tracked altcoin basket. */
  tailCap: number;
}

export interface PriceBar {
  timestamp: number;
  open: number;
  close: number;
}

export interface DominanceRow {
  timestamp: number;
  open: Record<DominanceComponent, number>;
  close: Record<DominanceComponent, number>;
}

function isStable(id: string, symbol: string, price: number): boolean {
  return Math.abs(price - 1) <= 0.03 && /usd|dai|heloc/i.test(`${id} ${symbol}`);
}

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildDominanceWeights(
  globalPayload: unknown,
  marketsPayload: unknown,
  availableSymbols: ReadonlySet<string>,
  nowMs: number,
): DominanceWeights {
  const totalCap = positive(
    (globalPayload as { data?: { total_market_cap?: { usd?: unknown } } } | null)?.data?.total_market_cap?.usd,
  );
  if (!Array.isArray(marketsPayload) || totalCap === 0) {
    throw new TypeError("CoinGecko did not return usable market-cap data");
  }

  let bitcoinCap = 0;
  let tetherCap = 0;
  let stableCap = 0;
  const trackedCaps: Record<string, number> = {};

  for (const item of marketsPayload) {
    if (typeof item !== "object" || item === null) continue;
    const coin = item as { id?: unknown; symbol?: unknown; market_cap?: unknown; current_price?: unknown };
    const cap = positive(coin.market_cap);
    if (cap === 0 || typeof coin.id !== "string" || typeof coin.symbol !== "string") continue;

    if (coin.id === "bitcoin") {
      bitcoinCap = cap;
    } else if (coin.id === "tether") {
      tetherCap = cap;
    } else if (isStable(coin.id, coin.symbol, positive(coin.current_price))) {
      stableCap += cap;
    } else {
      const follows = PRICE_FOLLOWS[coin.id] ?? `${coin.symbol.toUpperCase()}USDT`;
      const alreadyTracked = follows in trackedCaps;
      const hasRoom = Object.keys(trackedCaps).length < MAX_TRACKED_SYMBOLS - 1;
      if (availableSymbols.has(follows) && (alreadyTracked || hasRoom)) {
        trackedCaps[follows] = (trackedCaps[follows] ?? 0) + cap;
      }
    }
  }

  if (bitcoinCap === 0 || tetherCap === 0) {
    throw new TypeError("CoinGecko market data is missing Bitcoin or Tether");
  }

  const tracked = Object.values(trackedCaps).reduce((sum, cap) => sum + cap, 0);
  // CoinGecko's own total can lag its coin list slightly; never let it fall below the parts we counted.
  const total = Math.max(totalCap, bitcoinCap + tetherCap + stableCap + tracked);
  return {
    fetchedAtMs: nowMs,
    totalCap: total,
    bitcoinCap,
    tetherCap,
    stableCap,
    trackedCaps,
    tailCap: total - bitcoinCap - tetherCap - stableCap - tracked,
  };
}

/** Binance symbols whose prices are needed to rebuild history; Bitcoin first. */
export function dominancePriceSymbols(weights: DominanceWeights): string[] {
  return [BITCOIN_PRICE_SYMBOL, ...Object.keys(weights.trackedCaps).filter((symbol) => symbol !== BITCOIN_PRICE_SYMBOL)];
}

/** The price each symbol had when the weights were captured: the last bar at or before that moment. */
export function referencePrices(
  bars: Readonly<Record<string, readonly PriceBar[]>>,
  atMs: number,
): Record<string, number> {
  const reference: Record<string, number> = {};
  for (const [symbol, series] of Object.entries(bars)) {
    let chosen = series[series.length - 1];
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (series[index].timestamp <= atMs) {
        chosen = series[index];
        break;
      }
    }
    if (chosen && chosen.close > 0) reference[symbol] = chosen.close;
  }
  return reference;
}

/**
 * Rebuilds dominance for every Bitcoin bar. A symbol with no bar at a given time
 * (listed later, or a gap) is carried at its nearest known price.
 */
export function computeDominanceRows(
  weights: DominanceWeights,
  bars: Readonly<Record<string, readonly PriceBar[]>>,
  reference: Readonly<Record<string, number>>,
): DominanceRow[] {
  const bitcoin = bars[BITCOIN_PRICE_SYMBOL] ?? [];
  const bitcoinReference = reference[BITCOIN_PRICE_SYMBOL];
  if (bitcoin.length === 0 || !(bitcoinReference > 0)) return [];

  const tracked = Object.entries(weights.trackedCaps).filter(([symbol]) => reference[symbol] > 0);
  const untrackedCap = Object.entries(weights.trackedCaps)
    .filter(([symbol]) => !(reference[symbol] > 0))
    .reduce((sum, [, cap]) => sum + cap, 0);
  const basketNow = tracked.reduce((sum, [, cap]) => sum + cap, 0);
  const tailNow = weights.tailCap + untrackedCap;
  const pointers = new Map(tracked.map(([symbol]) => [symbol, 0]));

  return bitcoin.map((bar) => {
    const prices = tracked.map(([symbol, cap]) => {
      const series = bars[symbol] ?? [];
      let index = pointers.get(symbol) ?? 0;
      while (index + 1 < series.length && series[index + 1].timestamp <= bar.timestamp) index += 1;
      pointers.set(symbol, index);
      const match = series[index];
      const aligned = match && match.timestamp === bar.timestamp;
      // Without a bar for this exact time, hold the nearest close for both ends of the candle.
      const open = match ? (aligned ? match.open : match.timestamp < bar.timestamp ? match.close : match.open) : reference[symbol];
      const close = match ? (aligned ? match.close : open) : reference[symbol];
      return { cap, open: open / reference[symbol], close: close / reference[symbol] };
    });

    const shares = (bitcoinRatio: number, field: "open" | "close"): Record<DominanceComponent, number> => {
      const basket = prices.reduce((sum, item) => sum + item.cap * item[field], 0);
      const tail = tailNow * (basketNow > 0 ? basket / basketNow : bitcoinRatio);
      const bitcoinCap = weights.bitcoinCap * bitcoinRatio;
      const total = bitcoinCap + weights.tetherCap + weights.stableCap + basket + tail;
      const btc = (bitcoinCap / total) * 100;
      const usdt = (weights.tetherCap / total) * 100;
      return { btc, usdt, alt: Math.max(0, 100 - btc - usdt) };
    };

    return {
      timestamp: bar.timestamp,
      open: shares(bar.open / bitcoinReference, "open"),
      close: shares(bar.close / bitcoinReference, "close"),
    };
  });
}

export const DOMINANCE_UNAVAILABLE_MESSAGE =
  "CoinGecko did not answer (rate limit or offline). Dominance needs today's market caps; try again in a minute.";

export interface FetchDominanceWeightsOptions {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: number;
}

const RETRY_DELAY_MS = 20_000;
const RETRIES = 2;

export async function fetchDominanceWeights(
  availableSymbols: ReadonlySet<string>,
  options: FetchDominanceWeightsOptions = {},
): Promise<DominanceWeights> {
  const fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)));

  // CoinGecko's 429 responses carry no CORS header, so browsers surface them as network errors.
  async function getJson(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      let response: Response | undefined;
      try {
        response = await fetcher(`${COINGECKO_API_ENDPOINT}${path}`, {
          headers: { Accept: "application/json" },
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
      }

      if (response?.ok) return response.json();
      if (response && response.status !== 429) {
        throw new Error(`CoinGecko request failed (${response.status} ${response.statusText})`.trim());
      }
      if (attempt >= RETRIES) throw new Error(DOMINANCE_UNAVAILABLE_MESSAGE);
      await sleep(RETRY_DELAY_MS);
    }
  }

  const globalPayload = await getJson("/global");
  const marketsPayload = await getJson("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1");
  return buildDominanceWeights(globalPayload, marketsPayload, availableSymbols, options.nowMs ?? Date.now());
}
