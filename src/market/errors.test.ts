import { describe, expect, it } from 'vitest'
import { BINANCE_EXCHANGE_INFO_ENDPOINT } from './binance/exchangeInfo'
import { BINANCE_FUTURES_EXCHANGE_INFO } from './binance/futures'
import { BINANCE_FUTURES_REST_ENDPOINT, BINANCE_MARKET_DATA_REST_ENDPOINT, fetchBinanceKlines } from './binance/rest'
import { BYBIT_REST_ENDPOINT } from './bybit/bybit'
import { MarketDataHttpError, marketSourceOf } from './errors'
import { fetchVenueKlines } from './venues'

const failWith =
  (status: number, statusText = '') =>
  () =>
    Promise.resolve(new Response('', { status, statusText }))

describe('marketSourceOf', () => {
  it('names the exchange behind each endpoint the app calls', () => {
    expect(marketSourceOf(BINANCE_MARKET_DATA_REST_ENDPOINT)).toBe('Binance')
    expect(marketSourceOf(BINANCE_EXCHANGE_INFO_ENDPOINT)).toBe('Binance')
    expect(marketSourceOf(BINANCE_FUTURES_REST_ENDPOINT)).toBe('Binance Futures')
    expect(marketSourceOf(BINANCE_FUTURES_EXCHANGE_INFO)).toBe('Binance Futures')
    expect(marketSourceOf(`${BYBIT_REST_ENDPOINT}/kline`)).toBe('Bybit')
    expect(marketSourceOf('https://www.okx.com/api/v5/market/candles')).toBe('OKX')
    expect(marketSourceOf('https://api.bitget.com/api/v2/spot/market/candles')).toBe('Bitget')
    expect(marketSourceOf(new URL('https://api.gateio.ws/api/v4/spot/candlesticks'))).toBe('Gate')
  })

  it('falls back to the host, or a neutral name for something that is not a URL', () => {
    expect(marketSourceOf('https://api.example.com/x')).toBe('api.example.com')
    expect(marketSourceOf('not a url')).toBe('Market data')
  })
})

describe('MarketDataHttpError', () => {
  it('names the exchange and the status, without a dangling space when there is no status text', () => {
    expect(new MarketDataHttpError(503, 'Service Unavailable', `${BYBIT_REST_ENDPOINT}/kline`).message).toBe(
      'Bybit market-data request failed (503 Service Unavailable)',
    )
    const error = new MarketDataHttpError(429, '', 'https://api.gateio.ws/api/v4/spot/candlesticks')
    expect(error.message).toBe('Gate market-data request failed (429)')
    expect(error).toMatchObject({ status: 429, statusText: '', source: 'Gate' })
  })

  it('is thrown with the right exchange from Binance and from the other venues', async () => {
    await expect(fetchBinanceKlines({ interval: '1h' }, failWith(500, 'Internal Server Error'))).rejects.toThrow(
      'Binance market-data request failed (500 Internal Server Error)',
    )
    await expect(
      fetchVenueKlines(
        { venue: 'gate', apiSymbol: 'BTC_USDT', symbol: 'GATE:BTCUSDT', marketId: 'gate:spot:BTCUSDT', interval: '1h', limit: 1 },
        failWith(503),
      ),
    ).rejects.toThrow('Gate market-data request failed (503)')
    await expect(
      fetchVenueKlines(
        { venue: 'okx', apiSymbol: 'BTC-USDT', symbol: 'OKX:BTCUSDT', marketId: 'okx:spot:BTCUSDT', interval: '1h', limit: 1 },
        failWith(403),
      ),
    ).rejects.toThrow('OKX market-data request failed (403)')
  })
})
