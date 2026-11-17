/** Thrown when an exchange payload has an unexpected shape; `payload` holds the offending value. */
export class MarketDataParseError extends Error {
  readonly payload: unknown

  constructor(message: string, payload: unknown) {
    super(message)
    this.name = 'MarketDataParseError'
    this.payload = payload
  }
}

/** Thrown when a market-data HTTP request gets a non-2xx response (used for every venue despite the Binance wording). */
export class MarketDataHttpError extends Error {
  readonly status: number
  readonly statusText: string

  constructor(status: number, statusText: string) {
    super(`Binance market-data request failed (${status} ${statusText})`)
    this.name = 'MarketDataHttpError'
    this.status = status
    this.statusText = statusText
  }
}

/** Thrown by LatestBinanceKlinesLoader when a newer load superseded this one; callers should ignore it. */
export class StaleMarketDataRequestError extends Error {
  readonly generation: number

  constructor(generation: number) {
    super(`Ignored stale market-data request generation ${generation}`)
    this.name = 'StaleMarketDataRequestError'
    this.generation = generation
  }
}

/** Reported for WebSocket errors, unexpected stream messages and exchange-level API errors; `event` holds the raw cause. */
export class MarketDataConnectionError extends Error {
  readonly event: unknown

  constructor(message: string, event?: unknown) {
    super(message)
    this.name = 'MarketDataConnectionError'
    this.event = event
  }
}
