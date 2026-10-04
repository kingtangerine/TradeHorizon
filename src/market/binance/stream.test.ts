import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Candle } from "../types";
import {
  BinanceKlineSubscription,
  binanceKlineStreamUrl,
  type WebSocketConnection,
  type WebSocketFactory,
} from "./stream";

const LIVE_MESSAGE = JSON.stringify({
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
  },
});

class FakeSocket implements WebSocketConnection {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly close = vi.fn();

  emitOpen(): void {
    this.onopen?.({});
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitClose(): void {
    this.onclose?.({ code: 1006 });
  }
}

describe("BinanceKlineSubscription", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("builds the Binance market-data-only stream URL", () => {
    expect(binanceKlineStreamUrl("btcusdt", "1m")).toBe(
      "wss://data-stream.binance.vision/ws/btcusdt@kline_1m",
    );
  });

  it("normalizes messages and reconnects with backoff after a disconnect", async () => {
    const sockets: FakeSocket[] = [];
    const factory: WebSocketFactory = vi.fn(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const candles: Candle[] = [];
    const states: string[] = [];
    const subscription = new BinanceKlineSubscription({
      interval: "1m",
      onCandle: (candle) => candles.push(candle),
      onStatus: (status) => states.push(status.state),
      webSocketFactory: factory,
      reconnect: { initialDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
    });

    expect(sockets).toHaveLength(1);
    sockets[0]?.emitOpen();
    sockets[0]?.emitMessage(LIVE_MESSAGE);
    expect(candles[0]).toMatchObject({ symbol: "BTCUSDT", interval: "1m", close: "101.5" });

    sockets[0]?.emitClose();
    expect(states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(99);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    subscription.stop();
  });

  it("drops stale callbacks and cancels reconnect timers when stopped", async () => {
    const sockets: FakeSocket[] = [];
    const factory: WebSocketFactory = () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
    const onCandle = vi.fn();
    const subscription = new BinanceKlineSubscription({
      interval: "1m",
      onCandle,
      webSocketFactory: factory,
      reconnect: { initialDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
    });
    const oldSocket = sockets[0];

    oldSocket?.emitClose();
    subscription.stop();
    oldSocket?.emitMessage(LIVE_MESSAGE);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sockets).toHaveLength(1);
    expect(onCandle).not.toHaveBeenCalled();
    expect(oldSocket?.close).not.toHaveBeenCalled();
  });

  it("stops immediately when its caller aborts", () => {
    const socket = new FakeSocket();
    const abortController = new AbortController();
    const subscription = new BinanceKlineSubscription({
      interval: "1m",
      onCandle: vi.fn(),
      signal: abortController.signal,
      webSocketFactory: () => socket,
    });

    abortController.abort();

    expect(subscription.active).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(1000, "subscription stopped");
  });

  it("reports malformed and cross-stream messages without delivering a candle", () => {
    const socket = new FakeSocket();
    const onCandle = vi.fn();
    const onError = vi.fn();
    const subscription = new BinanceKlineSubscription({
      interval: "1m",
      onCandle,
      onError,
      webSocketFactory: () => socket,
    });

    socket.emitMessage("not-json");
    socket.emitMessage(LIVE_MESSAGE.replaceAll("BTCUSDT", "ETHUSDT"));

    expect(onCandle).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
    subscription.stop();
  });
});

