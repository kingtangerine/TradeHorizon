import { describe, expect, it, vi } from "vitest";

import { MarketDataHttpError, StaleMarketDataRequestError } from "../errors";
import {
  fetchBinanceKlines,
  LatestBinanceKlinesLoader,
  type FetchBinanceKlinesOptions,
  type MarketDataFetch,
} from "./rest";

const REST_ROW = [
  1_000,
  "100.0",
  "103.0",
  "99.0",
  "101.5",
  "12.25",
  60_999,
  "1240.0",
  42,
  "6.0",
  "610.0",
  "0",
];

describe("fetchBinanceKlines", () => {
  it("uses the public market-data-only endpoint and expected query parameters", async () => {
    const fetcher: MarketDataFetch = vi.fn(async () =>
      new Response(JSON.stringify([REST_ROW]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const candles = await fetchBinanceKlines(
      {
        symbol: "btcusdt",
        interval: "5m",
        startTimeMs: 1_000,
        endTimeMs: 9_000,
        limit: 250,
      },
      fetcher,
    );

    const input = vi.mocked(fetcher).mock.calls[0]?.[0];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://data-api.binance.vision");
    expect(url.pathname).toBe("/api/v3/klines");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      symbol: "BTCUSDT",
      interval: "5m",
      startTime: "1000",
      endTime: "9000",
      limit: "250",
    });
    expect(candles).toHaveLength(1);
  });

  it("surfaces non-success status codes as typed errors", async () => {
    const fetcher: MarketDataFetch = vi.fn(async () =>
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" }),
    );

    await expect(fetchBinanceKlines({ interval: "1m" }, fetcher)).rejects.toBeInstanceOf(
      MarketDataHttpError,
    );
  });

  it("validates request ranges before accessing the network", async () => {
    const fetcher: MarketDataFetch = vi.fn();

    await expect(fetchBinanceKlines({ interval: "1m", limit: 1001 }, fetcher)).rejects.toThrow(
      /limit/,
    );
    await expect(
      fetchBinanceKlines({ interval: "1m", startTimeMs: 2_000, endTimeMs: 1_000 }, fetcher),
    ).rejects.toThrow(/startTimeMs/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("LatestBinanceKlinesLoader", () => {
  it("aborts the previous request and rejects a stale result even if its fetcher ignores abort", async () => {
    let resolveFirst: ((value: []) => void) | undefined;
    let call = 0;
    const fetcher = vi.fn((_options: FetchBinanceKlinesOptions) => {
      ++call;

      if (call === 1) {
        return new Promise<[]>((resolve) => {
          resolveFirst = resolve;
        });
      }

      return Promise.resolve([]);
    });
    const loader = new LatestBinanceKlinesLoader(fetcher);
    const first = loader.load({ interval: "1m" });
    const firstSignal = fetcher.mock.calls[0]?.[0].signal;
    const firstExpectation = expect(first).rejects.toBeInstanceOf(StaleMarketDataRequestError);

    const second = await loader.load({ interval: "1h" });
    expect(second).toEqual({ generation: 2, candles: [] });
    expect(firstSignal?.aborted).toBe(true);

    resolveFirst?.([]);
    await firstExpectation;
  });

  it("links a caller AbortSignal into the active request", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (options) => {
      observedSignal = options.signal;
      return [];
    });
    const caller = new AbortController();
    const loader = new LatestBinanceKlinesLoader(fetcher);

    caller.abort();
    await loader.load({ interval: "1m", signal: caller.signal });
    expect(observedSignal?.aborted).toBe(true);
  });
});
