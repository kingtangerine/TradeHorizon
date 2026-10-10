import { MarketDataConnectionError } from "../errors";
import type { MarketInterval } from "../intervals";
import { DEFAULT_BINANCE_SPOT_SYMBOL, normalizeBinanceSpotSymbol, type Candle } from "../types";
import { parseBinanceWebSocketKline } from "./parsers";

export const BINANCE_MARKET_DATA_WS_ENDPOINT = "wss://data-stream.binance.vision/ws";

export const BINANCE_FUTURES_WS_ENDPOINT = "wss://fstream.binance.com/ws";

export type KlineStreamState = "connecting" | "open" | "reconnecting" | "stopped";

export interface KlineStreamStatus {
  state: KlineStreamState;
  generation: number;
  attempt: number;
  retryInMs?: number;
}

export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export interface WebSocketConnection {
  /** 1 when open. Optional because test doubles do not have it. */
  readonly readyState?: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketConnection;

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BinanceKlineSubscriptionOptions {
  symbol?: string;
  interval: MarketInterval;
  onCandle(candle: Candle): void;
  onStatus?(status: KlineStreamStatus): void;
  onError?(error: Error): void;
  signal?: AbortSignal;
  endpoint?: string;
  webSocketFactory?: WebSocketFactory;
  reconnect?: Partial<ReconnectPolicy>;
  scheduler?: TimerScheduler;
  random?: () => number;
}

const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
};

const DEFAULT_SCHEDULER: TimerScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultWebSocketFactory(url: string): WebSocketConnection {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("WebSocket is unavailable in this runtime");
  }

  return new globalThis.WebSocket(url) as unknown as WebSocketConnection;
}

function validateReconnectPolicy(policy: ReconnectPolicy): void {
  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new RangeError("initialDelayMs must be a non-negative number");
  }

  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) {
    throw new RangeError("maxDelayMs must be greater than or equal to initialDelayMs");
  }

  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new RangeError("jitterRatio must be between 0 and 1");
  }
}

export function binanceKlineStreamUrl(
  symbol: string,
  interval: MarketInterval,
  endpoint = BINANCE_MARKET_DATA_WS_ENDPOINT,
): string {
  const normalizedSymbol = normalizeBinanceSpotSymbol(symbol);
  return `${endpoint.replace(/\/$/, "")}/${normalizedSymbol.toLowerCase()}@kline_${interval}`;
}

/** A self-reconnecting, abortable subscription for one symbol and interval. */
export class BinanceKlineSubscription {
  readonly symbol: string;
  readonly interval: MarketInterval;
  readonly #options: BinanceKlineSubscriptionOptions;
  readonly #factory: WebSocketFactory;
  readonly #scheduler: TimerScheduler;
  readonly #policy: ReconnectPolicy;
  readonly #random: () => number;

  #active = true;
  #generation = 1;
  #retryAttempt = 0;
  #socket: WebSocketConnection | undefined;
  #retryTimer: unknown;

  constructor(options: BinanceKlineSubscriptionOptions) {
    this.#options = options;
    this.symbol = normalizeBinanceSpotSymbol(options.symbol ?? DEFAULT_BINANCE_SPOT_SYMBOL);
    this.interval = options.interval;
    this.#factory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.#scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.#random = options.random ?? Math.random;
    this.#policy = { ...DEFAULT_RECONNECT_POLICY, ...options.reconnect };
    validateReconnectPolicy(this.#policy);

    if (options.signal?.aborted) {
      this.#active = false;
      this.#emitStatus("stopped", 0);
      return;
    }

    options.signal?.addEventListener("abort", this.#handleAbort, { once: true });
    this.#connect(this.#generation);
  }

  get generation(): number {
    return this.#generation;
  }

  get active(): boolean {
    return this.#active;
  }

  stop(): void {
    if (!this.#active) {
      return;
    }

    this.#active = false;
    ++this.#generation;
    this.#options.signal?.removeEventListener("abort", this.#handleAbort);

    if (this.#retryTimer !== undefined) {
      this.#scheduler.clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }

    const socket = this.#socket;
    this.#socket = undefined;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, "subscription stopped");
    }

    this.#emitStatus("stopped", this.#retryAttempt);
  }

  /**
   * Called when the page becomes visible again or the network returns. A connection that died while the page was in
   * the background (common on phones) is replaced immediately instead of waiting for the retry timer. With
   * `force` the connection is replaced even if it looks open, because a long sleep can leave it silently dead.
   */
  nudge(force = false): void {
    if (!this.#active) {
      return;
    }

    const socket = this.#socket;
    const open = socket !== undefined && (socket.readyState === undefined || socket.readyState === 1);

    if (open && !force) {
      return;
    }

    if (this.#retryTimer !== undefined) {
      this.#scheduler.clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      this.#socket = undefined;

      try {
        socket.close(1000, "refreshing connection");
      } catch {
        // Already closed.
      }
    }

    this.#retryAttempt = 0;
    this.#connect(this.#generation);
  }

  readonly #handleAbort = (): void => this.stop();

  #isCurrent(generation: number, socket?: WebSocketConnection): boolean {
    return (
      this.#active &&
      generation === this.#generation &&
      (socket === undefined || socket === this.#socket)
    );
  }

  #connect(generation: number): void {
    if (!this.#isCurrent(generation)) {
      return;
    }

    this.#emitStatus(this.#retryAttempt === 0 ? "connecting" : "reconnecting", this.#retryAttempt);

    let socket: WebSocketConnection;

    try {
      socket = this.#factory(
        binanceKlineStreamUrl(
          this.symbol,
          this.interval,
          this.#options.endpoint ?? BINANCE_MARKET_DATA_WS_ENDPOINT,
        ),
      );
    } catch (error) {
      this.#reportError(error);
      this.#scheduleReconnect(generation);
      return;
    }

    this.#socket = socket;

    socket.onopen = () => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }

      this.#retryAttempt = 0;
      this.#emitStatus("open", 0);
    };

    socket.onmessage = (event) => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }

      try {
        const candle = parseBinanceWebSocketKline(event.data);

        // A defensive check keeps a misrouted multiplexed message out of this
        // single-market stream.
        if (candle.symbol !== this.symbol || candle.interval !== this.interval) {
          throw new MarketDataConnectionError(
            `Unexpected kline stream ${candle.symbol}/${candle.interval}; expected ${this.symbol}/${this.interval}`,
          );
        }

        this.#options.onCandle(candle);
      } catch (error) {
        this.#reportError(error);
      }
    };

    socket.onerror = (event) => {
      if (this.#isCurrent(generation, socket)) {
        this.#reportError(new MarketDataConnectionError("Binance WebSocket error", event));
      }
    };

    socket.onclose = () => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }

      this.#socket = undefined;
      this.#scheduleReconnect(generation);
    };
  }

  #scheduleReconnect(generation: number): void {
    if (!this.#isCurrent(generation) || this.#retryTimer !== undefined) {
      return;
    }

    const exponentialDelay = Math.min(
      this.#policy.initialDelayMs * 2 ** this.#retryAttempt,
      this.#policy.maxDelayMs,
    );
    const jitterMultiplier =
      1 - this.#policy.jitterRatio + this.#random() * 2 * this.#policy.jitterRatio;
    const retryInMs = Math.round(exponentialDelay * jitterMultiplier);
    ++this.#retryAttempt;
    this.#emitStatus("reconnecting", this.#retryAttempt, retryInMs);

    this.#retryTimer = this.#scheduler.setTimeout(() => {
      this.#retryTimer = undefined;
      this.#connect(generation);
    }, retryInMs);
  }

  #emitStatus(state: KlineStreamState, attempt: number, retryInMs?: number): void {
    const status: KlineStreamStatus = {
      state,
      generation: this.#generation,
      attempt,
    };

    if (retryInMs !== undefined) {
      status.retryInMs = retryInMs;
    }

    this.#options.onStatus?.(status);
  }

  #reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new MarketDataConnectionError(String(error), error);
    this.#options.onError?.(normalized);
  }
}

export function subscribeToBinanceKlines(
  options: BinanceKlineSubscriptionOptions,
): BinanceKlineSubscription {
  return new BinanceKlineSubscription(options);
}

