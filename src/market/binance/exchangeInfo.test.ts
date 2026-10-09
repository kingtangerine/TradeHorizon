import { describe, expect, it } from "vitest";
import { parseBinanceExchangeInfo } from "./exchangeInfo";

function entry(overrides: Record<string, unknown>) {
  return {
    symbol: "BTCUSDT",
    status: "TRADING",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    isSpotTradingAllowed: true,
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
      { filterType: "LOT_SIZE", stepSize: "0.00001000" },
    ],
    ...overrides,
  };
}

describe("parseBinanceExchangeInfo", () => {
  it("keeps trading USDT spot pairs and derives precision from tick and step sizes", () => {
    const result = parseBinanceExchangeInfo({
      symbols: [
        entry({}),
        entry({ symbol: "SHIBUSDT", baseAsset: "SHIB", filters: [
          { filterType: "PRICE_FILTER", tickSize: "0.00000001" },
          { filterType: "LOT_SIZE", stepSize: "1.00000000" },
        ] }),
      ],
    });

    expect(result).toEqual([
      { symbol: "BTCUSDT", baseAsset: "BTC", pricePrecision: 2, volumePrecision: 5 },
      { symbol: "SHIBUSDT", baseAsset: "SHIB", pricePrecision: 8, volumePrecision: 0 },
    ]);
  });

  it("keeps USDT and BTC pairs and drops other quotes, halted, and non-spot symbols", () => {
    const result = parseBinanceExchangeInfo({
      symbols: [
        entry({ symbol: "ETHBTC", baseAsset: "ETH", quoteAsset: "BTC" }),
        entry({ symbol: "ETHEUR", baseAsset: "ETH", quoteAsset: "EUR" }),
        entry({ symbol: "LUNAUSDT", baseAsset: "LUNA", status: "BREAK" }),
        entry({ symbol: "XUSDT", baseAsset: "X", isSpotTradingAllowed: false }),
        entry({ symbol: "ETHUSDT", baseAsset: "ETH" }),
      ],
    });

    expect(result.map((item) => item.symbol)).toEqual(["ETHBTC", "ETHUSDT"]);
    expect(result.find((item) => item.symbol === "ETHBTC")?.quoteAsset).toBe("BTC");
  });

  it("falls back to default precision when filters are missing and rejects bad payloads", () => {
    expect(parseBinanceExchangeInfo({ symbols: [entry({ filters: [] })] })[0]).toMatchObject({
      pricePrecision: 2,
      volumePrecision: 4,
    });
    expect(() => parseBinanceExchangeInfo({})).toThrow(TypeError);
  });
});
