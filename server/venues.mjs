// The other exchanges in the coin catalog (Bybit perpetuals, OKX, Bitget, Gate: spot and USDT perpetuals) and their
// last prices for alerts. Our symbols carry the exchange as a prefix ("OKX:BTCUSDT", "GATE:BTCUSDT.P"); `apiSymbol`
// is the exchange's own name for the pair.
import { precisionFromStep } from './markets.mjs'

const SYMBOL = /^[A-Z0-9]{1,30}$/

function decimals(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 12 ? number : fallback
}

function listing(exchange, prefix, base, apiSymbol, pricePrecision, volumePrecision, perpetual) {
  if (typeof base !== 'string' || !SYMBOL.test(base)) return undefined
  return {
    exchange,
    symbol: `${prefix}:${base}USDT${perpetual ? '.P' : ''}`,
    baseAsset: base,
    apiSymbol,
    pricePrecision,
    volumePrecision,
  }
}

export function parseBybitLinear(payload) {
  const list = payload?.result?.list
  if (!Array.isArray(list)) throw new TypeError('Bybit linear instruments have no list')
  return list.filter((item) => item?.status === 'Trading' && item.contractType === 'LinearPerpetual' && item.quoteCoin === 'USDT' && typeof item.symbol === 'string')
    .map((item) => listing('bybit-futures', 'BYBIT', item.baseCoin, item.symbol, precisionFromStep(item.priceFilter?.tickSize, 4), precisionFromStep(item.lotSizeFilter?.qtyStep, 3), true))
    .filter(Boolean)
}

export function parseOkx(payload, swap) {
  const list = payload?.data
  if (!Array.isArray(list)) throw new TypeError('OKX instruments have no data')
  return list.filter((item) => item?.state === 'live' && (swap ? item.settleCcy === 'USDT' && item.ctType === 'linear' : item.quoteCcy === 'USDT'))
    .map((item) => listing(swap ? 'okx-futures' : 'okx', 'OKX', swap ? item.ctValCcy : item.baseCcy, item.instId, precisionFromStep(item.tickSz, 4), precisionFromStep(item.lotSz, 3), swap))
    .filter(Boolean)
}

export function parseBitget(payload, mix) {
  const list = payload?.data
  if (!Array.isArray(list)) throw new TypeError('Bitget symbols have no data')
  return list.filter((item) => (mix ? item?.symbolStatus === 'normal' : item?.status === 'online') && item.quoteCoin === 'USDT')
    .map((item) => listing(mix ? 'bitget-futures' : 'bitget', 'BITGET', item.baseCoin, item.symbol,
      decimals(mix ? item.pricePlace : item.pricePrecision, 4), decimals(mix ? item.volumePlace : item.quantityPrecision, 3), mix))
    .filter(Boolean)
}

export function parseGate(payload, futures) {
  if (!Array.isArray(payload)) throw new TypeError('Gate list is not an array')
  return payload.filter((item) => (futures ? item?.status === 'trading' && !item.in_delisting && typeof item.name === 'string' && item.name.endsWith('_USDT') : item?.trade_status === 'tradable' && item.quote === 'USDT'))
    .map((item) => (futures
      ? listing('gate-futures', 'GATE', item.name.slice(0, -'_USDT'.length), item.name, precisionFromStep(item.order_price_round, 4), 3, true)
      : listing('gate', 'GATE', item.base, item.id, decimals(item.precision, 4), decimals(item.amount_precision, 3), false)))
    .filter(Boolean)
}

export const VENUE_LISTS = [
  { name: 'Bybit perpetuals', url: 'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000', parse: parseBybitLinear, pages: 'bybit' },
  { name: 'OKX spot', url: 'https://www.okx.com/api/v5/public/instruments?instType=SPOT', parse: (payload) => parseOkx(payload, false) },
  { name: 'OKX perpetuals', url: 'https://www.okx.com/api/v5/public/instruments?instType=SWAP', parse: (payload) => parseOkx(payload, true) },
  { name: 'Bitget spot', url: 'https://api.bitget.com/api/v2/spot/public/symbols', parse: (payload) => parseBitget(payload, false) },
  { name: 'Bitget perpetuals', url: 'https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES', parse: (payload) => parseBitget(payload, true) },
  { name: 'Gate spot', url: 'https://api.gateio.ws/api/v4/spot/currency_pairs', parse: (payload) => parseGate(payload, false) },
  { name: 'Gate perpetuals', url: 'https://api.gateio.ws/api/v4/futures/usdt/contracts', parse: (payload) => parseGate(payload, true) },
]

/** Every list, one failing exchange only leaving out its own pairs. Bybit's list is paged with a cursor. */
export async function fetchVenueListings(getJson, log = console) {
  const results = await Promise.all(VENUE_LISTS.map(async (venue) => {
    try {
      if (venue.pages !== 'bybit') return venue.parse(await getJson(venue.url))
      const all = []
      let cursor = ''
      for (let page = 0; page < 10; page += 1) {
        const payload = await getJson(`${venue.url}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        all.push(...venue.parse(payload))
        cursor = payload?.result?.nextPageCursor ?? ''
        if (!cursor) break
      }
      return all
    } catch (error) {
      log.warn?.(`[markets] ${venue.name} unavailable: ${error.message}`)
      return []
    }
  }))
  return results.flat()
}

/** Last prices of one venue, keyed by the exchange's own symbol (one request for the whole exchange). */
export const VENUE_TICKERS = {
  'bybit-futures': { url: 'https://api.bybit.com/v5/market/tickers?category=linear', rows: (payload) => payload?.result?.list, symbol: 'symbol', price: 'lastPrice' },
  okx: { url: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT', rows: (payload) => payload?.data, symbol: 'instId', price: 'last' },
  'okx-futures': { url: 'https://www.okx.com/api/v5/market/tickers?instType=SWAP', rows: (payload) => payload?.data, symbol: 'instId', price: 'last' },
  bitget: { url: 'https://api.bitget.com/api/v2/spot/market/tickers', rows: (payload) => payload?.data, symbol: 'symbol', price: 'lastPr' },
  'bitget-futures': { url: 'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES', rows: (payload) => payload?.data, symbol: 'symbol', price: 'lastPr' },
  gate: { url: 'https://api.gateio.ws/api/v4/spot/tickers', rows: (payload) => payload, symbol: 'currency_pair', price: 'last' },
  'gate-futures': { url: 'https://api.gateio.ws/api/v4/futures/usdt/tickers', rows: (payload) => payload, symbol: 'contract', price: 'last' },
}
