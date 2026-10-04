export class MarketDataParseError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "MarketDataParseError";
    this.payload = payload;
  }
}

export class MarketDataHttpError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`Binance market-data request failed (${status} ${statusText})`);
    this.name = "MarketDataHttpError";
    this.status = status;
    this.statusText = statusText;
  }
}

export class StaleMarketDataRequestError extends Error {
  readonly generation: number;

  constructor(generation: number) {
    super(`Ignored stale market-data request generation ${generation}`);
    this.name = "StaleMarketDataRequestError";
    this.generation = generation;
  }
}

export class MarketDataConnectionError extends Error {
  readonly event: unknown;

  constructor(message: string, event?: unknown) {
    super(message);
    this.name = "MarketDataConnectionError";
    this.event = event;
  }
}

