import { describe, expect, it } from "vitest";
import {
  DOMINANCE_UNAVAILABLE_MESSAGE,
  buildDominanceWeights,
  computeDominanceRows,
  dominancePriceSymbols,
  fetchDominanceWeights,
  referencePrices,
  type DominanceWeights,
  type PriceBar,
} from "./dominance";

const GLOBAL = { data: { total_market_cap: { usd: 1000 } } };
const MARKETS = [
  { id: "bitcoin", symbol: "btc", market_cap: 500, current_price: 80000 },
  { id: "ethereum", symbol: "eth", market_cap: 200, current_price: 2500 },
  { id: "tether", symbol: "usdt", market_cap: 100, current_price: 1 },
  { id: "usd-coin", symbol: "usdc", market_cap: 50, current_price: 0.9998 },
  { id: "wrapped-bitcoin", symbol: "wbtc", market_cap: 20, current_price: 79900 },
  { id: "unlisted-coin", symbol: "zzz", market_cap: 30, current_price: 4 },
  { id: "one-dollar-coin", symbol: "one", market_cap: 10, current_price: 1.01 },
];
const AVAILABLE = new Set(["BTCUSDT", "ETHUSDT", "ONEUSDT"]);

function bars(values: Array<[number, number]>, start = 0, step = 60_000): PriceBar[] {
  return values.map(([open, close], index) => ({ timestamp: start + index * step, open, high: Math.max(open, close), low: Math.min(open, close), close }));
}

describe("buildDominanceWeights", () => {
  const weights = buildDominanceWeights(GLOBAL, MARKETS, AVAILABLE, 123);

  it("splits today's caps into bitcoin, tether, stables, tracked prices, and the remainder", () => {
    expect(weights.bitcoinCap).toBe(500);
    expect(weights.tetherCap).toBe(100);
    expect(weights.stableCap).toBe(50);
    // wrapped bitcoin follows BTCUSDT; a $1.01 coin that is not a dollar token still tracks its own price
    expect(weights.trackedCaps).toEqual({ ETHUSDT: 200, BTCUSDT: 20, ONEUSDT: 10 });
    expect(weights.tailCap).toBe(1000 - 500 - 100 - 50 - 230);
    expect(weights.fetchedAtMs).toBe(123);
  });

  it("requests bitcoin first and each price symbol once", () => {
    expect(dominancePriceSymbols(weights)).toEqual(["BTCUSDT", "ETHUSDT", "ONEUSDT"]);
  });

  it("never reports a total smaller than the parts it counted", () => {
    const tight = buildDominanceWeights({ data: { total_market_cap: { usd: 700 } } }, MARKETS, AVAILABLE, 1);
    expect(tight.tailCap).toBe(0);
    expect(tight.totalCap).toBe(880);
  });

  it("rejects payloads without bitcoin, tether, or a total", () => {
    expect(() => buildDominanceWeights(GLOBAL, [MARKETS[1]], AVAILABLE, 1)).toThrow(TypeError);
    expect(() => buildDominanceWeights({}, MARKETS, AVAILABLE, 1)).toThrow(TypeError);
    expect(() => buildDominanceWeights(GLOBAL, "nope", AVAILABLE, 1)).toThrow(TypeError);
  });
});

describe("computeDominanceRows", () => {
  const weights: DominanceWeights = {
    fetchedAtMs: 60_000,
    totalCap: 1000,
    bitcoinCap: 500,
    tetherCap: 100,
    ethereumCap: 200,
    stableCap: 50,
    trackedCaps: { ETHUSDT: 250 },
    tailCap: 100,
    topTen: { stableCap: 150, trackedCaps: { ETHUSDT: 250 }, untrackedCap: 0 },
  };

  it("reproduces today's exact shares at the reference prices", () => {
    const series = { BTCUSDT: bars([[100, 100]]), ETHUSDT: bars([[10, 10]]) };
    const [row] = computeDominanceRows(weights, series, { BTCUSDT: 100, ETHUSDT: 10 });
    expect(row.close.btc).toBeCloseTo(50);
    expect(row.close.usdt).toBeCloseTo(10);
    expect(row.close.alt).toBeCloseTo(40);
  });

  it("raises bitcoin dominance when bitcoin outperforms and lowers tether's share", () => {
    // earlier bar: bitcoin was half its price, alts unchanged
    const series = { BTCUSDT: bars([[50, 50], [100, 100]]), ETHUSDT: bars([[10, 10], [10, 10]]) };
    const [past, now] = computeDominanceRows(weights, series, { BTCUSDT: 100, ETHUSDT: 10 });
    // past total = 250 + 100 + 50 + 250 + 100 = 750
    expect(past.close.btc).toBeCloseTo((250 / 750) * 100);
    expect(past.close.usdt).toBeCloseTo((100 / 750) * 100);
    expect(now.close.btc).toBeGreaterThan(past.close.btc);
    expect(past.close.btc + past.close.usdt + past.close.alt).toBeCloseTo(100);
  });

  it("moves the untracked remainder with the altcoin basket and uses open and close separately", () => {
    const series = { BTCUSDT: bars([[100, 100]]), ETHUSDT: bars([[20, 10]]) };
    const [row] = computeDominanceRows(weights, series, { BTCUSDT: 100, ETHUSDT: 10 });
    // at the open the basket and the remainder were both doubled: total = 500 + 100 + 50 + 500 + 200
    expect(row.open.btc).toBeCloseTo((500 / 1350) * 100);
    expect(row.close.btc).toBeCloseTo(50);
  });

  it("holds a coin at its nearest known price when it has no bar for a time", () => {
    const series = {
      BTCUSDT: bars([[100, 100], [100, 100], [100, 100]]),
      ETHUSDT: bars([[20, 20]], 60_000), // only the middle bar exists
    };
    const rows = computeDominanceRows(weights, series, { BTCUSDT: 100, ETHUSDT: 10 });
    expect(rows).toHaveLength(3);
    expect(rows[0].close.btc).toBeCloseTo(rows[1].close.btc);
    expect(rows[2].close.btc).toBeCloseTo(rows[1].close.btc);
  });

  it("treats a tracked coin with no reference price as part of the remainder", () => {
    const series = { BTCUSDT: bars([[100, 100]]), ETHUSDT: [] };
    const [row] = computeDominanceRows(weights, series, { BTCUSDT: 100 });
    expect(row.close.btc).toBeCloseTo(50);
  });

  it("returns nothing without bitcoin bars", () => {
    expect(computeDominanceRows(weights, { ETHUSDT: bars([[1, 1]]) }, { ETHUSDT: 1 })).toEqual([]);
  });
});

describe("market-cap indices and wicks", () => {
  const weights: DominanceWeights = {
    fetchedAtMs: 60_000,
    totalCap: 2e12,
    bitcoinCap: 1e12,
    ethereumCap: 2e11,
    tetherCap: 1.5e11,
    stableCap: 5e10,
    trackedCaps: { ETHUSDT: 3e11 },
    tailCap: 5e11,
    topTen: { stableCap: 2e11, trackedCaps: { ETHUSDT: 3e11 }, untrackedCap: 0 },
  };
  const reference = { BTCUSDT: 100, ETHUSDT: 10 };

  it("reports today's totals in billions at the reference prices", () => {
    const series = { BTCUSDT: bars([[100, 100]]), ETHUSDT: bars([[10, 10]]) };
    const [row] = computeDominanceRows(weights, series, reference);
    expect(row.close.total).toBeCloseTo(2000);
    expect(row.close.total2).toBeCloseTo(1000);
    expect(row.close.total3).toBeCloseTo(800);
    // total minus bitcoin (1000) minus top-ten stables (200) minus top-ten ETH (300)
    expect(row.close.others).toBeCloseTo(500);
    expect(row.close.eth).toBeCloseTo(10);
    expect(row.close.stable).toBeCloseTo(10);
  });

  it("shrinks the stablecoin share when the market rises and grows it when the market falls", () => {
    const series = { BTCUSDT: bars([[50, 50], [200, 200]]), ETHUSDT: bars([[5, 5], [20, 20]]) };
    const [down, up] = computeDominanceRows(weights, series, reference);
    expect(down.close.stable).toBeGreaterThan(10);
    expect(up.close.stable).toBeLessThan(10);
  });

  it("draws wicks from each coin's own high and low", () => {
    const series = {
      BTCUSDT: [{ timestamp: 0, open: 100, high: 120, low: 90, close: 105 }],
      ETHUSDT: [{ timestamp: 0, open: 10, high: 12, low: 9, close: 10.5 }],
    };
    const [row] = computeDominanceRows(weights, series, reference);
    for (const key of ["btc", "eth", "usdt", "total", "others"] as const) {
      expect(row.high[key]).toBeGreaterThanOrEqual(Math.max(row.open[key], row.close[key]));
      expect(row.low[key]).toBeLessThanOrEqual(Math.min(row.open[key], row.close[key]));
    }
    expect(row.high.total).toBeGreaterThan(Math.max(row.open.total, row.close.total));
    expect(row.low.total).toBeLessThan(Math.min(row.open.total, row.close.total));
    expect(row.high.btc).toBeGreaterThan(Math.max(row.open.btc, row.close.btc));
  });
});

describe("buildDominanceWeights: ethereum and the top ten", () => {
  const markets = [
    { id: "bitcoin", symbol: "btc", market_cap: 500, current_price: 80000, market_cap_rank: 1 },
    { id: "ethereum", symbol: "eth", market_cap: 200, current_price: 2500, market_cap_rank: 2 },
    { id: "tether", symbol: "usdt", market_cap: 100, current_price: 1, market_cap_rank: 3 },
    { id: "ripple", symbol: "xrp", market_cap: 60, current_price: 2, market_cap_rank: 4 },
    { id: "small-coin", symbol: "sml", market_cap: 5, current_price: 2, market_cap_rank: 40 },
  ];
  const weights = buildDominanceWeights(GLOBAL, markets, new Set(["BTCUSDT", "ETHUSDT", "XRPUSDT", "SMLUSDT"]), 1);

  it("keeps ethereum on its own and records which tracked coins are in the top ten", () => {
    expect(weights.ethereumCap).toBe(200);
    expect(weights.topTen).toEqual({ stableCap: 100, trackedCaps: { ETHUSDT: 200, XRPUSDT: 60 }, untrackedCap: 0 });
    expect(weights.trackedCaps.SMLUSDT).toBe(5);
  });
});

describe("referencePrices", () => {
  it("takes the last close at or before the capture time, else the latest", () => {
    const series = { BTCUSDT: bars([[1, 10], [10, 20], [20, 30]]), ETHUSDT: bars([[5, 6]], 600_000) };
    expect(referencePrices(series, 60_000)).toEqual({ BTCUSDT: 20, ETHUSDT: 6 });
    expect(referencePrices({ EMPTY: [] }, 1)).toEqual({});
  });
});

function fakeApi(handler: (path: string) => Response | "network-error") {
  const calls: string[] = [];
  const fetcher = async (input: string): Promise<Response> => {
    const path = input.replace("https://api.coingecko.com/api/v3", "");
    calls.push(path.split("?")[0]);
    const result = handler(path);
    if (result === "network-error") throw new TypeError("Failed to fetch");
    return result;
  };
  return { calls, fetcher };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => {};

describe("fetchDominanceWeights", () => {
  it("needs only two requests", async () => {
    const api = fakeApi((path) => json(path === "/global" ? GLOBAL : MARKETS));
    const weights = await fetchDominanceWeights(AVAILABLE, { fetcher: api.fetcher, sleep: noSleep, nowMs: 5 });
    expect(api.calls).toEqual(["/global", "/coins/markets"]);
    expect(weights.bitcoinCap).toBe(500);
  });

  it("retries through a rate limit that the browser reports as a network error", async () => {
    let attempts = 0;
    const api = fakeApi((path) => {
      if (path === "/global") {
        attempts += 1;
        return attempts === 1 ? "network-error" : json(GLOBAL);
      }
      return json(MARKETS);
    });
    await expect(fetchDominanceWeights(AVAILABLE, { fetcher: api.fetcher, sleep: noSleep })).resolves.toBeDefined();
    expect(attempts).toBe(2);
  });

  it("gives up with a clear message, and does not retry other HTTP failures", async () => {
    const down = fakeApi(() => "network-error");
    await expect(fetchDominanceWeights(AVAILABLE, { fetcher: down.fetcher, sleep: noSleep })).rejects.toThrow(
      DOMINANCE_UNAVAILABLE_MESSAGE,
    );
    const broken = fakeApi(() => json({}, 500));
    await expect(fetchDominanceWeights(AVAILABLE, { fetcher: broken.fetcher, sleep: noSleep })).rejects.toThrow(/500/);
    expect(broken.calls).toHaveLength(1);
  });
});
