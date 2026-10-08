import { describe, expect, it } from "vitest";
import { fetchBybitKlines, parseBybitInstruments, parseBybitRestKlines } from "./bybit";

const HOUR = 3_600_000;
const row = (start: number, open: string, high: string, low: string, close: string) => [String(start), open, high, low, close, "10", "100"];

describe("parseBybitInstruments", () => {
  it("keeps trading USDT pairs only and reads precision", () => {
    const listings = parseBybitInstruments({ result: { list: [
      { symbol: "ZETAUSDT", baseCoin: "ZETA", quoteCoin: "USDT", status: "Trading", priceFilter: { tickSize: "0.00001" }, lotSizeFilter: { basePrecision: "0.01" } },
      { symbol: "ZETABTC", baseCoin: "ZETA", quoteCoin: "BTC", status: "Trading" },
      { symbol: "OLDUSDT", baseCoin: "OLD", quoteCoin: "USDT", status: "PreLaunch" },
    ] } });
    expect(listings).toEqual([{ exchange: "bybit", symbol: "ZETAUSDT", baseAsset: "ZETA", pricePrecision: 5, volumePrecision: 2 }]);
  });
});

describe("parseBybitRestKlines", () => {
  it("returns ascending candles tagged with the bybit market id", () => {
    const candles = parseBybitRestKlines({ result: { list: [row(2 * HOUR, "2", "3", "1", "2.5"), row(HOUR, "1", "2", "0.5", "2")] } }, "ZETAUSDT", "1h", 10 * HOUR);
    expect(candles.map((candle) => candle.openTimeMs)).toEqual([HOUR, 2 * HOUR]);
    expect(candles[0].marketId).toBe("bybit:spot:ZETAUSDT");
    expect(candles[0].isFinal).toBe(true);
  });
});

describe("fetchBybitKlines", () => {
  it("builds 8h candles from 4h ones", async () => {
    const base = [row(16 * HOUR, "4", "6", "3", "5"), row(12 * HOUR, "3", "5", "2", "4"), row(8 * HOUR, "2", "4", "1", "3"), row(4 * HOUR, "1", "3", "0.5", "2")];
    const fetcher = async () => new Response(JSON.stringify({ retCode: 0, result: { list: base } }));
    const bars = await fetchBybitKlines({ symbol: "ZETAUSDT", interval: "8h", limit: 5 }, fetcher);
    // 4h..8h is a partial first bucket (starts at 4h, not 0h) so it is kept only when history ends there.
    const full = bars.find((bar) => bar.openTimeMs === 8 * HOUR);
    expect(full).toMatchObject({ open: "2", close: "4", high: "5", low: "1" });
  });
});
