import { MARKET_INTERVAL_SPECS, type MarketInterval } from '../market'

/** When the candle that opened at `openMs` closes. Calendar months are not a fixed length. */
export function candleCloseMs(openMs: number, interval: MarketInterval): number {
  const duration = MARKET_INTERVAL_SPECS[interval].durationMs
  if (duration !== null) return openMs + duration
  const open = new Date(openMs)
  return Date.UTC(open.getUTCFullYear(), open.getUTCMonth() + 1, 1)
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** "42:07", "1:05:09" or, for daily and longer candles, "2d 03:05:09". Never negative. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${pad(minutes)}:${pad(seconds)}`
}
