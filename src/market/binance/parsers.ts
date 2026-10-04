import { MarketDataParseError } from "../errors";
import { isMarketInterval, type MarketInterval } from "../intervals";
import { marketIdFor, normalizeBinanceSpotSymbol, type Candle } from "../types";

export interface BinanceKlineContext {
  symbol: string;
  interval: MarketInterval;
  nowMs?: number;
}

function fail(message: string, payload: unknown): never {
  throw new MarketDataParseError(message, payload);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${label} must be an object`, value);
  }

  return value as Record<string, unknown>;
}

function asInteger(value: unknown, label: string, payload: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fail(`${label} must be a safe integer`, payload);
  }

  return value;
}

function asDecimalString(value: unknown, label: string, payload: unknown): string {
  if (typeof value !== "string" || value.length === 0 || !Number.isFinite(Number(value))) {
    return fail(`${label} must be a decimal string`, payload);
  }

  return value;
}

function asString(value: unknown, label: string, payload: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${label} must be a non-empty string`, payload);
  }

  return value;
}

function asBoolean(value: unknown, label: string, payload: unknown): boolean {
  if (typeof value !== "boolean") {
    return fail(`${label} must be a boolean`, payload);
  }

  return value;
}

export function parseBinanceRestKline(raw: unknown, context: BinanceKlineContext): Candle {
  if (!Array.isArray(raw) || raw.length < 11) {
    return fail("Binance REST kline must contain at least 11 fields", raw);
  }

  const symbol = normalizeBinanceSpotSymbol(context.symbol);
  const openTimeMs = asInteger(raw[0], "open time", raw);
  const closeTimeMs = asInteger(raw[6], "close time", raw);

  if (closeTimeMs < openTimeMs) {
    return fail("Kline close time cannot precede open time", raw);
  }

  return {
    marketId: marketIdFor(symbol),
    symbol,
    interval: context.interval,
    openTimeMs,
    closeTimeMs,
    open: asDecimalString(raw[1], "open", raw),
    high: asDecimalString(raw[2], "high", raw),
    low: asDecimalString(raw[3], "low", raw),
    close: asDecimalString(raw[4], "close", raw),
    volume: asDecimalString(raw[5], "volume", raw),
    quoteVolume: asDecimalString(raw[7], "quote volume", raw),
    tradeCount: asInteger(raw[8], "trade count", raw),
    takerBuyBaseVolume: asDecimalString(raw[9], "taker-buy base volume", raw),
    takerBuyQuoteVolume: asDecimalString(raw[10], "taker-buy quote volume", raw),
    isFinal: closeTimeMs < (context.nowMs ?? Date.now()),
  };
}

export function parseBinanceRestKlines(payload: unknown, context: BinanceKlineContext): Candle[] {
  if (!Array.isArray(payload)) {
    return fail("Binance REST klines response must be an array", payload);
  }

  // Sorting and keying by open time also protects the chart from accidental
  // duplicate insertion if an upstream cache returns overlapping pages.
  const candlesByOpenTime = new Map<number, Candle>();

  for (const raw of payload) {
    const candle = parseBinanceRestKline(raw, context);
    candlesByOpenTime.set(candle.openTimeMs, candle);
  }

  return [...candlesByOpenTime.values()].sort((left, right) => left.openTimeMs - right.openTimeMs);
}

export function parseBinanceWebSocketKline(payload: unknown): Candle {
  let decoded = payload;

  if (typeof payload === "string") {
    try {
      decoded = JSON.parse(payload) as unknown;
    } catch {
      return fail("Binance WebSocket message is not valid JSON", payload);
    }
  }

  const event = asRecord(decoded, "Binance WebSocket message");

  if (event.e !== "kline") {
    return fail("Binance WebSocket message is not a kline event", decoded);
  }

  const eventTimeMs = asInteger(event.E, "event time", decoded);
  const eventSymbol = normalizeBinanceSpotSymbol(asString(event.s, "event symbol", decoded));
  const kline = asRecord(event.k, "kline payload");
  const klineSymbol = normalizeBinanceSpotSymbol(asString(kline.s, "kline symbol", decoded));
  const interval = kline.i;

  if (eventSymbol !== klineSymbol) {
    return fail("Event and kline symbols do not match", decoded);
  }

  if (!isMarketInterval(interval)) {
    return fail(`Unsupported Binance kline interval: ${String(interval)}`, decoded);
  }

  const openTimeMs = asInteger(kline.t, "open time", decoded);
  const closeTimeMs = asInteger(kline.T, "close time", decoded);

  if (closeTimeMs < openTimeMs) {
    return fail("Kline close time cannot precede open time", decoded);
  }

  return {
    marketId: marketIdFor(eventSymbol),
    symbol: eventSymbol,
    interval,
    openTimeMs,
    closeTimeMs,
    open: asDecimalString(kline.o, "open", decoded),
    high: asDecimalString(kline.h, "high", decoded),
    low: asDecimalString(kline.l, "low", decoded),
    close: asDecimalString(kline.c, "close", decoded),
    volume: asDecimalString(kline.v, "volume", decoded),
    quoteVolume: asDecimalString(kline.q, "quote volume", decoded),
    tradeCount: asInteger(kline.n, "trade count", decoded),
    takerBuyBaseVolume: asDecimalString(kline.V, "taker-buy base volume", decoded),
    takerBuyQuoteVolume: asDecimalString(kline.Q, "taker-buy quote volume", decoded),
    isFinal: asBoolean(kline.x, "closed flag", decoded),
    eventTimeMs,
  };
}

