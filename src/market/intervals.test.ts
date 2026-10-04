import { describe, expect, it } from "vitest";

import {
  getMarketIntervalSpec,
  isMarketInterval,
  MARKET_INTERVALS,
  toBinanceKlineInterval,
} from "./intervals";

describe("market intervals", () => {
  it("maps every supported application interval to a Binance interval", () => {
    for (const interval of MARKET_INTERVALS) {
      expect(toBinanceKlineInterval(interval)).toBe(interval);
    }
  });

  it("distinguishes fixed intervals from calendar months", () => {
    expect(getMarketIntervalSpec("5m").durationMs).toBe(300_000);
    expect(getMarketIntervalSpec("1M").durationMs).toBeNull();
  });

  it("validates values without changing Binance's case-sensitive month interval", () => {
    expect(isMarketInterval("1m")).toBe(true);
    expect(isMarketInterval("1M")).toBe(true);
    expect(isMarketInterval("1month")).toBe(false);
    expect(isMarketInterval("1mo")).toBe(false);
  });
});

