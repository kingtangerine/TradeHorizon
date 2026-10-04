export const MARKET_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;

export type MarketInterval = (typeof MARKET_INTERVALS)[number];
export type BinanceKlineInterval = MarketInterval;

export interface MarketIntervalSpec {
  label: string;
  binanceInterval: BinanceKlineInterval;
  /** Null for calendar-based intervals such as one month. */
  durationMs: number | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const MARKET_INTERVAL_SPECS: Readonly<Record<MarketInterval, MarketIntervalSpec>> = {
  "1m": { label: "1m", binanceInterval: "1m", durationMs: MINUTE_MS },
  "3m": { label: "3m", binanceInterval: "3m", durationMs: 3 * MINUTE_MS },
  "5m": { label: "5m", binanceInterval: "5m", durationMs: 5 * MINUTE_MS },
  "15m": { label: "15m", binanceInterval: "15m", durationMs: 15 * MINUTE_MS },
  "30m": { label: "30m", binanceInterval: "30m", durationMs: 30 * MINUTE_MS },
  "1h": { label: "1h", binanceInterval: "1h", durationMs: HOUR_MS },
  "2h": { label: "2h", binanceInterval: "2h", durationMs: 2 * HOUR_MS },
  "4h": { label: "4h", binanceInterval: "4h", durationMs: 4 * HOUR_MS },
  "6h": { label: "6h", binanceInterval: "6h", durationMs: 6 * HOUR_MS },
  "8h": { label: "8h", binanceInterval: "8h", durationMs: 8 * HOUR_MS },
  "12h": { label: "12h", binanceInterval: "12h", durationMs: 12 * HOUR_MS },
  "1d": { label: "1D", binanceInterval: "1d", durationMs: DAY_MS },
  "3d": { label: "3D", binanceInterval: "3d", durationMs: 3 * DAY_MS },
  "1w": { label: "1W", binanceInterval: "1w", durationMs: 7 * DAY_MS },
  "1M": { label: "1M", binanceInterval: "1M", durationMs: null },
};

const INTERVAL_SET: ReadonlySet<string> = new Set(MARKET_INTERVALS);

export function isMarketInterval(value: unknown): value is MarketInterval {
  return typeof value === "string" && INTERVAL_SET.has(value);
}

export function toBinanceKlineInterval(interval: MarketInterval): BinanceKlineInterval {
  return MARKET_INTERVAL_SPECS[interval].binanceInterval;
}

export function getMarketIntervalSpec(interval: MarketInterval): MarketIntervalSpec {
  return MARKET_INTERVAL_SPECS[interval];
}

