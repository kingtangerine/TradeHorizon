import { useEffect, useState } from 'react'
import { fetchFuturesStats, fundingCountdown, type FuturesStats } from '../market/binance/futures'
import { formatCompact, formatPrice } from './format'

// Legend line for perpetual futures: funding rate with the time to the next funding, mark price and open interest.
// Refreshed every 30 seconds; the countdown ticks every second without asking Binance again.

const REFRESH_MS = 30_000

export function FuturesStatsRow({ symbol, baseAsset, precision }: { symbol: string, baseAsset: string, precision: number }) {
  const [stats, setStats] = useState<FuturesStats>()
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      fetchFuturesStats(symbol, controller.signal)
        .then((next) => { setStats(next); setFailed(false) })
        .catch(() => { if (!controller.signal.aborted) setFailed(true) })
        .finally(() => { if (!controller.signal.aborted) timer = setTimeout(load, REFRESH_MS) })
    }
    setStats(undefined)
    load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [symbol])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  if (!stats) return failed ? <div className="chart-futures-row muted">Funding and open interest unavailable</div> : null
  const rate = stats.fundingRate * 100
  return (
    <div className="chart-futures-row" title="Binance USDT-M perpetual: funding is paid between longs and shorts every funding period; open interest is the number of open contracts.">
      <span>Funding <b className={rate >= 0 ? 'price-up' : 'price-down'}>{rate >= 0 ? '+' : ''}{rate.toFixed(4)}%</b> <small>{fundingCountdown(stats.nextFundingTimeMs, now)}</small></span>
      <span>Mark <b>{formatPrice(stats.markPrice, precision)}</b></span>
      {stats.openInterest !== undefined && (
        <span>OI <b>{formatCompact(stats.openInterest)} {baseAsset}</b> <small>${formatCompact(stats.openInterest * stats.markPrice)}</small></span>
      )}
    </div>
  )
}
