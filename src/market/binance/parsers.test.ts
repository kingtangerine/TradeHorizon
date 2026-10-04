import { describe, expect, it } from "vitest";

import { MarketDataParseError } from "../errors";
import { parseBinanceRestKline, parseBinanceRestKlines, parseBinanceWebSocketKline } from "./parsers";

const restKline = (openTimeMs = 1_000, close = "101.5"): unknown[] => [
  openTimeMs,
  "100.0",
  "103.0",
  "99.0",
  close,
  "12.25",
  openTimeMs + 59_999,
  "1240.0",
  42,
  "6.0",
  "610.0",
  "0",
];

const webSocketKline = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  e: "kline",
  E: 61_001,
  s: "BTCUSDT",
  k: {
    t: 1_000,
    T: 60_999,
    s: "BTCUSDT",
    i: "1m",
    o: "100.0",
    h: "103.0",
    l: "99.0",
    c: "101.5",
    v: "12.25",
    n: 42,
    x: false,
    q: "1240.0",
    V: "6.0",
    Q: "610.0",
    ...overrides,
  },
});

describe("Binance kline parsers", () => {
  it("normalizes a REST tuple while preserving decimal precision as strings", () => {
    const candle = parseBinanceRestKline(restKline(), {
      symbol: "btcusdt",
      interval: "1m",
      nowMs: 100_000,
    });

    expect(candle).toMatchObject({
      marketId: "binance:spot:BTCUSDT",
      symbol: "BTCUSDT",
      interval: "1m",
      openTimeMs: 1_000,
      closeTimeMs: 60_999,
      open: "100.0",
      close: "101.5",
      tradeCount: 42,
      isFinal: true,
    });
  });

  it("sorts and deduplicates overlapping REST pages by open time", () => {
    const candles = parseBinanceRestKlines(
      [restKline(61_000), restKline(1_000), restKline(1_000, "102.0")],
      { symbol: "BTCUSDT", interval: "1m", nowMs: 200_000 },
    );

    expect(candles.map((candle) => candle.openTimeMs)).toEqual([1_000, 61_000]);
    expect(candles[0]?.close).toBe("102.0");
  });

  it("parses a live WebSocket candle and its finality flag", () => {
    const candle = parseBinanceWebSocketKline(JSON.stringify(webSocketKline({ x: true })));

    expect(candle).toMatchObject({
      symbol: "BTCUSDT",
      interval: "1m",
      close: "101.5",
      isFinal: true,
      eventTimeMs: 61_001,
    });
  });

  it("rejects malformed or unsupported messages instead of poisoning the store", () => {
    expect(() => parseBinanceWebSocketKline("not json")).toThrow(MarketDataParseError);
    expect(() => parseBinanceWebSocketKline(webSocketKline({ i: "7m" }))).toThrow(
      /Unsupported Binance kline interval/,
    );
    expect(() => parseBinanceRestKline([1, "bad"], { symbol: "BTCUSDT", interval: "1m" })).toThrow(
      MarketDataParseError,
    );
  });
});

