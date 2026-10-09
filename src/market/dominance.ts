/**
 * Market dominance and market-cap indices (BTC.D, ETH.D, USDT.D, stablecoin dominance,
 * TOTAL, TOTAL2, TOTAL3, OTHERS) at any timeframe.
 *
 * Free APIs do not serve historical global market cap, and CoinGecko's public
 * tier allows only a handful of requests per minute. So the model is:
 *   - today's market caps come from CoinGecko (two requests, cached), and
 *   - history is rebuilt from Binance prices: a coin's cap at time t is its cap
 *     today scaled by price(t) / price(today), i.e. supply is held constant.
 * Stablecoins are held at today's cap, and coins without a Binance pair move
 * with the tracked altcoin basket. Values are therefore estimates that are
 * exact now and drift slowly the further back you look.
 *
 * Candle wicks are estimated from each coin's own high and low (see `computeDominanceRows`).
 */
export const COINGECKO_API_ENDPOINT = "https://api.coingecko.com/api/v3";

/** Percentages: btc, eth, usdt, stable, alt. Dollar indices (in billions): total, total2, total3, others. */
export type IndexKey = "btc" | "eth" | "usdt" | "stable" | "alt" | "total" | "total2" | "total3" | "others";
export const INDEX_KEYS: readonly IndexKey[] = ["btc", "eth", "usdt", "stable", "alt", "total", "total2", "total3", "others"];
/** Kept for callers that only deal with the three original dominance lines. */
export type DominanceComponent = "btc" | "usdt" | "alt";

export const BITCOIN_PRICE_SYMBOL = "BTCUSDT";
export const ETHEREUM_PRICE_SYMBOL = "ETHUSDT";
/** Upper bound on Binance price series fetched per page (one request each). */
export const MAX_TRACKED_SYMBOLS = 12;
const TOP_TEN = 10;
const BILLION = 1e9;

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
  /** Ethereum itself, without staked or wrapped copies (those sit in `trackedCaps`). */
  ethereumCap: number;
  tetherCap: number;
  /** Other dollar-pegged coins, held constant through history. */
  stableCap: number;
  /** Today's cap of price-following coins, keyed by the Binance symbol they follow. */
  trackedCaps: Record<string, number>;
  /** Everything else; assumed to move with the tracked altcoin basket. */
  tailCap: number;
  /** The ten largest coins today, which the OTHERS index leaves out (Bitcoin is handled separately). */
  topTen: {
    /** Stablecoins in the top ten (held constant). */
    stableCap: number;
    /** Other top-ten coins that have a Binance price, keyed by symbol. */
    trackedCaps: Record<string, number>;
    /** Top-ten coins without a Binance price; they move with the altcoin basket. */
    untrackedCap: number;
  };
}

export interface PriceBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DominanceRow {
  timestamp: number;
  open: Record<IndexKey, number>;
  high: Record<IndexKey, number>;
  low: Record<IndexKey, number>;
  close: Record<IndexKey, number>;
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
  let ethereumCap = 0;
  let tetherCap = 0;
  let stableCap = 0;
  const trackedCaps: Record<string, number> = {};
  const topTen: DominanceWeights["topTen"] = { stableCap: 0, trackedCaps: {}, untrackedCap: 0 };
  let counted = 0;

  for (const item of marketsPayload) {
    if (typeof item !== "object" || item === null) continue;
    const coin = item as { id?: unknown; symbol?: unknown; market_cap?: unknown; current_price?: unknown; market_cap_rank?: unknown };
    const cap = positive(coin.market_cap);
    if (cap === 0 || typeof coin.id !== "string" || typeof coin.symbol !== "string") continue;
    counted += 1;
    const rank = typeof coin.market_cap_rank === "number" ? coin.market_cap_rank : counted;
    const inTopTen = rank <= TOP_TEN;

    if (coin.id === "bitcoin") {
      bitcoinCap = cap;
    } else if (coin.id === "tether") {
      tetherCap = cap;
      if (inTopTen) topTen.stableCap += cap;
    } else if (isStable(coin.id, coin.symbol, positive(coin.current_price))) {
      stableCap += cap;
      if (inTopTen) topTen.stableCap += cap;
    } else {
      const follows = PRICE_FOLLOWS[coin.id] ?? `${coin.symbol.toUpperCase()}USDT`;
      if (coin.id === "ethereum") ethereumCap = cap;
      const alreadyTracked = follows in trackedCaps;
      const hasRoom = Object.keys(trackedCaps).length < MAX_TRACKED_SYMBOLS - 1;
      const tracked = availableSymbols.has(follows) && (alreadyTracked || hasRoom);
      if (tracked) trackedCaps[follows] = (trackedCaps[follows] ?? 0) + cap;
      if (inTopTen) {
        if (tracked) topTen.trackedCaps[follows] = (topTen.trackedCaps[follows] ?? 0) + cap;
        else topTen.untrackedCap += cap;
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
    ethereumCap,
    tetherCap,
    stableCap,
    trackedCaps,
    tailCap: total - bitcoinCap - tetherCap - stableCap - tracked,
    topTen,
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

interface Ratios {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Rebuilds every index for each Bitcoin bar. A symbol with no bar at a given time
 * (listed later, or a gap) is carried at its nearest known price.
 *
 * Open and close are exact for the model. High and low are estimates: the index is
 * evaluated with every coin at its own high, at its own low, and with Bitcoin at its
 * extremes while the rest sit midway through the bar; the widest values become the wicks.
 * Coins peak at different moments, so wicks of the cap indices are slightly generous.
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
  const topTenPriced = Object.entries(weights.topTen.trackedCaps).filter(([symbol]) => reference[symbol] > 0);
  const topTenLoose = weights.topTen.untrackedCap +
    Object.entries(weights.topTen.trackedCaps)
      .filter(([symbol]) => !(reference[symbol] > 0))
      .reduce((sum, [, cap]) => sum + cap, 0);

  return bitcoin.map((bar) => {
    const coins = tracked.map(([symbol, cap]) => {
      const series = bars[symbol] ?? [];
      let index = pointers.get(symbol) ?? 0;
      while (index + 1 < series.length && series[index + 1].timestamp <= bar.timestamp) index += 1;
      pointers.set(symbol, index);
      const match = series[index];
      const aligned = match && match.timestamp === bar.timestamp;
      const ref = reference[symbol];
      let ratios: Ratios;
      if (!match) {
        ratios = { open: 1, high: 1, low: 1, close: 1 };
      } else if (aligned) {
        ratios = { open: match.open / ref, high: match.high / ref, low: match.low / ref, close: match.close / ref };
      } else {
        // Without a bar for this exact time, hold the nearest close for the whole candle.
        const held = (match.timestamp < bar.timestamp ? match.close : match.open) / ref;
        ratios = { open: held, high: held, low: held, close: held };
      }
      return { symbol, cap, ratios };
    });
    const btc: Ratios = {
      open: bar.open / bitcoinReference,
      high: bar.high / bitcoinReference,
      low: bar.low / bitcoinReference,
      close: bar.close / bitcoinReference,
    };

    /** Every index for one assumed set of prices. */
    const evaluate = (bitcoinRatio: number, pick: (ratios: Ratios) => number): Record<IndexKey, number> => {
      const ratioOf = new Map<string, number>();
      let basket = 0;
      for (const coin of coins) {
        const ratio = pick(coin.ratios);
        ratioOf.set(coin.symbol, ratio);
        basket += coin.cap * ratio;
      }
      const basketFactor = basketNow > 0 ? basket / basketNow : bitcoinRatio;
      const tail = tailNow * basketFactor;
      const bitcoinCap = weights.bitcoinCap * bitcoinRatio;
      const total = bitcoinCap + weights.tetherCap + weights.stableCap + basket + tail;
      const ethereumCap = weights.ethereumCap * (ratioOf.get(ETHEREUM_PRICE_SYMBOL) ?? basketFactor);
      // Top-ten coins with a price series move with it; the rest move with the altcoin basket.
      const topTenCap =
        weights.topTen.stableCap +
        topTenPriced.reduce((sum, [symbol, cap]) => sum + cap * (ratioOf.get(symbol) ?? basketFactor), 0) +
        topTenLoose * basketFactor;

      const btcShare = (bitcoinCap / total) * 100;
      const usdtShare = (weights.tetherCap / total) * 100;
      return {
        btc: btcShare,
        eth: (ethereumCap / total) * 100,
        usdt: usdtShare,
        stable: ((weights.tetherCap + weights.stableCap) / total) * 100,
        alt: Math.max(0, 100 - btcShare - usdtShare),
        total: total / BILLION,
        total2: (total - bitcoinCap) / BILLION,
        total3: (total - bitcoinCap - ethereumCap) / BILLION,
        others: Math.max(0, total - bitcoinCap - topTenCap) / BILLION,
      };
    };

    const open = evaluate(btc.open, (r) => r.open);
    const close = evaluate(btc.close, (r) => r.close);
    const mid = (r: Ratios) => (r.open + r.close) / 2;
    const scenarios = [
      open,
      close,
      evaluate(btc.high, (r) => r.high),
      evaluate(btc.low, (r) => r.low),
      evaluate(btc.high, mid),
      evaluate(btc.low, mid),
    ];
    const high = {} as Record<IndexKey, number>;
    const low = {} as Record<IndexKey, number>;
    for (const key of INDEX_KEYS) {
      high[key] = Math.max(...scenarios.map((scenario) => scenario[key]));
      low[key] = Math.min(...scenarios.map((scenario) => scenario[key]));
    }
    return { timestamp: bar.timestamp, open, high, low, close };
  });
}

export const DOMINANCE_UNAVAILABLE_MESSAGE =
  "CoinGecko did not answer (rate limit or offline). Dominance needs today's market caps; try again in a minute.";

export interface FetchDominanceWeightsOptions {
  /** Our own cached copy of the CoinGecko data (e.g. "/api/cg"); tried first, CoinGecko directly is the fallback. */
  cachedBase?: string;
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
  async function getJson(path: string, cachedName: "global" | "markets"): Promise<unknown> {
    if (options.cachedBase) {
      try {
        const cached = await fetcher(`${options.cachedBase}/${cachedName}`, { headers: { Accept: "application/json" }, signal: options.signal });
        if (cached.ok) return await cached.json();
      } catch (error) {
        if (options.signal?.aborted) throw error;
      }
    }
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

  const globalPayload = await getJson("/global", "global");
  const marketsPayload = await getJson("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1", "markets");
  return buildDominanceWeights(globalPayload, marketsPayload, availableSymbols, options.nowMs ?? Date.now());
}
